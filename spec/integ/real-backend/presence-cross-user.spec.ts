import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClientEvent, type MatrixClient, type MatrixEvent } from "../../../src/matrix";
import { MemoryStore } from "../../../src/store/memory";
import { extendMatrixClient as extendPresenceClient } from "../../../src/presence/index";
import { createClient } from "../../../src/matrix";
import { syncPromise } from "../../test-utils/test-utils";
import { TestConfig } from "./TestConfig";
import { loginAsConfiguredUser, sleep, withRateLimitRetry } from "./auth-test-helpers";

extendPresenceClient();

/**
 * ISSUE-01 验证方案（L2 real-backend）：
 * 用户 A、B 同房间，B 调 PUT /presence/{B}/status 置 online，断言 A 的 SDK
 * 在 2 个 sync 周期内收到 B 的 presence（User 模型 presence 字段更新，
 * 即 UserEvent.presence 的触发路径）。
 *
 * 修复前（后端只下发自己的 presence）此测试必失败；后端补扇出后转绿。
 *
 * 注意：presence 变化不推进 stream_id，A 的长轮询 /sync 不会被打醒，
 * 最坏要等一个 sync 超时周期才携带 presence 返回——因此超时预算给足
 * 两个 sync 周期（默认 sync timeout 30s × 2 + 余量）。
 */
describe("ISSUE-01 presence cross-user fanout (real backend)", () => {
    const PRESENCE_TIMEOUT_MS = 90_000;

    let clientA: MatrixClient | null = null;
    let clientB: MatrixClient | null = null;
    let backendAvailable = false;
    let setupError: unknown;
    let roomId = "";

    const bUserId = TestConfig.secondaryUser.userId;

    beforeAll(async () => {
        try {
            // A 需要 MemoryStore：sync 收到 presence 后 storeUser 持久化，
            // clientA.getUser(B) 才能读到 User 模型状态。
            clientA = await loginAsConfiguredUser(TestConfig.testUser);
            clientA.store = new MemoryStore();

            clientB = await loginAsConfiguredUser(TestConfig.secondaryUser);

            // A 建房并邀请 B，B 加入——建立共享房间关系（presence 扇出的前提）
            const room = await withRateLimitRetry(() =>
                clientA!.createRoom({ name: `presence_cross_user_${Date.now()}`, invite: [bUserId] }),
            );
            roomId = room.room_id;
            await withRateLimitRetry(() => clientB!.joinRoom(roomId));

            // 双方完成初始 sync（A 的扇出目标列表此时已包含 B）
            clientA.startClient({ initialSyncLimit: 10 });
            await syncPromise(clientA, 1);
            clientB.startClient({ initialSyncLimit: 10 });
            await syncPromise(clientB, 1);

            backendAvailable = true;
        } catch (error) {
            setupError = error;
            backendAvailable = false;
        }
    }, 120_000);

    afterAll(async () => {
        clientA?.stopClient();
        clientB?.stopClient();
        await clientA?.logout?.().catch(() => undefined);
        await clientB?.logout?.().catch(() => undefined);
    });

    it(
        "A receives B's presence update via /sync within 2 sync cycles",
        async () => {
            if (!backendAvailable) {
                throw new Error(`Backend unavailable: ${String(setupError)}`);
            }

            // 监听 A 的 sync 流中来自 B 的 m.presence 事件
            let presenceFromB: MatrixEvent | null = null;
            clientA!.on(ClientEvent.Event, (event: MatrixEvent) => {
                if (event.getType() === "m.presence" && event.getSender() === bUserId) {
                    presenceFromB = event;
                }
            });

            // B 显式置 online（带 status_msg 确保规范化载荷变化，触发增量下发）
            const statusMsg = `cross-user probe ${Date.now()}`;
            await clientB!.getPresenceManager().setPresence("online", statusMsg);

            // 等待 A 收到 B 的 presence（最长 2 个 sync 周期）
            const deadline = Date.now() + PRESENCE_TIMEOUT_MS;
            while (Date.now() < deadline) {
                const userB = clientA!.getUser(bUserId);
                if (presenceFromB && userB?.presence === "online") {
                    // sync 流收到事件 + User 模型已更新（UserEvent.presence 路径）
                    expect(presenceFromB.getContent().presence).toBe("online");
                    expect(userB.presenceStatusMsg).toBe(statusMsg);
                    return;
                }
                await sleep(1000);
            }

            throw new Error(
                `A did not receive B's presence within ${PRESENCE_TIMEOUT_MS}ms ` +
                    `(event received: ${presenceFromB !== null}, user in store: ${clientA!.getUser(bUserId)?.presence ?? "none"})`,
            );
        },
        PRESENCE_TIMEOUT_MS + 30_000,
    );
});
