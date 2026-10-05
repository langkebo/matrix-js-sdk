/**
 * Performance Benchmarks — 性能基准测试
 *
 * 用于测量和监控 SDK 关键 API 的性能表现。
 *
 * **重要**: 性能测试应在受控环境中运行（避免其他进程干扰），建议使用以下方式：
 *
 * 1. **本地快速测试**（单次运行）：
 *    ```bash
 *    cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk
 *    PATH="/usr/bin:/bin:$PATH" ./node_modules/.bin/vitest run perf/benchmarks.spec.ts
 *    ```
 *
 * 2. **CI 中的性能回归检测**（多次迭代取平均）：
 *    ```bash
 *    # 运行 3 次取平均值
 *    for i in {1..3}; do
 *      PATH="/usr/bin:/bin:$PATH" ./node_modules/.bin/vitest run perf/benchmarks.spec.ts >> perf/results-${i}.txt
 *    done
 *    ```
 *
 * **性能基线阈值**（单位：ms）：
 * - Cache operations: < 1ms
 * - Media URL generation: < 5ms
 * - Query operations: < 50ms
 *
 * **性能指标说明**：
 * - **Warm-up**: 每次测试前预热 3 次，排除 JIT 编译影响
 * - **Iterations**: 每个测试默认运行 10 次，取平均值
 * - **Outliers**: 剔除最高/最低 10% 的异常值
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { UnifiedCacheManager } from "../src/managers/cache-manager";
import { LRUCache } from "../src/utils/lru-cache";

// ============================================================================
// 性能测试工具函数
// ============================================================================

interface BenchmarkResult {
    name: string;
    avgTime: number;
    minTime: number;
    maxTime: number;
    medianTime: number;
    stddev: number;
    iterations: number;
    /** 本次测量使用的退化阈值（ms），由 `benchmark()` 从 config 带入。 */
    baselineThreshold: number;
}

interface BenchmarkConfig {
    warmupIterations?: number;
    testIterations?: number;
    baselineThreshold?: number; // ms - 超过此值视为性能退化
}

const DEFAULT_CONFIG: Required<BenchmarkConfig> = {
    warmupIterations: 3,
    testIterations: 10,
    baselineThreshold: 100,
};

/**
 * 运行性能基准测试
 * @param name 测试名称
 * @param fn 被测试的函数
 * @param config 配置
 */
async function benchmark(
    name: string,
    fn: () => void | Promise<void>,
    config?: BenchmarkConfig,
): Promise<BenchmarkResult> {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const times: number[] = [];

    // Warm-up
    for (let i = 0; i < cfg.warmupIterations; i++) {
        await fn();
    }

    // Measure
    for (let i = 0; i < cfg.testIterations; i++) {
        const start = performance.now();
        await fn();
        const end = performance.now();
        times.push(end - start);
    }

    // Remove outliers (top/bottom 10%)
    times.sort((a, b) => a - b);
    const removeCount = Math.floor(times.length * 0.1);
    if (removeCount > 0) {
        times.splice(0, removeCount);
        times.splice(-removeCount, removeCount);
    }

    // Calculate statistics
    const avgTime = times.reduce((sum, t) => sum + t, 0) / times.length;
    const medianIndex = Math.floor(times.length / 2);
    const medianTime = times[medianIndex];
    const minTime = times[0];
    const maxTime = times[times.length - 1];
    const variance = times.reduce((sum, t) => sum + Math.pow(t - avgTime, 2), 0) / times.length;
    const stddev = Math.sqrt(variance);

    return {
        name,
        avgTime,
        minTime,
        maxTime,
        medianTime,
        stddev,
        iterations: times.length,
        baselineThreshold: cfg.baselineThreshold,
    };
}

/**
 * 格式化基准测试结果
 */
function formatBenchmark(result: BenchmarkResult): string {
    const status =
        result.avgTime <= result.baselineThreshold
            ? "✅"
            : result.avgTime <= result.baselineThreshold * 1.25
              ? "🟡"
              : "🔴";

    return `
  ${status} ${result.name}
    Average: ${result.avgTime.toFixed(2)} ms
    Median:  ${result.medianTime.toFixed(2)} ms
    Range:   [${result.minTime.toFixed(2)}, ${result.maxTime.toFixed(2)}] ms
    StdDev:  ${result.stddev.toFixed(2)} ms
    Iterations: ${result.iterations}
`;
}

// ============================================================================
// 1. Cache Operations Performance
// ============================================================================

describe("Performance: Cache Operations", () => {
    it("basic set/get operations", async () => {
        const cache = new UnifiedCacheManager({ namespace: "perf_test", maxSize: 100, ttl: 60_000 });
        const keys = Array.from({ length: 10 }, (_, i) => `key_${i}`);

        const result = await benchmark("Cache set/get", async () => {
            keys.forEach((k, i) => cache.set(k, { value: i }));
            keys.forEach((k) => cache.get(k));
        });

        console.log(formatBenchmark(result));
        expect(result.avgTime).toBeLessThan(1);
    });

    it("getOrFetch (cache hit scenario)", async () => {
        const cache = new UnifiedCacheManager({ namespace: "perf_test", maxSize: 100, ttl: 60_000 });
        const fetchFn = vi.fn().mockResolvedValue({ data: "test" });

        // First, populate cache
        await cache.getOrFetch("populated_key", fetchFn);

        // Now measure cache hits only
        const result = await benchmark("Cache hit", async () => cache.getOrFetch("populated_key", fetchFn));

        console.log(formatBenchmark(result));
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(result.avgTime).toBeLessThan(1);
    });

    it("invalidate with wildcard patterns", async () => {
        const cache = new UnifiedCacheManager({ namespace: "perf_test", maxSize: 100, ttl: 60_000 });

        for (let i = 0; i < 20; i++) {
            cache.set(`group_${i % 4}_item_${i}`, { value: i });
        }

        const result = await benchmark("Invalidation", async () => {
            cache.invalidate(["group_0_*"]);
        });

        console.log(formatBenchmark(result));
        expect(result.avgTime).toBeLessThan(2);
    });

    it("LRU eviction when cache is full", async () => {
        const smallCache = new UnifiedCacheManager({ namespace: "perf_test", maxSize: 5, ttl: 60_000 });

        const result = await benchmark("Eviction", async () => {
            for (let i = 0; i < 10; i++) {
                smallCache.set(`key_${i}`, { value: i });
            }
        });

        console.log(formatBenchmark(result));
        expect(result.avgTime).toBeLessThan(2);
    });
});

