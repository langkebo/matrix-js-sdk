#!/usr/bin/env node
/**
 * check-cross-line-gate-parity.mjs —— **两线门禁集合差集**守卫（批次 F5）。
 *
 * ## 为什么需要它
 *
 * 本仓有**两条线**：`develop` 与 `release/*`。Tjg 通过 `meta/sdk-pin.json` 吃的是
 * **release 线的 tarball** —— 也就是说，"Tjg 消费的那条线"如果缺判据，develop 上的
 * 门禁再全也保护不到它。这正是 D-01 / 批次 F 的根因。
 *
 * 实测（F1，2026-10-10）：
 *
 * ```
 * develop scripts/quality          132 个文件
 * release scripts/quality           62 个文件
 * develop 独有（release 缺）        70 个  ← 18 门禁 + 12 lib + 24 .d.mts + 16 台账
 * release 独有                        0 个
 * ```
 *
 * 18 个只在 develop 的**受管辖门禁**里，包含 `check-wire-format` / `verify-path-contract` /
 * `check-route-set-parity` / `check-public-api-docs` / `check-audit-doc-integrity` 等 --
 * 即"路径与报文两类契约判据"**在 Tjg 消费的线上一条都没有**。
 *
 * 这类漂移**在没有任何判据时不会有人注意到**（本次是逐个数出来的）。本门禁把它钉成一个
 * **只能变小的数字**。
 *
 * ## 判据
 *
 * 1. **受管辖门禁**（`isGoverned()` 认定）的文件集合，两线必须一致；差集必须**逐条**登记在
 *    `cross-line-gate-parity-waivers.json` 的 `gates` 里，且每条带非空 `reason`。
 *    双向都查（"另一线独有"同样是漂移）。
 * 2. **非门禁文件**（类 `lib/` 支撑、`.d.mts` 声明、台账/基线）只统计**数量**并与台账
 *    的 `support.count` 做棘轮（只降不升）。它们的价值是"那些门禁跑不跑得起来"，
 *    本身不是独立判据，逐条登记只会让台账臃肿。
 * 3. **腐烂条目**（登记了、但两线其实已一致或文件已删）⇒ 失败（修一条删一条）。
 *
 * ## 跨线定位
 *
 * 默认 `release/contract-entrypoint`；用 `CROSS_LINE_REF=<ref>` 覆盖。
 * ref 解析不到（CI 的浅 checkout / SDK-only checkout 常见）⇒ **显式 SKIP 并打印 banner**
 * （不是 pass）—— 要让它生效需先 `git fetch` 该 ref（见文档 §9.14.11）。
 *
 * ## 用法
 *
 * ```
 * node scripts/quality/check-cross-line-gate-parity.mjs                  # 校验（棘轮）
 * node scripts/quality/check-cross-line-gate-parity.mjs --json           # 机器可读
 * node scripts/quality/check-cross-line-gate-parity.mjs --write-waivers  # 刷新台账
 * ```
 *
 * 退出码：0 = 无未登记漂移；1 = 有未登记 / 腐烂条目；2 = 环境问题。
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { isGoverned } from "./check-gate-reachability.mjs";
import { writeJsonFormatted } from "./lib/write-json.mjs";

const projectRoot = process.cwd();
const QUALITY_PREFIX = "scripts/quality";
const WAIVERS = path.join(projectRoot, "scripts", "quality", "cross-line-gate-parity-waivers.json");
const DEFAULT_REF = "release/contract-entrypoint";

const args = new Set(process.argv.slice(2));

/**
 * 把一个 `scripts/quality/**` 下的文件分类。
 *
 * 只有 `gate` 类参与严格判据（见文件头「判据」1）。
 *
 * @param {string} rel 仓库根相对路径（posix 分隔）。
 * @returns {"gate" | "lib" | "types" | "ledger" | "other"}
 */
