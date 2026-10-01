#!/usr/bin/env node
/*
 * 定时器配对门禁（阶段 3 · P3-3）。
 *
 * 背景：报告点出 `src/web-rtc` 31 处 set vs 19 处 clear，担心定时器泄漏。人工过了一遍之后
 * 的结论是"当时没有真泄漏"，但**没有任何机制阻止下一个泄漏**：新加一个 `setInterval`
 * 而忘了在 stop() 里清理，类型检查、测试、lint 全都不会红 —— 泄漏要等到线上看到内存/请求
 * 打点才会被发现。本门禁就是把"每一处都有人做过判断"变成机器可查的事实。
 *
 * 覆盖范围（有意收窄，避免变成噪声门禁）：
 *   - `src/**` 里所有 `setInterval(...)`：必须登记处置；
 *   - `src/**` 里**被存进变量/属性**的 `setTimeout(...)`：存句柄就说明打算取消，必须登记；
 *   - 返回值被丢弃的 `setTimeout(...)`：一次性语义，只统计不要求登记。
 *
 * 处置类型（`scripts/quality/timer-pairing-registry.json`）：
 *   paired —— 同一文件里有对应的 clear*（门禁会去 grep，登记说谎就红）；
 *   owned  —— 由别的文件统一清理（必须写 clearedIn + clearedHandle，门禁同样去 grep）；
 *   waived —— 明确接受不清理，必须写 reason + expires（到期即红）。
 *
 * 能力边界（写清楚，免得被当成比实际更强的保证）：门禁只能证明"清理语句存在"，
 * 不能证明"清理路径一定被执行"。后者的兜底是 `spec/unit/client-lifecycle-teardown.spec.ts`
 * 对客户端级停止路径的用例。
 *
 * 用法：
 *   node scripts/quality/check-timer-pairing.mjs                # 门禁
 *   node scripts/quality/check-timer-pairing.mjs --list         # 列出全部站点与处置
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const srcDir = path.join(rootDir, "src");
const registryPath = path.join(rootDir, "scripts", "quality", "timer-pairing-registry.json");

const shouldList = process.argv.includes("--list");

/** 全局 `setInterval`（排除 `this.stats.setInterval(...)` 这类同名方法调用）。 */
const SET_INTERVAL_RE = /(?<![.\w])setInterval\s*\(/;
/** `this.x = setTimeout(` / `const x = setTimeout(` / `client.x = setTimeout(` */
const STORED_TIMEOUT_RE = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=\s*(?<![.\w])setTimeout\s*\(/;
/** 方法/函数声明（`public setInterval(...)`、`function setTimeout(...)`）不是调用点。 */
const DECLARATION_RE =
    /\b(?:public|private|protected|static|function|declare|async)\s+(?:async\s+)?set(?:Interval|Timeout)\s*\(/;

function writeStdout(line = "") {
    process.stdout.write(`${line}\n`);
}

function writeStderr(line = "") {
    process.stderr.write(`${line}\n`);
}

function normalizePath(value) {
    return value.replaceAll("\\", "/");
}

function listTsFiles(dir, acc = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "__generated__" || entry.name === "node_modules") continue;
            listTsFiles(fullPath, acc);
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
            acc.push(fullPath);
        }
    }
    return acc;
}

/**
 * 把 `globalThis.setInterval(` 归一成 `setInterval(`，这样"排除点号前缀"的规则
 * 既能滤掉同名方法调用，又不会漏掉显式挂在全局对象上的调用。
 */
