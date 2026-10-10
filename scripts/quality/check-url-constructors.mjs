#!/usr/bin/env node

/**
 * 批次 K2 门禁：URL/路径构造器台账（`scripts/quality/url-constructor-ledger.json`）。
 *
 * ## 为什么需要它
 *
 * `verify-path-contract.mjs` 校验的是 **`request({method, path})` 调用点**——它从
 * 「发请求」的那一层看路径。但有一类方法**不发请求、纯字符串拼 URL**，返回值直接交给
 * 浏览器做整页跳转（SSO/CAS/SAML/OIDC 登录、媒体直链等）。拼错就是 404，可在
 * `request()` 视角下**零调用点** ⇒ 完全隐形。方案文档 §9.14.4（盲区 1）记的
 * `getSsoLoginUrl` / `getCasLoginUrl` / `getLoginRedirectUrl` / `getLogoutRedirectUrl`
 * 四处 404 全部由此漏网。
 *
 * 本门禁把这类构造点**显式登记**成台账，并对每一条做三段判据。
 *
 * ## 判据
 *
 * 1. **guard 守卫**（防"源码漂移而台账没跟着改"）：登记项给出 `symbol` 与一组 `guards`
 *    ——该符号**定义体**内必须出现的源码子串。缺任何一个 ⇒ `stale-guard` 报红。
 *    这是 K3 变异自证的落点：把 `getSsoLoginUrl` 的体换回旧实现（`"/login/" + loginType
 *    + "/redirect"`），`guards` 里的 `/login/sso/redirect` 子串消失 ⇒ 立即变红。
 * 2. **产物核对**：登记项给出它能拼出的 `(method, path)`。`expect:"manifest"` 的路径经
 *    `normalizePath()` 后必须命中后端 manifest（`{…}` 段按段通配）；`expect:"bucket:<name>"`
 *    的路径**必须未命中**（认不出的落**具名桶**），且计入桶计数。桶计数**只降不升**，
 *    并且**缩小后不刷新也要报**（棘轮要求"修一条、刷一条"，不允许静默漂移）。
 * 3. **覆盖率守卫**：静态扫描 `src/**`，按三条规则找出"疑似 URL/路径构造点"：
 *      R1 `new URL(\`…\`, base)`   —— 模板字面量作第一实参的 URL 构造
 *      R2 `.getUrl(`              —— 走 HTTP API 的 URL 构造器
 *      R3 `` return `…${baseUrl…` `` —— 手写 baseUrl 拼接
 *    每个构造点必须落在某条登记项（同文件 + 符号定义体行范围）内；否则 `unregistered-site`
 *    报红。非构造点（解析字符串、传输层 plumbing 等）在 `ignoredSites` 里**逐文件说明原因**。
 *
 * ## 环境
 *
 * manifest 来源与 `verify-path-contract.mjs` 一致（`LEDGER_PATH` > 兄弟仓 > 仓内镜像）。
 * 注意：本模块 **import** `verify-path-contract.mjs` 时，那里的 `backendRoutes` 是
 * 模块级 `let`、只在它的 `main()` 里赋值 ⇒ 这里**必须自己 `loadBackendRoutes()` 并显式
 * 传第三参**，否则会退化成"全部未命中"的假红。
 *
 * 用法：node scripts/quality/check-url-constructors.mjs [--refresh]
 * 退出码：0 = 通过；1 = 存在违规；2 = 门禁自身无法运行（台账缺失/解析失败）。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadBackendRoutes, matchAgainstLedger, normalizePath } from "./verify-path-contract.mjs";
import { writeJsonFormatted } from "./lib/write-json.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LEDGER_FILE = path.join(projectRoot, "scripts", "quality", "url-constructor-ledger.json");
const SRC_DIR = path.join(projectRoot, "src");

/**
 * 覆盖率守卫的三条规则（每次调用现造正则，避免 `lastIndex` 跨文件残留）。
 *
 * 为什么 R1 要收窄到「第一实参是模板字面量」：`new URL(x)` 在全仓有 17 处，绝大多数是
 * **解析**已有字符串（`new URL(value)` / `new URL(baseUrl)`），不是构造 API 路径。收窄后
 * 只剩 3 处真正的路径构造（全都登记了），噪声归零而盲区仍在网内。
 */
