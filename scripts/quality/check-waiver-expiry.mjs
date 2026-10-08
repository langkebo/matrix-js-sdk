#!/usr/bin/env node
/**
 * check-waiver-expiry.mjs - P3 豁免到期检查门禁
 *
 * 用法:
 *   node scripts/quality/check-waiver-expiry.mjs           # 普通模式：到期仅警告
 *   node scripts/quality/check-waiver-expiry.mjs --strict  # 严格模式：到期即失败
 *
 * ## 覆盖哪些台账
 *
 * 2026-10-08 起从「只读 path-contract 一份」扩成**多台账**：仓库里带 `expires` 的
 * 白名单都归这里管（见 `LEDGER_SOURCES`）。原因是实测发现**两份豁免的到期纪律不一致**：
 *
 *   · `path-contract-waivers.json`      → 有 `expires`，且被本门禁读；
 *   · `swallow-fallback-baseline.json`  → `@swallow-error { owner, expires }` 也有 `expires`，
 *     但**没有任何东西读它** —— `check-swallow-fallbacks.mjs` 只对"新命中且过期"报错，
 *     对**已登记基线里过期**的条目只打一行 warning（`baseline entry … has expired whitelist`）。
 *
 * 同一仓库里两套到期纪律、其中一套无人执行，正是本门禁存在的意义。
 *
 * ## 原理
 *
 *   1. 逐个读入 `LEDGER_SOURCES` 里的台账；
 *   2. 把「带 expires 的条目」拍平成统一形状（`collectExpirables`，纯函数）；
 *   3. 分类为 EXPIRED / EXPIRING_SOON / VALID 并输出报告；
 *   4. strict 模式下存在 EXPIRED（或 `expires` 不可解析）则 exit 1。
 */

import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 归本门禁管的台账。
 *
 * 加新的一本时**必须同时**在 `collectExpirables` 里给出它的形状解析 —— 那里对未知
 * `name` 是**抛错**而不是静默跳过（静默跳过 = 台账悄悄脱离纪律，正是本次要修的病）。
 */
const LEDGER_SOURCES = Object.freeze([
    { name: "path-contract", file: "path-contract-waivers.json" },
    { name: "swallow-fallback", file: "swallow-fallback-baseline.json" },
    { name: "route-set-parity", file: "route-set-parity-waivers.json" },
]);

/** 豁免到期状态。 */
const EXPIRY = Object.freeze({
    EXPIRED: "EXPIRED",
    EXPIRING_SOON: "EXPIRING_SOON",
    VALID: "VALID",
});

/** "即将到期"窗口：剩余天数 ≤ 此值即提醒。 */
const EXPIRING_SOON_DAYS = 30;

/**
 * 距离到期还有几天（按自然日算，忽略时分秒）。
 *
 * `expires` 用 `T00:00:00` 解析成**本地自然日零点**：若改用 `new Date("2026-12-31")`
 * （UTC 零点），在东八区会变成前一天 08:00，导致"到期当天"被判成"已过期"。
 *
 * @returns 天数；日期不可解析时返回 `NaN`
 */
function daysLeftUntil(expires, today) {
    const d = new Date(`${expires}T00:00:00`);
    if (isNaN(d.getTime())) return NaN;
    return Math.floor((d - today) / 86400000);
}

/**
 * 给一条豁免定级。
 *
 * 边界（有意如此）：`daysLeft === 0`（当天到期）算 **EXPIRING_SOON 而非 EXPIRED** ——
 * 到期日当天仍然有效，第二天才作废。`daysLeft` 为负才是 EXPIRED。
 */
function classifyExpiry(expires, today) {
    const daysLeft = daysLeftUntil(expires, today);
    if (Number.isNaN(daysLeft)) return { status: null, daysLeft };
    if (daysLeft < 0) return { status: EXPIRY.EXPIRED, daysLeft };
    if (daysLeft <= EXPIRING_SOON_DAYS) return { status: EXPIRY.EXPIRING_SOON, daysLeft };
    return { status: EXPIRY.VALID, daysLeft };
}

/**
 * 按**本地**日历格式化 `YYYY-MM-DD`。
 *
 * 不能写 `d.toISOString().slice(0, 10)`：`toISOString()` 是 UTC，而 `today` 是
 * 本地自然日零点 —— 东八区的 `2026-10-07 00:00` 在 UTC 是 `2026-10-06T16:00Z`，
 * 于是报告头会打印成**前一天**（实测：本地 10-07 打印 10-06）。
 *
 * 分类逻辑本身用的是本地零点 `today`，所以这只是**打印**错一天，判定没错；
 * 但报告头是给人看的，错一天会让"这条豁免到底哪天到期"对不上账。
 */
