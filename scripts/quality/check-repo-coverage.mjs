#!/usr/bin/env node
/**
 * 全仓覆盖率门禁（P2-c 双轨制的「全仓」那一轨）
 *
 * 为什么单独一个门禁，而不是只靠 vitest.config.ts 里的 thresholds：
 *   1. vitest 内置 threshold 是**在测试跑完后**才判定，我们希望 CI 有独立的、
 *      可单独重跑的失败面（像 critical-coverage 那样）；
 *   2. 双轨制的两个数字要放在一起看（关键模块 ≥85% / 全仓 ≥65%），
 *      放在同一个配置文件里才能一眼看出是否失衡；
 *   3. 本机全仓覆盖率跑一次要 16 分钟且会触发限流（见 2026-10-01 记录），
 *      所以门禁必须支持读缓存的 lcov，而不是强迫每次重跑。
 *
 * 用法:
 *   node scripts/quality/check-repo-coverage.mjs [lcovFile]
 *
 * 退出码:
 *   0 = 达标
 *   1 = 未达标
 *   2 = lcov 缺失 / 无法解析（环境问题，与「代码覆盖率不达标」区分）
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lcovFile = process.argv[2] ?? "coverage/lcov.info";

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "coverage-targets.json"), "utf8"));

/** 解析 lcov 的 LF/LH，聚合成全仓加权覆盖率（不能用各文件比率的平均——那会被小文件稀释）。 */
export function summarizeLcov(content) {
    let linesFound = 0;
    let linesHit = 0;
    let branchFound = 0;
    let branchHit = 0;
    let funcFound = 0;
    let funcHit = 0;
    let fileCount = 0;

    let inRecord = false;
    for (const raw of content.split("\n")) {
        const line = raw.trim();
        if (line.startsWith("SF:")) {
            if (inRecord) fileCount++;
            inRecord = true;
            continue;
        }
        if (!inRecord) continue;
        if (line.startsWith("LF:")) linesFound += Number(line.slice(3));
        else if (line.startsWith("LH:")) linesHit += Number(line.slice(3));
        else if (line.startsWith("BRF:")) branchFound += Number(line.slice(4));
        else if (line.startsWith("BRH:")) branchHit += Number(line.slice(4));
        else if (line.startsWith("FNF:")) funcFound += Number(line.slice(4));
        else if (line.startsWith("FNH:")) funcHit += Number(line.slice(4));
        else if (line === "end_of_record") {
            inRecord = false;
            fileCount++;
        }
    }

    const pct = (hit, found) => (found === 0 ? 100 : (hit / found) * 100);
    return {
        fileCount,
        lines: { hit: linesHit, found: linesFound, pct: pct(linesHit, linesFound) },
        branches: { hit: branchHit, found: branchFound, pct: pct(branchHit, branchFound) },
        functions: { hit: funcHit, found: funcFound, pct: pct(funcHit, funcFound) },
    };
}

function main() {
    if (!fs.existsSync(lcovFile)) {
        console.error(`[repo-coverage] lcov 不存在: ${lcovFile}`);
        console.error("[repo-coverage] 先跑 `pnpm test --coverage`，或传入缓存的 lcov 路径。");
        process.exit(2);
    }

    let summary;
    try {
        summary = summarizeLcov(fs.readFileSync(lcovFile, "utf8"));
    } catch (e) {
        console.error(`[repo-coverage] lcov 解析失败: ${e.message}`);
        process.exit(2);
    }

    const floors = config.repoFloors;
    const checks = [
        ["lines", summary.lines],
        ["branches", summary.branches],
        ["functions", summary.functions],
    ];

    const failures = [];
    console.log(`[repo-coverage] ${summary.fileCount} 个源文件（来自 ${lcovFile}）`);
    for (const [metric, data] of checks) {
        const required = floors[metric];
        const ok = data.pct >= required;
        const mark = ok ? "✅" : "❌";
        console.log(
            `  ${mark} ${metric.padEnd(9)} ${data.pct.toFixed(2).padStart(6)}%  (floor ${required}%)  ${data.hit}/${data.found}`,
        );
        if (!ok) {
            failures.push(`${metric}: ${data.pct.toFixed(2)}% < ${required}%`);
        }
    }

    if (failures.length > 0) {
        console.error("[repo-coverage] 全仓覆盖率未达标:");
        for (const f of failures) console.error(`  - ${f}`);
        console.error(`[repo-coverage] 参考: ${config.note}`);
        process.exit(1);
    }

    console.log(`[repo-coverage] 全仓覆盖率达标（关键模块那一轨见 quality:coverage:critical）`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}