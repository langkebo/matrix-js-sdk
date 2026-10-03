#!/usr/bin/env node
/**
 * 文件级别的快速覆盖率分析
 * 精确定位最薄弱的 5 个源文件（有 HTTP 请求但没有测试）
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..", "..");

const srcDir = path.join(projectRoot, "src");
const specDir = path.join(projectRoot, "spec/unit");

function walkDir(dir, exts = [".ts"]) {
    const results = [];
    if (!fs.existsSync(dir)) return results;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith("_")) {
            results.push(...walkDir(fullPath, exts));
        } else if (entry.isFile() && exts.includes(path.extname(entry.name))) {
            results.push(fullPath);
        }
    }
    return results;
}

// 获取所有测试文件，建立"源文件 -> 测试文件"映射
const allSpecFiles = walkDir(specDir, [".spec.ts", ".spec.test.ts", ".test.ts"]);
const allSourceFiles = walkDir(srcDir, [".ts"]);

console.log(`Found ${allSourceFiles.length} source files and ${allSpecFiles.length} test files\n`);

// 对于每个源文件，查找对应的测试文件（支持多种模式）
function findTestForSource(sourcePath) {
    const relative = path.relative(srcDir, sourcePath);
    const dir = path.dirname(relative);
    const baseName = path.basename(sourcePath, ".ts");

    // 模式 1: src/foo/bar.ts -> spec/unit/foo/bar.spec.ts
    const candidate1 = path.join(specDir, dir, `${baseName}.spec.ts`);
    if (fs.existsSync(candidate1)) return candidate1;

    const candidate1b = path.join(specDir, dir, `${baseName}.spec.test.ts`);
    if (fs.existsSync(candidate1b)) return candidate1b;

    // 模式 2: src/foo/index.ts -> spec/unit/foo.spec.ts (扁平化)
    if (baseName === "index") {
        const parentDir = path.basename(dir);
        const candidate2 = path.join(specDir, `${parentDir}.spec.ts`);
        if (fs.existsSync(candidate2)) return candidate2;
    }

    // 模式 3: src/client.ts -> spec/unit/client.ts 同级
    const candidate3 = path.join(specDir, `${baseName}.spec.ts`);
    if (fs.existsSync(candidate3)) return candidate3;

    return null;
}

const analysisResults = [];

for (const sourceFile of allSourceFiles) {
    if (sourceFile.endsWith(".d.ts")) continue;

    const relativePath = path.relative(srcDir, sourceFile);
    const content = fs.readFileSync(sourceFile, "utf8");
    const lines = content.split("\n").length;

    // 检查是否有 HTTP 请求
    const httpMatches = content.match(/withRetry|authedRequest|\.request\(Method/g);
    const httpCount = httpMatches ? httpMatches.length : 0;

    // 检查是否有测试
    const testFile = findTestForSource(sourceFile);
    const hasTest = !!testFile;

    // 风险评分
    let riskScore = 0;
    if (httpCount > 0 && !hasTest) {
        riskScore = 100;
    } else if (httpCount > 0 && hasTest) {
        const testContent = fs.readFileSync(testFile, "utf8");
        const testLines = testContent.split("\n").length;
        const coverageRatio = testLines / lines;
        if (coverageRatio < 0.3) riskScore = 80;
        else if (coverageRatio < 0.6) riskScore = 50;
        else if (coverageRatio < 0.9) riskScore = 20;
    } else if (!httpCount && lines > 500 && !hasTest) {
        riskScore = 40;
    } else if (!httpCount && lines > 200 && !hasTest) {
        riskScore = 20;
    }

    if (riskScore > 0) {
        analysisResults.push({
            file: relativePath,
            lines,
            httpCount,
            hasTest,
            testFile: testFile || null,
            riskScore,
        });
    }
}

// 排序
analysisResults.sort((a, b) => b.riskScore - a.riskScore);

console.log("=".repeat(80));
console.log("文件级覆盖率风险分析 - 前 20 个高风险文件");
console.log("=".repeat(80));

for (let i = 0; i < Math.min(20, analysisResults.length); i++) {
    const r = analysisResults[i];
    console.log(`${i + 1}. ${r.file}`);
    console.log(`   Lines: ${r.lines} | HTTP Calls: ${r.httpCount}`);
    console.log(`   Test: ${r.hasTest ? "✅ " + path.basename(r.testFile || "") : "❌ MISSING"}`);
    console.log(`   Risk Score: ${r.riskScore}`);
    console.log("");
}

console.log("=".repeat(80));
console.log("⚠️ 最薄弱的 5 个文件（需要优先补充测试）");
console.log("=".repeat(80));
console.log("");

for (let i = 0; i < Math.min(5, analysisResults.length); i++) {
    const r = analysisResults[i];
    if (r.riskScore >= 100) {
        console.log(`${i + 1}. \`src/${r.file}\``);
        console.log(`   规模：${r.lines} 行代码`);
        console.log(`   HTTP 调用：${r.httpCount} 次`);
        console.log(`   问题：完全无测试文件`);
        console.log(`   建议：创建 \`spec/unit/${r.file.replace(".ts", ".spec.ts")}\``);
        console.log("");
    }
}

// JSON 输出
const top5 = analysisResults.filter((r) => r.riskScore >= 100).slice(0, 5);
const jsonOutput = {
    generatedAt: new Date().toISOString(),
    totalAnalyzed: analysisResults.length,
    criticalFiles: top5.map((r) => ({
        file: r.file,
        lines: r.lines,
        httpCalls: r.httpCount,
        recommendedTestPath: `spec/unit/${r.file.replace(".ts", ".spec.ts")}`,
    })),
};

console.log("\nJSON Output:");
console.log(JSON.stringify(jsonOutput.criticalFiles, null, 2));
