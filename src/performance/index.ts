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

/**
 * 性能阈值注册表。
 *
 * 职责只有三件事：**声明**某操作的耗时上限、**读取**它、拿实测耗时**求值**。
 * 供 `perf/` 下的性能 spec 在 CI 中使用。
 *
 * ## 为什么这里只剩三个函数
 *
 * 本模块原先还带一套指标采集链路
 * （`measureOperation` → `recordMetrics` → `METRICS_HISTORY` → `getPerformanceReport`
 * / `getMetricsHistory` / `getMetricsSummary` / `resetPerformanceData`）。
 * 实测该链路在本仓库**没有任何调用方**（`knip` 报 7 个死导出），采集到的指标也没有
 * 任何读取方 —— 报告函数只会被测试自己打印。保留一套无人调用的采集器，只会制造
 * 「性能监控已接入」的错觉，所以整体删除。
 *
 * 真需要把某个操作的耗时接进来时，正确做法是在**被测代码**里调用注册表求值
 * （或让 benchmark 直接断言），而不是恢复一个自成闭环的采集器。
 */

/**
 * 一次基线校验的结果。
 */
export interface PerformanceBaseline {
    /** 被校验的操作名，与 `setBaseline` 注册时使用的键一致。 */
    operation: string;
    /** 该操作声明的耗时上限（毫秒）。未声明基线时等于本次实测耗时。 */
    maxDurationMs: number;
    /** 实测耗时是否未超过 `maxDurationMs`。 */
    passed: boolean;
    /** 本次用于校验的实测耗时（毫秒）。 */
    actualDurationMs: number;
    /** 判定发生的时刻（`Date.now()`），不是基线注册时刻。 */
    timestamp: number;
}

/** 操作名 -> 阈值（毫秒）与注册时刻。 */
const PERFORMANCE_REGISTRY: Map<string, { maxDurationMs: number; setAt: number }> = new Map();

/**
 * 声明一个操作的耗时上限。
 *
 * 重复声明同名操作会覆盖前值（便于测试之间相互隔离）。
 *
 * @param operation - 操作名，例如 `"RoomManager.getRoomVersion"`。
 * @param maxDurationMs - 该操作的耗时上限（毫秒）。
 *
 * @example
 * ```typescript
 * setBaseline("RoomManager.getRoomVersion", 50);
 * expect(validatePerformance("RoomManager.getRoomVersion", 12).passed).toBe(true);
 * ```
 */
export function setBaseline(operation: string, maxDurationMs: number): void {
    PERFORMANCE_REGISTRY.set(operation, { maxDurationMs, setAt: Date.now() });
}

/**
 * 读取某个操作已声明的基线。
 *
 * @param operation - 操作名。
 * @returns 该操作的阈值与**注册时刻**；未声明过则返回 `undefined`（调用方需自行决定策略，本模块不提供默认值）。
 *
 * @example
 * ```typescript
 * setBaseline("FriendManager.getFriends", 30);
 * const baseline = getBaseline("FriendManager.getFriends");
 * console.log(baseline?.maxDurationMs); // 30
 * console.log(getBaseline("nonexistent")); // undefined
 * ```
 */
export function getBaseline(operation: string): { maxDurationMs: number; timestamp: number } | undefined {
    const entry = PERFORMANCE_REGISTRY.get(operation);
    if (entry === undefined) return undefined;
    return { maxDurationMs: entry.maxDurationMs, timestamp: entry.setAt };
}

/**
 * 用实测耗时对一个操作的基线求值。
 *
 * ⚠️ 注意「未声明基线」的行为：此时 `maxDurationMs` 回退为**本次实测耗时**，
 * 因此 `passed` 恒为 `true`。这是**故意 fail-open** 的——本仓并未接入全量耗时采集，
 * 若 fail-closed 会把所有未声明基线的操作一律判失败，使门禁失去可执行性。
 * 需要严格模式时，调用方必须先用 `getBaseline()` 判断是否声明过。
 *
 * @param operation - 操作名。
 * @param durationMs - 本次实测耗时（毫秒）。
 * @returns 含阈值、实测值、判定结果与判定时刻的结果对象。本函数不抛异常。
 *
 * @example
 * ```typescript
 * setBaseline("RoomManager.getRoomVersion", 50);
 * validatePerformance("RoomManager.getRoomVersion", 12).passed; // true
 * validatePerformance("RoomManager.getRoomVersion", 80).passed; // false
 *
 * // 未声明基线的操作：fail-open
 * validatePerformance("never.declared", 9999).passed; // true
 * ```
 */
export function validatePerformance(operation: string, durationMs: number): PerformanceBaseline {
    const maxDurationMs = PERFORMANCE_REGISTRY.get(operation)?.maxDurationMs ?? durationMs;

    return {
        operation,
        maxDurationMs,
        passed: durationMs <= maxDurationMs,
        actualDurationMs: durationMs,
        timestamp: Date.now(),
    };
}