export function classifyQualityFile(rel) {
    if (rel.includes("/lib/")) return "lib";
    if (rel.endsWith(".d.mts") || rel.endsWith(".d.ts")) return "types";
    if (rel.endsWith(".json") || rel.endsWith(".csv")) return "ledger";
    if (/\.mjs$|\.cjs$|\.js$/.test(rel)) return isGoverned(rel) ? "gate" : "other";
    return "other";
}

/**
 * 求两个集合的双向差集。
 *
 * @param {Iterable<string>} thisLine 本线（HEAD）的文件集合。
 * @param {Iterable<string>} otherLine 另一线（ref）的文件集合。
 * @returns {{ onlyInThisLine: string[]; onlyInOtherLine: string[] }} 均已排序。
 */
export function diffSets(thisLine, otherLine) {
    const a = new Set(thisLine);
    const b = new Set(otherLine);
    return {
        onlyInThisLine: [...a].filter((f) => !b.has(f)).sort(),
        onlyInOtherLine: [...b].filter((f) => !a.has(f)).sort(),
    };
}

/**
 * 找出台账的问题（未登记 / 缺 reason / 腐烂）。
 *
 * @param {{ onlyInThisLine: string[]; onlyInOtherLine: string[] }} gateDiff 只含 `gate` 类的差集。
 * @param {{ gates?: Record<string, string> }} waivers 台账内容。
 * @returns {string[]} 问题清单（空数组 = 通过）。
 */
export function findWaiverProblems(gateDiff, waivers) {
    const problems = [];
    const registered = waivers.gates ?? {};
    const inDiff = new Set([...gateDiff.onlyInThisLine, ...gateDiff.onlyInOtherLine]);

    for (const rel of inDiff) {
        const reason = registered[rel];
        if (reason === undefined) {
            problems.push(`未登记：${rel}`);
        } else if (typeof reason !== "string" || reason.trim() === "") {
            problems.push(`缺 reason：${rel}`);
        }
    }

    // 腐烂条目：登记了但两线其实已一致（或文件已删）⇒ 棘轮要求"修一条删一条"。
    for (const rel of Object.keys(registered)) {
        if (!inDiff.has(rel)) {
            problems.push(`腐烂条目（两线已一致或文件已删，请删除该条）：${rel}`);
        }
    }

    return problems;
}

/** 用 `git ls-tree` 列出某个 ref 下的 `scripts/quality/**`（避免依赖 worktree 是否在场）。 */
function listQualityFiles(ref) {
    const out = execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "--", QUALITY_PREFIX], {
        cwd: projectRoot,
        encoding: "utf8",
    });
    return out
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
}

function readWaivers() {
    if (!fs.existsSync(WAIVERS)) return { gates: {}, support: { count: 0 } };
    return JSON.parse(fs.readFileSync(WAIVERS, "utf8"));
}

