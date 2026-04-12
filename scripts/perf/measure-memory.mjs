#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import v8 from "node:v8";

const REPORT_DIR = "docs/governance/perf-baseline";
const TIMESTAMP = new Date().toISOString().split("T")[0];

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function getMemoryUsage() {
    const memoryData = process.memoryUsage();
    return {
        heapTotal: Math.round(memoryData.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memoryData.heapUsed / 1024 / 1024),
        external: Math.round(memoryData.external / 1024 / 1024),
        rss: Math.round(memoryData.rss / 1024 / 1024),
    };
}

function getHeapStatistics() {
    const stats = v8.getHeapStatistics();
    return {
        total_heap_size: Math.round(stats.total_heap_size / 1024 / 1024),
        total_heap_size_executable: Math.round(stats.total_heap_size_executable / 1024 / 1024),
        total_physical_size: Math.round(stats.total_physical_size / 1024 / 1024),
        total_available_size: Math.round(stats.total_available_size / 1024 / 1024),
        used_heap_size: Math.round(stats.used_heap_size / 1024 / 1024),
        heap_size_limit: Math.round(stats.heap_size_limit / 1024 / 1024),
        malloced_memory: Math.round(stats.malloced_memory / 1024 / 1024),
        peak_malloced_memory: Math.round(stats.peak_malloced_memory / 1024 / 1024),
    };
}

function measureOperation(name, operation, iterations = 100) {
    const beforeMemory = getMemoryUsage();
    const beforeHeap = getHeapStatistics();

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        operation();
    }
    const elapsed = performance.now() - start;

    const afterMemory = getMemoryUsage();
    const afterHeap = getHeapStatistics();

    return {
        name,
        iterations,
        elapsedMs: Math.round(elapsed * 100) / 100,
        avgMs: Math.round((elapsed / iterations) * 1000) / 1000,
        memoryDelta: {
            heapUsed: afterMemory.heapUsed - beforeMemory.heapUsed,
            external: afterMemory.external - beforeMemory.external,
        },
        peakMemory: {
            heapUsed: afterMemory.heapUsed,
            rss: afterMemory.rss,
        },
    };
}

async function measureCacheOperations() {
    const results = [];

    const { LRUCache } = await import("../../src/utils/lru-cache.ts");

    const cache = new LRUCache({ maxSize: 1000, ttl: 60000, name: "perf-test" });

    const writeResult = measureOperation(
        "LRUCache.set",
        () => {
            const key = `key-${Math.random()}`;
            cache.set(key, { data: "test-value-" + Math.random() });
        },
        1000,
    );
    results.push(writeResult);

    for (let i = 0; i < 500; i++) {
        cache.set(`existing-key-${i}`, { data: `value-${i}` });
    }

    const readResult = measureOperation(
        "LRUCache.get (warm)",
        () => {
            const key = `existing-key-${Math.floor(Math.random() * 500)}`;
            cache.get(key);
        },
        1000,
    );
    results.push(readResult);

    const stats = cache.getStats();
    results.push({
        name: "LRUCache.stats",
        hitRate: stats.hitRate,
        size: stats.size,
        evictions: stats.evictions,
    });

    return results;
}

async function measureManagerInstantiation() {
    const results = [];

    const managers = [
        { name: "PushManager", path: "../../src/push/index.ts" },
        { name: "RoomSummaryManager", path: "../../src/room-summary/index.ts" },
        { name: "AdminManager", path: "../../src/admin/index.ts" },
        { name: "DirectMessageManager", path: "../../src/dm/index.ts" },
        { name: "SpaceManager", path: "../../src/space/index.ts" },
    ];

    for (const { name, path: modulePath } of managers) {
        try {
            const module = await import(modulePath);
            const ManagerClass = module[name];

            if (ManagerClass) {
                const mockClient = {
                    getUserId: () => "@perf:example.com",
                    http: { authedRequest: () => Promise.resolve({}) },
                };

                const result = measureOperation(
                    `${name} instantiation`,
                    () => {
                        new ManagerClass(mockClient);
                    },
                    100,
                );
                results.push(result);
            }
        } catch (error) {
            results.push({ name, error: error.message });
        }
    }

    return results;
}

