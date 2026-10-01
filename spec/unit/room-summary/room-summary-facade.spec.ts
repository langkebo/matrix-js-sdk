/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * `RoomSummaryManager` 门面层补测。
 *
 * 2026-10-01 定向覆盖率实测 74.61%，未覆盖 49 行，集中在三处：
 *
 * 1. **缓存命中与 forceRefresh 短路**（`getRoomSummary:350-355`）——
 *    缓存命中时直接返回，完全不打网络。
 * 2. **`convertClientSummary` 的默认值兜底**（`join_rule` / `history_visibility` /
 *    `guest_access` 的 `||` 短路，以及 `heroes` 的字符串/对象联合类型守卫，:1041-1066）。
 * 3. **生命周期与监听器解绑**（`start` / `stop`，:1005-1014）——
 *    `stop()` 必须解绑 `forwardSubManagerEvents` 注册的监听器，否则事件泄漏。
 *
 * 另外补测 `requestV3` / `requestInternal` 两个私有请求封装的**前缀差异**：
 * 前者走 `ClientPrefix.V3`，后者走 `/_synapse/room_summary/v1`。
 * 这是 P2-a 路径契约门禁能覆盖到的语义边界，写成测试能防止将来两者被写混。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { RoomSummaryManager, extendMatrixClient, RoomSummaryEvent } from "../../../src/room-summary/index";
import { MatrixClient } from "../../../src/client";

/** 一份最小的 client summary，覆盖 `convertClientSummary` 会读到的全部字段。 */
function clientSummary(overrides: Record<string, unknown> = {}) {
    return {
        room_id: "!r:example.com",
        room_type: "m.room",
        name: "Test Room",
        topic: "a topic",
        avatar_url: null,
        canonical_alias: "#test:example.com",
        join_rule: "public",
        history_visibility: "world_readable",
        guest_access: "can_join",
        is_direct: true,
        is_space: false,
        is_encrypted: true,
        num_joined_members: 3,
        heroes: ["@alice:example.com"],
        last_event_ts: 1_700_000_000_000,
        last_message_ts: 1_700_000_000_500,
        ...overrides,
    };
}

