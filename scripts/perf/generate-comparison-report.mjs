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

function findLatestBaseline() {
    const files = fs.readdirSync(REPORT_DIR);
    const baselines = files
        .filter((f) => f.startsWith("baseline-") && f.endsWith(".json"))
        .sort()
        .reverse();

    if (baselines.length === 0) {
        return null;
    }

    return path.join(REPORT_DIR, baselines[0]);
}

function getCurrentMetrics() {
    const metrics = {
        timestamp: TIMESTAMP,
        bundle: {},
        criticalModules: {},
        managerMigration: {},
        testCoverage: {},
        performance: {},
    };

    const libPath = path.resolve(process.cwd(), "lib");
    if (fs.existsSync(libPath)) {
        const entries = ["index.js", "browser-index.js", "core.js", "advanced.js", "legacy.js"];
        let totalBytes = 0;

        for (const entry of entries) {
            const filePath = path.join(libPath, entry);
            if (fs.existsSync(filePath)) {
                const stat = fs.statSync(filePath);
                metrics.bundle[entry] = {
                    bytes: stat.size,
                    kb: (stat.size / 1024).toFixed(2),
                };
                totalBytes += stat.size;
            }
        }
        metrics.bundle.totalKB = (totalBytes / 1024).toFixed(2);
    }

    const modules = [
        "src/client.ts",
        "src/push/index.ts",
        "src/room-summary/index.ts",
        "src/admin/index.ts",
        "src/dm/index.ts",
        "src/space/index.ts",
    ];

    for (const mod of modules) {
        if (fs.existsSync(mod)) {
            const content = fs.readFileSync(mod, "utf8");
            metrics.criticalModules[mod] = {
                lines: content.split("\n").length,
                bytes: fs.statSync(mod).size,
            };
        }
    }

    const gapListPath = "docs/governance/ERROR_SEMANTICS_GAP_LIST_2026-04-10.md";
    if (fs.existsSync(gapListPath)) {
        const content = fs.readFileSync(gapListPath, "utf8");
        const coverageMatch = content.match(/\*\*当前覆盖率\*\*[：:]\s*\*\*(\d+)%\*\*/);
        const migratedMatch = content.match(/\*\*已接入 `BaseManager`\*\*[：:]\s*(\d+)/);
        const totalMatch = content.match(/\*\*总 Manager 类数\*\*[：:]\s*(\d+)/);

        if (coverageMatch) {
            metrics.managerMigration = {
                coverage: parseFloat(coverageMatch[1]),
                migrated: migratedMatch?.[1] || "unknown",
                total: totalMatch?.[1] || "unknown",
            };
        }
    }

    const lcovPath = "coverage/lcov.info";
    if (fs.existsSync(lcovPath)) {
        let linesFound = 0;
        let linesHit = 0;
        const content = fs.readFileSync(lcovPath, "utf8");

        for (const line of content.split("\n")) {
            if (line.startsWith("LF:")) linesFound += Number(line.slice(3));
            if (line.startsWith("LH:")) linesHit += Number(line.slice(3));
        }

        metrics.testCoverage = {
            lines: linesFound > 0 ? ((linesHit / linesFound) * 100).toFixed(2) : 0,
            linesFound,
            linesHit,
        };
    }

    return metrics;
}

function calculateChange(current, baseline) {
    if (!baseline || baseline === 0) return { change: 0, percent: "N/A" };
    const change = current - baseline;
    const percent = ((change / baseline) * 100).toFixed(1);
    return { change, percent: `${percent}%` };
}

