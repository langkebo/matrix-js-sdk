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

import { type MatrixClient, MediaPrefix } from "../../../src/matrix";
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
 * 2. 通过 http.authedRequest 调用 /upload/chunk/start（含 total_chunks）
 * 3. uploadChunk 传 1 个分片（4KB）—— 若 queryParams 未传递则后端返回 400
 * 4. completeChunkUpload 获取 content_uri
 * 5. download 断言字节一致
 *
 * 修复前 uploadChunk 返回 "upload_id is required as a query parameter" (400)；
 * 修复后全流程通畅且下载字节与上传一致。
 */
describe("ISSUE-04 media chunked upload (real backend)", () => {
    let client: MatrixClient | null = null;
    let backendAvailable = false;
    let setupError: unknown;

    const CHUNK_SIZE = 4096;

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

        // 1. startChunkUpload — 通过 http.authedRequest 传 total_chunks=1
        const filename = `chunk_test_${Date.now()}.bin`;
        const startResp = await withRateLimitRetry(() =>
            client!.http.authedRequest(
                "POST",
                "/upload/chunk/start",
                undefined,
                {
                    filename,
                    content_type: "application/octet-stream",
                    total_size: CHUNK_SIZE,
                    total_chunks: 1,
                },
                { prefix: MediaPrefix.V1 },
            ),
        );
        const uploadId = (startResp as { upload_id: string }).upload_id;
        expect(uploadId).toBeTruthy();
        console.log(`ISSUE-04: startChunkUpload upload_id=${uploadId}`);

        // 2. uploadChunk — 核心验证点：upload_id/chunk_index 通过 queryParams 传递
        //    修复前：后端返回 400 "upload_id is required as a query parameter"
        //    修复后：返回 200，chunk 上传成功
        const chunkData = new Uint8Array(CHUNK_SIZE);
        for (let i = 0; i < CHUNK_SIZE; i++) {
            chunkData[i] = i % 256;
        }

        const chunkResp = await withRateLimitRetry(() => mediaManager.uploadChunk(uploadId, 0, chunkData.buffer));
        expect(chunkResp.upload_id).toBe(uploadId);
        expect(chunkResp.status).toBe("complete");
        console.log(
            `ISSUE-04: chunk uploaded, status=${chunkResp.status}, ` +
                `uploaded_chunks=${chunkResp.uploaded_chunks}/${chunkResp.total_chunks}`,
        );

        // 3. completeChunkUpload
        await sleep(500);
        const completeResp = await withRateLimitRetry(() => mediaManager.completeChunkUpload(uploadId));
        expect(completeResp.content_uri).toBeTruthy();
        console.log(
            `ISSUE-04: completeChunkUpload content_uri=${completeResp.content_uri}, size=${completeResp.size}`,
        );

        // 4. download 并验证字节
        const downloadUrl = mediaManager.getDownloadUrl(completeResp.content_uri);
        const downloadResp = await fetch(downloadUrl);
        expect(downloadResp.ok).toBe(true);

        const downloadedBytes = new Uint8Array(await downloadResp.arrayBuffer());
        expect(downloadedBytes.length).toBe(CHUNK_SIZE);

        // 验证字节模式匹配
        for (let i = 0; i < CHUNK_SIZE; i++) {
            expect(downloadedBytes[i]).toBe(i % 256);
        }

        console.log(`ISSUE-04: downloaded ${downloadedBytes.length} bytes, all bytes match`);
    }, 120_000);
});
