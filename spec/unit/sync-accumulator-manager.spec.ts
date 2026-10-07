import { describe, it, expect, beforeEach } from "vitest";

import { SyncAccumulatorManager } from "../../src/sync-accumulator/index";
import { SyncAccumulator } from "../../src/sync-accumulator";

/*
 * ⚠️ mockClient 是**空对象**：它既不提供 `syncAccumulator` 属性，也不提供
 * `accumulateSyncData` / `getAccumulatedData` / `resetAccumulator` 方法 ——
 * 这些在 MatrixClient 上**运行时并不存在**。
 *
 * 改造前的实现正是依赖它们：
 *   getSyncAccumulator()   → this.client.syncAccumulator ?? null   （属性不存在 ⇒ 恒 null）
 *   setSyncAccumulator()   → 写到一个不存在的属性上（静默丢弃）
 *   accumulateSyncData()   → 转发 client.accumulateSyncData(...)   （调用即 TypeError）
 * 现改为模块内自持实例。本 spec 用空 client，实现若回退到"依赖 client"立刻失败。
 *
 * 说明：`spec/unit/sync-accumulator.spec.ts` 测的是上游的 `SyncAccumulator` **类**，
 * 与这个 Manager 无关 —— 这 5 个方法此前**零覆盖**。
 */
describe("SyncAccumulatorManager（模块内自持累积器）", () => {
    let manager: SyncAccumulatorManager;

    beforeEach(() => {
        manager = new SyncAccumulatorManager({} as never);
    });

    it("初始为空；set / get 走模块内实例", () => {
        expect(manager.getSyncAccumulator()).toBeNull();

        const accumulator = new SyncAccumulator();
        manager.setSyncAccumulator(accumulator);

        expect(manager.getSyncAccumulator()).toBe(accumulator);
    });

    it("accumulateSyncData 首次调用自动建实例并累积", async () => {
        await manager.accumulateSyncData({ next_batch: "t1" } as never);

        expect(manager.getSyncAccumulator()).toBeInstanceOf(SyncAccumulator);
        expect(manager.getAccumulatedData()).not.toBeNull();
    });

    it("resetAccumulator 清空累积器与数据", async () => {
        await manager.accumulateSyncData({ next_batch: "t1" } as never);
        expect(manager.getSyncAccumulator()).not.toBeNull();

        manager.resetAccumulator();

        expect(manager.getSyncAccumulator()).toBeNull();
        expect(manager.getAccumulatedData()).toBeNull();
    });

    it("未累积过时 getAccumulatedData 返回 null（而不是抛错）", () => {
        expect(manager.getAccumulatedData()).toBeNull();
    });

    it("累积状态不依赖 client 上的任何属性（回归守卫）", async () => {
        const client = {} as Record<string, unknown>;
        const local = new SyncAccumulatorManager(client as never);

        await local.accumulateSyncData({ next_batch: "t1" } as never);

        expect(local.getSyncAccumulator()).toBeInstanceOf(SyncAccumulator);
        // 若实现回退到 `this.client.syncAccumulator = …`，这里会多出这个键
        expect(Object.keys(client)).not.toContain("syncAccumulator");
    });
});
