#!/usr/bin/env node

/**
 * check-large-file-changes.mjs —— 「改动到大文件就要架构评审」门禁
 *
 * ## 判据（两道，缺一不可）
 *
 * 本次 diff 触及的 .ts 文件里，同时满足以下两条的**才**要求架构评审：
 *
 *   1. 文件**行数 > `LARGE_FILE_THRESHOLD`**（默认 1500）；
 *   2. 该文件**本次改动行数 ≥ `LARGE_FILE_DIFF_LINES`**（默认 50，added + deleted）。
 *
 * 放行方式：`ARCH_REVIEW_APPROVED=true`（放行会被打印出来，不留暗门）。
 *
 * ## 为什么加第 2 条（2026-10-10，第二十轮）
 *
 * 原判据只有第 1 条：**只要碰过大文件就要评审**。于是 `src/client.ts`（4399 行）上
 * **2 行**的委托签名收窄也会被拦 —— 合法小改动不可能为此开 ADR。
 * 实测后果：门禁只有**全局**旁路（`ARCH_REVIEW_APPROVED`）、**没有 per-change 批准**，
 * 于是"合法小改动"与"大规模重构"被迫共用同一个开关 ⇒ 要么放宽门禁、要么开全局旁路
 * （后者等于关掉整个门禁）。第 2 条把两者分开，同时**不削弱**真正的架构级改动。
 *
 * ⚠️ **fail-closed**：改动行数**取不到**时（二进制、`--numstat` 显示 `-`、解析失败、
 * 字段缺失）一律按"**需要评审**"处理 —— 判据不确定时不许放行。
 *
 * ## 值得一提的边界
 *
 * · **只有 .ts 参与**，且**已删除的文件跳过**（`exists` 为假）—— 删除一个大文件显然
 *   不需要"评审它的体量"，不跳过会制造无法修复的红灯。
 * · **阈值是 `>` 不是 `>=`**（正好等于不算），同上理由。
 * · **push 事件不能只看 tip 提交**：`github.event.pull_request.base.sha` 在 push 下为空，
 *   原实现会退化成 `HEAD~1...HEAD` ⇒ 多提交推送里**非 tip 提交改动大文件不会被拦**
 *   （假绿通道，可被"换提交顺序"绕过）。现改用 `github.event.before`（推送前的远端 ref），
 *   与 PR 事件的口径对齐；全零 SHA（新分支首推）或无 before 时才回退。
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
 * diff 范围（三类事件、按优先级）：
 *
 *   ① PR：`GITHUB_BASE_SHA...GITHUB_SHA`（PR base 到 head，覆盖整个 PR）；
 *   ② push：`GITHUB_EVENT_BEFORE...GITHUB_SHA`（**推送前的远端 ref** ⇒ 覆盖本次推送的
 *      **全部**提交，而不是只有 tip）；`before` 全为 0（新分支首推）或等于 head 时不可用；
 *   ③ 本地：回退 `HEAD~1...HEAD`。
 */
export function resolveDiffRange(env = process.env) {
    const base = env.GITHUB_BASE_SHA;
    const head = env.GITHUB_SHA;
    if (base && head) return `${base}...${head}`;
    const before = env.GITHUB_EVENT_BEFORE;
    if (head && before && before !== head && !/^0+$/.test(before)) return `${before}...${head}`;
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

/**
 * 解析 `git diff --numstat` 的单行输出，返回**改动行数**（added + deleted）。
 *
 * 二进制文件显示为 `-\t-\tpath` ⇒ 返回 `null`（不可知，交回 fail-closed 判据）。
 */
export function parseNumstat(output) {
    const line = String(output)
        .split("\n")
        .map((l) => l.trim())
        .find(Boolean);
    if (!line) return null;
    const [added, deleted] = line.split("\t");
    const total = Number(added) + Number(deleted);
    return Number.isFinite(total) ? total : null;
}

/**
 * 从「超阈值文件」里筛出**真需要架构评审**的：还要求本次改动行数 ≥ `minDiffLines`。
 *
 * fail-closed：`diffLines` 不是有限数（`null` / 缺失 / NaN）⇒ 一律要求评审。
 * 这条是刻意写死的 —— 判据不确定时放行等于把门禁变纸面。
 *
 * @param {Array<{ relPath: string, lines: number, diffLines?: number | null }>} files
 * @param {{ minDiffLines: number }} options
 */
export function selectReviewRequired(files, { minDiffLines }) {
    return files.filter((f) => {
        const n = f.diffLines;
        if (typeof n !== "number" || !Number.isFinite(n)) return true;
        return n >= minDiffLines;
    });
}

function readDiffLines(diffRange, relPath) {
    try {
        return parseNumstat(run(`git diff --numstat ${diffRange} -- "${relPath}"`));
    } catch {
        return null; // 取不到 ⇒ fail-closed
    }
}

function main() {
    const threshold = Number(process.env.LARGE_FILE_THRESHOLD ?? "1500");
    const minDiffLines = Number(process.env.LARGE_FILE_DIFF_LINES ?? "50");
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

    const measured = oversizedTouched.map((f) => ({ ...f, diffLines: readDiffLines(diffRange, f.relPath) }));
    const required = selectReviewRequired(measured, { minDiffLines });
    const requiredSet = new Set(required.map((f) => f.relPath));

    console.warn(`[large-file-check] oversized files were modified（范围 ${diffRange}）:`);
    for (const f of measured) {
        const diff = f.diffLines === null ? "unknown" : `${f.diffLines}`;
        const mark = requiredSet.has(f.relPath) ? "REVIEW" : `exempt(<${minDiffLines})`;
        console.warn(`- ${f.relPath}: ${f.lines} lines, diff ${diff} lines  [${mark}]`);
    }

    if (required.length === 0) {
        console.warn(
            `[large-file-check] all ${measured.length} oversized-file change(s) are below ` +
                `LARGE_FILE_DIFF_LINES=${minDiffLines} ⇒ treated as non-architectural. ` +
                `(名单已打印在上一行，不留暗门)`,
        );
        process.exit(0);
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
