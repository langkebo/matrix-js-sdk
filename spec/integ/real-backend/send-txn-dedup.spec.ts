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
 * ISSUE-03 验证方案（L2 real-backend）：
 *
 * 后端 txn 去重已落 DB 唯一约束（`room_event_txn_dedup`，
 * UNIQUE(sender, room_id, txn_id)）。同 txnId 连续 PUT /send 两次，
 * 后端应返回同一 event_id，且房间内仅 1 条事件。
 *
 * 验证步骤：
 * 1. 注册用户、创建房间
 * 2. 用同一 txnId 连续 PUT /rooms/{roomId}/send/m.room.message/{txnId} 两次
 * 3. 断言两次返回同一 event_id
 * 4. 查询 /messages 断言房间仅 1 条该类型事件
 *
 * 修复前（仅缓存去重，TTL 1h）：缓存命中时返回同 event_id，但缓存失效后
 * 重复 PUT 会创建第二条事件；修复后（DB 唯一约束）永久去重。
 */
describe("ISSUE-03 send txn dedup (real backend)", () => {
    let client: MatrixClient | null = null;
    let backendAvailable = false;
    let setupError: unknown;
    let roomId = "";

    beforeAll(async () => {
        try {
            const user = createTestUser("txn_dedup");
            client = await registerTestUser(user);

            const room = await withRateLimitRetry(() => client!.createRoom({ name: `txn_dedup_${Date.now()}` }));
            roomId = room.room_id;
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

    it("duplicate PUT with same txnId returns same event_id and room has 1 event", async () => {
        if (!backendAvailable) throw new Error(`Backend unavailable: ${String(setupError)}`);

        const txnId = `txn_dedup_test_${Date.now()}`;
        const body = { msgtype: "m.text", body: `dedup probe ${Date.now()}` };

        // 第一次 PUT /send
        const firstResp = await withRateLimitRetry(() =>
            client!.http.authedRequest(
                "PUT",
                `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`,
                undefined,
                body,
            ),
        );
        const firstEventId = (firstResp as { event_id: string }).event_id;
        expect(firstEventId).toBeTruthy();
        console.log(`ISSUE-03: first PUT event_id=${firstEventId}`);

        await sleep(500);

        // 第二次 PUT /send（同 txnId，应被去重）
        const secondResp = await withRateLimitRetry(() =>
            client!.http.authedRequest(
                "PUT",
                `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`,
                undefined,
                body,
            ),
        );
        const secondEventId = (secondResp as { event_id: string }).event_id;
        expect(secondEventId).toBeTruthy();
        console.log(`ISSUE-03: second PUT event_id=${secondEventId}`);

        // 核心断言：两次返回同一 event_id
        expect(secondEventId).toBe(firstEventId);

        // 查询 /messages 断言房间仅 1 条 m.room.message 事件
        await sleep(1000); // 等待事件落库
        const messagesResp = await withRateLimitRetry(() =>
            client!.http.authedRequest("GET", `/rooms/${encodeURIComponent(roomId)}/messages`, {
                dir: "b",
                limit: 10,
            }),
        );
        const chunk = (messagesResp as { chunk: Array<{ type: string; event_id: string }> }).chunk ?? [];
        const messageEvents = chunk.filter((e) => e.type === "m.room.message");

        console.log(`ISSUE-03: room has ${messageEvents.length} m.room.message events`);
        expect(messageEvents.length).toBe(1);
        expect(messageEvents[0].event_id).toBe(firstEventId);
    }, 60_000);
});
