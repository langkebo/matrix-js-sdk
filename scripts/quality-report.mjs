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

/**
 * 是否允许报告脚本自己拉起全量测试。
 *
 * 默认关闭：本仓全量 vitest 单次约 5-6 分钟，而 coverage 那一轨还要再加一次
 * （collectCoverageMetrics + collectTestStats 各一次）—— 实测一次报告 **11 分 14 秒**，
 * 且输出被 `silent` 吞掉，看起来就是"卡住了"。更糟的是它跑完并不产出
 * coverage/lcov.info（见 collectCoverageMetrics），于是下一次还是照样白跑。
 *
 * 需要测试的那一轨请用 CI/本地显式跑完，再让报告读产物：
 *   pnpm test --coverage            # 产出 coverage/lcov.info
 *   pnpm quality:report             # 秒级，只读产物
 * 确实想让报告自己跑（例如一次性体检）：
 *   pnpm quality:report --run-tests
 */
const AUTO_RUN_TESTS = process.argv.includes("--run-tests") || process.env.QUALITY_REPORT_RUN_TESTS === "1";

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
        if (!AUTO_RUN_TESTS) {
            // 不静默重试，也不假装数据缺失是"未知错误"：把该跑的那条命令直接说清楚。
            console.warn("[quality-report] coverage/lcov.info 不存在 —— 跳过覆盖率统计。");
            console.warn("[quality-report] 先执行：pnpm test --coverage（全量约 5-6 分钟）");
            console.warn("[quality-report] 或让本脚本自己跑：pnpm quality:report --run-tests");
            return { error: "Coverage data not available (run pnpm test --coverage first)", skipped: true };
        }
        console.log("[quality-report] Coverage file not found, running tests...");
        console.log("[quality-report] 这一步是全量 vitest --coverage，约 5-6 分钟，输出实时打印。");
        runCommand("npx vitest run --coverage", false);
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
    // Single source of truth, shared with scripts/quality/check-critical-coverage.mjs.
    // The two used to hardcode different module lists (5 vs 8), so the report and the
    // gate could disagree about whether the repo was healthy.
    const criticalConfig = JSON.parse(
        fs.readFileSync(path.join(projectRoot, "scripts", "quality", "critical-modules.json"), "utf8"),
    );
    const targetPercent = criticalConfig.targetPercent ?? 90;

    const lcovPath = path.join(projectRoot, "coverage", "lcov.info");
    if (!fs.existsSync(lcovPath)) {
        return { error: "Coverage data not available" };
    }

    const records = parseLcov(fs.readFileSync(lcovPath, "utf8"));
    const results = [];

    for (const entry of criticalConfig.modules) {
        const target = entry.path;
        const required = entry.floorPercent ?? targetPercent;
        const record = records.get(target) ?? records.get(normalizeCoveragePath(path.resolve(projectRoot, target)));
        results.push({
            file: target,
            coverage: record ? record.linesRatio.toFixed(2) : "N/A",
            threshold: required,
            target: targetPercent,
            passed: record ? record.linesRatio >= required : false,
        });
    }

    return {
        modules: results,
        passed: results.every((r) => r.passed),
        threshold: 90,
    };
}

/**
 * codegen 覆盖证据强度（C-2）。
 *
 * 直接消费 `check-manager-codegen-coverage.mjs --json`，而不是在报告里重算一遍 ——
 * 否则"报告显示的覆盖"和"门禁判定的覆盖"迟早会漂移。这里同时给出**强证据**（src 下
 * 有人 import 该模块的 route-table）与**弱证据**（生成了表但没人读）两栏，
 * 避免一个"覆盖率 100%"把"这张表没人读"掩盖掉。
 */
function collectCodegenCoverage() {
    const raw = runCommand("node scripts/quality/check-manager-codegen-coverage.mjs --json", true);
    const payload = extractJsonPayload(raw);
    if (!payload) {
        return { available: false, covered: 0, strong: [], weak: [], waived: 0, missing: 0 };
    }
    try {
        const parsed = JSON.parse(payload);
        return {
            available: true,
            covered: parsed.covered ?? 0,
            coverageRate: parsed.coverageRate ?? 0,
            strong: parsed.strong ?? [],
            weak: parsed.weak ?? [],
            waived: parsed.waived ?? 0,
            missing: parsed.missing ?? 0,
            missingModules: parsed.missingModules ?? [],
        };
    } catch {
        return { available: false, covered: 0, strong: [], weak: [], waived: 0, missing: 0 };
    }
}

/**
 * 契约差集（SDK-2）。
 *
 * 消费 `check-contract-drift.mjs --json`：SDK 生成 route-table 与后端 ledger 的双向差集数量。
 * "覆盖 100%" 不该掩盖"表与 ledger 不一致"，所以这里把两个方向都摊开。
 */