// ============================================================================
// 2. LRUCache Internal Performance
// ============================================================================

describe("Performance: LRUCache internals", () => {
    it("batch set operations", async () => {
        const cache = new LRUCache<{ value: number }>({ maxSize: 100, ttl: 60_000, name: "perf_test" });

        const result = await benchmark("Batch set", async () => {
            for (let i = 0; i < 100; i++) {
                cache.set(i.toString(), { value: i });
            }
        });

        console.log(formatBenchmark(result));
        expect(result.avgTime).toBeLessThan(5);
    });

    it("batch get operations", async () => {
        const cache = new LRUCache<{ value: number }>({ maxSize: 100, ttl: 60_000, name: "perf_test" });

        // Pre-populate
        for (let i = 0; i < 100; i++) {
            cache.set(i.toString(), { value: i });
        }

        const result = await benchmark("Batch get", async () => {
            for (let i = 0; i < 100; i++) {
                cache.get(i.toString());
            }
        });

        console.log(formatBenchmark(result));
        expect(result.avgTime).toBeLessThan(5);
    });

    it("mixed read/write operations", async () => {
        const cache = new LRUCache<number>({ maxSize: 50, ttl: 60_000, name: "perf_test" });

        const result = await benchmark("Mixed ops", async () => {
            for (let i = 0; i < 20; i++) {
                cache.set(i.toString(), i);
                cache.get(i.toString());
            }
        });

        console.log(formatBenchmark(result));
        expect(result.avgTime).toBeLessThan(3);
    });

    it("eviction during overflow", async () => {
        const cache = new LRUCache<number>({ maxSize: 10, ttl: 60_000, name: "perf_test" });

        const result = await benchmark("Eviction stress", async () => {
            // Fill beyond capacity multiple times
            for (let round = 0; round < 10; round++) {
                for (let i = round * 20; i < round * 20 + 20; i++) {
                    cache.set(i.toString(), i);
                }
            }
        });

        console.log(formatBenchmark(result));
        expect(result.avgTime).toBeLessThan(10);
    });
});

// ============================================================================
// 3. String Operations Performance
// ============================================================================

describe("Performance: String Operations", () => {
    it("encodeURIComponent (path segments)", async () => {
        const testStrings = [
            "!abc:example.com",
            "!complex_room_id_with_hyphens:sub.example.com",
            "!very-long-room-id-name:matrix.org",
            "some/random/path",
        ];

        const result = await benchmark("encodeURIComponent", async () => {
            testStrings.forEach((str) => encodeURIComponent(str));
        });

        console.log(formatBenchmark(result));
        expect(result.avgTime).toBeLessThan(3);
    });

    it("string normalization patterns", async () => {
        const testCases = [
            "  !abc:example.com  ",
            "!abc:example.com/",
            "matrix:client://!abc:example.com",
            "https://matrix.example.com/#/room/!abc:example.com",
        ];

        const result = await benchmark("String normalization", async () => {
            testCases.forEach((str) => {
                str.trim()
                    .replace(/\/$/, "")
                    .replace(/^matrix:client:\/\//, "");
            });
        });

        console.log(formatBenchmark(result));
        expect(result.avgTime).toBeLessThan(2);
    });
});

// ============================================================================
// 4. Performance Summary Report
// ============================================================================

describe("Performance Summary", () => {
    it("should generate performance summary report", async () => {
        const results: BenchmarkResult[] = [];
        const cache = new UnifiedCacheManager({ namespace: "summary_test", maxSize: 10, ttl: 60_000 });

        // Cache operations
        results.push(
            await benchmark("Cache get/set", async () => {
                cache.set("key", "value");
                cache.get("key");
            }),
        );

        // Batch operations
        results.push(
            await benchmark("Batch set (50 items)", async () => {
                for (let i = 0; i < 50; i++) {
                    cache.set(`item_${i}`, { index: i });
                }
            }),
        );

        // Generate report
        const report = `
# Performance Benchmark Summary

Generated: ${new Date().toISOString()}

## Average Times Across All Benchmarks
${results
    .map(
        (r) => `
- ${r.name}:
  - Average: ${r.avgTime.toFixed(2)} ms
  - Median:  ${r.medianTime.toFixed(2)} ms
  - Range:   [${r.minTime.toFixed(2)}, ${r.maxTime.toFixed(2)}] ms
`,
    )
    .join("\n")}

## Performance Targets
- All benchmarks should pass < 100ms threshold
- Critical paths (cache ops) should be < 5ms
- Standard deviation should be < 20% of average

## Recommendations
- Monitor trends over time, not just individual runs
- Run benchmarks in CI to detect regressions early
- Consider hardware variations in different environments
`;

        console.log(report);

        // Verify all benchmarks passed
        results.forEach((r) => {
            expect(r.avgTime).toBeLessThan(100);
        });
    });
});
