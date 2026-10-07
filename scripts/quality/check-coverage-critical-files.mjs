#!/usr/bin/env node
/**
 * check-coverage-critical-files.mjs - 「零覆盖 + 高危源文件」强制门禁
 *
 * 用法:
 *   node scripts/quality/check-coverage-critical-files.mjs          # 门禁模式（有违规即 exit 1）
 *   node scripts/quality/check-coverage-critical-files.mjs --json   # 输出 JSON 摘要
 *
 * 为什么不用文件名匹配:
 *   本仓 spec 命名不统一（src/client.ts <- spec/unit/matrix-client.spec.ts,
 *   src/room/RoomManager.ts <- spec/unit/room-manager.spec.ts）。
 *   按 basename 猜"有没有测试"会产生大量假阳性 —— 这正是 COVERAGE_WEAK_FILES.md
 *   历史误报（"471 files / 0 tests"）的根因。
 *
 * 因此本门禁用两个可验证信号:
 *   1. 直接 spec:  spec/unit/<镜像路径>.spec.ts 或 spec/unit/<basename>.spec.ts
 *   2. import 图:  是否存在任意 spec 文件 import 了该源文件（真实可达性证据）
 *
 * 判定:
 *   critical = 含 HTTP 调用 且 无直接 spec 且 无任何 spec import 它
 *
 * 门禁规则（任一违反 => exit 1）:
 *   R1 未登记的 critical 文件（新出现的覆盖盲区）
 *   R2 台账条目缺 owner / deadline / reason
 *   R3 台账条目已过期（deadline < 今天）且文件仍未覆盖
 *   R4 台账条目已失效（文件现在已被 spec 覆盖）—— 强制清理，防止台账腐烂
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCoverageSignals } from "./lib/spec-import-graph.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..", "..");

const srcDir = path.join(projectRoot, "src");
const specDir = path.join(projectRoot, "spec");
const LEDGER_PATH = path.join(__dirname, "coverage-critical-ledger.json");

const HTTP_CALL_RE = /withRetry|authedRequest|authedRequestClient|makeRequest|\.request\(Method/g;

// 覆盖判定信号（直接 spec + import 图）统一由 lib/spec-import-graph.mjs 提供，
// 避免与其它扫描器各自实现一套而漂移。
const signals = createCoverageSignals(srcDir, specDir);
const { sourceFiles, specFiles, isTouched } = signals;

function analyze() {
    const critical = [];
    for (const file of sourceFiles) {
        const rel = path.relative(srcDir, file);
        const content = fs.readFileSync(file, "utf8");
        const httpCalls = (content.match(HTTP_CALL_RE) || []).length;
        if (httpCalls === 0) continue;

        if (isTouched(file)) continue;

        critical.push({
            file: rel,
            lines: content.split("\n").length,
            httpCalls,
            evidence: "no direct spec, no spec imports this module",
        });
    }
    critical.sort((a, b) => b.httpCalls - a.httpCalls);
    return critical;
}

function loadLedger() {
    if (!fs.existsSync(LEDGER_PATH)) {
        console.error(`[coverage-critical] Ledger not found: ${LEDGER_PATH}`);
        process.exit(1);
    }
    try {
        return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
    } catch (e) {
        console.error(`[coverage-critical] Cannot parse ledger: ${e.message}`);
        process.exit(1);
    }
}

/**
 * R1–R4 的判定（纯函数，便于单测 —— 原实现把四条规则全写在 main() 里，
 * 既没法测，也没法在 CI 之外复现）。
 *
 * `today` 显式入参而不是内部取 `new Date()`：R3 是"deadline 过期且仍未覆盖"，
 * 这个判定随日期变化，不参数化就只能写"今天前后"这种会自己腐烂的用例。
 *
 * @param {{critical: Array<{file: string, lines: number, httpCalls: number, evidence: string}>,
 *          entries: Array<Record<string, unknown>>, today: Date}} input
 * @returns {{violations: Array<Record<string, unknown>>, tracked: Array<Record<string, unknown>>}}
 */
