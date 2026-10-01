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
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WAIVERS_PATH = join(__dirname, "path-contract-waivers.json");

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
        const expires = new Date(w.expires + "T00:00:00");
        if (isNaN(expires.getTime())) {
            console.error(`[waiver-expiry] Invalid expires date '${w.expires}' for ${w.sdkCall}`);
            process.exit(1);
        }
        const daysLeft = Math.floor((expires - today) / 86400000);
        if (daysLeft < 0) {
            expired.push({ ...w, daysLeft });
        } else if (daysLeft <= 30) {
            expiringSoon.push({ ...w, daysLeft });
        } else {
            valid.push({ ...w, daysLeft });
        }
    }

    console.log(`[waiver-expiry] ${today.toISOString().slice(0, 10)}: ` +
        `${entries.length} waivers [valid: ${valid.length}, expiring-soon(<=30d): ${expiringSoon.length}, expired: ${expired.length}]`);

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
            console.error("  Fix: renew `expires` after confirming the backend gap still exists, or remove the waiver if the");
            console.error("  SDK call was dropped / backend implemented. See scripts/quality/path-contract-waivers.json");
            process.exit(1);
        } else {
            console.log("[waiver-expiry] Warning: expired waivers detected (non-strict mode, not blocking).");
        }
    } else {
        console.log("[waiver-expiry] quality gate passed");
    }
}

main();
