#!/usr/bin/env node
/**
 * find-lowest-coverage-files.mjs —— 文件级覆盖风险报告（advisory，非阻断）
 *
 * 输出最薄弱的源文件（"有 HTTP 调用但没有任何 spec 触及"排在最前）。
 *
 * ⚠️ 历史坑（务必不要回退）:
 *   本脚本最初用 `walkDir(specDir, [".spec.ts"])` 收集测试文件，但
 *   `path.extname("foo.spec.ts")` 返回 `".ts"`，于是**一个 spec 都扫不到**
 *   （输出 `Found 471 source files and 0 test files`），全部源文件被判"无测试"。
 *   修掉那处之后仍是按 basename 猜测试文件，而本仓 spec 与源文件**不同名**
 *   （`src/client.ts` ← `matrix-client.spec.ts`、`src/three-pids/` ← `threepids.spec.ts`），
 *   于是 `client.ts` 等仍在报告里显示 MISSING —— 假阳性会直接误导优先级判断。
 *
 *   现在统一改用 `lib/spec-import-graph.mjs` 的两个可验证信号：
 *     A. 直接 spec（镜像路径 / 扁平同名）
 *     B. import 图（任意 spec import 了该文件）
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCoverageSignals, hasDirectSpec } from "./lib/spec-import-graph.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..", "..");

const srcDir = path.join(projectRoot, "src");
const specDir = path.join(projectRoot, "spec");

const HTTP_CALL_RE = /withRetry|authedRequest|authedRequestClient|makeRequest|\.request\(Method/g;

const signals = createCoverageSignals(srcDir, specDir);
const sourceFiles = signals.sourceFiles;
const specFiles = signals.specFiles;
const isTouched = signals.isTouched;

console.log(`Found ${sourceFiles.length} source files and ${specFiles.length} test files\n`);

const analysisResults = [];

for (const sourceFile of sourceFiles) {
    const relativePath = path.relative(srcDir, sourceFile);
    const content = fs.readFileSync(sourceFile, "utf8");
    const lines = content.split("\n").length;
    const httpCount = (content.match(HTTP_CALL_RE) || []).length;

    const touched = isTouched(sourceFile);
    const directSpec = hasDirectSpec(sourceFile, srcDir, specDir);

    // 风险评分：只看"有没有被任何 spec 触及"，不再用 testLines/sourceLines 这种
    // 与真实覆盖率无关的行数比值（它会把"测试文件短但覆盖全"的文件误判成高风险）。
    let riskScore = 0;
    if (httpCount > 0 && !touched)
        riskScore = 100; // 真盲区
    else if (httpCount > 0 && !directSpec)
        riskScore = 50; // 仅间接触及，无专属 spec
    else if (lines > 500 && !directSpec) riskScore = 20;

    if (riskScore > 0) {
        analysisResults.push({
            file: relativePath,
            lines,
            httpCount,
            hasTest: touched,
            directSpec,
            riskScore,
        });
    }
}

analysisResults.sort((a, b) => b.riskScore - a.riskScore || b.httpCount - a.httpCount);

console.log("=".repeat(80));
console.log("文件级覆盖率风险分析 - 前 20 个高风险文件");
console.log("=".repeat(80));

for (let i = 0; i < Math.min(20, analysisResults.length); i++) {
    const r = analysisResults[i];
    const testLabel = r.directSpec ? "✅ 直接 spec" : r.hasTest ? "🟡 仅被 spec import" : "❌ MISSING";
    console.log(`${i + 1}. ${r.file}`);
    console.log(`   Lines: ${r.lines} | HTTP Calls: ${r.httpCount}`);
    console.log(`   Test: ${testLabel}`);
    console.log(`   Risk Score: ${r.riskScore}`);
    console.log("");
}

console.log("=".repeat(80));
console.log("⚠️ 完全无测试的文件（需要优先补充测试）");
console.log("=".repeat(80));
console.log("");

const uncovered = analysisResults.filter((r) => r.riskScore === 100);
for (let i = 0; i < Math.min(5, uncovered.length); i++) {
    const r = uncovered[i];
    console.log(`${i + 1}. \`src/${r.file}\``);
    console.log(`   规模：${r.lines} 行代码`);
    console.log(`   HTTP 调用：${r.httpCount} 次`);
    console.log(`   问题：无任何 spec 引用该模块`);
    console.log(`   建议：创建 \`spec/unit/${r.file.replace(/\.ts$/, ".spec.ts")}\``);
    console.log("");
}
if (uncovered.length === 0) console.log("（无）");

// JSON 输出
const top5 = uncovered.slice(0, 5);
const jsonOutput = {
    generatedAt: new Date().toISOString(),
    totalAnalyzed: analysisResults.length,
    criticalFiles: top5.map((r) => ({
        file: r.file,
        lines: r.lines,
        httpCalls: r.httpCount,
        recommendedTestPath: `spec/unit/${r.file.replace(/\.ts$/, ".spec.ts")}`,
    })),
};

console.log("\nJSON Output:");
console.log(JSON.stringify(jsonOutput.criticalFiles, null, 2));
