/**
 * Performance Baseline Registry — 单元测试
 *
 * 本套件**只测阈值注册表本身**（声明 / 读取 / 求值）。
 *
 * 历史背景：本文件原先只有 3 个 `expect(true).toBe(true)`，并注释称
 * 「Actual measurement happens in production via getTelemetry()」。该注释不成立：
 * `getTelemetry()` 属于 `TelemetryManager`（`src/telemetry/index.ts`）自带的
 * `getMetrics`，与 `src/performance/index.ts` 的 `PERFORMANCE_REGISTRY` 无任何调用关系。
 * 也就是说，那 3 个用例在 `pnpm test` 里永远通过，却不对应任何被测代码 —— 属「测试剧场」：
 * 既发现不了回归，又让人误以为性能基线已被 CI 守住。现改为对真实行为的断言。
 *
 * 真实性能数字在 `perf/benchmarks.spec.ts`（自带测量工具链）与
 * `spec/perf/critical-path.perf.spec.ts`（`pnpm test:perf`）里，不在本文件。
 */

import { describe, it, expect } from "vitest";
import { setBaseline, getBaseline, validatePerformance } from "../src/performance/index";

describe("performance baseline registry", () => {
    it("returns undefined for an operation that has no baseline", () => {
        expect(getBaseline("perf.baseline.never-declared")).toBeUndefined();
    });

    it("stores the declared threshold and exposes the registration time", () => {
        const before = Date.now();
        setBaseline("perf.baseline.stores-threshold", 50);
        const after = Date.now();

        const baseline = getBaseline("perf.baseline.stores-threshold");
        expect(baseline).toBeDefined();
        expect(baseline?.maxDurationMs).toBe(50);
        // timestamp 是**注册**时刻（而非读取时刻），必须落在 setBaseline 调用区间内
        expect(baseline?.timestamp).toBeGreaterThanOrEqual(before);
        expect(baseline?.timestamp).toBeLessThanOrEqual(after);
    });

    it("overwrites the threshold when the same operation is declared twice", () => {
        setBaseline("perf.baseline.redeclare", 100);
        setBaseline("perf.baseline.redeclare", 25);

        expect(getBaseline("perf.baseline.redeclare")?.maxDurationMs).toBe(25);
    });

    it("passes when the measured duration is within the declared threshold", () => {
        setBaseline("perf.baseline.within", 50);

        const result = validatePerformance("perf.baseline.within", 50);
        expect(result).toEqual({
            operation: "perf.baseline.within",
            maxDurationMs: 50,
            passed: true,
            actualDurationMs: 50,
            timestamp: expect.any(Number),
        });
    });

    it("fails when the measured duration exceeds the declared threshold", () => {
        setBaseline("perf.baseline.exceeds", 50);

        const result = validatePerformance("perf.baseline.exceeds", 51);
        expect(result.passed).toBe(false);
        expect(result.maxDurationMs).toBe(50);
        expect(result.actualDurationMs).toBe(51);
    });

    it("is fail-open for operations with no declared baseline", () => {
        // 记录当前设计：未声明基线时 maxDurationMs 回退为实测耗时，因此必然通过。
        // 若日后改成 fail-closed，本用例会失败，提醒改动方同步更新文档与调用方。
        const result = validatePerformance("perf.baseline.fail-open", 9999);

        expect(result.passed).toBe(true);
        expect(result.maxDurationMs).toBe(9999);
    });
});
