#!/usr/bin/env node

/**
 * 分析代码重复模式
 */

import fs from "fs";

const filePath = process.argv[2] || "src/client.ts";
const content = fs.readFileSync(filePath, "utf-8");
const lines = content.split("\n");

console.log("\n=== 代码重复模式分析 ===\n");
console.log(`文件: ${filePath}`);
console.log(`总行数: ${lines.length}\n`);

// 分析常见模式
const patterns = [
    { name: "HTTP 认证请求", regex: /this\.http\.authedRequest/g },
    { name: "HTTP 普通请求", regex: /this\.http\.request/g },
    { name: "Manager 委托调用", regex: /return this\.get\w+Manager\(\)/g },
    { name: "异步重试包装", regex: /this\.withRetry\(/g },
    { name: "错误抛出", regex: /throw new Error\(/g },
    { name: "日志调试", regex: /this\.logger\.debug\(/g },
    { name: "事件发射", regex: /this\.emit\(/g },
    { name: "Promise 返回", regex: /return this\.http\./g },
];

console.log("| 模式 | 出现次数 |");
console.log("|---|---:|");

let totalPatterns = 0;
for (const p of patterns) {
    const matches = content.match(p.regex) || [];
    console.log(`| ${p.name} | ${matches.length} |`);
    totalPatterns += matches.length;
}

console.log(`| **总计** | **${totalPatterns}** |`);

// 分析相似代码块 (5行窗口)
console.log("\n=== 相似代码块分析 ===\n");

const codeBlocks = new Map();
const windowSize = 5;

for (let i = 0; i <= lines.length - windowSize; i++) {
    const block = lines
        .slice(i, i + windowSize)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("//") && !l.startsWith("*"))
        .join("\n");

    if (block.length > 50) {
        const hash = block.substring(0, 100);
        if (!codeBlocks.has(hash)) {
            codeBlocks.set(hash, []);
        }
        codeBlocks.get(hash).push(i + 1);
    }
}

const duplicates = Array.from(codeBlocks.entries())
    .filter(([_, lines]) => lines.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

console.log(`检测到 ${duplicates.length} 个重复代码块模式\n`);

if (duplicates.length > 0) {
    console.log("| 重复次数 | 起始行位置 | 代码片段预览 |");
    console.log("|---:|---|---|");

    for (const [hash, lineNums] of duplicates.slice(0, 10)) {
        const preview = hash.substring(0, 50).replace(/\n/g, " ").replace(/\|/g, "\\|");
        console.log(
            `| ${lineNums.length} | ${lineNums.slice(0, 3).join(", ")}${lineNums.length > 3 ? "..." : ""} | ${preview}... |`,
        );
    }
}

// 统计摘要
console.log("\n=== 统计摘要 ===\n");

const totalDuplicates = duplicates.reduce((sum, [_, lines]) => sum + lines.length, 0);
const avgDuplication = duplicates.length > 0 ? (totalDuplicates / duplicates.length).toFixed(1) : 0;

console.log(`重复代码块总数: ${duplicates.length}`);
console.log(`涉及代码位置: ${totalDuplicates}`);
console.log(`平均重复次数: ${avgDuplication}`);

// 估算重复代码行数
const estimatedDupLines = duplicates.length * windowSize;
const duplicationRate = ((estimatedDupLines / lines.length) * 100).toFixed(1);

console.log(`估算重复代码行数: ${estimatedDupLines}`);
console.log(`重复率: ${duplicationRate}%`);

// 保存结果
const outputPath = "docs/governance/perf-baseline/duplication-baseline.json";
const outputData = {
    file: filePath,
    timestamp: new Date().toISOString(),
    totalLines: lines.length,
    patterns: patterns.map((p) => ({
        name: p.name,
        count: (content.match(p.regex) || []).length,
    })),
    duplicates: {
        totalBlocks: duplicates.length,
        totalLocations: totalDuplicates,
        estimatedDupLines,
        duplicationRate: parseFloat(duplicationRate),
    },
};

fs.mkdirSync("docs/governance/perf-baseline", { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
console.log(`\n详细数据已保存到: ${outputPath}`);
