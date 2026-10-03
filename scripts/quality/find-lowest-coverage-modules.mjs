#!/usr/bin/env node
/**
 * 快速定位测试覆盖率最薄弱的 5 个模块
 * 不使用全量测试，仅通过静态分析估算
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..", "..");

const srcDir = path.join(projectRoot, "src");
const specDir = path.join(projectRoot, "spec/unit");

function walkDir(dir, extensions = [".ts"]) {
    const results = [];
    if (!fs.existsSync(dir)) return results;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith("_") && entry.name !== "__generated__") {
            results.push(...walkDir(fullPath, extensions));
        } else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
            results.push(fullPath);
        }
    }
    return results;
}

// 获取顶层模块列表
const topLevelSrcDirs = fs.readdirSync(srcDir).filter((d) => {
    const stat = fs.statSync(path.join(srcDir, d));
    return stat.isDirectory() && !d.startsWith("_") && d !== "__tests__";
});

const moduleStats = [];

for (const moduleName of topLevelSrcDirs) {
    const srcModulePath = path.join(srcDir, moduleName);
    const stat = fs.statSync(srcModulePath);

    if (!stat.isDirectory()) continue;

    // 统计该模块的源文件数和代码行数
    const srcFiles = walkDir(srcModulePath, [".ts"]);
    const totalLines = srcFiles.reduce((acc, f) => {
        if (f.endsWith(".d.ts")) return acc;
        return acc + fs.readFileSync(f, "utf8").split("\n").length;
    }, 0);

    const httpCallCount = srcFiles.reduce((acc, f) => {
        if (f.endsWith(".d.ts")) return acc;
        const content = fs.readFileSync(f, "utf8");
        return acc + (content.match(/withRetry|authedRequest|\.request\(Method/g) || []).length;
    }, 0);

    // 查找对应的测试文件/目录 - 更全面的搜索
    const specModulePath = path.join(specDir, moduleName);
    const hasSpecDir = fs.existsSync(specModulePath) && fs.statSync(specModulePath).isDirectory();
    const hasSpecFile = fs.existsSync(path.join(specDir, `${moduleName}.spec.ts`));

    // 也要检查是否有相关的测试文件（名称不完全匹配的情况）
    const allSpecFiles = walkDir(specDir, [".spec.ts", ".spec.test.ts"]);
    const relatedSpecFiles = allSpecFiles.filter((f) => {
        const basename = path.basename(f, ".spec.ts").replace(".spec.test", "");
        return (
            basename === moduleName || basename.startsWith(`${moduleName}-`) || basename.startsWith(`${moduleName}_`)
        );
    });

    // 收集所有相关测试文件（目录 + 平铺 + 名称关联），去重后合并统计
    // 注意：spec/unit/<module>/ 可能是空目录（占位），此时必须回退到平铺的 <module>.spec.ts
    const candidateTestFiles = new Set();
    if (hasSpecDir) {
        for (const f of walkDir(specModulePath, [".spec.ts", ".spec.test.ts"])) candidateTestFiles.add(f);
    }
    if (hasSpecFile) candidateTestFiles.add(path.join(specDir, `${moduleName}.spec.ts`));
    for (const f of relatedSpecFiles) candidateTestFiles.add(f);

    const testFiles = [...candidateTestFiles];
    const testLines = testFiles.reduce((acc, f) => {
        return acc + fs.readFileSync(f, "utf8").split("\n").length;
    }, 0);
    const testFileCount = testFiles.length;

    // 计算覆盖率估算值（基于行数比例）
    const coverageEstimate = totalLines > 0 ? (testLines / totalLines) * 100 : 100;

    // 风险评分：HTTP 调用多但没有测试的文件风险最高
    let riskScore = 0;
    if (httpCallCount > 0 && testFileCount === 0) {
        riskScore = 100; // 有 HTTP 请求但完全无测试
    } else if (httpCallCount > 0 && testFileCount > 0 && coverageEstimate < 50) {
        riskScore = 80; // 有 HTTP 请求且覆盖率低于 50%
    } else if (httpCallCount > 0 && testFileCount > 0 && coverageEstimate < 80) {
        riskScore = 60; // 有 HTTP 请求且覆盖率低于 80%
    } else if (totalLines > 500 && testFileCount === 0) {
        riskScore = 40; // 大文件但没有测试
    } else if (totalLines > 300 && testFileCount < 2) {
        riskScore = 20; // 中等文件但测试不足
    }

    moduleStats.push({
        module: moduleName,
        srcFiles: srcFiles.length,
        totalLines,
        httpCallCount,
        specFiles: testFileCount,
        testLines,
        coverageEstimate: Math.min(coverageEstimate, 100),
        riskScore,
        hasSpecDir,
        hasSpecFile,
    });
}

// 按风险评分排序
moduleStats.sort((a, b) => b.riskScore - a.riskScore);

console.log("\n" + "=".repeat(80));
console.log("模块覆盖率估算排名（从高到低风险）");
console.log("=".repeat(80));
console.log("");

console.log("前 20 个高风险模块：");
console.log("-".repeat(80));

for (let i = 0; i < Math.min(20, moduleStats.length); i++) {
    const m = moduleStats[i];
    const coverageIcon = m.coverageEstimate >= 80 ? "✅" : m.coverageEstimate >= 50 ? "🟡" : "🔴";
    console.log(
        `${i + 1}. ${m.module.padEnd(25)} | 代码 ${String(m.totalLines).padStart(5)} 行 | HTTP ${String(m.httpCallCount).padStart(4)} 次 | 测试 ${String(m.specFiles).padStart(3)} 文件 | 覆盖 ${String(Math.round(m.coverageEstimate)).padStart(4)}% ${coverageIcon} | 风险 ${m.riskScore}`,
    );
}

console.log("");
console.log("=".repeat(80));
console.log("最薄弱的 5 个模块（需要优先补充测试）");
console.log("=".repeat(80));
console.log("");

for (let i = 0; i < Math.min(5, moduleStats.length); i++) {
    const m = moduleStats[i];
    if (m.riskScore > 0) {
        console.log(`${i + 1}. \`${m.module}\``);
        console.log(
            `   问题：${m.httpCallCount > 0 ? "有 HTTP 请求但" : ""}${m.specFiles === 0 ? "完全无测试文件" : "测试覆盖率过低"} (${Math.round(m.coverageEstimate)}%)`,
        );
        console.log(
            `   建议：${
                m.specFiles === 0
                    ? `创建 spec/unit/${m.module}.spec.ts 或 spec/unit/${m.module}/`
                    : `增加 spec/unit/${m.module}/ 测试文件`
            }`,
        );
        console.log(`   规模：${m.srcFiles} 源文件，${m.totalLines} 行代码`);
        console.log("");
    }
}

// 输出 JSON 格式供其他脚本使用
const top5 = moduleStats.filter((m) => m.riskScore > 0).slice(0, 5);
const jsonOutput = {
    generatedAt: new Date().toISOString(),
    totalModules: moduleStats.length,
    lowestCoverageModules: top5.map((m) => ({
        module: m.module,
        coverageEstimate: Math.round(m.coverageEstimate),
        riskScore: m.riskScore,
        httpCallCount: m.httpCallCount,
        recommendedAction:
            m.specFiles === 0
                ? `Create spec/unit/${m.module}.spec.ts or spec/unit/${m.module}/`
                : `Add more tests in spec/unit/${m.module}/`,
    })),
};

console.log("\nJSON Output (for automation):");
console.log(JSON.stringify(jsonOutput.lowestCoverageModules, null, 2));
