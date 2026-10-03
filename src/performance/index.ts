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
 * Performance Monitoring Utilities
 *
 * 提供性能基准测试、延迟监控、基线验证功能。
 * 用于 CI 集成性能回归检测。
 */

import { logger } from "../logger";

export interface PerformanceMetrics {
    operation: string;
    durationMs: number;
    timestamp: number;
    cacheHit: boolean;
}

export interface PerformanceBaseline {
    operation: string;
    maxDurationMs: number;
    passed: boolean;
    actualDurationMs: number;
    timestamp: number;
}

export interface PerformanceReport {
    totalOperations: number;
    failedBaselines: PerformanceBaseline[];
    averageDurationMs: number;
    p95DurationMs: number;
    p99DurationMs: number;
}

const PERFORMANCE_REGISTRY: Map<string, number> = new Map();
const METRICS_HISTORY: PerformanceMetrics[] = [];

/**
 * 测量操作耗时
 * @param operation 操作名称
 * @param fn 要测量的函数
 * @returns 函数返回值
 */
export async function measureOperation<T>(operation: string, fn: () => Promise<T>, cacheHit = false): Promise<T> {
    const start = performance.now();
    try {
        const result = await fn();
        const duration = performance.now() - start;

        recordMetrics({ operation, durationMs: duration, timestamp: Date.now(), cacheHit });

        // 触发性能基线检查
        const baseline = getBaseline(operation);
        if (baseline && duration > baseline.maxDurationMs) {
            logger.warn(
                `[Performance] ${operation} exceeded baseline: ${duration.toFixed(2)}ms > ${baseline.maxDurationMs}ms`,
            );
        }

        return result;
    } catch (error) {
        const duration = performance.now() - start;
        recordMetrics({ operation, durationMs: duration, timestamp: Date.now(), cacheHit });
        throw error;
    }
}

/**
 * 同步操作耗时测量
 */
export function measureSyncOperation<T>(operation: string, fn: () => T, cacheHit = false): T {
    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;

    recordMetrics({ operation, durationMs: duration, timestamp: Date.now(), cacheHit });
    return result;
}

/**
 * 记录性能指标
 */
function recordMetrics(metrics: PerformanceMetrics): void {
    METRICS_HISTORY.push(metrics);

    // 保持历史记录在 1000 条以内
    if (METRICS_HISTORY.length > 1000) {
        METRICS_HISTORY.shift();
    }
}

/**
 * 设置性能基线阈值
 * 在测试环境中调用，用于 CI 性能回归检测
 */
export function setBaseline(operation: string, maxDurationMs: number): void {
    PERFORMANCE_REGISTRY.set(operation, maxDurationMs);
}

/**
 * 获取操作的性能基线
 */
export function getBaseline(operation: string): { maxDurationMs: number; timestamp: number } | undefined {
    const maxDurationMs = PERFORMANCE_REGISTRY.get(operation);
    if (maxDurationMs === undefined) return undefined;
    return { maxDurationMs, timestamp: Date.now() };
}

/**
 * 验证操作是否通过性能基线
 * 用于 CI 中的性能回归检测
 */
export function validatePerformance(operation: string, durationMs: number): PerformanceBaseline {
    const maxDurationMs = PERFORMANCE_REGISTRY.get(operation) ?? durationMs;
    const passed = durationMs <= maxDurationMs;

    return {
        operation,
        maxDurationMs,
        passed,
        actualDurationMs: durationMs,
        timestamp: Date.now(),
    };
}

/**
 * 获取性能报告
 */
export function getPerformanceReport(): PerformanceReport {
    const metrics = Array.from(METRICS_HISTORY);

    if (metrics.length === 0) {
        return {
            totalOperations: 0,
            failedBaselines: [],
            averageDurationMs: 0,
            p95DurationMs: 0,
            p99DurationMs: 0,
        };
    }

    const durations = Array.from(metrics)
        .map((m) => m.durationMs)
        .sort((a, b) => a - b);

    const failedBaselines: PerformanceBaseline[] = [];
    for (const [op, maxDuration] of PERFORMANCE_REGISTRY.entries()) {
        const ops = metrics.filter((m) => m.operation === op);
        if (ops.length === 0) continue;

        const maxActual = Math.max(...ops.map((o) => o.durationMs));
        const baseline: PerformanceBaseline = {
            operation: op,
            maxDurationMs: maxDuration,
            passed: maxActual <= maxDuration,
            actualDurationMs: maxActual,
            timestamp: Date.now(),
        };
        if (!baseline.passed) {
            failedBaselines.push(baseline);
        }
    }

    return {
        totalOperations: metrics.length,
        failedBaselines,
        averageDurationMs: durations.reduce((a, b) => a + b, 0) / durations.length,
        p95DurationMs: durations[Math.floor(durations.length * 0.95)] ?? 0,
        p99DurationMs: durations[Math.floor(durations.length * 0.99)] ?? 0,
    };
}

/**
 * 重置所有性能数据
 */
export function resetPerformanceData(): void {
    METRICS_HISTORY.length = 0;
    PERFORMANCE_REGISTRY.clear();
}

/**
 * 获取所有记录的指标（用于调试）
 */
export function getMetricsHistory(): readonly PerformanceMetrics[] {
    return METRICS_HISTORY;
}

/**
 * 温度性能指标摘要
 */
export function getMetricsSummary(): {
    operationCounts: Record<string, { count: number; avgDuration: number; totalDuration: number }>;
} {
    const summary: Record<string, { count: number; totalDuration: number; durations: number[] }> = {};

    for (const m of METRICS_HISTORY) {
        if (!summary[m.operation]) {
            summary[m.operation] = { count: 0, totalDuration: 0, durations: [] };
        }
        summary[m.operation].count++;
        summary[m.operation].totalDuration += m.durationMs;
        summary[m.operation].durations.push(m.durationMs);
    }

    const result: Record<string, { count: number; avgDuration: number; totalDuration: number }> = {};
    for (const [op, data] of Object.entries(summary)) {
        result[op] = {
            count: data.count,
            avgDuration: data.totalDuration / data.count,
            totalDuration: data.totalDuration,
        };
    }

    return { operationCounts: result };
}