function collectContractDrift() {
    const raw = runCommand("node scripts/quality/check-contract-drift.mjs --json", true);
    const payload = extractJsonPayload(raw);
    if (!payload) {
        return { available: false, driftedModules: 0, sdkOnly: 0, ledgerOnly: 0, registered: 0, stale: 0 };
    }
    try {
        const parsed = JSON.parse(payload);
        return {
            available: true,
            driftedModules: parsed.driftedModules ?? 0,
            sdkOnly: parsed.sdkOnly ?? 0,
            ledgerOnly: parsed.ledgerOnly ?? 0,
            registered: parsed.registered ?? 0,
            stale: (parsed.stale ?? []).length,
            perModule: parsed.perModule ?? {},
        };
    } catch {
        return { available: false, driftedModules: 0, sdkOnly: 0, ledgerOnly: 0, registered: 0, stale: 0 };
    }
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

/**
 * `pnpm audit` exits non-zero whenever it *finds* anything at the configured
 * level, and only writes its JSON payload after that decision. A plain
 * `execSync` therefore throws away the whole report exactly when it matters
 * most, which is how this section used to render "❌ 0 vulnerabilities".
 * Capture stdout from both the success and the failure path instead.
 */
function runCommandCapture(cmd) {
    try {
        return {
            exitCode: 0,
            stdout: execSync(cmd, { encoding: "utf8", cwd: projectRoot, stdio: "pipe", maxBuffer: 20 * 1024 * 1024 }),
        };
    } catch (e) {
        return {
            exitCode: typeof e.status === "number" ? e.status : 1,
            stdout: typeof e.stdout === "string" ? e.stdout : "",
        };
    }
}

function summariseAuditPayload(stdout) {
    let audit;
    try {
        audit = JSON.parse(stdout);
    } catch {
        return null;
    }

    const advisories = Object.values(audit.advisories || {});
    const counts = { critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: advisories.length };
    const modules = new Set();

    for (const advisory of advisories) {
        const severity = advisory.severity || "info";
        counts[severity] = (counts[severity] || 0) + 1;
        modules.add(advisory.module_name || "unknown");
    }

    return { counts, modules, advisories, muted: Object.keys(audit.muted || {}).length };
}

function collectSecurityAudit() {
    // Full scope (runtime + dev). `audit:high` is `--prod`-only, but
    // `release.yml` gates on the full scope, and dev-tooling advisories still
    // ship in `pnpm-lock.yaml` for every contributor and CI runner.
    const fullScope = runCommandCapture("pnpm audit --json");
    const full = summariseAuditPayload(fullScope.stdout);
    if (!full) {
        return { error: "Failed to parse `pnpm audit --json` output", passed: false, exitCode: fullScope.exitCode };
    }

    // Runtime scope needs its own call: pnpm's advisory payload carries no
    // `dev` flag on findings, so "prod" cannot be derived from the full report.
    const prodScope = runCommandCapture("pnpm audit --prod --json");
    const prod = summariseAuditPayload(prodScope.stdout);

    const blockingAdvisories = full.advisories
        .filter((a) => a.severity === "high" || a.severity === "critical")
        .map((a) => ({
            severity: a.severity,
            module: a.module_name || "unknown",
            title: (a.title || "").trim(),
            vulnerableVersions: a.vulnerable_versions || "unknown",
            patchedVersions: a.patched_versions || "none",
            prod: prod ? prod.modules.has(a.module_name) : null,
        }))
        .sort((a, b) =>
            a.severity === b.severity ? a.module.localeCompare(b.module) : a.severity === "critical" ? -1 : 1,
        );

    return {
        // Kept for backwards compatibility with older report consumers: these
        // are the full-scope counts.
        vulnerabilities: full.counts,
        scopes: { all: full.counts, prod: prod ? prod.counts : null },
        blockingAdvisories,
        muted: full.muted,
        passed: full.counts.high === 0 && full.counts.critical === 0,
    };
}

/**
 * 安全段的 markdown 渲染（报告正文与 `--security-only` 诊断共用同一份实现，
 * 保证“能展示真实计数”这件事本身可被单独验证）。
 */
function renderSecuritySection(security) {
    const prod = security?.scopes?.prod ?? null;
    const all = security?.vulnerabilities ?? {};

    return [
        `| Severity | Runtime (\`--prod\`) | All scopes |`,
        `|----------|------------------|------------|`,
        `| Critical | ${prod?.critical ?? "-"} | ${all.critical || 0} |`,
        `| High | ${prod?.high ?? "-"} | ${all.high || 0} |`,
        `| Moderate | ${prod?.moderate ?? "-"} | ${all.moderate || 0} |`,
        `| Low | ${prod?.low ?? "-"} | ${all.low || 0} |`,
        `| Muted | - | ${security?.muted ?? 0} |`,
        "",
        `**Status**: ${security?.passed ? "✅ No high/critical vulnerabilities in any scope" : "❌ High/critical vulnerabilities found"}`,
        ...(security?.error ? [`**Error**: ${security.error}`] : []),
        ...(security?.blockingAdvisories?.length
            ? [
                  "",
                  "| Severity | Package | Vulnerable | Patched | Scope |",
                  "|----------|---------|-----------|---------|-------|",
                  ...security.blockingAdvisories
                      .slice(0, 15)
                      .map(
                          (a) =>
                              `| ${a.severity} | \`${a.module}\` | \`${a.vulnerableVersions}\` | \`${a.patchedVersions}\` | ${a.prod ? "runtime" : "dev-only"} |`,
                      ),
              ]
            : []),
    ];
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
    if (!AUTO_RUN_TESTS) {
        // 这一轨与 coverage 那次是**同一批全量测试跑第二遍**，纯属重复开销。
        // 没有数据就不计入健康度（summary 里 undefined 会被过滤掉），
        // 而不是用一份过期/缺失的数据假装检查过。
        console.warn("[quality-report] 跳过测试统计（默认不再重复跑一遍全量 vitest）。");
        console.warn("[quality-report] 需要时：pnpm quality:report --run-tests");
        return { skipped: true };
    }

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
            codegenCoverage: collectCodegenCoverage(),
            contractDrift: collectContractDrift(),
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
        `### Critical Module Coverage (target ${report.metrics.criticalCoverage?.threshold ?? 90}%, ratchet floors per module)`,
        `| Module | Coverage | Floor | Status |`,
        `|--------|----------|-------|--------|`,
        ...(report.metrics.criticalCoverage?.modules || []).map(
            (m) => `| ${m.file} | ${m.coverage}% | ${m.threshold}% | ${m.passed ? "✅" : "❌"} |`,
        ),
        "",
        "### Codegen Coverage (route-table 消费证据)",
        `| 层级 | 数量 | 说明 |`,
        `|------|------|------|`,
        `| 强证据（src 下有人 import 该模块 route-table） | ${report.metrics.codegenCoverage?.strong?.length ?? "N/A"} | 跨模块导入也算，判定见 check-manager-codegen-coverage.mjs |`,
        `| 弱证据（生成了表但没人读，已白名单说明原因） | ${report.metrics.codegenCoverage?.weak?.length ?? "N/A"} | ${(report.metrics.codegenCoverage?.weak || []).join(", ") || "（无）"} |`,
        `| 白名单（codegen 有意跳过 / 无消费者） | ${report.metrics.codegenCoverage?.waived ?? "N/A"} | 每条带 reason + 到期日 |`,
        `| 缺失 | ${report.metrics.codegenCoverage?.missing ?? "N/A"} | 非 0 即门禁红 |`,
        "",
        "### Contract Drift (SDK route-table ↔ 后端 ledger)",
        `| 方向 | 数量 | 说明 |`,
        `|------|------|------|`,
        `| 有差集的模块 | ${report.metrics.contractDrift?.driftedModules ?? "N/A"} | 逐条登记在 scripts/quality/contract-drift-registry.json |`,
        `| SDK 表有、ledger 无 | ${report.metrics.contractDrift?.sdkOnly ?? "N/A"} | 历史/人工条目，待 SDK-3/SDK-5 定性 |`,
        `| ledger 有、SDK 表无 | ${report.metrics.contractDrift?.ledgerOnly ?? "N/A"} | 文档漏覆盖或路径族变化，SDK-1 以 ledger 为源后收敛 |`,
        `| 已验证修好但没删登记（stale） | ${report.metrics.contractDrift?.stale ?? "N/A"} | 非 0 即门禁红 |`,
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
        ...renderSecuritySection(report.metrics.security),
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

// Fast diagnostic: render only the security section (no coverage run, no file
// writes), so the section's ability to surface non-zero counts can be verified
// end-to-end without a full two-minute report. Exit code mirrors the gate.
if (process.argv.includes("--security-only")) {
    const security = collectSecurityAudit();
    console.log(JSON.stringify(security, null, 2));
    console.log("\n### Security\n" + renderSecuritySection(security).join("\n"));
    process.exit(security.passed ? 0 : 1);
}

const report = generateReport();
console.log("\n[quality-report] Summary:");
console.log(`  Overall Health: ${report.summary.overallHealth}`);
console.log(`  Checks Passed: ${report.summary.passedChecks}/${report.summary.totalChecks}`);