function generateComparisonReport(current, baseline) {
    const report = {
        timestamp: TIMESTAMP,
        baselineTimestamp: baseline?.timestamp || "N/A",
        summary: {
            totalChanges: 0,
            improvements: 0,
            regressions: 0,
        },
        bundle: {},
        criticalModules: {},
        managerMigration: {},
        testCoverage: {},
        targets: {
            bundleSizeReduction: { target: "-20%", status: "pending" },
            clientTsLinesReduction: { target: "-30%", status: "pending" },
            managerCoverage: { target: ">= 95%", status: "pending" },
            testCoverage: { target: ">= 80%", status: "pending" },
        },
    };

    if (baseline?.baseline?.bundle && current.bundle.totalKB) {
        const currentTotal = parseFloat(current.bundle.totalKB);
        const baselineTotal = parseFloat(baseline.baseline.bundle.totalKB);
        const bundleChange = calculateChange(currentTotal, baselineTotal);

        report.bundle = {
            current: currentTotal,
            baseline: baselineTotal,
            change: bundleChange.change,
            percent: bundleChange.percent,
            status: bundleChange.change <= 0 ? "improved" : "regressed",
        };

        if (bundleChange.change <= 0) report.summary.improvements++;
        else report.summary.regressions++;
        report.summary.totalChanges++;

        const reductionPercent = parseFloat(bundleChange.percent);
        report.targets.bundleSizeReduction.status = reductionPercent <= -20 ? "passed" : "pending";
    }

    if (baseline?.baseline?.criticalModules && current.criticalModules) {
        for (const [mod, data] of Object.entries(current.criticalModules)) {
            const baselineData = baseline.baseline.criticalModules[mod];
            if (baselineData) {
                const linesChange = calculateChange(data.lines, baselineData.lines);

                report.criticalModules[mod] = {
                    current: data.lines,
                    baseline: baselineData.lines,
                    change: linesChange.change,
                    percent: linesChange.percent,
                    status: linesChange.change <= 0 ? "improved" : "regressed",
                };

                if (linesChange.change <= 0) report.summary.improvements++;
                else report.summary.regressions++;
                report.summary.totalChanges++;
            }
        }

        const clientTs = report.criticalModules["src/client.ts"];
        if (clientTs) {
            const reductionPercent = parseFloat(clientTs.percent);
            report.targets.clientTsLinesReduction.status = reductionPercent <= -30 ? "passed" : "pending";
        }
    }

    if (baseline?.baseline?.managerMigration && current.managerMigration.coverage) {
        const coverageChange = calculateChange(
            current.managerMigration.coverage,
            baseline.baseline.managerMigration.coverage,
        );

        report.managerMigration = {
            current: current.managerMigration.coverage,
            baseline: baseline.baseline.managerMigration.coverage,
            change: coverageChange.change,
            percent: coverageChange.percent,
            status: coverageChange.change >= 0 ? "improved" : "regressed",
        };

        if (coverageChange.change >= 0) report.summary.improvements++;
        else report.summary.regressions++;
        report.summary.totalChanges++;

        report.targets.managerCoverage.status = current.managerMigration.coverage >= 95 ? "passed" : "pending";
    }

    if (baseline?.baseline?.testCoverage && current.testCoverage.lines) {
        const coverageChange = calculateChange(
            parseFloat(current.testCoverage.lines),
            parseFloat(baseline.baseline.testCoverage.lines),
        );

        report.testCoverage = {
            current: parseFloat(current.testCoverage.lines),
            baseline: parseFloat(baseline.baseline.testCoverage.lines),
            change: coverageChange.change,
            percent: coverageChange.percent,
            status: coverageChange.change >= 0 ? "improved" : "regressed",
        };

        if (coverageChange.change >= 0) report.summary.improvements++;
        else report.summary.regressions++;
        report.summary.totalChanges++;

        report.targets.testCoverage.status = parseFloat(current.testCoverage.lines) >= 80 ? "passed" : "pending";
    }

    return report;
}

