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
 * ## 存量棘轮（2026-10-11 新增）
 *
 * 上面两道判据都只看**本次 diff**：一个 4000 行的文件只要每次改 < 50 行，就能无限增长下去
 * —— 门禁永远看不见"存量体量"本身。于是补一条**只降不升**的棘轮（与 path-contract-coverage 同型）：
 *
 *   · 扫全 `src/`，取**所有** > `LARGE_FILE_THRESHOLD` 的文件 ⇒ 与内嵌基线 `LARGE_FILE_RATCHET_BASELINE` 比对；
 *   · 出现基线里没有的新超限文件 ⇒ 失败；
 *   · 基线里的文件当前行数 > 其上限 ⇒ 失败（只降不升）；
 *   · 基线里的文件已降到阈值以下（stale）⇒ 仅提示；`--update-baseline` 收编并剔除。
 *
 * **基线为什么内嵌常量、而不是 `scripts/quality/*.json` 台账**：本文件在 develop / release
 * 两条线上都存在（`check-cross-line-gate-parity.mjs` 观测的是 `scripts/quality/**` 的**文件集合**，
 * 不比对内容）。新增一个 `scripts/quality/*.json` 会抬高该门禁 `support.count`（非门禁差集计数，
 * 棘轮只降不升）而立刻变红。内嵌常量把数据留在本文件内，两线的文件集合不变。
 *
 * 刷新：`node scripts/quality/check-large-file-changes.mjs --update-baseline`
 *      （新增/增长条目需额外 `--accept-new`，否则拒绝写入 —— 与其它 baseline 门禁同规）。
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
import { fileURLToPath } from "node:url";

/** 本脚本自身路径 —— `--update-baseline` 要重写本文件里的内嵌基线常量。 */
const SELF_PATH = fileURLToPath(import.meta.url);

// >>> large-file-ratchet-baseline >>>
export const LARGE_FILE_RATCHET_BASELINE = {
    "src/client.ts": 7307,
    "src/models/event.ts": 1793,
    "src/models/room.ts": 4234,
    "src/room-summary/index.ts": 2113,
    "src/room/RoomManager.ts": 2230,
    "src/rust-crypto/rust-crypto.ts": 2570,
    "src/sync.ts": 2077,
    "src/web-rtc/call.ts": 3126,
    "src/web-rtc/groupCall.ts": 1731,
};
// <<< large-file-ratchet-baseline <<<

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

/**
 * 纯函数：**存量巨型文件棘轮**判定（只降不升）。
 *
 * @param {object} input
 * @param {Record<string, number>} input.baseline 基线（仓库相对路径 → 允许上限行数）
 * @param {Record<string, number>} input.current  本次扫到的超限文件（路径 → 当前行数）
 * @param {boolean} input.allowGrowth 是否显式接受新增/增长（对应 CLI `--accept-new`）
 * @returns {{
 *   added: Array<{ relPath: string, lines: number }>,
 *   grown: Array<{ relPath: string, lines: number, baseline: number }>,
 *   shrunk: string[],
 *   refuse: boolean,
 * }} `shrunk` = 已降到阈值以下、可从基线剔除的条目；`refuse` = 有新增/增长且未显式接受。
 */
export function planRatchet({ baseline, current, allowGrowth }) {
    const added = [];
    const grown = [];
    for (const [relPath, lines] of Object.entries(current)) {
        const max = baseline[relPath];
        if (max === undefined) {
            added.push({ relPath, lines });
        } else if (lines > max) {
            grown.push({ relPath, lines, baseline: max });
        }
    }
    const shrunk = Object.keys(baseline)
        .filter((rel) => !(rel in current))
        .sort();
    return { added, grown, shrunk, refuse: (added.length > 0 || grown.length > 0) && !allowGrowth };
}

