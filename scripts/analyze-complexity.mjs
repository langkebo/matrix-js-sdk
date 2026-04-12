#!/usr/bin/env node

/**
 * 使用 ESLint 分析 TypeScript 文件的圈复杂度
 */

import { execSync } from "child_process";
import fs from "fs";

const filePath = process.argv[2] || "src/client.ts";

const result = execSync(`npx eslint "${filePath}" --rule 'complexity: ["warn", 1]' --format json 2>/dev/null`, {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
});

const data = JSON.parse(result);

if (data && data.length > 0) {
    const messages = data[0].messages || [];
    const results = [];

    for (const m of messages) {
        if (m.ruleId === "complexity") {
            const msg = m.message;
            const complexityMatch = msg.match(/complexity of (\d+)/);
            const nameMatch = msg.match(/method '(\w+)'/);

            if (complexityMatch) {
                const complexity = parseInt(complexityMatch[1]);
                let name = nameMatch ? nameMatch[1] : "unknown";
                if (msg.includes("Constructor")) {
                    name = "constructor";
                }
                results.push({
                    name,
                    line: m.line,
                    complexity,
                });
            }
        }
    }

    results.sort((a, b) => b.complexity - a.complexity);

    console.log("\n=== 高复杂度函数分析 ===\n");
    console.log(`文件: ${filePath}`);
    console.log(`分析时间: ${new Date().toISOString().split("T")[0]}\n`);

    console.log("| 函数名 | 起始行 | 圈复杂度 | 等级 |");
    console.log("|---|---:|---:|---|");

    for (const r of results.slice(0, 30)) {
        let level = "✅ 简单";
        if (r.complexity >= 25) level = "🔴 极高";
        else if (r.complexity >= 15) level = "🟠 高";
        else if (r.complexity >= 10) level = "🟡 中等";
        console.log(`| ${r.name} | ${r.line} | ${r.complexity} | ${level} |`);
    }

    console.log("\n=== 统计摘要 ===\n");
    const totalComplexity = results.reduce((sum, r) => sum + r.complexity, 0);
    const avgComplexity = (totalComplexity / results.length).toFixed(1);

    console.log(`总函数数: ${results.length}`);
    console.log(`总圈复杂度: ${totalComplexity}`);
    console.log(`平均圈复杂度: ${avgComplexity}`);

    const simple = results.filter((r) => r.complexity < 10).length;
    const medium = results.filter((r) => r.complexity >= 10 && r.complexity < 15).length;
    const high = results.filter((r) => r.complexity >= 15 && r.complexity < 25).length;
    const extreme = results.filter((r) => r.complexity >= 25).length;

    console.log(`\n简单 (<10): ${simple}`);
    console.log(`中等 (10-14): ${medium}`);
    console.log(`高 (15-24): ${high}`);
    console.log(`极高 (>=25): ${extreme}`);

    console.log("\n=== 复杂度分布 ===\n");

    const ranges = [
        { min: 1, max: 5, label: "1-5" },
        { min: 6, max: 10, label: "6-10" },
        { min: 11, max: 15, label: "11-15" },
        { min: 16, max: 20, label: "16-20" },
        { min: 21, max: 30, label: "21-30" },
        { min: 31, max: Infinity, label: "31+" },
    ];

    for (const range of ranges) {
        const count = results.filter((r) => r.complexity >= range.min && r.complexity <= range.max).length;
        const bar = "█".repeat(Math.min(count, 50));
        console.log(`${range.label.padEnd(6)}: ${count.toString().padStart(3)} ${bar}`);
    }

    // 输出 JSON 格式供后续处理
    const outputPath = "docs/governance/perf-baseline/complexity-baseline.json";
    const outputData = {
        file: filePath,
        timestamp: new Date().toISOString(),
        summary: {
            totalFunctions: results.length,
            totalComplexity,
            avgComplexity: parseFloat(avgComplexity),
            simple,
            medium,
            high,
            extreme,
        },
        functions: results,
    };

    fs.mkdirSync("docs/governance/perf-baseline", { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
    console.log(`\n详细数据已保存到: ${outputPath}`);
}