function main() {
    const ref = process.env.CROSS_LINE_REF || DEFAULT_REF;

    let thisLine;
    try {
        thisLine = listQualityFiles("HEAD");
    } catch (err) {
        process.stderr.write(`check-cross-line-gate-parity: cannot read HEAD via git: ${err?.message || err}\n`);
        process.exit(2);
    }

    let otherLine;
    try {
        otherLine = listQualityFiles(ref);
    } catch {
        // ref 不在本地（浅 checkout / SDK-only checkout）⇒ 显式 SKIP，不算 pass。
        process.stdout.write(
            `check-cross-line-gate-parity: SKIP — cross-line ref '${ref}' is not available locally ` +
                `(not a pass; run \`git fetch origin ${ref}\` or set CROSS_LINE_REF=<ref> to enable).\n`,
        );
        return;
    }

    const raw = diffSets(thisLine, otherLine);
    const pick = (list, cls) => list.filter((f) => classifyQualityFile(f) === cls);
    const gateDiff = {
        onlyInThisLine: pick(raw.onlyInThisLine, "gate"),
        onlyInOtherLine: pick(raw.onlyInOtherLine, "gate"),
    };
    const supportCount =
        raw.onlyInThisLine.length +
        raw.onlyInOtherLine.length -
        gateDiff.onlyInThisLine.length -
        gateDiff.onlyInOtherLine.length;

    const waivers = readWaivers();

    if (args.has("--write-waivers")) {
        const gates = {};
        for (const rel of [...gateDiff.onlyInThisLine, ...gateDiff.onlyInOtherLine]) {
            gates[rel] =
                waivers.gates?.[rel] ??
                "F2 待移植：该门禁只在 develop 存在，release 线（Tjg 消费）尚无 → 需连同其 lib/台账/spec 一起移植，或在 release 侧重建等价判据。";
        }
        writeJsonFormatted(WAIVERS, {
            $comment: [
                "check-cross-line-gate-parity.mjs 的豁免台账（批次 F5）。",
                "",
                "受管辖门禁 = isGoverned() 认定（scripts/quality/ 下、lib/ 除外；或 check-/verify-/validate-/assert-/enforce- 前缀）。",
                "登记在此的文件表示：『develop 有、release 没有』或反之 —— 即 Tjg 消费的线上缺这条判据。",
                "",
                "纪律（棘轮：只降不升）：",
                "  · 两线差集里出现新条目而未登记 ⇒ 门禁失败；",
                "  · 登记了但两线已一致（或文件已删）⇒ 腐烂 ⇒ 门禁失败（修一条删一条）；",
                "  · **登记不等于修好**：它只把『Tjg 消费的线缺多少条判据』钉成一个只能变小的数字。",
                "",
                "真正的修法见方案文档 §10 批次 F2/F3/F4：把门禁连同 lib/台账/.d.mts/spec 一起移植到",
                "release 线并接进它的 lint / quality:contracts。",
            ],
            schemaVersion: 1,
            capturedAt: new Date().toISOString().slice(0, 10),
            crossLineRef: ref,
            gates,
            support: {
                count: supportCount,
                note:
                    "非门禁差集（lib/ 支撑 + .d.mts 声明 + 台账/基线）的条数。只做棘轮（只降不升），" +
                    "不逐条登记 —— 它们的意义是『上面那些门禁跑不跑得起来』。",
            },
        });
        process.stdout.write(
            `check-cross-line-gate-parity: wrote ${path.relative(projectRoot, WAIVERS)} ` +
                `(gates=${Object.keys(gates).length}, support=${supportCount}, ref=${ref})\n`,
        );
        return;
    }

    const problems = findWaiverProblems(gateDiff, waivers);

    const supportBaseline = waivers.support?.count ?? 0;
    const supportGrew = supportCount > supportBaseline;

    if (args.has("--json")) {
        process.stdout.write(
            `${JSON.stringify({ ref, gateDiff, supportCount, supportBaseline, problems, supportGrew }, null, 2)}\n`,
        );
    }

    if (problems.length || supportGrew) {
        process.stderr.write(
            `check-cross-line-gate-parity: FAILED (ref=${ref})\n` +
                (problems.length ? problems.map((p) => `  - ${p}`).join("\n") + "\n" : "") +
                (supportGrew ? `  - 非门禁差集从 ${supportBaseline} 涨到 ${supportCount}（棘轮只降不升）\n` : "") +
                "  刷新台账：node scripts/quality/check-cross-line-gate-parity.mjs --write-waivers\n" +
                "  （登记前请先确认这不是一次应当避免的漂移 —— 见方案文档 §10 批次 F）\n",
        );
        process.exit(1);
    }

    process.stdout.write(
        `check-cross-line-gate-parity: ok (ref=${ref}) — ` +
            `受管辖门禁差集 ${Object.keys(waivers.gates ?? {}).length} 条已登记；` +
            `非门禁差集 ${supportCount} 条（上限 ${supportBaseline}）\n`,
    );
}

main();
