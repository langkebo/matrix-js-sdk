#!/usr/bin/env node

/**
 * check-large-file-changes.mjs —— 「改动到大文件就要架构评审」门禁
 *
 * 判据很简单：本次 diff 触及的 .ts 文件里，有没有行数超过阈值的
 *（`LARGE_FILE_THRESHOLD`，默认 1500）。有则要求架构评审，可用
 * `ARCH_REVIEW_APPROVED=true` 放行（且放行会被打印出来，不留暗门）。
 *
 * 值得一提的边界：**只有 .ts 参与**，且**已删除的文件跳过**（`exists` 为假）——
 * 删除一个大文件显然不需要"评审它的体量"，不跳过会制造无法修复的红灯。
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function run(cmd) {
    return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] })
        .toString()
        .trim();
}

/**
 * diff 范围：CI 的 PR 事件给 GITHUB_BASE_SHA / GITHUB_SHA，本地回退到上一个提交。
 */
export function resolveDiffRange(env = process.env) {
    const base = env.GITHUB_BASE_SHA;
    const head = env.GITHUB_SHA;
    if (base && head) return `${base}...${head}`;
    return "HEAD~1...HEAD";
}

/**
 * 从变更文件里筛出"超过阈值"的 .ts 文件。
 *
 * `exists` / `lineCount` 用注入而不是直接读 fs，是为了让判定可测；
 * 缺失的文件（已删除）跳过 —— 否则删掉一个大文件会留下无法修复的红灯。
 */
export function filterOversized(changedFiles, { threshold, exists, lineCount }) {
    const oversized = [];
    for (const relPath of changedFiles) {
        if (!relPath.endsWith(".ts")) continue;
        if (!exists(relPath)) continue;
        const lines = lineCount(relPath);
        if (lines > threshold) {
            oversized.push({ relPath, lines });
        }
    }
    return oversized;
}

function main() {
    const threshold = Number(process.env.LARGE_FILE_THRESHOLD ?? "1500");
    const allowBypass = process.env.ARCH_REVIEW_APPROVED === "true";

    const diffRange = resolveDiffRange();
    const changedRaw = run(`git diff --name-only ${diffRange}`);
    const changedFiles = changedRaw
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);

    const oversizedTouched = filterOversized(changedFiles, {
        threshold,
        exists: (relPath) => fs.existsSync(path.resolve(process.cwd(), relPath)),
        lineCount: (relPath) => fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8").split("\n").length,
    });

    if (oversizedTouched.length === 0) {
        console.log(`[large-file-check] no modified TypeScript file exceeds ${threshold} lines`);
        process.exit(0);
    }

    console.warn("[large-file-check] oversized files were modified:");
    for (const item of oversizedTouched) {
        console.warn(`- ${item.relPath}: ${item.lines} lines`);
    }

    if (allowBypass) {
        console.warn("[large-file-check] bypassed by ARCH_REVIEW_APPROVED=true");
        process.exit(0);
    }

    console.error(
        "[large-file-check] architecture review required. Set ARCH_REVIEW_APPROVED=true only after ADR/risk review is approved.",
    );
    process.exit(1);
}

// 仅在被直接执行时跑 main（原为顶层无条件执行：import 会跑 git diff 并 process.exit）
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