function normalizeSource(source) {
    return source.replace(/(?:globalThis|window|self)\.(setInterval|setTimeout)\s*\(/g, "$1(");
}

/**
 * 枚举一个文件里的定时器站点。
 *
 * 站点身份 = 文件 + 种类 + 句柄（不是行号）：在文件上方插代码不会让登记失效，
 * 而改句柄名会 —— 那本来就是需要重新判断的改动。
 */
export function collectTimerSites(source, filePath) {
    const normalized = normalizeSource(source);
    const lines = normalized.split(/\r?\n/);
    const sites = [];
    const seen = new Map();

    const push = (site) => {
        const base = `${site.kind}#${site.handle ?? "<discarded>"}`;
        const ordinal = (seen.get(base) ?? 0) + 1;
        seen.set(base, ordinal);
        sites.push({ ...site, ordinal });
    };

    lines.forEach((lineText, index) => {
        if (DECLARATION_RE.test(lineText)) return;

        if (SET_INTERVAL_RE.test(lineText)) {
            push({
                file: filePath,
                kind: "interval",
                handle: extractHandle(lineText, "setInterval"),
                line: index + 1,
                snippet: lineText.trim(),
            });
        }

        const storedMatch = STORED_TIMEOUT_RE.exec(lineText);
        if (storedMatch !== null) {
            push({
                file: filePath,
                kind: "stored-timeout",
                handle: storedMatch[1],
                line: index + 1,
                snippet: lineText.trim(),
            });
        }
    });

    return sites;
}

function extractHandle(lineText, callee) {
    const index = lineText.indexOf(`${callee}(`);
    if (index < 0) return null;
    const before = lineText.slice(0, index);
    const match = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=\s*$/.exec(before);
    return match === null ? null : match[1];
}

/** `setTimeout` 但没接句柄 = 一次性语义，只统计。 */
export function countDiscardedTimeouts(source) {
    const normalized = normalizeSource(source);
    return normalized.split(/\r?\n/).filter((lineText) => {
        if (DECLARATION_RE.test(lineText)) return false;
        if (!/(?<![.\w])setTimeout\s*\(/.test(lineText)) return false;
        return !STORED_TIMEOUT_RE.test(lineText);
    }).length;
}

export function siteKey(site) {
    // 同一个句柄可能在多处被赋值（例如 `this.keepAliveTimer` 有三个赋值点），
    // 因此键里带上"该句柄在文件内的第几处"。序号而不是行号：在上方插代码不会失效。
    return `${site.file}#${site.kind}#${site.handle ?? "<discarded>"}#${site.ordinal ?? 1}`;
}

export function readRegistry(filePath = registryPath) {
    if (!fs.existsSync(filePath)) return { sites: [], generatedAt: null };
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return { sites: Array.isArray(payload.sites) ? payload.sites : [], generatedAt: payload.generatedAt ?? null };
}

/**
 * 该文件里是否有清理这个句柄的语句。
 *
 * 归一化三件事，否则会把真实存在的清理误判成"没清理"（都是实测踩到的）：
 *   - `globalThis.clearInterval(` / `window.clearTimeout(` → 去掉全局对象前缀；
 *   - `clearTimeout(x as NodeJS.Timeout)` / `clearInterval(this.timer!)` 这类带断言/非空
 *     断言的写法 → 句柄后面允许跟任意内容直到右括号；
 *   - 句柄名后缀用 `\b` 兜住，避免 `timer` 误配 `timer2`。
 *
 * 导出给登记表生成器复用，避免"门禁的判定"和"生成登记表时的判定"两套逻辑漂移。
 */
export function fileClearsHandle(content, kind, handle) {
    const normalized = normalizeSource(content).replace(
        /(?:globalThis|window|self)\.(clearInterval|clearTimeout)\s*\(/g,
        "$1(",
    );
    const callee = kind === "interval" ? "clearInterval" : "clearTimeout";
    return new RegExp(`(?<![.\\w])${callee}\\s*\\(\\s*${escapeRegExp(handle)}\\b[^)]*\\)`).test(normalized);
}

/** 句柄是否被某个集合统一清理（`for (const t of this.setNewKeyTimeouts) clearTimeout(t)`）。 */
export function fileClearsCollection(content, kind, collection) {
    const normalized = normalizeSource(content);
    const callee = kind === "interval" ? "clearInterval" : "clearTimeout";
    return content.includes(collection) && new RegExp(`${callee}\\s*\\(`).test(normalized);
}

function clearExists({ clearFile, clearHandle, kind, clearCollection }) {
    const absolute = path.join(rootDir, clearFile);
    if (!fs.existsSync(absolute)) return false;
    const content = fs.readFileSync(absolute, "utf8");
    if (typeof clearCollection === "string" && clearCollection.length > 0) {
        return fileClearsCollection(content, kind, clearCollection);
    }
    return fileClearsHandle(content, kind, clearHandle);
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 判定单个站点。返回 `{ ok, detail }`；`ok === false` 的站点会让门禁失败。
 *
 * 导出以便负向测试：一个"永远返回 ok"的判定等于没有门禁。
 */
export function evaluateSite(site, registry, today = new Date()) {
    const key = siteKey(site);
    const entry = registry.sites.find((candidate) => candidate.key === key);

    if (entry === undefined) {
        return { ok: false, key, detail: `未登记（${site.snippet}）` };
    }

    if (entry.disposition === "waived") {
        if (typeof entry.reason !== "string" || entry.reason.length === 0) {
            return { ok: false, key, detail: "waived 必须写 reason" };
        }
        if (typeof entry.expires !== "string" || new Date(entry.expires) < today) {
            return { ok: false, key, detail: `waived 已过期（expires=${String(entry.expires)}）` };
        }
        return { ok: true, key, detail: `waived: ${entry.reason}` };
    }

    if (entry.disposition !== "paired" && entry.disposition !== "owned") {
        return { ok: false, key, detail: `未知处置 ${String(entry.disposition)}` };
    }

    const clearFile = normalizePath(entry.clearedIn ?? site.file);
    const clearHandle = entry.clearedHandle ?? site.handle;
    if (clearHandle === null && entry.clearCollection === undefined) {
        return { ok: false, key, detail: "没有句柄就无法清理，请改为 waived 并说明理由" };
    }
    if (!clearExists({ clearFile, clearHandle, kind: site.kind, clearCollection: entry.clearCollection })) {
        return {
            ok: false,
            key,
            detail: `${clearFile} 里找不到清理 ${String(entry.clearCollection ?? clearHandle)}`,
        };
    }

    return { ok: true, key, detail: entry.disposition === "owned" ? `owned by ${clearFile}` : "paired" };
}

function main() {
    const registry = readRegistry();
    const files = listTsFiles(srcDir).map((absolute) => ({
        absolute,
        relative: normalizePath(path.relative(rootDir, absolute)),
    }));

    const sites = [];
    let discardedTimeouts = 0;
    for (const file of files) {
        const source = fs.readFileSync(file.absolute, "utf8");
        discardedTimeouts += countDiscardedTimeouts(source);
        for (const site of collectTimerSites(source, file.relative)) {
            sites.push(site);
        }
    }

    const today = new Date();
    const failures = [];
    for (const site of sites) {
        const verdict = evaluateSite(site, registry, today);
        if (shouldList) {
            writeStdout(`${verdict.ok ? "ok " : "RED"} ${siteKey(site)} -> ${verdict.detail}`);
        }
        if (!verdict.ok) failures.push({ site, verdict });
    }

    // 登记了但代码里已经不存在 → 登记表腐化，必须清掉（否则下次真站点改名会被旧条目掩盖）
    const liveKeys = new Set(sites.map(siteKey));
    const staleEntries = registry.sites.filter((entry) => !liveKeys.has(entry.key)).map((entry) => entry.key);

    const intervals = sites.filter((site) => site.kind === "interval").length;
    const storedTimeouts = sites.filter((site) => site.kind === "stored-timeout").length;
    writeStdout(
        `[timer-pairing] setInterval ${intervals} 处、存句柄的 setTimeout ${storedTimeouts} 处、` +
            `丢弃句柄的 setTimeout ${discardedTimeouts} 处（后者为一次性语义，不要求登记）`,
    );

    if (failures.length > 0) {
        writeStderr(`[timer-pairing] 门禁失败：${failures.length} 处定时器没有可核对的处置`);
        for (const { site, verdict } of failures) {
            writeStderr(`- ${siteKey(site)} (${site.file}:${site.line}) -> ${verdict.detail}`);
        }
        writeStderr("[timer-pairing] 见 scripts/quality/timer-pairing-registry.json 的说明");
        process.exitCode = 1;
    }

    if (staleEntries.length > 0) {
        writeStderr(`[timer-pairing] 登记表里有 ${staleEntries.length} 条已失效条目，请删除：`);
        for (const key of staleEntries) writeStderr(`- ${key}`);
        process.exitCode = 1;
    }

    if (failures.length === 0 && staleEntries.length === 0) {
        writeStdout(`[timer-pairing] 门禁通过（${sites.length} 处全部有处置说明）`);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
