#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const REPORT_DIR = "docs/governance/perf-baseline";
const TIMESTAMP = new Date().toISOString().split("T")[0];

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function getBundleSize() {
    const libPath = path.resolve(process.cwd(), "lib");
    if (!fs.existsSync(libPath)) {
        console.log("[bundle] Building lib/ first...");
        execSync("pnpm build", { stdio: "inherit" });
    }

    const sizes = {};
    const entries = ["index.js", "browser-index.js", "core.js", "advanced.js", "legacy.js"];

    for (const entry of entries) {
        const filePath = path.join(libPath, entry);
        if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            sizes[entry] = {
                bytes: stat.size,
                kb: (stat.size / 1024).toFixed(2),
            };
        }
    }

    const totalBytes = Object.values(sizes).reduce((sum, s) => sum + s.bytes, 0);
    return {
        entries: sizes,
        totalKB: (totalBytes / 1024).toFixed(2),
    };
}

function getCriticalModuleSizes() {
    const modules = [
        "src/client.ts",
        "src/push/index.ts",
        "src/room-summary/index.ts",
        "src/admin/index.ts",
        "src/dm/index.ts",
        "src/space/index.ts",
    ];

    const sizes = {};
    for (const mod of modules) {
        if (fs.existsSync(mod)) {
            const content = fs.readFileSync(mod, "utf8");
            sizes[mod] = {
                lines: content.split("\n").length,
                bytes: fs.statSync(mod).size,
            };
        }
    }
    return sizes;
}

function getManagerMigrationStatus() {
    const gapListPath = "docs/governance/ERROR_SEMANTICS_GAP_LIST_2026-04-10.md";
    if (fs.existsSync(gapListPath)) {
        const content = fs.readFileSync(gapListPath, "utf8");
        const coverageMatch = content.match(/\*\*当前覆盖率\*\*[：:]\s*\*\*(\d+)%\*\*/);
        const migratedMatch = content.match(/\*\*已接入 `BaseManager`\*\*[：:]\s*(\d+)/);
        const totalMatch = content.match(/\*\*总 Manager 类数\*\*[：:]\s*(\d+)/);
        if (coverageMatch) {
            return {
                coverage: parseFloat(coverageMatch[1]),
                migrated: migratedMatch?.[1] || "unknown",
                total: totalMatch?.[1] || "unknown",
            };
        }
    }
    return { coverage: 0, migrated: "unknown", total: "unknown" };
}

function getTestCoverage() {
    const lcovPath = "coverage/lcov.info";
    if (!fs.existsSync(lcovPath)) {
        console.log("[coverage] Running tests with coverage...");
        try {
            execSync("pnpm test --run --coverage", { stdio: "inherit" });
        } catch {
            return { lines: 0, functions: 0 };
        }
    }

    let linesFound = 0;
    let linesHit = 0;
    const content = fs.readFileSync(lcovPath, "utf8");

    for (const line of content.split("\n")) {
        if (line.startsWith("LF:")) linesFound += Number(line.slice(3));
        if (line.startsWith("LH:")) linesHit += Number(line.slice(3));
    }

    return {
        lines: linesFound > 0 ? ((linesHit / linesFound) * 100).toFixed(2) : 0,
        linesFound,
        linesHit,
    };
}

function generateReport(bundle, modules, manager, coverage) {
    const report = {
        timestamp: TIMESTAMP,
        baseline: {
            bundle,
            criticalModules: modules,
            managerMigration: manager,
            testCoverage: coverage,
        },
        targets: {
            bundleSizeReduction: "-20%",
            pushRulesP95Ms: "<= 2.0ms (warm cache)",
            roomSummaryP95Ms: "<= 5.0ms",
            memoryPeakMB: "<= 100MB baseline",
            managerCoverage: ">= 95%",
        },
    };

    return report;
}

function main() {
    console.log("=".repeat(60));
    console.log("Performance Baseline Benchmark");
    console.log(`Timestamp: ${TIMESTAMP}`);
    console.log("=".repeat(60));

    ensureDir(REPORT_DIR);

    console.log("\n[1/4] Measuring bundle sizes...");
    const bundle = getBundleSize();
    console.log(`  Total bundle size: ${bundle.totalKB} KB`);
    for (const [entry, size] of Object.entries(bundle.entries)) {
        console.log(`  - ${entry}: ${size.kb} KB`);
    }

    console.log("\n[2/4] Measuring critical module sizes...");
    const modules = getCriticalModuleSizes();
    for (const [mod, size] of Object.entries(modules)) {
        console.log(`  - ${mod}: ${size.lines} lines`);
    }

    console.log("\n[3/4] Checking manager migration status...");
    const manager = getManagerMigrationStatus();
    console.log(`  Coverage: ${manager.coverage}%`);

    console.log("\n[4/4] Checking test coverage...");
    const coverage = getTestCoverage();
    console.log(`  Line coverage: ${coverage.lines}%`);

    const report = generateReport(bundle, modules, manager, coverage);

    const reportPath = path.join(REPORT_DIR, `baseline-${TIMESTAMP}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n[Report] Saved to: ${reportPath}`);

    const mdPath = path.join(REPORT_DIR, `baseline-${TIMESTAMP}.md`);
    const mdContent = generateMarkdownReport(report);
    fs.writeFileSync(mdPath, mdContent);
    console.log(`[Report] Saved to: ${mdPath}`);

    console.log("\n" + "=".repeat(60));
    console.log("Baseline Summary");
    console.log("=".repeat(60));
    console.log(`Bundle Size: ${bundle.totalKB} KB`);
    console.log(`Manager Migration: ${manager.coverage}%`);
    console.log(`Test Coverage: ${coverage.lines}%`);
}

function generateMarkdownReport(report) {
    return `# Performance Baseline Report

> Generated: ${report.timestamp}

## 1. Bundle Size

| Entry | Size (KB) |
|---|---:|
${Object.entries(report.baseline.bundle.entries)
    .map(([k, v]) => `| ${k} | ${v.kb} |`)
    .join("\n")}
| **Total** | **${report.baseline.bundle.totalKB}** |

## 2. Critical Module Sizes

| Module | Lines |
|---|---:|
${Object.entries(report.baseline.criticalModules)
    .map(([k, v]) => `| ${k} | ${v.lines} |`)
    .join("\n")}

## 3. Manager Migration Status

| Metric | Value |
|---|---|
| Coverage | ${report.baseline.managerMigration.coverage}% |
| Migrated | ${report.baseline.managerMigration.migrated} |
| Total | ${report.baseline.managerMigration.total} |

## 4. Test Coverage

| Metric | Value |
|---|---|
| Line Coverage | ${report.baseline.testCoverage.lines}% |

## 5. Performance Targets

| Metric | Target |
|---|---|
| Bundle Size Reduction | ${report.targets.bundleSizeReduction} |
| PushRules P95 (warm) | ${report.targets.pushRulesP95Ms} |
| RoomSummary P95 | ${report.targets.roomSummaryP95Ms} |
| Memory Peak | ${report.targets.memoryPeakMB} |
| Manager Coverage | ${report.targets.managerCoverage} |
`;
}

main();
