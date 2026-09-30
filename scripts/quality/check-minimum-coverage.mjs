#!/usr/bin/env node
/**
 * 最低覆盖率门禁
 *
 * 用法:
 *   node scripts/quality/check-minimum-coverage.mjs [--target=0.8] [--json]
 *
 * 目标:
 *   - 确保测试覆盖率不低于设定阈值
 *   - 在 CI 中作为阻断性门禁
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TARGET = parseFloat(process.argv.find((a) => a.startsWith("--target="))?.split("=")[1] ?? "0.7");
const SHOULD_EMIT_JSON = process.argv.includes("--json");

const rootDir = process.cwd();
const reportPath = path.join(rootDir, "coverage", "lcov.info");

if (!fs.existsSync(reportPath)) {
    console.error("❌ coverage/lcov.info 不存在");
    console.log("💡 请先运行: npm run test:coverage");
    process.exit(1);
}

const lcovContent = fs.readFileSync(reportPath, "utf8");

// 提取总体覆盖率
const summaryMatch = lcovContent.match(/SUMMARY:[\s\S]*?end_of_summary/);
if (!summaryMatch) {
    console.error("❌ 无法从 lcov 报告中提取覆盖率数据");
    process.exit(1);
}

const summary = summaryMatch[0];
const lineCoverage = summary.match(/lines:([\d.]+)%/)?.[1];
const branchCoverage = summary.match(/branches:([\d.]+)%/)?.[1];
const functionCoverage = summary.match(/functions:([\d.]+)%/)?.[1];

if (!lineCoverage) {
    console.error("❌ 无法解析行覆盖率");
    process.exit(1);
}

const coverageRate = parseFloat(lineCoverage) / 100;
const passed = coverageRate >= TARGET;

if (SHOULD_EMIT_JSON) {
    const report = {
        coverage: {
            lines: coverageRate,
            branches: branchCoverage ? parseFloat(branchCoverage) / 100 : null,
            functions: functionCoverage ? parseFloat(functionCoverage) / 100 : null,
        },
        target: TARGET,
        passed,
        timestamp: new Date().toISOString(),
    };
    console.log(JSON.stringify(report, null, 2));
    process.exit(passed ? 0 : 1);
}

console.log(`📊 覆盖率统计:`);
console.log(`   行覆盖率：${lineCoverage}%`);
console.log(`   分支覆盖率：${branchCoverage ?? "N/A"}%`);
console.log(`   函数覆盖率：${functionCoverage ?? "N/A"}%`);
console.log(`   目标覆盖率：${(TARGET * 100).toFixed(0)}%`);
console.log("");

if (passed) {
    console.log(`✅ 通过率：覆盖率 ${(coverageRate * 100).toFixed(1)}% ≥ ${(TARGET * 100).toFixed(0)}%`);
    process.exit(0);
} else {
    console.log(`❌ 失败：覆盖率 ${(coverageRate * 100).toFixed(1)}% < ${(TARGET * 100).toFixed(0)}%`);
    console.log("");
    console.log("💡 建议:");
    console.log(`   1. 补充缺失模块的单元测试`);
    console.log(`   2. 降低目标阈值 (--target=0.6)`);
    console.log(`   3. 运行完整测试生成覆盖率报告`);
    process.exit(1);
}
