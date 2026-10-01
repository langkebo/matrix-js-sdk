/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * `DirectMessageManager` 门面层测试。
 *
 * 覆盖三条既有 spec 漏掉的分支（2026-10-01 定向覆盖率实测 65.75%）：
 *
 * 1. **生命周期**：`start()` 的并发复用（FT-115：`startPromise` 让并发调用共享同一次初始化）、
 *    失败后的重试语义（失败要清空 `startPromise` 否则永远卡在 rejected promise）、
 *    `stop()` 的监听器解绑（否则 stop 之后事件还会继续冒泡）。
 * 2. **事件转发**：`forwardSubManagerEvents()` 把三个 sub-manager 的事件重新 emit 到顶层，
 *    这是 `@deprecated 委托方法` 能保持向后兼容的关键。
 * 3. **原型扩展**：`extendMatrixClient()` 的两个幂等守卫 —— `MatrixClient.prototype`
 *    不存在时直接返回、已经有 `getDirectMessageManager` 时不重复打补丁。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { DirectMessageManager, DMEvent, extendMatrixClient } from "../../../src/dm/index";
import { MatrixClient } from "../../../src/client";

describe("DirectMessageManager 门面层", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let dmManager: DirectMessageManager;

    beforeEach(() => {
        mockClient = {
            createRoom: vi.fn(),
            getRooms: vi.fn().mockReturnValue([]),
            getAccountData: vi.fn().mockReturnValue(null),
            setAccountData: vi.fn().mockResolvedValue({}),
            leave: vi.fn().mockResolvedValue({}),
            getRoom: vi.fn().mockReturnValue(null),
            setRoomReadMarkers: vi.fn().mockResolvedValue({}),
            getReadReceiptsManager: vi.fn(),
            sendEvent: vi.fn().mockResolvedValue({ event_id: "$evt:example.com" }),
            getUserId: vi.fn().mockReturnValue("@test:example.com"),
            getHomeserverUrl: vi.fn().mockReturnValue("https://example.com"),
        };
        dmManager = new DirectMessageManager(mockClient);
    });

    // ========================================================================
    // 1. 生命周期：start() / stop()
    // ========================================================================

    describe("start()", () => {
        it("第二次调用在已初始化时直接返回，不重复请求 account data", async () => {
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({ "@alice:example.com": ["!dm1:example.com"] }),
            });

            await dmManager.start();
            const callsAfterFirst = mockClient.getAccountData.mock.calls.length;

            await dmManager.start();

            expect(mockClient.getAccountData.mock.calls.length).toBe(callsAfterFirst);
        });

        it("并发调用共享同一次初始化（FT-115）", async () => {
            let resolveAccountData: (value: unknown) => void = () => {};
            mockClient.getAccountData.mockImplementation(
                () =>
                    new Promise((resolve) => {
                        resolveAccountData = resolve;
                    }),
            );

            // 三个并发 start()，只应触发一次 account data 读取
            const p1 = dmManager.start();
            const p2 = dmManager.start();
            const p3 = dmManager.start();

            expect(mockClient.getAccountData).toHaveBeenCalledTimes(1);

            resolveAccountData({ getContent: () => ({}) });
            await Promise.all([p1, p2, p3]);

            expect(mockClient.getAccountData).toHaveBeenCalledTimes(1);
        });

        it("初始化失败时不抛异常，但清空 startPromise 允许下次重试", async () => {
            mockClient.getAccountData.mockImplementationOnce(() => {
                throw new Error("network down");
            });

            // 第一次失败：静默降级（不抛）
            await expect(dmManager.start()).resolves.toBeUndefined();

            // 第二次可以重试（因为 startPromise 被清空了）
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({ "@bob:example.com": ["!dm2:example.com"] }),
            });
            await dmManager.start();

            // 重试成功后 userDmMapCache 应被填充
            expect(dmManager.userDmMapCache.get("@bob:example.com")).toBe("!dm2:example.com");
        });

        it("忽略 userId 对应的空房间列表（不写入空数组）", async () => {
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({
                    "@alice:example.com": [],
                    "@bob:example.com": ["!dm:example.com"],
                }),
            });

            await dmManager.start();

            expect(dmManager.userDmMapCache.get("@alice:example.com")).toBeUndefined();
            expect(dmManager.userDmMapCache.get("@bob:example.com")).toBe("!dm:example.com");
        });

        it("每个 userId 只取第一个房间 ID", async () => {
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({
                    "@alice:example.com": ["!first:example.com", "!second:example.com"],
                }),
            });

            await dmManager.start();

            expect(dmManager.userDmMapCache.get("@alice:example.com")).toBe("!first:example.com");
        });
    });

    describe("stop()", () => {
        it("清空 list manager 的缓存", async () => {
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({ "@alice:example.com": ["!dm:example.com"] }),
            });
            await dmManager.start();
            expect(dmManager.getCacheStats().userDmMap.size).toBe(1);

            dmManager.stop();

            expect(dmManager.getCacheStats().userDmMap.size).toBe(0);
        });

        it("解绑 sub-manager 监听器，stop 后不再向外转发事件", () => {
            const forwarded = vi.fn();
            dmManager.on(DMEvent.ListUpdated, forwarded);

            dmManager.stop();
            forwarded.mockClear();

            // stop 之后 sub-manager 再发事件，不应冒泡到顶层
            dmManager.list.emit(DMEvent.ListUpdated);
            dmManager.creation.emit(DMEvent.ListUpdated);
            dmManager.operation.emit(DMEvent.ListUpdated);

            expect(forwarded).not.toHaveBeenCalled();
        });

        it("允许 stop 后重新 start（isInitialized 被重置）", async () => {
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({ "@alice:example.com": ["!dm1:example.com"] }),
            });
            await dmManager.start();
            dmManager.stop();

            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({ "@bob:example.com": ["!dm2:example.com"] }),
            });
            await dmManager.start();

            expect(dmManager.userDmMapCache.get("@bob:example.com")).toBe("!dm2:example.com");
        });
    });

    // ========================================================================
    // 2. 事件转发
    // ========================================================================

    describe("事件转发", () => {
        it("list manager 的 ListUpdated 转发到顶层", () => {
            const handler = vi.fn();
            dmManager.on(DMEvent.ListUpdated, handler);

            dmManager.list.emit(DMEvent.ListUpdated);

            expect(handler).toHaveBeenCalledTimes(1);
        });

        it("creation manager 的 DMCreated 转发到顶层（带参数）", () => {
            const handler = vi.fn();
            dmManager.on(DMEvent.DMCreated, handler);

            dmManager.creation.emit(DMEvent.DMCreated, "!new:example.com", ["@alice:example.com"]);

            expect(handler).toHaveBeenCalledWith("!new:example.com", ["@alice:example.com"]);
        });

        it("operation manager 的 DMLeft 转发到顶层", () => {
            const handler = vi.fn();
            dmManager.on(DMEvent.DMLeft, handler);

            dmManager.operation.emit(DMEvent.DMLeft, "!left:example.com");

            expect(handler).toHaveBeenCalledWith("!left:example.com");
        });

        it("DMUpdated 同样被转发", () => {
            const handler = vi.fn();
            dmManager.on(DMEvent.DMUpdated, handler);

            dmManager.list.emit(DMEvent.DMUpdated, "!updated:example.com");

            expect(handler).toHaveBeenCalledWith("!updated:example.com");
        });
    });

    // ========================================================================
    // 3. 缓存访问器（向后兼容）
    // ========================================================================

    describe("缓存访问器代理", () => {
        it("dmRoomsCache 与 userDmMapCache 代理到 list manager 的同一实例", () => {
            expect(dmManager.dmRoomsCache).toBe(dmManager.list.dmRoomsCache);
            expect(dmManager.userDmMapCache).toBe(dmManager.list.userDmMapCache);
        });

        it("getCacheStats 返回 list manager 的统计", () => {
            const stats = dmManager.getCacheStats();

            expect(stats).toHaveProperty("dmRooms");
            expect(stats).toHaveProperty("userDmMap");
            expect(stats.dmRooms).toHaveProperty("hitRate");
            expect(stats.userDmMap).toHaveProperty("misses");
        });
    });

    // ========================================================================
    // 4. 服务端 DM REST API 委托（synapse-rust 自定义端点）
    // ========================================================================

    describe("服务端 DM REST API 委托", () => {
        it("getRoomDm 委托到 list.getRoomDm", async () => {
            const spy = vi.spyOn(dmManager.list, "getRoomDm").mockResolvedValue({ is_dm: true } as never);

            await dmManager.getRoomDm("!room:example.com");

            expect(spy).toHaveBeenCalledWith("!room:example.com");
        });

        it("setDirect 委托到 list.setDirect", async () => {
            const spy = vi.spyOn(dmManager.list, "setDirect").mockResolvedValue(undefined);

            await dmManager.setDirect("!room:example.com");

            expect(spy).toHaveBeenCalledWith("!room:example.com");
        });

        it("leaveDm 委托到 operation.leaveDm", async () => {
            const spy = vi.spyOn(dmManager.operation, "leaveDm").mockResolvedValue(undefined);

            await dmManager.leaveDm("!room:example.com");

            expect(spy).toHaveBeenCalledWith("!room:example.com");
        });

        it("markDmAsRead 委托到 operation.markDmAsRead", async () => {
            const spy = vi.spyOn(dmManager.operation, "markDmAsRead").mockResolvedValue(undefined);

            await dmManager.markDmAsRead("!room:example.com");

            expect(spy).toHaveBeenCalledWith("!room:example.com");
        });

        it("sendDmMessage 委托到 operation.sendDmMessage 并回传 event_id", async () => {
            const spy = vi
                .spyOn(dmManager.operation, "sendDmMessage")
                .mockResolvedValue("$sent:example.com");

            const result = await dmManager.sendDmMessage("!room:example.com", "hello");

            expect(spy).toHaveBeenCalledWith("!room:example.com", "hello");
            expect(result).toBe("$sent:example.com");
        });
    });

    // ========================================================================
    // 5. updateDirectRoom 的 overload 分发
    // ========================================================================

    describe("updateDirectRoom overload 分发", () => {
        it("传数组时走 userIds 分支", async () => {
            const spy = vi
                .spyOn(dmManager.creation, "updateDirectRoom")
                .mockResolvedValue({ updated: true } as never);

            await dmManager.updateDirectRoom("!room:example.com", ["@alice:example.com"]);

            expect(spy).toHaveBeenCalledWith("!room:example.com", ["@alice:example.com"]);
        });

        it("传对象时走 options 分支", async () => {
            const options = { userIds: ["@bob:example.com"], extra: true } as never;
            const spy = vi.spyOn(dmManager.creation, "updateDirectRoom").mockResolvedValue({ updated: true } as never);

            await dmManager.updateDirectRoom("!room:example.com", options);

            expect(spy).toHaveBeenCalledWith("!room:example.com", options);
        });
    });

    // ========================================================================
    // 6. extendMatrixClient 的幂等守卫
    // ========================================================================

    describe("extendMatrixClient()", () => {
        it("给 MatrixClient.prototype 打上 getDirectMessageManager 补丁", () => {
            extendMatrixClient();

            expect(typeof MatrixClient.prototype.getDirectMessageManager).toBe("function");
        });

        it("重复调用不会二次打补丁（hasOwnProperty 守卫）", () => {
            extendMatrixClient();
            const first = MatrixClient.prototype.getDirectMessageManager;

            extendMatrixClient();
            const second = MatrixClient.prototype.getDirectMessageManager;

            expect(second).toBe(first);
        });

        it("补丁返回同一个 manager 实例（getOrCreateManager 语义）", () => {
            extendMatrixClient();

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const fakeClient = { ...mockClient } as any;
            const a = MatrixClient.prototype.getDirectMessageManager.call(fakeClient);
            const b = MatrixClient.prototype.getDirectMessageManager.call(fakeClient);

            expect(a).toBe(b);
            expect(a).toBeInstanceOf(DirectMessageManager);
        });
    });
});