describe("RoomSummaryManager 门面层", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: RoomSummaryManager;

    beforeEach(() => {
        mockClient = {
            getUserId: vi.fn().mockReturnValue("@tester:example.com"),
            getHomeserverUrl: vi.fn().mockReturnValue("https://example.com"),
        };
        manager = new RoomSummaryManager(mockClient);
        // request 是 BaseManager 的 protected 方法，从外部 spy
        vi.spyOn(manager as never, "request" as never).mockResolvedValue(clientSummary() as never);
    });

    /** 取出本轮最后一次 request 调用的 spec，便于断言 prefix / path。 */
    function lastRequestSpec(): { method: string; path: string; prefix?: string; body?: unknown } {
        const spy = vi.mocked((manager as never as { request: unknown }).request as never);
        const calls = (spy as unknown as { mock: { calls: unknown[][] } }).mock.calls;
        return calls[calls.length - 1]?.[0] as never;
    }

    // ========================================================================
    // 1. getRoomSummary 的缓存语义
    // ========================================================================

    describe("getRoomSummary 缓存语义", () => {
        it("首次调用打网络并写入缓存", async () => {
            const summary = await manager.getRoomSummary("!r:example.com");

            expect(summary?.room_id).toBe("!r:example.com");
            expect(lastRequestSpec().method).toBe("GET");
        });

        it("第二次调用命中缓存，不再打网络", async () => {
            await manager.getRoomSummary("!r:example.com");
            const spy = vi.mocked((manager as never as { request: unknown }).request as never);
            const afterFirst = (spy as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

            await manager.getRoomSummary("!r:example.com");

            expect((spy as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(afterFirst);
        });

        it("forceRefresh=true 绕过缓存重新请求", async () => {
            await manager.getRoomSummary("!r:example.com");
            const spy = vi.mocked((manager as never as { request: unknown }).request as never);
            const afterFirst = (spy as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

            await manager.getRoomSummary("!r:example.com", undefined, true);

            expect((spy as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(afterFirst + 1);
        });

        it("缓存 key 用的是传入的 roomIdOrAlias（含 alias 场景）", async () => {
            await manager.getRoomSummary("#alias:example.com");

            expect(lastRequestSpec().path).toContain(encodeURIComponent("#alias:example.com"));
        });

        it("网络失败且 throwOnError=false 时返回 null 并发射 Error 事件", async () => {
            vi.mocked((manager as never as { request: unknown }).request as never).mockRejectedValue(
                new Error("network down") as never,
            );
            const onError = vi.fn();
            manager.on(RoomSummaryEvent.Error, onError);

            await expect(manager.getRoomSummary("!r:example.com")).resolves.toBeNull();
            expect(onError).toHaveBeenCalled();
        });

        it("网络失败且 throwOnError=true 时抛错", async () => {
            vi.mocked((manager as never as { request: unknown }).request as never).mockRejectedValue(
                new Error("network down") as never,
            );

            await expect(manager.getRoomSummary("!r:example.com", undefined, false, true)).rejects.toThrow();
        });

        it("成功后发射 Updated 事件", async () => {
            const onUpdated = vi.fn();
            manager.on(RoomSummaryEvent.Updated, onUpdated);

            await manager.getRoomSummary("!r:example.com");

            expect(onUpdated).toHaveBeenCalledWith("!r:example.com", expect.objectContaining({ room_id: "!r:example.com" }));
        });

        it("clearCache(roomId) 只清该房间", async () => {
            await manager.getRoomSummary("!r1:example.com");
            await manager.getRoomSummary("!r2:example.com");
            expect(manager.isCached("!r1:example.com")).toBe(true);
            expect(manager.isCached("!r2:example.com")).toBe(true);

            manager.clearCache("!r1:example.com");

            expect(manager.isCached("!r1:example.com")).toBe(false);
            expect(manager.isCached("!r2:example.com")).toBe(true);
        });

        it("getCachedSummary 命中时返回同一对象引用", async () => {
            const first = await manager.getRoomSummary("!r:example.com");
            expect(manager.getCachedSummary("!r:example.com")).toBe(first);
        });

        it("getCachedSummary 未命中返回 null", () => {
            expect(manager.getCachedSummary("!missing:example.com")).toBeNull();
        });
    });

    // ========================================================================
    // 2. convertClientSummary 的默认值兜底
    // ========================================================================

    describe("convertClientSummary 默认值兜底", () => {
        it("join_rule 缺失时兜底为 invite", async () => {
            vi.mocked((manager as never as { request: unknown }).request as never).mockResolvedValue(
                clientSummary({ join_rule: undefined }) as never,
            );

            const summary = await manager.getRoomSummary("!r:example.com");

            expect(summary?.join_rule).toBe("invite");
        });

        it("join_rule 为空字符串时也兜底为 invite（|| 而非 ??）", async () => {
            vi.mocked((manager as never as { request: unknown }).request as never).mockResolvedValue(
                clientSummary({ join_rule: "" }) as never,
            );

            expect((await manager.getRoomSummary("!r:example.com"))?.join_rule).toBe("invite");
        });

        it("history_visibility 缺失时兜底为 shared", async () => {
            vi.mocked((manager as never as { request: unknown }).request as never).mockResolvedValue(
                clientSummary({ history_visibility: undefined }) as never,
            );

            expect((await manager.getRoomSummary("!r:example.com"))?.history_visibility).toBe("shared");
        });

        it("guest_access 缺失时兜底为 forbidden", async () => {
            vi.mocked((manager as never as { request: unknown }).request as never).mockResolvedValue(
                clientSummary({ guest_access: undefined }) as never,
            );

            expect((await manager.getRoomSummary("!r:example.com"))?.guest_access).toBe("forbidden");
        });

        it("num_joined_members 缺失时 member_count/joined_member_count 兜底为 0", async () => {
            vi.mocked((manager as never as { request: unknown }).request as never).mockResolvedValue(
                clientSummary({ num_joined_members: undefined }) as never,
            );

            const summary = await manager.getRoomSummary("!r:example.com");

            expect(summary?.member_count).toBe(0);
            expect(summary?.joined_member_count).toBe(0);
        });

        it("三个布尔字段用 ?? 兜底为 false（保留 false 本身，不被 || 吞掉）", async () => {
            vi.mocked((manager as never as { request: unknown }).request as never).mockResolvedValue(
                clientSummary({ is_direct: false, is_space: false, is_encrypted: false }) as never,
            );

            const summary = await manager.getRoomSummary("!r:example.com");

            expect(summary?.is_direct).toBe(false);
            expect(summary?.is_space).toBe(false);
            expect(summary?.is_encrypted).toBe(false);
        });

        it("invited_member_count 恒为 0（当前后端不提供）", async () => {
            expect((await manager.getRoomSummary("!r:example.com"))?.invited_member_count).toBe(0);
        });
    });

    // ========================================================================
    // 3. heroes 联合类型的类型守卫
    // ========================================================================

    describe("heroes 类型守卫", () => {
        it("字符串数组映射为 {user_id, display_name: undefined, avatar_url: undefined}", async () => {
            vi.mocked((manager as never as { request: unknown }).request as never).mockResolvedValue(
                clientSummary({ heroes: ["@a:example.com", "@b:example.com"] }) as never,
            );

            const summary = await manager.getRoomSummary("!r:example.com");

            expect(summary?.heroes).toEqual([
                { user_id: "@a:example.com", display_name: undefined, avatar_url: undefined },
                { user_id: "@b:example.com", display_name: undefined, avatar_url: undefined },
            ]);
        });

        it("对象数组保留 display_name 与 avatar_url", async () => {
            vi.mocked((manager as never as { request: unknown }).request as never).mockResolvedValue(
                clientSummary({
                    heroes: [{ user_id: "@a:example.com", display_name: "Alice", avatar_url: "mxc://x" }],
                }) as never,
            );

            const summary = await manager.getRoomSummary("!r:example.com");

            expect(summary?.heroes).toEqual([{ user_id: "@a:example.com", display_name: "Alice", avatar_url: "mxc://x" }]);
        });

        it("混合数组（字符串 + 对象）都能处理", async () => {
            vi.mocked((manager as never as { request: unknown }).request as never).mockResolvedValue(
                clientSummary({
                    heroes: ["@a:example.com", { user_id: "@b:example.com", display_name: "Bob", avatar_url: null }],
                }) as never,
            );

            const summary = await manager.getRoomSummary("!r:example.com");

            expect(summary?.heroes).toEqual([
                { user_id: "@a:example.com", display_name: undefined, avatar_url: undefined },
                { user_id: "@b:example.com", display_name: "Bob", avatar_url: null },
            ]);
        });

        it("heroes 缺失时返回空数组", async () => {
            vi.mocked((manager as never as { request: unknown }).request as never).mockResolvedValue(
                clientSummary({ heroes: undefined }) as never,
            );

            expect((await manager.getRoomSummary("!r:example.com"))?.heroes).toEqual([]);
        });
    });

    // ========================================================================
    // 4. 统计与指标
    // ========================================================================

    describe("统计与指标", () => {
        it("getCacheStats 返回 summary/members/stats 三个缓存的统计", () => {
            const stats = manager.getCacheStats();

            expect(stats).toHaveProperty("summary");
            expect(stats).toHaveProperty("members");
            expect(stats).toHaveProperty("stats");
            expect(stats.summary).toHaveProperty("size");
            expect(stats.members).toHaveProperty("size");
        });

        it("getRequestStats 聚合所有子 manager 的统计，初始不为 undefined", () => {
            const stats = manager.getRequestStats();

            expect(typeof stats.total).toBe("number");
            expect(typeof stats.successful).toBe("number");
        });

        it("getMetrics 返回汇总形状", () => {
            const metrics = manager.getMetrics();

            expect(metrics).toHaveProperty("cache");
            expect(metrics).toHaveProperty("requests");
        });

        it("getCachedMembers / getCachedStats 未命中返回空值", () => {
            expect(manager.getCachedMembers("!missing:example.com")).toEqual([]);
            expect(manager.getCachedStats("!missing:example.com")).toBeNull();
        });
    });

    // ========================================================================
    // 5. 生命周期：start / stop 的监听器解绑
    // ========================================================================

    describe("生命周期", () => {
        it("start() 是幂等的空实现（不抛错、不打网络）", async () => {
            const spy = vi.mocked((manager as never as { request: unknown }).request as never);
            await manager.start();

            expect(spy).not.toHaveBeenCalled();
        });

        it("stop() 清空所有缓存", async () => {
            await manager.getRoomSummary("!r:example.com");
            expect(manager.isCached("!r:example.com")).toBe(true);

            manager.stop();

            expect(manager.isCached("!r:example.com")).toBe(false);
        });

        it("stop() 解绑 members/stats 监听器，事件不再冒泡", () => {
            const onMembers = vi.fn();
            manager.on(RoomSummaryEvent.MembersUpdated, onMembers);

            manager.stop();
            onMembers.mockClear();

            manager.members.emit("MembersUpdated" as never, "!r:example.com", [] as never);

            expect(onMembers).not.toHaveBeenCalled();
        });
    });

    // ========================================================================
    // 6. 子管理器委托
    // ========================================================================

    describe("子管理器委托", () => {
        it("updateSummary 委托给 eventOps", async () => {
            const spy = vi.spyOn(manager.eventOps, "updateSummary").mockResolvedValue(null);

            await manager.updateSummary("!r:example.com", {} as never);

            expect(spy).toHaveBeenCalledWith("!r:example.com", {});
        });

        it("deleteSummary 委托给 eventOps", async () => {
            const spy = vi.spyOn(manager.eventOps, "deleteSummary").mockResolvedValue(undefined);

            await manager.deleteSummary("!r:example.com");

            expect(spy).toHaveBeenCalledWith("!r:example.com");
        });

        it("syncSummary 委托给 eventOps 且透传默认 body", async () => {
            const spy = vi.spyOn(manager.eventOps, "syncSummary").mockResolvedValue({} as never);

            await manager.syncSummary("!r:example.com");

            expect(spy).toHaveBeenCalledWith("!r:example.com", {});
        });

        it("createOrRefreshSummary 委托给 eventOps", async () => {
            const spy = vi.spyOn(manager.eventOps, "createOrRefreshSummary").mockResolvedValue(null);

            await manager.createOrRefreshSummary("!r:example.com");

            expect(spy).toHaveBeenCalledWith("!r:example.com", {});
        });

        it("getRoomSummaryMembers 委托给 members（含默认参数透传）", async () => {
            const spy = vi.spyOn(manager.members, "getRoomSummaryMembers").mockResolvedValue([] as never);

            await manager.getRoomSummaryMembers("!r:example.com");

            expect(spy).toHaveBeenCalledWith("!r:example.com", false, true);
        });

        it("getRoomSummaryStats 委托给 stats（含默认参数透传）", async () => {
            const spy = vi.spyOn(manager.stats, "getRoomSummaryStats").mockResolvedValue(null);

            await manager.getRoomSummaryStats("!r:example.com");

            expect(spy).toHaveBeenCalledWith("!r:example.com", false, true);
        });
    });

    // ========================================================================
    // 7. 内部 summary 端点用 /_synapse 前缀（P2-a 路径契约的语义边界）
    // ========================================================================

    describe("内部 summary 端点的前缀", () => {
        it("batchGetSummaries 空数组直接短路，不打网络", async () => {
            const spy = vi.mocked((manager as never as { request: unknown }).request as never);

            await expect(manager.batchGetSummaries([])).resolves.toEqual({});
            expect(spy).not.toHaveBeenCalled();
        });

        it("batchGetSummaries 走 /_synapse/room_summary/v1 前缀", async () => {
            vi.mocked((manager as never as { request: unknown }).request as never).mockResolvedValue({} as never);

            await manager.batchGetSummaries(["!r:example.com"], true);

            const spec = lastRequestSpec();
            expect(spec.prefix).toBe("/_synapse/room_summary/v1");
            expect(spec.body).toMatchObject({ rooms: ["!r:example.com"], is_suggested_only: true });
        });

        it("getRoomSummary 走 ClientPrefix.V3（与内部端点区分）", async () => {
            await manager.getRoomSummary("!r:example.com");

            // getRoomSummary 的 spec 不带 prefix，落到 BaseManager 的 defaultPrefix
            const spec = lastRequestSpec();
            expect(spec.prefix).not.toBe("/_synapse/room_summary/v1");
        });
    });

    // ========================================================================
    // 8. extendMatrixClient
    // ========================================================================

    describe("extendMatrixClient()", () => {
        it("给 MatrixClient.prototype 打上 getRoomSummaryManager 补丁", () => {
            extendMatrixClient();
            expect(typeof MatrixClient.prototype.getRoomSummaryManager).toBe("function");
        });

        it("多次调用返回同一个管理器实例", () => {
            extendMatrixClient();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const fakeClient = mockClient as any;

            const a = MatrixClient.prototype.getRoomSummaryManager.call(fakeClient);
            const b = MatrixClient.prototype.getRoomSummaryManager.call(fakeClient);

            expect(a).toBe(b);
            expect(a).toBeInstanceOf(RoomSummaryManager);
        });
    });
});