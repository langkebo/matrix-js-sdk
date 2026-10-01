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
 * ISSUE-06 验证方案（L2 real-backend）：
 *
 * 此前 /messages 的分页 token 为 `t{origin_server_ts}` 时间戳且使用严格
 * 不等号，同毫秒多事件在页边界被跳过。修复后 token 升级为 `t{ts}_{stream_id}`
 * 复合格式（ts 粗筛 + stream_id 精确去重），保持 opaque 对 SDK 无感。
 *
 * 验证步骤：
 * 1. 注册用户、创建房间
 * 2. 连续发送 3 条消息（快速发送以提高同毫秒概率）
 * 3. 以 limit=2 向后翻页，获取两页
 * 4. 断言两页合计 3 条事件且无重复 event_id
 *
 * 注意：真实同毫秒场景需要后端测试钩子直接落库才能保证。
 * 此测试验证复合 token 的基本分页正确性——即使事件不在同一毫秒，
 * 复合 token 也应正确去重，不丢消息、不重复。
 *
 * 修复前（纯时间戳 token + 严格不等号）：页边界同毫秒事件被跳过，
 * 两页合计可能 < 3；修复后（复合 token）两页合计 = 3 且无重复。
 */
describe("ISSUE-06 messages pagination boundary (real backend)", () => {
    let client: MatrixClient | null = null;
    let backendAvailable = false;
    let setupError: unknown;
    let roomId = "";

    beforeAll(async () => {
        try {
            const user = createTestUser("msg_pagination");
            client = await registerTestUser(user);

            const room = await withRateLimitRetry(() => client!.createRoom({ name: `msg_pagination_${Date.now()}` }));
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

    it("paginating with limit=2 across 3 events returns all 3 without duplicates", async () => {
        if (!backendAvailable) throw new Error(`Backend unavailable: ${String(setupError)}`);

        // 1. 快速连续发送 3 条消息（提高同毫秒概率）
        const sentEventIds: string[] = [];
        for (let i = 0; i < 3; i++) {
            const resp = await withRateLimitRetry(() =>
                client!.http.authedRequest(
                    "PUT",
                    `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/txn_${Date.now()}_${i}`,
                    undefined,
                    { msgtype: "m.text", body: `pagination probe ${i}` },
                ),
            );
            sentEventIds.push((resp as { event_id: string }).event_id);
        }
        console.log(`ISSUE-06: sent ${sentEventIds.length} events: ${sentEventIds.join(", ")}`);

        // 等待事件落库
        await sleep(2000);

        // 2. 第一页：limit=2 向后翻页
        const firstPageResp = await withRateLimitRetry(() =>
            client!.http.authedRequest("GET", `/rooms/${encodeURIComponent(roomId)}/messages`, {
                dir: "b",
                limit: 2,
            }),
        );
        const firstPage = firstPageResp as {
            chunk: Array<{ event_id: string; type: string }>;
            end?: string;
        };
        const firstPageMessageEvents = firstPage.chunk.filter((e) => e.type === "m.room.message");
        console.log(
            `ISSUE-06: first page has ${firstPageMessageEvents.length} messages, end token=${firstPage.end ?? "none"}`,
        );

        // 第一页应有 2 条消息（limit=2）
        expect(firstPageMessageEvents.length).toBe(2);

        // 3. 第二页：使用第一页的 end token 继续翻页
        expect(firstPage.end).toBeTruthy();
        const secondPageResp = await withRateLimitRetry(() =>
            client!.http.authedRequest("GET", `/rooms/${encodeURIComponent(roomId)}/messages`, {
                dir: "b",
                limit: 2,
                from: firstPage.end,
            }),
        );
        const secondPage = secondPageResp as {
            chunk: Array<{ event_id: string; type: string }>;
            end?: string;
        };
        const secondPageMessageEvents = secondPage.chunk.filter((e) => e.type === "m.room.message");
        console.log(
            `ISSUE-06: second page has ${secondPageMessageEvents.length} messages, end token=${secondPage.end ?? "none"}`,
        );

        // 第二页应有 1 条消息（剩余的 1 条）
        expect(secondPageMessageEvents.length).toBe(1);

        // 4. 核心断言：两页合计 3 条且无重复
        const allEventIds = [
            ...firstPageMessageEvents.map((e) => e.event_id),
            ...secondPageMessageEvents.map((e) => e.event_id),
        ];
        const uniqueEventIds = new Set(allEventIds);

        console.log(`ISSUE-06: total ${allEventIds.length} events, ${uniqueEventIds.size} unique`);
        expect(allEventIds.length).toBe(3);
        expect(uniqueEventIds.size).toBe(3);

        // 所有发送的事件都应出现在分页结果中
        for (const sentId of sentEventIds) {
            expect(uniqueEventIds.has(sentId)).toBe(true);
        }
    }, 90_000);
});
