#!/usr/bin/env node

/**
 * Quality KPI Dashboard Generator
 *
 * Collects and aggregates quality metrics from multiple sources:
 * - Test coverage (vitest)
 * - Code complexity (custom analyzer)
 * - Code duplication (custom analyzer)
 * - Security audit (pnpm audit)
 * - Technical debt (TODO/FIXME/HACK/XXX)
 * - Manager migration coverage
 * - Cache metrics (CacheRegistry)
 * - Performance baselines
 *
 * Output: JSON report + Markdown summary
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const projectRoot = process.cwd();
const reportDir = path.join(projectRoot, "docs", "governance", "quality-reports");
const reportFile = path.join(reportDir, `quality-report-${new Date().toISOString().split("T")[0]}.json`);

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function runCommand(cmd, silent = false) {
    try {
        return execSync(cmd, {
            encoding: "utf8",
            cwd: projectRoot,
            stdio: silent ? "pipe" : "inherit",
            maxBuffer: 20 * 1024 * 1024,
        });
    } catch (e) {
        return null;
    }
}

function parseLcov(content) {
    const records = new Map();
    let currentFile = null;
    let linesFound = 0;
    let linesHit = 0;
    let branchesFound = 0;
    let branchesHit = 0;
    let functionsFound = 0;
    let functionsHit = 0;

    const flush = () => {
        if (!currentFile) return;
        records.set(currentFile, {
            linesFound,
            linesHit,
            linesRatio: linesFound === 0 ? 0 : (linesHit / linesFound) * 100,
            branchesFound,
            branchesHit,
            branchesRatio: branchesFound === 0 ? 0 : (branchesHit / branchesFound) * 100,
            functionsFound,
            functionsHit,
            functionsRatio: functionsFound === 0 ? 0 : (functionsHit / functionsFound) * 100,
        });
    };

    for (const line of content.split("\n")) {
        if (line.startsWith("SF:")) {
            flush();
            currentFile = line.slice(3).trim().replaceAll("\\", "/");
            linesFound = 0;
            linesHit = 0;
            branchesFound = 0;
            branchesHit = 0;
            functionsFound = 0;
            functionsHit = 0;
            continue;
        }
        if (line.startsWith("LF:")) {
            linesFound = Number(line.slice(3).trim());
            continue;
        }
        if (line.startsWith("LH:")) {
            linesHit = Number(line.slice(3).trim());
            continue;
        }
        if (line.startsWith("BRF:")) {
            branchesFound = Number(line.slice(4).trim());
            continue;
        }
        if (line.startsWith("BRH:")) {
            branchesHit = Number(line.slice(4).trim());
            continue;
        }
        if (line.startsWith("FNF:")) {
            functionsFound = Number(line.slice(4).trim());
            continue;
        }
        if (line.startsWith("FNH:")) {
            functionsHit = Number(line.slice(4).trim());
            continue;
        }
        if (line === "end_of_record") {
            flush();
            currentFile = null;
        }
    }
    flush();
    return records;
}

function normalizeCoveragePath(filePath) {
    return filePath.replaceAll("\\", "/").replace(`${projectRoot.replaceAll("\\", "/")}/`, "");
}

function extractJsonPayload(rawOutput) {
    if (!rawOutput) return null;

    const trimmed = rawOutput.trim();
    if (!trimmed) return null;

    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
        return null;
    }

    return trimmed.slice(firstBrace, lastBrace + 1);
}

function collectCoverageMetrics() {
    const lcovPath = path.join(projectRoot, "coverage", "lcov.info");
    if (!fs.existsSync(lcovPath)) {
        console.log("[quality-report] Coverage file not found, running tests...");
        runCommand("npx vitest run --coverage", true);
    }

    if (!fs.existsSync(lcovPath)) {
        return { error: "Coverage data not available" };
    }

    const records = parseLcov(fs.readFileSync(lcovPath, "utf8"));

    let totalLinesFound = 0;
    let totalLinesHit = 0;
    let totalBranchesFound = 0;
    let totalBranchesHit = 0;
    let totalFunctionsFound = 0;
    let totalFunctionsHit = 0;

    for (const record of records.values()) {
        totalLinesFound += record.linesFound;
        totalLinesHit += record.linesHit;
        totalBranchesFound += record.branchesFound;
        totalBranchesHit += record.branchesHit;
        totalFunctionsFound += record.functionsFound;
        totalFunctionsHit += record.functionsHit;
    }

    return {
        lines: {
            total: totalLinesFound,
            covered: totalLinesHit,
            percentage: totalLinesFound === 0 ? 0 : ((totalLinesHit / totalLinesFound) * 100).toFixed(2),
            threshold: 70,
            passed: totalLinesFound === 0 ? false : (totalLinesHit / totalLinesFound) * 100 >= 70,
        },
        branches: {
            total: totalBranchesFound,
            covered: totalBranchesHit,
            percentage: totalBranchesFound === 0 ? 0 : ((totalBranchesHit / totalBranchesFound) * 100).toFixed(2),
            threshold: 60,
            passed: totalBranchesFound === 0 ? false : (totalBranchesHit / totalBranchesFound) * 100 >= 60,
        },
        functions: {
            total: totalFunctionsFound,
            covered: totalFunctionsHit,
            percentage: totalFunctionsFound === 0 ? 0 : ((totalFunctionsHit / totalFunctionsFound) * 100).toFixed(2),
            threshold: 70,
            passed: totalFunctionsFound === 0 ? false : (totalFunctionsHit / totalFunctionsFound) * 100 >= 70,
        },
        fileCount: records.size,
    };
}

function collectCriticalCoverage() {
    const criticalTargets = [
        "src/admin/index.ts",
        "src/dm/index.ts",
        "src/push/index.ts",
        "src/space/index.ts",
        "src/room-summary/index.ts",
        "src/room/RoomManager.ts",
        "src/event/EventManager.ts",
        "src/auth/index.ts",
    ];

    const lcovPath = path.join(projectRoot, "coverage", "lcov.info");
    if (!fs.existsSync(lcovPath)) {
        return { error: "Coverage data not available" };
    }

    const records = parseLcov(fs.readFileSync(lcovPath, "utf8"));
    const results = [];

    for (const target of criticalTargets) {
        const record = records.get(target) ?? records.get(normalizeCoveragePath(path.resolve(projectRoot, target)));
        results.push({
            file: target,
            coverage: record ? record.linesRatio.toFixed(2) : "N/A",
            threshold: 90,
            passed: record ? record.linesRatio >= 90 : false,
        });
    }

    return {
        modules: results,
        passed: results.every((r) => r.passed),
        threshold: 90,
    };
}

function collectComplexityMetrics() {
    const clientTsPath = path.join(projectRoot, "src", "client.ts");
    if (!fs.existsSync(clientTsPath)) {
        return { error: "client.ts not found" };
    }

    const content = fs.readFileSync(clientTsPath, "utf8");
    const lines = content.split("\n").length;

    const functionPattern = /(?:public|private|protected|async)\s+(\w+)\s*\(/g;
    const functions = [];
    let match;
    while ((match = functionPattern.exec(content)) !== null) {
        functions.push(match[1]);
    }

    return {
        clientTs: {
            lines,
            functionCount: functions.length,
            baseline: 9044,
            reduction: (((9044 - lines) / 9044) * 100).toFixed(1),
        },
    };
}

function collectSecurityAudit() {
    const result = runCommand("pnpm audit --audit-level=high --json", true);
    if (!result) {
        return { error: "pnpm audit failed" };
    }

    try {
        const audit = JSON.parse(result);
        const metadata = audit.metadata || {};

        return {
            vulnerabilities: {
                critical: metadata.vulnerabilities?.critical || 0,
                high: metadata.vulnerabilities?.high || 0,
                moderate: metadata.vulnerabilities?.moderate || 0,
                low: metadata.vulnerabilities?.low || 0,
                info: metadata.vulnerabilities?.info || 0,
                total: metadata.vulnerabilities?.total || 0,
            },
            passed: (metadata.vulnerabilities?.high || 0) === 0 && (metadata.vulnerabilities?.critical || 0) === 0,
        };
    } catch (e) {
        return { error: "Failed to parse audit output" };
    }
}

function collectTechnicalDebt() {
    const srcDir = path.join(projectRoot, "src");
    const patterns = {
        TODO: /\bTODO\b/g,
        FIXME: /\bFIXME\b/g,
        HACK: /\bHACK\b/g,
        XXX: /\bXXX\b/g,
    };

    const counts = { TODO: 0, FIXME: 0, HACK: 0, XXX: 0 };
    const files = [];

    function scanDir(dir) {
        for (const entry of fs.readdirSync(dir)) {
            const fullPath = path.join(dir, entry);
            if (fs.statSync(fullPath).isDirectory()) {
                scanDir(fullPath);
            } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
                const content = fs.readFileSync(fullPath, "utf8");
                const fileCounts = {};
                for (const [type, pattern] of Object.entries(patterns)) {
                    const matches = content.match(pattern);
                    if (matches) {
                        counts[type] += matches.length;
                        fileCounts[type] = matches.length;
                    }
                }
                if (Object.keys(fileCounts).length > 0) {
                    files.push({ file: fullPath.replace(projectRoot, ""), ...fileCounts });
                }
            }
        }
    }

    scanDir(srcDir);

    return {
        summary: counts,
        total: Object.values(counts).reduce((a, b) => a + b, 0),
        baseline: 181,
        reduction: (((181 - Object.values(counts).reduce((a, b) => a + b, 0)) / 181) * 100).toFixed(1),
        topFiles: files.sort((a, b) => (b.TODO || 0) + (b.FIXME || 0) - (a.TODO || 0) - (a.FIXME || 0)).slice(0, 10),
    };
}

function collectManagerMigration() {
    const srcDir = path.join(projectRoot, "src");
    let totalManagers = 0;
    let baseManagerCount = 0;
    const nonMigrated = [];

    function scanDir(dir) {
        for (const entry of fs.readdirSync(dir)) {
            const fullPath = path.join(dir, entry);
            if (fs.statSync(fullPath).isDirectory()) {
                scanDir(fullPath);
            } else if (entry === "index.ts") {
                const content = fs.readFileSync(fullPath, "utf8");
                const classMatches = content.match(/export class \w+(?:Manager|Handler|Service|Provider|Client)/g);
                if (classMatches) {
                    for (const match of classMatches) {
                        totalManagers++;
                        const className = match.replace("export class ", "");
                        if (content.includes("extends BaseManager")) {
                            baseManagerCount++;
                        } else if (!content.includes("extends TypedEventEmitter")) {
                            nonMigrated.push({ file: fullPath.replace(projectRoot, ""), class: className });
                        }
                    }
                }
            }
        }
    }

    scanDir(srcDir);

    return {
        total: totalManagers,
        migrated: baseManagerCount,
        coverage: totalManagers === 0 ? 0 : ((baseManagerCount / totalManagers) * 100).toFixed(1),
        threshold: 95,
        passed: (baseManagerCount / totalManagers) * 100 >= 95,
        nonMigrated: nonMigrated.slice(0, 5),
    };
}

function collectAnyTypeUsage() {
    const srcDir = path.join(projectRoot, "src");
    let colonAnyCount = 0;
    let asAnyCount = 0;

    function scanDir(dir) {
        for (const entry of fs.readdirSync(dir)) {
            const fullPath = path.join(dir, entry);
            if (fs.statSync(fullPath).isDirectory()) {
                scanDir(fullPath);
            } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
                const content = fs.readFileSync(fullPath, "utf8");
                const colonMatches = content.match(/:\s*any\b/g);
                const asMatches = content.match(/\bas\s+any\b/g);
                if (colonMatches) colonAnyCount += colonMatches.length;
                if (asMatches) asAnyCount += asMatches.length;
            }
        }
    }

    scanDir(srcDir);

    return {
        colonAny: colonAnyCount,
        asAny: asAnyCount,
        total: colonAnyCount + asAnyCount,
        baseline: 208,
        reduction: (((208 - colonAnyCount - asAnyCount) / 208) * 100).toFixed(1),
    };
}

function collectTestStats() {
    let output = "";

    try {
        output = execSync("npx vitest run --reporter=json", {
            encoding: "utf8",
            cwd: projectRoot,
            stdio: "pipe",
            maxBuffer: 20 * 1024 * 1024,
        });
    } catch (e) {
        output = e.stdout?.toString?.() ?? "";
    }

    const jsonPayload = extractJsonPayload(output);
    if (!jsonPayload) {
        return { error: "Failed to capture test output" };
    }

    try {
        const testResult = JSON.parse(jsonPayload);
        const passedTests = testResult.numPassedTests || 0;
        const failedTests = testResult.numFailedTests || 0;
        const skippedTests = testResult.numPendingTests || 0;
        const totalTests = testResult.numTotalTests || passedTests + failedTests + skippedTests;

        return {
            testFiles: testResult.numTotalTestSuites || 0,
            totalTests,
            passedTests,
            failedTests,
            skippedTests,
            duration: testResult.success
                ? `${((testResult.endTime - testResult.startTime) / 1000).toFixed(1)}s`
                : "N/A",
            passed: Boolean(testResult.success),
        };
    } catch (e) {
        return { error: "Failed to parse test output" };
    }
}

function generateReport() {
    console.log("[quality-report] Collecting quality metrics...\n");

    const report = {
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        metrics: {
            coverage: collectCoverageMetrics(),
            criticalCoverage: collectCriticalCoverage(),
            complexity: collectComplexityMetrics(),
            security: collectSecurityAudit(),
            technicalDebt: collectTechnicalDebt(),
            managerMigration: collectManagerMigration(),
            anyTypeUsage: collectAnyTypeUsage(),
            tests: collectTestStats(),
        },
        summary: {
            overallHealth: "unknown",
            passedChecks: 0,
            totalChecks: 0,
        },
    };

    const checks = [
        report.metrics.coverage.lines?.passed,
        report.metrics.coverage.branches?.passed,
        report.metrics.coverage.functions?.passed,
        report.metrics.criticalCoverage?.passed,
        report.metrics.security?.passed,
        report.metrics.managerMigration?.passed,
        report.metrics.tests?.passed,
    ].filter((c) => c !== undefined);

    report.summary.passedChecks = checks.filter((c) => c).length;
    report.summary.totalChecks = checks.length;
    report.summary.overallHealth =
        report.summary.passedChecks === report.summary.totalChecks
            ? "healthy"
            : report.summary.passedChecks >= report.summary.totalChecks * 0.8
              ? "warning"
              : "critical";

    ensureDir(reportDir);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(`[quality-report] Report saved to: ${reportFile}\n`);

    generateMarkdownSummary(report);

    return report;
}

function generateMarkdownSummary(report) {
    const mdFile = reportFile.replace(".json", ".md");

    const lines = [
        `# Quality KPI Report - ${report.timestamp.split("T")[0]}`,
        "",
        `## Overall Health: ${report.summary.overallHealth.toUpperCase()}`,
        "",
        `**Checks Passed**: ${report.summary.passedChecks}/${report.summary.totalChecks}`,
        "",
        "### Test Coverage",
        `| Metric | Value | Threshold | Status |`,
        `|--------|-------|-----------|--------|`,
        `| Lines | ${report.metrics.coverage.lines?.percentage || "N/A"}% | ${report.metrics.coverage.lines?.threshold || 70}% | ${report.metrics.coverage.lines?.passed ? "✅" : "❌"} |`,
        `| Branches | ${report.metrics.coverage.branches?.percentage || "N/A"}% | ${report.metrics.coverage.branches?.threshold || 60}% | ${report.metrics.coverage.branches?.passed ? "✅" : "❌"} |`,
        `| Functions | ${report.metrics.coverage.functions?.percentage || "N/A"}% | ${report.metrics.coverage.functions?.threshold || 70}% | ${report.metrics.coverage.functions?.passed ? "✅" : "❌"} |`,
        "",
        "### Critical Module Coverage (>= 90%)",
        `| Module | Coverage | Status |`,
        `|--------|----------|--------|`,
        ...(report.metrics.criticalCoverage?.modules || []).map(
            (m) => `| ${m.file} | ${m.coverage}% | ${m.passed ? "✅" : "❌"} |`,
        ),
        "",
        "### Code Quality",
        `| Metric | Value | Baseline | Change |`,
        `|--------|-------|----------|--------|`,
        `| client.ts Lines | ${report.metrics.complexity?.clientTs?.lines || "N/A"} | ${report.metrics.complexity?.clientTs?.baseline || 9044} | ${report.metrics.complexity?.clientTs?.reduction || 0}% |`,
        `| TODO/FIXME/HACK/XXX | ${report.metrics.technicalDebt?.total || 0} | ${report.metrics.technicalDebt?.baseline || 181} | ${report.metrics.technicalDebt?.reduction || 0}% |`,
        `| \`any\` Usage | ${report.metrics.anyTypeUsage?.total || 0} | ${report.metrics.anyTypeUsage?.baseline || 208} | ${report.metrics.anyTypeUsage?.reduction || 0}% |`,
        `| Manager Migration | ${report.metrics.managerMigration?.coverage || 0}% | 95% | ${report.metrics.managerMigration?.passed ? "✅" : "❌"} |`,
        "",
        "### Security",
        `| Severity | Count |`,
        `|----------|-------|`,
        `| Critical | ${report.metrics.security?.vulnerabilities?.critical || 0} |`,
        `| High | ${report.metrics.security?.vulnerabilities?.high || 0} |`,
        `| Moderate | ${report.metrics.security?.vulnerabilities?.moderate || 0} |`,
        `| Low | ${report.metrics.security?.vulnerabilities?.low || 0} |`,
        "",
        `**Status**: ${report.metrics.security?.passed ? "✅ No high/critical vulnerabilities" : "❌ Vulnerabilities found"}`,
        "",
        "### Tests",
        `| Metric | Value |`,
        `|--------|-------|`,
        `| Test Files | ${report.metrics.tests?.testFiles || 0} |`,
        `| Total Tests | ${report.metrics.tests?.totalTests || 0} |`,
        `| Passed | ${report.metrics.tests?.passedTests || 0} |`,
        `| Failed | ${report.metrics.tests?.failedTests || 0} |`,
        `| Skipped | ${report.metrics.tests?.skippedTests || 0} |`,
        "",
        "---",
        `*Generated by quality-report.mjs*`,
    ];

    fs.writeFileSync(mdFile, lines.join("\n"));
    console.log(`[quality-report] Markdown summary saved to: ${mdFile}`);
}

const report = generateReport();
console.log("\n[quality-report] Summary:");
console.log(`  Overall Health: ${report.summary.overallHealth}`);
console.log(`  Checks Passed: ${report.summary.passedChecks}/${report.summary.totalChecks}`);
