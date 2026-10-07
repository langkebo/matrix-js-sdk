#!/usr/bin/env node
/**
 * check-waiver-expiry.mjs - P3 豁免到期检查门禁
 *
 * 用法:
 *   node scripts/quality/check-waiver-expiry.mjs           # 普通模式：到期仅警告
 *   node scripts/quality/check-waiver-expiry.mjs --strict  # 严格模式：到期即失败
 *
 * 原理:
 *   1. 读入 scripts/quality/path-contract-waivers.json
 *   2. 对每个豁免条目计算剩余天数
 *   3. 分类为 EXPIRED / EXPIRING_SOON / VALID 并输出报告
 *   4. strict 模式下存在 EXPIRED 条目则 exit 1
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WAIVERS_PATH = join(__dirname, "path-contract-waivers.json");

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

function loadWaivers() {
    try {
        return JSON.parse(readFileSync(WAIVERS_PATH, "utf8"));
    } catch (e) {
        console.error(`[waiver-expiry] Cannot load waivers: ${WAIVERS_PATH}`);
        console.error(e.message);
        process.exit(1);
    }
}

function main() {
    const strict = process.argv.includes("--strict");
    const waivers = loadWaivers();
    const entries = waivers.waivers || [];
    if (entries.length === 0) {
        console.log("[waiver-expiry] No waivers registered. Nothing to check.");
        return;
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const expired = [];
    const expiringSoon = [];
    const valid = [];

    for (const w of entries) {
        const { status, daysLeft } = classifyExpiry(w.expires, today);
        if (status === null) {
            console.error(`[waiver-expiry] Invalid expires date '${w.expires}' for ${w.sdkCall}`);
            process.exit(1);
        }
        if (status === EXPIRY.EXPIRED) expired.push({ ...w, daysLeft });
        else if (status === EXPIRY.EXPIRING_SOON) expiringSoon.push({ ...w, daysLeft });
        else valid.push({ ...w, daysLeft });
    }

    console.log(
        `[waiver-expiry] ${formatLocalDate(today)}: ` +
            `${entries.length} waivers [valid: ${valid.length}, expiring-soon(<=30d): ${expiringSoon.length}, expired: ${expired.length}]`,
    );

    for (const w of expiringSoon) {
        console.log(`  [SOON] ${w.sdkCall} (${w.file}) — ${w.daysLeft} days left (expires ${w.expires})`);
    }
    for (const w of expired) {
        console.log(`  [EXPIRED] ${w.sdkCall} (${w.file}) — expired ${-w.daysLeft} days ago (expires ${w.expires})`);
        console.log(`          reason: ${w.reason}`);
    }

    if (expired.length > 0) {
        if (strict) {
            console.error(`[waiver-expiry] quality gate failed: ${expired.length} expired waiver(s).`);
            console.error(
                "  Fix: renew `expires` after confirming the backend gap still exists, or remove the waiver if the",
            );
            console.error(
                "  SDK call was dropped / backend implemented. See scripts/quality/path-contract-waivers.json",
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
export { EXPIRY, EXPIRING_SOON_DAYS, classifyExpiry, daysLeftUntil, formatLocalDate };

const invokedDirectly =
    typeof process.argv[1] === "string" && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