const COVERAGE_RULES = [
    { rule: "R1", re: () => /new\s+URL\s*\(\s*`/g },
    { rule: "R2", re: () => /\.getUrl\s*\(/g },
    { rule: "R3", re: () => /return\s+`[^`]*\$\{[^}]*(?:baseUrl|BaseUrl|getHomeserverUrl)/g },
];

/** 1-based 行号：`index` 处之前有多少个换行。 */
export function lineOf(source, index) {
    let line = 1;
    for (let i = 0; i < index && i < source.length; i++) {
        if (source[i] === "\n") line++;
    }
    return line;
}

/**
 * 从 `startIndex`（必须是 `(` `{` `[` 之一）起做括号配平，返回配对闭合括号的下标；找不到返回 -1。
 *
 * 跳过单/双引号字符串、模板字面量（`${…}` 内部整体跳过——合法的 TS 插值表达式自身括号
 * 必配平，故不影响外层计数）、行注释、块注释。**不支持**模板里再嵌模板（本仓构造点无此形态）。
 */
export function matchBalanced(source, startIndex) {
    const open = source[startIndex];
    const close = open === "(" ? ")" : open === "{" ? "}" : open === "[" ? "]" : null;
    if (!close) return -1;

    let depth = 0;
    let state = "code"; // code | ' | " | ` | line | block
    for (let i = startIndex; i < source.length; i++) {
        const ch = source[i];
        const next = source[i + 1];

        if (state === "code") {
            if (ch === "/" && next === "/") {
                state = "line";
                i++;
                continue;
            }
            if (ch === "/" && next === "*") {
                state = "block";
                i++;
                continue;
            }
            if (ch === "'") {
                state = "'";
                continue;
            }
            if (ch === '"') {
                state = '"';
                continue;
            }
            if (ch === "`") {
                state = "`";
                continue;
            }
            if (ch === open) depth++;
            else if (ch === close) {
                depth--;
                if (depth === 0) return i;
            }
            continue;
        }

        if (state === "line") {
            if (ch === "\n") state = "code";
            continue;
        }
        if (state === "block") {
            if (ch === "*" && next === "/") {
                state = "code";
                i++;
            }
            continue;
        }
        // 字符串 / 模板：仅处理转义；模板的闭合反引号即退出
        if (ch === "\\") {
            i++;
            continue;
        }
        if ((state === "'" && ch === "'") || (state === '"' && ch === '"') || (state === "`" && ch === "`")) {
            state = "code";
        }
    }
    return -1;
}

/**
 * 从 `from`（参数表右括号之后）起定位函数体的 `{`：跳过返回类型标注 —— 类型里可能内嵌
 * 对象字面量（`Promise<{ access_token: string }>`）或泛型尖括号 —— 以及字符串与注释。
 * 返回函数体 `{` 的下标；找不到（如 interface / 重载签名）返回 -1。
 */
function findBodyBrace(source, from) {
    let angle = 0;
    let state = "code"; // code | ' | " | ` | line | block
    for (let i = from; i < source.length; i++) {
        const ch = source[i];
        const next = source[i + 1];

        if (state === "code") {
            if (ch === "/" && next === "/") {
                state = "line";
                i++;
                continue;
            }
            if (ch === "/" && next === "*") {
                state = "block";
                i++;
                continue;
            }
            if (ch === "'") {
                state = "'";
                continue;
            }
            if (ch === '"') {
                state = '"';
                continue;
            }
            if (ch === "`") {
                state = "`";
                continue;
            }
            if (ch === "<") {
                angle++;
                continue;
            }
            if (ch === ">") {
                if (angle > 0) angle--;
                continue;
            }
            if (ch === "{") {
                if (angle === 0) return i;
                const end = matchBalanced(source, i);
                if (end < 0) return -1;
                i = end;
                continue;
            }
            if (ch === ";") return -1; // 无函数体（interface 成员 / 重载签名）
            continue;
        }

        if (state === "line") {
            if (ch === "\n") state = "code";
            continue;
        }
        if (state === "block") {
            if (ch === "*" && next === "/") {
                state = "code";
                i++;
            }
            continue;
        }
        if (ch === "\\") {
            i++;
            continue;
        }
        if ((state === "'" && ch === "'") || (state === '"' && ch === '"') || (state === "`" && ch === "`")) {
            state = "code";
        }
    }
    return -1;
}

/**
 * 定位方法/函数 `symbol` 的定义体。
 *
 * 用「定义行锚定」而非裸 `\bsymbol\s*\(`：后者会把**调用点**当成定义（如
 * `getCasLoginUrl` 内 `return this.getSsoLoginUrl(…)`、JSDoc 示例行），导致守卫取错范围。
 * 锚点要求行首（仅允许空白）后是修饰符序列再是符号名 —— 调用点以 `return` / `this.` 等
 * 开头，JSDoc 行以 `*` 开头，均不匹配。
 *
 * @returns {{ start: number; end: number; lineStart: number; body: string } | null}
 */
export function findSymbolBody(source, symbol) {
    const esc = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
        String.raw`^[ \t]*(?:export\s+)?(?:default\s+)?` +
            String.raw`(?:public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+|function\s+)*` +
            esc +
            String.raw`\s*(?:<[^>]*>)?\s*\(`,
        "m",
    );
    const m = re.exec(source);
    if (!m) return null;
    const openParen = m.index + m[0].length - 1;
    const closeParen = matchBalanced(source, openParen);
    if (closeParen < 0) return null;

    // 参数表之后是返回类型标注与函数体 `{`：跳过类型（可能含 `Promise<{…}>` 这类嵌套
    // 大括号/尖括号）后配平函数体才是「定义体」。若只取参数表的 `)`，body 会退化成
    // 签名，守卫与覆盖率范围都会失真。
    const braceStart = findBodyBrace(source, closeParen + 1);
    if (braceStart < 0) return null;
    const braceEnd = matchBalanced(source, braceStart);
    if (braceEnd < 0) return null;

    return {
        start: m.index,
        end: braceEnd,
        lineStart: lineOf(source, m.index),
        body: source.slice(m.index, braceEnd + 1),
    };
}

/** 定义体 `body` 里缺失的守卫子串（空数组 = 全部命中）。 */
export function missingGuards(body, guards) {
    return guards.filter((g) => !body.includes(g));
}

/** 收集源码里所有覆盖率规则命中的构造点。 */
export function collectConstructionSites(source) {
    const sites = [];
    for (const { rule, re } of COVERAGE_RULES) {
        const pattern = re();
        let m;
        while ((m = pattern.exec(source)) !== null) {
            sites.push({ rule, index: m.index, line: lineOf(source, m.index) });
        }
    }
    return sites;
}

/**
 * 核对一条 `(method, path)` 的期望。
 *
 * @returns {{ ok: true; kind: "exact" | "wildcard" | "bucket"; bucket?: string }
 *         | { ok: false; kind: string; detail: string; bucket?: string }}
 */
export function classifyPathExpectation(method, rawPath, expect, routes) {
    const np = normalizePath(rawPath);
    const matched = matchAgainstLedger(method, np, routes);

    if (expect === "manifest") {
        if (matched === null) {
            return { ok: false, kind: "manifest-miss", detail: `${method} ${np} 未命中 manifest` };
        }
        return { ok: true, kind: matched };
    }

    if (typeof expect === "string" && expect.startsWith("bucket:")) {
        const bucket = expect.slice("bucket:".length);
        if (!bucket) return { ok: false, kind: "bad-expect", detail: `空桶名: ${expect}` };
        if (matched !== null) {
            return {
                ok: false,
                kind: "bucket-now-in-manifest",
                detail: `${method} ${np} 已命中 manifest（${matched}）⇒ 应从桶迁出`,
                bucket,
            };
        }
        return { ok: true, kind: "bucket", bucket };
    }

    return { ok: false, kind: "bad-expect", detail: `无法识别的 expect: ${JSON.stringify(expect)}` };
}

/**
 * 桶棘轮：观测值相对基线**只准降不准升**；缩小未刷新也要报（要求 `--refresh` 显式接受）。
 *
 * @param {Record<string, number>} baseline
 * @param {Record<string, number>} observed
 * @returns {Array<{ kind: string; detail: string }>}
 */
export function diffBuckets(baseline, observed) {
    const issues = [];
    for (const [name, n] of Object.entries(observed)) {
        const base = baseline[name] ?? 0;
        if (n > base) {
            issues.push({ kind: "bucket-grown", detail: `${name}: ${base} → ${n}（+${n - base}）` });
        } else if (n < base) {
            issues.push({
                kind: "bucket-stale",
                detail: `${name}: ${base} → ${n}（-${base - n}）—— 桶计数缩小未刷新，跑 --refresh 接受`,
            });
        }
    }
    for (const name of Object.keys(baseline)) {
        if (!(name in observed)) {
            issues.push({
                kind: "bucket-stale",
                detail: `${name}: ${baseline[name]} → 0 —— 桶已清空未刷新，跑 --refresh 接受`,
            });
        }
    }
    return issues;
}

function* walkSrc(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "__generated__" || entry.name === "__tests__") continue;
            yield* walkSrc(full);
        } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
            yield full;
        }
    }
}

function relPosix(file) {
    return path.relative(projectRoot, file).split(path.sep).join("/");
}

function main() {
    const refresh = process.argv.includes("--refresh");

    if (!fs.existsSync(LEDGER_FILE)) {
        console.error(`❌ URL 构造器台账不存在: ${LEDGER_FILE}`);
        process.exit(2);
    }
    let ledger;
    try {
        ledger = JSON.parse(fs.readFileSync(LEDGER_FILE, "utf8"));
    } catch (e) {
        console.error(`❌ URL 构造器台账解析失败: ${e.message}`);
        process.exit(2);
    }

    // 显式加载 routes：不要依赖 verify-path-contract 的模块级 backendRoutes（import 时为 undefined）。
    const routes = loadBackendRoutes();

    const problems = [];
    const observedBuckets = {};
    const registeredRanges = new Map(); // rel → [{ start, end, symbol }]

    // --- 1) guard 守卫 + 2) 产物核对 ---
    for (const entry of ledger.entries ?? []) {
        const fileAbs = path.join(projectRoot, entry.file);
        if (!fs.existsSync(fileAbs)) {
            problems.push(`[missing-file] ${entry.file}: 登记的文件不存在`);
            continue;
        }
        const source = fs.readFileSync(fileAbs, "utf8");
        const found = findSymbolBody(source, entry.symbol);
        if (!found) {
            problems.push(`[missing-symbol] ${entry.file}: 找不到 ${entry.symbol} 的定义`);
            continue;
        }
        const ranges = registeredRanges.get(entry.file) ?? [];
        ranges.push({ start: found.start, end: found.end, symbol: entry.symbol });
        registeredRanges.set(entry.file, ranges);

        for (const g of missingGuards(found.body, entry.guards ?? [])) {
            problems.push(
                `[stale-guard] ${entry.file}:${found.lineStart} ${entry.symbol}: 守卫子串缺失 ${JSON.stringify(g)}`,
            );
        }

        for (const p of entry.paths ?? []) {
            const r = classifyPathExpectation(entry.method, p.path, p.expect, routes);
            if (!r.ok) {
                problems.push(`[${r.kind}] ${entry.file} ${entry.symbol}: ${r.detail}`);
            } else if (r.kind === "bucket") {
                observedBuckets[r.bucket] = (observedBuckets[r.bucket] ?? 0) + 1;
            }
        }
    }

    // --- 3) 覆盖率守卫 ---
    const ignored = new Set((ledger.ignoredSites ?? []).map((s) => s.file));
    for (const file of walkSrc(SRC_DIR)) {
        const rel = relPosix(file);
        if (ignored.has(rel)) continue;
        const source = fs.readFileSync(file, "utf8");
        for (const site of collectConstructionSites(source)) {
            const inRange = (registeredRanges.get(rel) ?? []).some((r) => site.index >= r.start && site.index <= r.end);
            if (!inRange) {
                problems.push(
                    `[unregistered-site] ${rel}:${site.line} ${site.rule} 构造点未登记（登记到台账或加 ignoredSites）`,
                );
            }
        }
    }

    // --- 桶棘轮 ---
    const bucketIssues = diffBuckets(ledger.buckets ?? {}, observedBuckets);
    for (const issue of bucketIssues) {
        problems.push(`[${issue.kind}] ${issue.detail}`);
    }

    if (refresh) {
        if (problems.some((p) => !p.startsWith("[bucket-"))) {
            console.error("❌ --refresh 被拒绝：存在非桶类问题，先修好它们：");
            console.error(problems.map((p) => `   ${p}`).join("\n"));
            process.exit(1);
        }
        ledger.buckets = observedBuckets;
        ledger.generatedAt = new Date().toISOString();
        writeJsonFormatted(LEDGER_FILE, ledger);
        process.stdout.write(`check-url-constructors: 桶计数已刷新 → ${JSON.stringify(observedBuckets)}。\n`);
        process.exit(0);
    }

    if (problems.length > 0) {
        process.stderr.write(
            "check-url-constructors: URL 构造器台账未闭环（批次 K2）:\n" +
                problems.map((p) => `  ${p}`).join("\n") +
                "\n",
        );
        process.exit(1);
    }

    const bucketSummary = Object.entries(observedBuckets)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
    process.stdout.write(
        `check-url-constructors: OK，${(ledger.entries ?? []).length} 条登记全部命中；` +
            `具名桶 ${bucketSummary || "（空）"}。\n`,
    );
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