/** 扫全 `src/` 找出所有 > 阈值的 `.ts` 文件（路径 → 行数），与 diff 级判据共用同一种行数口径。 */
function findOversizedInTree(threshold) {
    const found = [];
    const walk = (absDir) => {
        let entries;
        try {
            entries = fs.readdirSync(absDir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const abs = path.join(absDir, entry.name);
            if (entry.isDirectory()) {
                walk(abs);
                continue;
            }
            if (!entry.name.endsWith(".ts")) continue;
            const relPath = path.relative(process.cwd(), abs).split(path.sep).join("/");
            const lines = fs.readFileSync(abs, "utf8").split("\n").length;
            if (lines > threshold) found.push({ relPath, lines });
        }
    };
    walk(path.resolve(process.cwd(), "src"));
    return found.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/** 重写本文件内嵌的基线常量块（marker 之间），键排序、prettier 兼容格式。 */
function writeBaseline(map) {
    const src = fs.readFileSync(SELF_PATH, "utf8");
    const keys = Object.keys(map).sort();
    const body = keys.map((k) => `    ${JSON.stringify(k)}: ${map[k]},`).join("\n");
    const literal = keys.length === 0 ? "{}" : `{\n${body}\n}`;
    const block =
        "// >>> large-file-ratchet-baseline >>>\n" +
        `export const LARGE_FILE_RATCHET_BASELINE = ${literal};\n` +
        "// <<< large-file-ratchet-baseline <<<";
    const re = /\/\/ >>> large-file-ratchet-baseline >>>[\s\S]*?\/\/ <<< large-file-ratchet-baseline <<</;
    if (!re.test(src)) {
        console.error("[large-file-check] baseline markers not found; cannot refresh baseline.");
        process.exit(1);
    }
    fs.writeFileSync(
        SELF_PATH,
        src.replace(re, () => block),
    );
}

function readDiffLines(diffRange, relPath) {
    try {
        return parseNumstat(run(`git diff --numstat ${diffRange} -- "${relPath}"`));
    } catch {
        return null; // 取不到 ⇒ fail-closed
    }
}

function main() {
    const args = new Set(process.argv.slice(2));
    const threshold = Number(process.env.LARGE_FILE_THRESHOLD ?? "1500");
    const minDiffLines = Number(process.env.LARGE_FILE_DIFF_LINES ?? "50");
    const allowBypass = process.env.ARCH_REVIEW_APPROVED === "true";

    let failed = false;

    // ── A. 存量棘轮（与本次 diff 无关，扫全 src/）──────────────────────────────
    const oversized = findOversizedInTree(threshold);
    const current = Object.fromEntries(oversized.map((f) => [f.relPath, f.lines]));
    const ratchet = planRatchet({
        baseline: LARGE_FILE_RATCHET_BASELINE,
        current,
        allowGrowth: args.has("--accept-new"),
    });

    if (args.has("--update-baseline")) {
        if (ratchet.refuse) {
            console.error(
                "[large-file-check] refuse to refresh baseline：检测到新增/增长而**未**给 `--accept-new`。\n" +
                    "  只降不升 —— 要显式接受增长请复核后加 `--accept-new`；否则应先重构把文件改小。",
            );
            process.exit(1);
        }
        writeBaseline(current);
        console.log(
            `[large-file-check] baseline refreshed — ${oversized.length} 个超限文件` +
                `（剔除 ${ratchet.shrunk.length} 个已降到阈值以下的条目）`,
        );
        return;
    }

    if (ratchet.added.length || ratchet.grown.length) {
        failed = true;
        console.error("[large-file-check] 存量棘轮失败（只降不升）：");
        for (const f of ratchet.added) {
            console.error(`  · 新增超限文件（基线外）：${f.relPath} — ${f.lines} 行（阈值 ${threshold}）`);
        }
        for (const f of ratchet.grown) {
            console.error(`  · 体量增长：${f.relPath} — ${f.baseline} → ${f.lines} 行`);
        }
        console.error(
            "  修法：把文件改小（优先），或在复核后跑 " +
                "`node scripts/quality/check-large-file-changes.mjs --update-baseline --accept-new` 并提交基线变更。",
        );
    } else {
        console.log(
            `[large-file-check] 存量棘轮 ok — ${oversized.length} 个超限文件均在基线上限内` +
                (ratchet.shrunk.length
                    ? `（${ratchet.shrunk.length} 个已降到阈值以下，可 --update-baseline 收编）`
                    : ""),
        );
    }

    // ── B. diff 级架构评审判据（本次改动是否触到大文件）──────────────────────
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
    } else {
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
        } else if (allowBypass) {
            console.warn("[large-file-check] bypassed by ARCH_REVIEW_APPROVED=true");
        } else {
            failed = true;
            console.error(
                "[large-file-check] architecture review required. Set ARCH_REVIEW_APPROVED=true only after ADR/risk review is approved.",
            );
        }
    }

    process.exit(failed ? 1 : 0);
}

// 仅在被直接执行时跑 main（原为顶层无条件执行：import 会跑 git diff 并 process.exit）
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