function formatLocalDate(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 把各台账里「带 `expires` 的条目」拍平成统一形状（纯函数，spec 直接测）。
 *
 * @param {Array<{ name: string; doc: unknown }>} ledgerDocs
 * @returns {Array<{ ledger: string; id: string; file: string | null; owner: string; expires: unknown; reason: string }>}
 */
function collectExpirables(ledgerDocs) {
    const out = [];
    for (const { name, doc } of ledgerDocs) {
        if (name === "path-contract") {
            for (const w of doc.waivers ?? []) {
                out.push({
                    ledger: name,
                    id: w.sdkCall ?? w.path ?? "(unnamed)",
                    file: w.file ?? null,
                    owner: w.owner ?? "",
                    expires: w.expires,
                    reason: w.reason ?? "",
                });
            }
        } else if (name === "route-set-parity") {
            for (const w of doc.waivers ?? []) {
                out.push({
                    ledger: name,
                    id: `${w.method} ${w.path}`,
                    file: null,
                    owner: w.owner ?? "",
                    expires: w.expires,
                    reason: w.reason ?? "",
                });
            }
        } else if (name === "swallow-fallback") {
            for (const f of doc.findings ?? []) {
                const wl = f.whitelist;
                // 没有 whitelist 的条目不是"豁免"，是待修缺陷（由 swallow 门禁自己管）。
                if (!wl) continue;
                out.push({
                    ledger: name,
                    id: `${f.file}:${f.line}`,
                    file: f.file,
                    owner: wl.owner ?? "",
                    expires: wl.expires,
                    reason: `@swallow-error（owner=${wl.owner ?? "?"}）`,
                });
            }
        } else {
            throw new Error(`未登记的台账 '${name}'：请同时在 collectExpirables 里给出它的形状解析`);
        }
    }
    return out;
}

/** 读一本台账；文件缺失即失败（它必须跟着仓库走）。 */
function loadLedger(source) {
    const file = join(__dirname, source.file);
    if (!existsSync(file)) {
        console.error(`[waiver-expiry] ❌ 台账缺失：${source.file}`);
        process.exit(1);
    }
    try {
        return { name: source.name, doc: JSON.parse(readFileSync(file, "utf8")) };
    } catch (e) {
        console.error(`[waiver-expiry] ❌ 台账无法解析：${source.file}\n   ${e.message}`);
        process.exit(1);
    }
}

function main() {
    const strict = process.argv.includes("--strict");
    const ledgers = LEDGER_SOURCES.map(loadLedger);

    let entries;
    try {
        entries = collectExpirables(ledgers);
    } catch (e) {
        console.error(`[waiver-expiry] ❌ ${e.message}`);
        process.exit(1);
    }
    if (entries.length === 0) {
        console.log("[waiver-expiry] No waivers registered. Nothing to check.");
        return;
    }

    // ─── schema：每条豁免都必须有 owner（「谁负责」是豁免能被审阅的前提） ───
    // 与 `expires` 不同，缺 owner 不是"到期"问题而是**结构缺陷** ⇒ 两种模式都直接失败，
    // 免得"没有负责人"的豁免在 warn 模式下无限期活下去。
    const missingOwner = entries.filter((e) => !String(e.owner ?? "").trim());
    if (missingOwner.length > 0) {
        console.error(`[waiver-expiry] ❌ ${missingOwner.length} 条豁免缺 owner（owner + expires 是登记的最低要求）：`);
        for (const e of missingOwner.slice(0, 20)) {
            console.error(`  - [${e.ledger}] ${e.id}`);
        }
        if (missingOwner.length > 20) console.error(`  …还有 ${missingOwner.length - 20} 条`);
        process.exit(1);
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const expired = [];
    const expiringSoon = [];
    const valid = [];

    for (const w of entries) {
        const { status, daysLeft } = classifyExpiry(w.expires, today);
        if (status === null) {
            console.error(`[waiver-expiry] Invalid expires date '${w.expires}' for ${w.id} (${w.ledger})`);
            process.exit(1);
        }
        if (status === EXPIRY.EXPIRED) expired.push({ ...w, daysLeft });
        else if (status === EXPIRY.EXPIRING_SOON) expiringSoon.push({ ...w, daysLeft });
        else valid.push({ ...w, daysLeft });
    }

    const perLedger = LEDGER_SOURCES.map((s) => `${s.name}: ${entries.filter((e) => e.ledger === s.name).length}`);
    console.log(
        `[waiver-expiry] ${formatLocalDate(today)}: ` +
            `${entries.length} waivers [valid: ${valid.length}, expiring-soon(<=30d): ${expiringSoon.length}, expired: ${expired.length}]` +
            ` — 台账 { ${perLedger.join(", ")} }`,
    );

    for (const w of expiringSoon) {
        console.log(`  [SOON] ${w.id} (${w.ledger}) — ${w.daysLeft} days left (expires ${w.expires})`);
    }
    for (const w of expired) {
        console.log(`  [EXPIRED] ${w.id} (${w.ledger}) — expired ${-w.daysLeft} days ago (expires ${w.expires})`);
        console.log(`          reason: ${w.reason}`);
    }

    if (expired.length > 0) {
        if (strict) {
            console.error(`[waiver-expiry] quality gate failed: ${expired.length} expired waiver(s).`);
            console.error(
                "  Fix: renew `expires` after confirming the gap still exists, or remove the waiver if it is no longer",
            );
            console.error(
                "  needed. See scripts/quality/path-contract-waivers.json and scripts/quality/swallow-fallback-baseline.json",
            );
            process.exit(1);
        } else {
            console.log("[waiver-expiry] Warning: expired waivers detected (non-strict mode, not blocking).");
        }
    } else {
        console.log("[waiver-expiry] quality gate passed");
    }
}

// 纯函数导出给 spec 用；副作用式入口用 invokedDirectly 兜住（被 import 时不得执行）。
export {
    EXPIRY,
    EXPIRING_SOON_DAYS,
    LEDGER_SOURCES,
    classifyExpiry,
    collectExpirables,
    daysLeftUntil,
    formatLocalDate,
};

const invokedDirectly =
    typeof process.argv[1] === "string" && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
