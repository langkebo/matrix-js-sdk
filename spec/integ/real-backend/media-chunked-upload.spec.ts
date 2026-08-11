/*
Copyright 2026 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type MatrixClient } from "../../../src/matrix";
import { createTestUser, registerTestUser, sleep, withRateLimitRetry } from "./auth-test-helpers";

/**
 * ISSUE-04 验证方案（L2 real-backend）：
 *
 * 此前 SDK `uploadChunk` 只发 body 不带 queryParams，后端从 query 读取
 * `upload_id`/`chunk_index` 导致 `upload_id=None`，分块上传整体失效。
 * 修复后 SDK 通过 queryParams 传递这两个参数。
 *
 * 验证步骤：
 * 1. 注册用户
 * 2. startChunkUpload 获取 upload_id
 * 3. uploadChunk 传 2 个分片（各 4KB）
 * 4. completeChunkUpload 获取 content_uri
 * 5. download 断言字节一致
 *
 * 修复前 startChunkUpload 可能成功但 uploadChunk 因 upload_id=None 返回错误；
 * 修复后全流程通畅且下载字节与上传一致。
 */
describe("ISSUE-04 media chunked upload (real backend)", () => {
    let client: MatrixClient | null = null;
    let backendAvailable = false;
    let setupError: unknown;

    // 每个分片 4KB，2 个分片共 8KB
    const CHUNK_SIZE = 4096;
    const CHUNK_COUNT = 2;
    const TOTAL_SIZE = CHUNK_SIZE * CHUNK_COUNT;

    beforeAll(async () => {
        try {
            const user = createTestUser("chunk_upload");
            client = await registerTestUser(user);
            backendAvailable = true;
        } catch (error) {
            setupError = error;
            backendAvailable = false;
        }
    }, 60_000);

    afterAll(async () => {
        client?.stopClient();
        await client?.logout?.().catch(() => undefined);
    });

    it("completes chunked upload and downloaded bytes match", async () => {
        if (!backendAvailable) throw new Error(`Backend unavailable: ${String(setupError)}`);

        const mediaManager = client!.getMediaManager();

        // 1. startChunkUpload
        const startResp = await withRateLimitRetry(() =>
            mediaManager.startChunkUpload(`chunk_test_${Date.now()}.bin`, "application/octet-stream", TOTAL_SIZE),
        );
        expect(startResp.upload_id).toBeTruthy();
        console.log(`ISSUE-04: startChunkUpload upload_id=${startResp.upload_id}`);

        // 2. uploadChunk × 2
        const chunk0 = new Uint8Array(CHUNK_SIZE);
        const chunk1 = new Uint8Array(CHUNK_SIZE);
        // 填充可识别的字节模式，便于下载后验证
        for (let i = 0; i < CHUNK_SIZE; i++) {
            chunk0[i] = i % 256;
            chunk1[i] = (255 - i) % 256;
        }

        const chunkResp0 = await withRateLimitRetry(() =>
            mediaManager.uploadChunk(startResp.upload_id, 0, chunk0.buffer),
        );
        expect(chunkResp0.upload_id).toBe(startResp.upload_id);
        console.log(`ISSUE-04: chunk 0 uploaded, status=${chunkResp0.status}`);

        await sleep(500); // 避免 429

        const chunkResp1 = await withRateLimitRetry(() =>
            mediaManager.uploadChunk(startResp.upload_id, 1, chunk1.buffer),
        );
        expect(chunkResp1.upload_id).toBe(startResp.upload_id);
        console.log(`ISSUE-04: chunk 1 uploaded, status=${chunkResp1.status}`);

        // 3. completeChunkUpload
        await sleep(500);
        const completeResp = await withRateLimitRetry(() => mediaManager.completeChunkUpload(startResp.upload_id));
        expect(completeResp.content_uri).toBeTruthy();
        console.log(`ISSUE-04: completeChunkUpload content_uri=${completeResp.content_uri}`);

        // 4. download 并验证字节
        const downloadUrl = mediaManager.getDownloadUrl(completeResp.content_uri);
        const downloadResp = await fetch(downloadUrl);
        expect(downloadResp.ok).toBe(true);

        const downloadedBytes = new Uint8Array(await downloadResp.arrayBuffer());
        expect(downloadedBytes.length).toBe(TOTAL_SIZE);

        // 验证字节模式匹配
        for (let i = 0; i < CHUNK_SIZE; i++) {
            expect(downloadedBytes[i]).toBe(i % 256);
            expect(downloadedBytes[CHUNK_SIZE + i]).toBe((255 - i) % 256);
        }

        console.log(`ISSUE-04: downloaded ${downloadedBytes.length} bytes, all bytes match`);
    }, 120_000);
});