export function evaluateLedger({ critical, entries, today }) {
    const byFile = new Map(entries.map((e) => [e.file, e]));
    const violations = [];
    const tracked = [];

    // R1: 未登记的 critical 文件
    for (const c of critical) {
        if (!byFile.has(c.file)) {
            violations.push({
                rule: "R1",
                file: c.file,
                detail: `${c.lines} lines / ${c.httpCalls} HTTP calls, ${c.evidence}`,
                fix: `补充 ${c.file.replace(/\.ts$/, ".spec.ts")}，或在 coverage-critical-ledger.json 登记（含 owner/deadline/reason）`,
            });
        }
    }

    // R2/R3/R4: 台账条目校验
    for (const e of entries) {
        const missing = ["file", "owner", "deadline", "reason"].filter((k) => !e[k]);
        if (missing.length) {
            violations.push({
                rule: "R2",
                file: e.file || "<missing file field>",
                detail: `missing fields: ${missing.join(", ")}`,
                fix: "补齐 owner / deadline / reason",
            });
            continue;
        }

        const deadline = new Date(`${e.deadline}T00:00:00`);
        if (Number.isNaN(deadline.getTime())) {
            violations.push({
                rule: "R2",
                file: e.file,
                detail: `invalid deadline '${e.deadline}' (expected YYYY-MM-DD)`,
                fix: "改为 YYYY-MM-DD",
            });
            continue;
        }

        const isCriticalNow = critical.some((c) => c.file === e.file);

        if (!isCriticalNow) {
            violations.push({
                rule: "R4",
                file: e.file,
                detail: "listed in ledger but now covered by a spec (or no longer has HTTP calls)",
                fix: "该条目已失效 —— 从 coverage-critical-ledger.json 中删除",
            });
            continue;
        }

        const daysLeft = Math.floor((deadline - today) / 86400000);
        if (daysLeft < 0) {
            violations.push({
                rule: "R3",
                file: e.file,
                detail: `deadline ${e.deadline} expired ${-daysLeft} day(s) ago, still uncovered (owner: ${e.owner})`,
                fix: "补齐测试，或由 owner 重新评估并给出新的 deadline",
            });
        } else {
            tracked.push({ ...e, daysLeft });
        }
    }

    return { violations, tracked };
}

function main() {
    const jsonMode = process.argv.includes("--json");

    const critical = analyze();
    const ledger = loadLedger();
    const entries = ledger.entries || [];

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const { violations, tracked } = evaluateLedger({ critical, entries, today });

    if (jsonMode) {
        console.log(
            JSON.stringify(
                {
                    generatedAt: new Date().toISOString(),
                    sourceFiles: sourceFiles.length,
                    specFiles: specFiles.length,
                    criticalCount: critical.length,
                    tracked: tracked.map((t) => ({ file: t.file, owner: t.owner, deadline: t.deadline })),
                    violations,
                },
                null,
                2,
            ),
        );
    } else {
        console.log("=".repeat(72));
        console.log("[coverage-critical] 零覆盖 + 高危源文件门禁");
        console.log("=".repeat(72));
        console.log(`源文件 ${sourceFiles.length} 个 / spec 文件 ${specFiles.length} 个`);
        console.log(`当前 critical（含 HTTP 调用且无任何 spec 引用）: ${critical.length} 个\n`);

        if (tracked.length) {
            console.log("已登记待修复（在期限内）:");
            for (const t of tracked) {
                console.log(`  - ${t.file}  [owner: ${t.owner}, deadline: ${t.deadline}, 剩余 ${t.daysLeft} 天]`);
            }
            console.log("");
        }

        if (violations.length) {
            console.log("违规:");
            for (const v of violations) {
                console.log(`  [${v.rule}] ${v.file}`);
                console.log(`        ${v.detail}`);
                console.log(`        -> ${v.fix}`);
            }
        } else {
            console.log("无违规。所有 critical 文件均已登记且在期限内。");
        }
        console.log("=".repeat(72));
    }

    if (violations.length > 0 && !jsonMode) {
        console.error(`\n[coverage-critical] FAILED: ${violations.length} violation(s).`);
    }
    process.exit(violations.length > 0 ? 1 : 0);
}

// 仅在被直接执行时跑 main。原来这里是**无条件** main() —— 于是任何
// `import` 它的 spec 都会顺带跑一遍全仓扫描，并在仓库真有违规时被
// `process.exit(1)` 打断（spec 假红，且红得莫名其妙）。
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