function generateMarkdownReport(report) {
    const lines = [
        "# Performance Comparison Report",
        "",
        `> Generated: ${report.timestamp}`,
        `> Baseline: ${report.baselineTimestamp}`,
        "",
        "## 1. Summary",
        "",
        `| Metric | Value |`,
        `|---|---:|`,
        `| Total Changes | ${report.summary.totalChanges} |`,
        `| Improvements | ${report.summary.improvements} |`,
        `| Regressions | ${report.summary.regressions} |`,
        "",
        "## 2. Bundle Size",
        "",
        "| Metric | Current | Baseline | Change | Status |",
        "|---|---:|---:|---:|---|",
    ];

    if (report.bundle.current) {
        lines.push(
            `| Total Bundle | ${report.bundle.current} KB | ${report.bundle.baseline} KB | ${report.bundle.percent} | ${report.bundle.status === "improved" ? "✅" : "⚠️"} |`,
        );
    }

    lines.push("", "## 3. Critical Module Sizes", "");
    lines.push("| Module | Current | Baseline | Change | Status |");
    lines.push("|---|---:|---:|---:|---|");

    for (const [mod, data] of Object.entries(report.criticalModules)) {
        lines.push(
            `| ${mod} | ${data.current} lines | ${data.baseline} lines | ${data.percent} | ${data.status === "improved" ? "✅" : "⚠️"} |`,
        );
    }

    lines.push("", "## 4. Manager Migration", "");
    lines.push("| Metric | Current | Baseline | Change | Status |");
    lines.push("|---|---:|---:|---:|---|");

    if (report.managerMigration.current) {
        lines.push(
            `| Coverage | ${report.managerMigration.current}% | ${report.managerMigration.baseline}% | ${report.managerMigration.percent} | ${report.managerMigration.status === "improved" ? "✅" : "⚠️"} |`,
        );
    }

    lines.push("", "## 5. Test Coverage", "");
    lines.push("| Metric | Current | Baseline | Change | Status |");
    lines.push("|---|---:|---:|---:|---|");

    if (report.testCoverage.current) {
        lines.push(
            `| Line Coverage | ${report.testCoverage.current}% | ${report.testCoverage.baseline}% | ${report.testCoverage.percent} | ${report.testCoverage.status === "improved" ? "✅" : "⚠️"} |`,
        );
    }

    lines.push("", "## 6. Target Verification", "");
    lines.push("| Target | Goal | Status |");
    lines.push("|---|---|---|");

    for (const [name, data] of Object.entries(report.targets)) {
        const label = name.replace(/([A-Z])/g, " $1").replace(/^./, (str) => str.toUpperCase());
        lines.push(`| ${label} | ${data.target} | ${data.status === "passed" ? "✅ Passed" : "⏳ Pending"} |`);
    }

    return lines.join("\n");
}

function main() {
    console.log("=".repeat(60));
    console.log("Performance Comparison Report");
    console.log(`Timestamp: ${TIMESTAMP}`);
    console.log("=".repeat(60));

    ensureDir(REPORT_DIR);

    const baselinePath = findLatestBaseline();
    if (!baselinePath) {
        console.error("[error] No baseline found. Run `pnpm perf:baseline` first.");
        process.exit(1);
    }

    console.log(`\n[baseline] Using: ${baselinePath}`);
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

    console.log("\n[current] Collecting current metrics...");
    const current = getCurrentMetrics();

    console.log("\n[comparison] Generating comparison report...");
    const report = generateComparisonReport(current, baseline);

    const reportPath = path.join(REPORT_DIR, `comparison-${TIMESTAMP}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n[Report] Saved to: ${reportPath}`);

    const mdPath = path.join(REPORT_DIR, `comparison-${TIMESTAMP}.md`);
    const mdContent = generateMarkdownReport(report);
    fs.writeFileSync(mdPath, mdContent);
    console.log(`[Report] Saved to: ${mdPath}`);

    console.log("\n" + "=".repeat(60));
    console.log("Comparison Summary");
    console.log("=".repeat(60));
    console.log(`Total Changes: ${report.summary.totalChanges}`);
    console.log(`Improvements: ${report.summary.improvements}`);
    console.log(`Regressions: ${report.summary.regressions}`);

    const passedTargets = Object.values(report.targets).filter((t) => t.status === "passed").length;
    const totalTargets = Object.keys(report.targets).length;
    console.log(`Targets: ${passedTargets}/${totalTargets} passed`);
}

main();