function generateMemoryReport(cacheResults, managerResults) {
    const report = {
        timestamp: TIMESTAMP,
        memory: {
            initial: getMemoryUsage(),
            heap: getHeapStatistics(),
        },
        cacheOperations: cacheResults,
        managerInstantiation: managerResults,
        targets: {
            maxHeapUsedMB: 100,
            maxCacheHitRate: 0.95,
            maxManagerInstantiationMs: 1.0,
        },
    };

    return report;
}

function generateMarkdownReport(report) {
    const lines = [
        "# Memory Performance Report",
        "",
        `> Generated: ${report.timestamp}`,
        "",
        "## 1. Memory Baseline",
        "",
        "| Metric | Value (MB) |",
        "|---|---:|",
        `| Heap Total | ${report.memory.initial.heapTotal} |`,
        `| Heap Used | ${report.memory.initial.heapUsed} |`,
        `| RSS | ${report.memory.initial.rss} |`,
        `| External | ${report.memory.initial.external} |`,
        "",
        "## 2. Heap Statistics",
        "",
        "| Metric | Value (MB) |",
        "|---|---:|",
        `| Total Heap Size | ${report.memory.heap.total_heap_size} |`,
        `| Used Heap Size | ${report.memory.heap.used_heap_size} |`,
        `| Heap Size Limit | ${report.memory.heap.heap_size_limit} |`,
        `| Available Size | ${report.memory.heap.total_available_size} |`,
        "",
        "## 3. Cache Operations",
        "",
        "| Operation | Iterations | Total (ms) | Avg (ms) | Memory Delta (MB) |",
        "|---|---:|---:|---:|---:|",
    ];

    for (const result of report.cacheOperations) {
        if (result.elapsedMs !== undefined) {
            lines.push(
                `| ${result.name} | ${result.iterations} | ${result.elapsedMs} | ${result.avgMs} | ${result.memoryDelta?.heapUsed || 0} |`,
            );
        }
    }

    lines.push("", "## 4. Manager Instantiation", "");
    lines.push("| Manager | Iterations | Total (ms) | Avg (ms) | Memory Delta (MB) |");
    lines.push("|---|---:|---:|---:|---:|");

    for (const result of report.managerInstantiation) {
        if (result.elapsedMs !== undefined) {
            lines.push(
                `| ${result.name} | ${result.iterations} | ${result.elapsedMs} | ${result.avgMs} | ${result.memoryDelta?.heapUsed || 0} |`,
            );
        }
    }

    lines.push("", "## 5. Performance Targets", "");
    lines.push("| Metric | Target | Status |");
    lines.push("|---|---|---|");
    lines.push(
        `| Max Heap Used | <= ${report.targets.maxHeapUsedMB} MB | ${report.memory.initial.heapUsed <= report.targets.maxHeapUsedMB ? "✅" : "❌"} |`,
    );

    const cacheHitRate = report.cacheOperations.find((r) => r.hitRate !== undefined);
    if (cacheHitRate) {
        lines.push(
            `| Cache Hit Rate | >= ${report.targets.maxCacheHitRate * 100}% | ${cacheHitRate.hitRate >= report.targets.maxCacheHitRate ? "✅" : "❌"} |`,
        );
    }

    return lines.join("\n");
}

async function main() {
    console.log("=".repeat(60));
    console.log("Memory Performance Measurement");
    console.log(`Timestamp: ${TIMESTAMP}`);
    console.log("=".repeat(60));

    ensureDir(REPORT_DIR);

    console.log("\n[1/2] Measuring cache operations...");
    const cacheResults = await measureCacheOperations();
    console.log(`  Measured ${cacheResults.length} cache operations`);

    console.log("\n[2/2] Measuring manager instantiation...");
    const managerResults = await measureManagerInstantiation();
    console.log(`  Measured ${managerResults.length} managers`);

    const report = generateMemoryReport(cacheResults, managerResults);

    const reportPath = path.join(REPORT_DIR, `memory-${TIMESTAMP}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n[Report] Saved to: ${reportPath}`);

    const mdPath = path.join(REPORT_DIR, `memory-${TIMESTAMP}.md`);
    const mdContent = generateMarkdownReport(report);
    fs.writeFileSync(mdPath, mdContent);
    console.log(`[Report] Saved to: ${mdPath}`);

    console.log("\n" + "=".repeat(60));
    console.log("Memory Summary");
    console.log("=".repeat(60));
    console.log(`Heap Used: ${report.memory.initial.heapUsed} MB`);
    console.log(`RSS: ${report.memory.initial.rss} MB`);
}

main().catch(console.error);
