#!/usr/bin/env node
/*
 * 后端路由契约 ↔ SDK 封装面 差异扫描器  (v2)
 *
 * 为什么需要三级证据
 * ─────────────────
 * "后端有这条路由、SDK 是否封装了"在本仓不能用单一信号回答，因为：
 *
 *   L1 声明面  src/xx/__generated__/route-table.ts  由 codegen 从 ledger 全量渲染，
 *              **有表 ≠ 有调用方**（门禁自己在 12 个模块上标了 WAIVED / no consumer）。
 *   L2 调用面  Manager 的 (prefix, path) 调用点。这是最强的封装证据，但只能抓到
 *              **字面量路径**；本仓大量路径来自构造器函数，抓不到。
 *   L3 构造面  路径构造器返回的字符串（如 utils.encodeUri("/profile/$userId")
 *              或 buildSecureBackupPath → "/keys/backup/secure/$backupId"）。
 *              能证明"这条路由被 SDK 主动构造过"，但不保证有 caller，也不保证
 *              调用时用的前缀和构造时一致（故单列为"构造证据"）。
 *
 * 因此本报告输出三级证据矩阵，覆盖率按 T1∪T2（实现面）与 T3（声明面）分开给，
 * 缺口只认"三级证据全无"的路由。
 *
 * 用法：
 *   node scripts/audit/compare-routes.mjs
 *   node scripts/audit/compare-routes.mjs --output artifacts/sdk-contract-gap-report.md
 *   node scripts/audit/compare-routes.mjs --json /tmp/gap.json --quiet
 *
 * 退出码：0 = 已生成报告；1 = 后端 ledger 缺失（不猜测）
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SDK_ROOT = path.resolve(__dirname, "..", "..");
const SRC_ROOT = path.join(SDK_ROOT, "src");
const WORKSPACE_ROOT = path.resolve(SDK_ROOT, "..");

// ────────────────────────── CLI ──────────────────────────
const argv = process.argv.slice(2);
function flagValue(name, fallback) {
    const hit = argv.find((a) => a === name || a.startsWith(`${name}=`));
    if (!hit) return fallback;
    if (hit.includes("=")) return hit.slice(hit.indexOf("=") + 1);
    return argv[argv.indexOf(hit) + 1] ?? fallback;
}
const QUIET = argv.includes("--quiet");
const BACKEND_LEDGER = path.resolve(
    flagValue(
        "--backend-ledger",
        path.join(WORKSPACE_ROOT, "synapse-rust", "tests", "unit", "fixtures", "ledger_export_sdk", "all.json"),
    ),
);
const SDK_MIRROR = path.resolve(
    flagValue("--sdk-mirror", path.join(SDK_ROOT, "docs", "api-contract", "generated", "route-manifest.all.json")),
);
const OUT_MD = path.resolve(flagValue("--output", path.join(SDK_ROOT, "artifacts", "sdk-contract-gap-report.md")));
const OUT_JSON = flagValue("--json", null);

const log = (...a) => !QUIET && console.log(...a);

/**
 * Format markdown using the project's own prettier, resolved from the SDK root
 * so the repo's .prettierrc / .prettierignore / plugin set all apply.
 *
 * prettier v3 is pure ESM, so it must be pulled in with dynamic `import()`;
 * its `resolveConfig` is async-only (`resolveConfig.sync` was removed in v3).
 *
 * Deliberately non-fatal. This report is advisory output, so a missing or
 * misbehaving prettier must not fail the audit — we fall back to the
 * unformatted (still correct) text and let `pnpm lint:js` be the backstop.
 */
async function formatWithPrettier(text, filePath) {
    try {
        const prettier = await import("prettier");
        const config = (await prettier.resolveConfig(filePath)) ?? {};
        return await prettier.format(text, { ...config, filepath: filePath });
    } catch (err) {
        process.stderr.write(`compare-routes: prettier skipped (${String(err.message).split("\n")[0]})\n`);
        return text;
    }
}
/** 本地时区时间戳（用户 +08:00，不要用 UTC 误导人） */
function localStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function localDate() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const rel = (p) => path.relative(SDK_ROOT, p);

// ────────────────────────── 工具 ──────────────────────────
function walk(dir, filter, acc = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === "node_modules" || e.name === "lib") continue;
            walk(full, filter, acc);
        } else if (filter(full)) acc.push(full);
    }
    return acc;
}

/** `{user_id}` / `${x}` / `:x` / `$userId` → `{}` */
function normalizeParams(p) {
    return p
        .split("?")[0]
        .replace(/\{[^}/]+\}/g, "{}")
        .replace(/\$\{[^}]*\}/g, "{}")
        .replace(/\$[A-Za-z_][\w$]*/g, "{}")
        .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{}")
        .replace(/\/{2,}/g, "/")
        .replace(/\/+$/, "");
}
const key = (method, np) => `${String(method).toUpperCase()} ${np}`;
/** 漂移键：抹掉命名空间段与版本段（`_matrix`/`_synapse`/`v3`/`r0`/`unstable`/`org.matrix.*`），
 *  只留端点签名。用于识别"同一能力、前缀/版本不同"（如 media/r0 vs media/v3、
 *  client/v1/voice vs vendor/v1/voice）。**不能用于覆盖率判定**——版本不可互替。 */
function looseKey(p) {
    return normalizeParams(p)
        .split("/")
        .filter(Boolean)
        .filter((s) => s !== "_matrix" && s !== "_synapse" && s !== ".well-known")
        .filter((s) => !/^(v\d+|r\d+|unstable|org\.matrix\.[\w.]+)$/.test(s))
        .join("/");
}

const NAMESPACES = ["/_matrix/", "/_synapse/", "/.well-known/"];
const isNamespaced = (p) => NAMESPACES.some((n) => p.startsWith(n));

const SERVER_ONLY_RE = [
    /^\/_matrix\/federation\//,
    /^\/_matrix\/app\//,
    /^\/_matrix\/key\//,
    /^\/_synapse\/federation\//,
    /^\/_synapse\/worker/,
    /^\/_synapse\/admin/,
    /^\/_matrix\/admin/,
    /^\/_matrix\/identity\//,
];
const ROOT_RE = [
    /^\/(login|logout|proxy|serviceValidate|proxyValidate|p3\/)/,
    /^\/admin\//,
    /^\/(health|_health|versions)?$/,
];
function scopeOf(p) {
    if (!isNamespaced(p)) return ROOT_RE.some((r) => r.test(p)) ? "ROOT_OR_SSO" : "NON_NAMESPACED";
    if (SERVER_ONLY_RE.some((r) => r.test(p))) return "SERVER_ONLY";
    return "CLIENT_FACING";
}

// ────────────────────────── 1. 后端 ledger ──────────────────────────
if (!fs.existsSync(BACKEND_LEDGER)) {
    console.error(`[compare-routes] 后端 ledger 缺失: ${BACKEND_LEDGER}`);
    console.error("  提示：cd ../synapse-rust && ./scripts/generate_sdk_ledger_fixtures.sh");
    process.exit(1);
}
const backend = JSON.parse(fs.readFileSync(BACKEND_LEDGER, "utf8"));
const backendEntries = backend.entries.map((e) => ({ ...e, norm: normalizeParams(e.path) }));
const backendByKey = new Map();
for (const e of backendEntries)
    if (!backendByKey.has(key(e.method, e.norm))) backendByKey.set(key(e.method, e.norm), e);
const backendByNormPath = new Map(); // normPath -> [entries]，路径级证据（任意 method）
for (const e of backendEntries) {
    if (!backendByNormPath.has(e.norm)) backendByNormPath.set(e.norm, []);
    backendByNormPath.get(e.norm).push(e);
}
log(
    `[1/6] 后端 ledger: ${backendEntries.length} 条 → distinct ${backendByKey.size} (schema v${backend.schema_version}, profile=${backend.state_profile})`,
);

// ────────────────────────── 2. SDK 镜像底座 ──────────────────────────
let mirrorInfo = null;
if (fs.existsSync(SDK_MIRROR)) {
    const mirror = JSON.parse(fs.readFileSync(SDK_MIRROR, "utf8"));
    const mKeys = new Set(mirror.entries.map((e) => key(e.method, normalizeParams(e.path))));
    const bKeys = new Set(backendByKey.keys());
    const missing = backendEntries.filter((e) => !mKeys.has(key(e.method, e.norm)));
    const extra = mirror.entries.filter((e) => !bKeys.has(key(e.method, normalizeParams(e.path))));
    mirrorInfo = {
        file: rel(SDK_MIRROR),
        count: mirror.entry_count,
        commit: mirror.synapse_rust_commit,
        generated_at: mirror.generated_at,
        missing,
        extra,
    };
    log(
        `[2/6] SDK 镜像底座: ${mirror.entry_count} 条 @ ${String(mirror.synapse_rust_commit).slice(0, 8)} → 落后 ${missing.length} / 多出 ${extra.length}`,
    );
} else {
    log(`[2/6] SDK 镜像缺失，跳过底座漂移: ${SDK_MIRROR}`);
}

// ────────────────────────── 3. L1 声明面 ──────────────────────────
const allTs = walk(SRC_ROOT, (f) => f.endsWith(".ts"));
const generatedTs = allTs.filter((f) => f.includes("__generated__"));
const sourceTs = allTs.filter((f) => !f.includes("__generated__"));
const routeTables = generatedTs.filter((f) => f.endsWith("route-table.ts"));

const declared = new Map();
const RT_RE = /\{\s*method:\s*"([A-Z]+)"\s*,\s*path:\s*"([^"]+)"\s*\}/g;
for (const f of routeTables) {
    const text = fs.readFileSync(f, "utf8");
    let m;
    while ((m = RT_RE.exec(text))) {
        const k = key(m[1], normalizeParams(m[2]));
        if (!declared.has(k)) declared.set(k, { method: m[1], path: m[2], file: rel(f) });
    }
}
log(`[3/6] L1 声明面: ${routeTables.length} 张 route-table → distinct ${declared.size}`);

// ────────────────────────── 前缀候选（从源码读，不硬编码） ──────────────────────────
const baseManagerPath = path.join(SRC_ROOT, "managers", "base-manager.ts");
const prefixCandidates = new Set();
if (fs.existsSync(baseManagerPath)) {
    const t = fs.readFileSync(baseManagerPath, "utf8");
    const block = t.match(/KNOWN_PREFIXES[^=]*=\s*\[([\s\S]*?)\]/);
    if (block) for (const m of block[1].matchAll(/"(\/[^"]*)"/g)) prefixCandidates.add(m[1]);
}
for (const p of [
    "/_matrix/client/v3",
    "/_matrix/client/v1",
    "/_matrix/client/r0",
    "/_matrix/client/unstable",
    "/_matrix/media/v3",
    "/_matrix/media/v1",
    "/_synapse/admin/v1",
    "/_synapse/admin",
    "/_synapse/worker",
    "/_matrix/vendor/v1",
    "/_matrix/identity/v2",
    "/_matrix/federation/v1",
    "/_matrix/key/v2",
])
    prefixCandidates.add(p);
log(`[3/6] 前缀候选（BaseManager.KNOWN_PREFIXES + prefix.ts）: ${prefixCandidates.size} 个`);

// ────────────────────────── 4. L2 调用点（AST 结构解析） ──────────────────────────
const ENUM_RE = /(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)\s*\{([\s\S]*?)\n\}/g;
const enumMembers = new Map();
/** 模块级字面量常量（`export const VendorPrefix = "/_matrix/vendor/v1"`）。
 *  必须全局收集：`VendorPrefix` / `THREAD_PREFIX_V1` 这类前缀是**跨文件 import** 的，
 *  仅靠文件内的 const 表解析不到，会导致 prefix 回退成默认 v3，产生"假缺口"。 */
const globalConsts = new Map();
const GLOBAL_CONST_RE = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*"(\/[^"\n]*)"/g;
for (const f of allTs) {
    let m;
    const text = fs.readFileSync(f, "utf8");
    while ((m = ENUM_RE.exec(text))) {
        for (const line of m[2].split("\n")) {
            const mm = line.match(/^\s*([A-Za-z_$][\w$]*)\s*=\s*"([^"]*)"/);
            if (mm) enumMembers.set(`${m[1]}.${mm[1]}`, mm[2]);
        }
    }
    GLOBAL_CONST_RE.lastIndex = 0;
    while ((m = GLOBAL_CONST_RE.exec(text))) if (!globalConsts.has(m[1])) globalConsts.set(m[1], m[2]);
}

// 从源码常量里再补两类前缀，避免"前缀是动态拼的 → 误判成缺口"：
//  a) 任何以 /_matrix、/_synapse 开头且无占位符的常量（如 THREAD_PREFIX_V1 / PRESENCE_PREFIX）
//  b) MSC 不稳定特性名常量（`org.matrix.msc4140`）→ /_matrix/client/unstable/<name>
//     （本仓 delayed_events / rendezvous / threads 都经 buildUnstableFeaturePrefix(...) 拼出）
for (const v of globalConsts.values()) {
    if (isNamespaced(v) && !v.includes("{") && v.split("/").filter(Boolean).length <= 4) prefixCandidates.add(v);
}
// MSC 特性名常量本身**不是**路径（`const UNSTABLE_MSC4140_DELAYED_EVENTS = "org.matrix.msc4140"`），
// 上面的路径常量表捕不到，需单独扫；真实前缀由 buildUnstableFeaturePrefix() 拼成
// `/_matrix/client/unstable/<feature>`。
const MSC_FEATURE_RE = /(?:const|let)\s+[A-Za-z_$][\w$]*\s*(?::[^=\n]+)?=\s*"((?:org\.matrix|uk\.tcpip)[\w.]*)"/g;
for (const f of allTs) {
    MSC_FEATURE_RE.lastIndex = 0;
    const text = fs.readFileSync(f, "utf8");
    let m;
    while ((m = MSC_FEATURE_RE.exec(text))) prefixCandidates.add(`/_matrix/client/unstable/${m[1]}`);
}
log(`[4/6] 前缀候选（KNOWN_PREFIXES + prefix.ts + 源码常量 + MSC 特性名）: ${prefixCandidates.size} 个`);

function textOfStringLike(node) {
    if (!node) return null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) {
        let out = node.head.text;
        for (const s of node.templateSpans) out += "{}" + s.literal.text;
        return out;
    }
    return null;
}
function collectStringConsts(sf) {
    const map = new Map();
    for (const st of sf.statements) {
        if (!ts.isVariableStatement(st)) continue;
        for (const d of st.declarationList.declarations) {
            if (!ts.isIdentifier(d.name) || !d.initializer) continue;
            const init = d.initializer;
            const direct = textOfStringLike(init);
            if (direct !== null) map.set(d.name.text, direct);
            else if (ts.isObjectLiteralExpression(init)) {
                for (const p of init.properties) {
                    if (ts.isPropertyAssignment(p) && p.name.getText(sf) === "prefix") {
                        const v = unwrapPrefix(p.initializer, sf, map);
                        if (v) map.set(d.name.text, v);
                    }
                }
            }
        }
    }
    return map;
}
function unwrapPrefix(node, sf, consts, depth = 0) {
    if (!node || depth > 6) return null;
    const direct = textOfStringLike(node);
    if (direct !== null) return direct;
    if (ts.isPropertyAccessExpression(node)) {
        const hit = enumMembers.get(`${node.expression.getText(sf)}.${node.name.getText(sf)}`);
        if (hit) return hit;
        const viaObj = consts.get(node.expression.getText(sf)) ?? globalConsts.get(node.expression.getText(sf));
        return viaObj && viaObj.startsWith("/") ? viaObj : null;
    }
    if (ts.isIdentifier(node)) {
        const v = consts.get(node.text) ?? globalConsts.get(node.text);
        return v && v.startsWith("/") ? v : null;
    }
    if (ts.isParenthesizedExpression(node)) return unwrapPrefix(node.expression, sf, consts, depth + 1);
    // 拼接式前缀：`ClientPrefix.Unstable + "/org.matrix.msc2965"`。
    // 不处理这一形态会把"前缀是拼出来的、路径完全正确"的路由误判成缺口
    // （src/client-auth.ts 的 /auth_issuer 就是这么被误报的）。
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = unwrapPrefix(node.left, sf, consts, depth + 1);
        const right = unwrapPrefix(node.right, sf, consts, depth + 1);
        if (left === null || right === null) return null;
        const joined = left.replace(/\/+$/, "") + (right.startsWith("/") ? right : `/${right}`);
        return joined.startsWith("/") ? joined : null;
    }
    return null;
}
/** 取函数形参的可选类型注解（用于解析 `prefix: string = VendorPrefix` 的默认值表达式） */
function paramDefaultsOf(fn) {
    const map = new Map();
    for (const p of fn.parameters ?? []) {
        if (ts.isIdentifier(p.name) && p.initializer) map.set(p.name.text, p.initializer);
    }
    return map;
}
function resolveConcat(node, sf, consts, depth = 0) {
    if (!node || depth > 6) return null;
    const direct = textOfStringLike(node);
    if (direct !== null) return direct;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const l = resolveConcat(node.left, sf, consts, depth + 1);
        const r = resolveConcat(node.right, sf, consts, depth + 1);
        if (l === null || r === null) return null;
        return l.endsWith("/") || r.startsWith("/") ? `${l}${r}` : `${l}/${r}`;
    }
    if (ts.isIdentifier(node)) return consts.get(node.text) ?? null;
    return null;
}

const callsites = new Map(); // key -> {method, path, file, line, idiom}
function record(method, rawPath, prefix, sf, file, node, idiom) {
    if (!rawPath || !rawPath.startsWith("/")) return;
    // prefix 可以是单个字符串，也可以是**多候选**数组：`useStable ? ClientPrefix.V1 :
    // ClientPrefix.Unstable + "/org.matrix.msc2965"` 这类三元前缀两个分支都合法，
    // 任一命中就算已封装。
    const supplied = (Array.isArray(prefix) ? prefix : prefix ? [prefix] : []).filter(
        (p) => typeof p === "string" && p.length > 0,
    );
    const candidates = isNamespaced(rawPath) ? [rawPath] : supplied.length ? supplied : ["/_matrix/client/v3"];
    for (const candidate of candidates) {
        const p = isNamespaced(rawPath) ? rawPath : `${candidate.replace(/\/+$/, "")}/${rawPath.replace(/^\/+/, "")}`;
        if (!isNamespaced(p)) continue;
        const k = key(method || "*", normalizeParams(p));
        if (callsites.has(k)) continue;
        callsites.set(k, {
            method: method || "*",
            path: p,
            file: rel(file),
            line: sf ? sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 : null,
            idiom,
        });
    }
}

/** 解析 `prefix:` 的**多候选**取值（三元表达式两个分支都收）。 */
function unwrapPrefixCandidates(node, sf, consts, depth = 0) {
    if (!node || depth > 6) return [];
    if (ts.isConditionalExpression(node)) {
        return [
            ...unwrapPrefixCandidates(node.whenTrue, sf, consts, depth + 1),
            ...unwrapPrefixCandidates(node.whenFalse, sf, consts, depth + 1),
        ];
    }
    const one = unwrapPrefix(node, sf, consts, depth);
    return one ? [one] : [];
}

/**
 * 从调用实参里捞 options 对象上的 `prefix`。
 * `request(Method.Get, "/auth_issuer", undefined, undefined, { prefix: ... })` ——
 * 前缀挂在第 5 个实参上，只盯着路径实参是看不到的。
 */
function prefixCandidatesFromCallArgs(node, sf, consts) {
    const out = [];
    for (const arg of node.arguments) {
        if (!ts.isObjectLiteralExpression(arg)) continue;
        for (const prop of arg.properties) {
            if (ts.isPropertyAssignment(prop) && prop.name.getText(sf) === "prefix") {
                out.push(...unwrapPrefixCandidates(prop.initializer, sf, consts));
            }
        }
    }
    return out;
}

const PREFIX_BY_FN = {
    adminRequest: "/_synapse/admin/v1",
    authedAdminRequest: "/_synapse/admin/v1",
    v2Request: "/_synapse/admin",
    workerRequest: "/_synapse/worker",
};

function nearbyPrefix(node, text, window = 800) {
    const chunk = text.slice(Math.max(0, node.getStart() - window), node.getStart());
    const m = [...chunk.matchAll(/prefix:\s*([^,\n}]+)/g)].pop();
    if (!m) return null;
    const expr = m[1].trim();
    const em = expr.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/);
    if (em) return enumMembers.get(`${em[1]}.${em[2]}`) ?? null;
    const sm = expr.match(/["'`]([^"'`]+)["'`]/);
    if (sm && sm[1].startsWith("/")) return sm[1];
    const im = expr.match(/^([A-Za-z_$][\w$]*)$/);
    if (im) {
        const a = text.match(new RegExp(`(?:const|let)\\s+${im[1]}\\s*=\\s*["'\`]([^"'\`]+)["'\`]`));
        if (a) return a[1];
        const b = text.match(new RegExp(`(?:const|let)\\s+${im[1]}\\s*=\\s*\\{\\s*prefix:\\s*["'\`]([^"'\`]+)["'\`]`));
        if (b) return b[1];
    }
    return null;
}

for (const f of sourceTs) {
    const text = fs.readFileSync(f, "utf8");
    if (!text.includes("/")) continue;
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
    const consts = collectStringConsts(sf);
    /** 逐层累积的函数形参默认值栈，用于解析 `prefix,`（shorthand）+ 形参默认 `= VendorPrefix` */
    const paramStack = [];
    const resolvePrefixNode = (node) => {
        const direct = unwrapPrefix(node, sf, consts);
        if (direct) return direct;
        // 形参默认值（`prefix: string = VendorPrefix`）→ 沿栈由内向外解析
        if (ts.isIdentifier(node)) {
            const nm = node.text;
            for (let i = paramStack.length - 1; i >= 0; i--) {
                const init = paramStack[i].get(nm);
                if (init) {
                    const v = unwrapPrefix(init, sf, consts);
                    if (v) return v;
                }
            }
        }
        return null;
    };
    const visit = (node) => {
        const pushed = ts.isFunctionLike(node) || ts.isClassLike(node);
        if (pushed) paramStack.push(paramDefaultsOf(node));
        if (ts.isObjectLiteralExpression(node)) {
            let pathRaw = null,
                prefixRaw = null,
                method = null;
            for (const prop of node.properties) {
                if (ts.isShorthandPropertyAssignment(prop)) {
                    // `{ method, path, prefix, }` —— 本仓最常见的写法，必须处理，
                    // 否则 prefix 回退成默认 v3，vendor/admin 前缀全部解析错。
                    if (prop.name.getText(sf) === "prefix") prefixRaw = resolvePrefixNode(prop.name);
                    continue;
                }
                if (!ts.isPropertyAssignment(prop)) continue;
                const name = prop.name.getText(sf);
                if (name === "path")
                    pathRaw = textOfStringLike(prop.initializer) ?? resolveConcat(prop.initializer, sf, consts);
                else if (name === "prefix") prefixRaw = resolvePrefixNode(prop.initializer);
                else if (name === "method")
                    method = prop.initializer
                        .getText(sf)
                        .replace(/^Method\./, "")
                        .toUpperCase();
            }
            if (pathRaw) {
                let pref = prefixRaw;
                if (!isNamespaced(pathRaw) && !pref) pref = nearbyPrefix(node, text);
                record(method, pathRaw, pref, sf, f, node, "object-literal {path}");
            }
        }
        if (ts.isCallExpression(node)) {
            // 被调函数名：既可能是 `this.request(...)`（PropertyAccess），也可能是
            // `request<T>(...)`（import 进来的裸标识符）。**只认前者会整段漏掉裸调用**——
            // src/client-auth.ts 的 /auth_issuer 就是这么被漏成"缺口"的。
            const fn = ts.isPropertyAccessExpression(node.expression)
                ? node.expression.name.getText(sf)
                : ts.isIdentifier(node.expression)
                  ? node.expression.text
                  : null;
            if (PREFIX_BY_FN[fn] && node.arguments.length >= 2) {
                const method = node.arguments[0]
                    .getText(sf)
                    .replace(/^Method\./, "")
                    .replace(/["']/g, "")
                    .toUpperCase();
                const pRaw = textOfStringLike(node.arguments[1]) ?? resolveConcat(node.arguments[1], sf, consts);
                if (pRaw) record(method, pRaw, PREFIX_BY_FN[fn], sf, f, node, `${fn}()`);
            }
            if ((fn === "authedRequest" || fn === "request") && node.arguments.length >= 2) {
                const a0 = node.arguments[0];
                const a1 = node.arguments[1];
                if (ts.isPropertyAccessExpression(a0)) {
                    const pRaw = textOfStringLike(a1) ?? resolveConcat(a1, sf, consts);
                    const pref = prefixCandidatesFromCallArgs(node, sf, consts);
                    if (pRaw)
                        record(
                            a0.name.getText(sf).toUpperCase(),
                            pRaw,
                            pref.length ? pref : null,
                            sf,
                            f,
                            node,
                            `${fn}(Method, path)`,
                        );
                }
            }
            // 路径构造器字面量：utils.encodeUri("/path/$x")、buildXxxPath(...)、sp(...)
            if (node.arguments.length >= 1) {
                const lit = textOfStringLike(node.arguments[0]);
                const callee = node.expression.getText(sf).replace(/\s+/g, "");
                if (lit && lit.startsWith("/") && /encodeUri|encodeURI|Path$|^sp$|^srp$|getUrl$/i.test(callee)) {
                    record(null, lit, null, sf, f, node, `builder: ${callee}()`);
                }
            }
        }
        ts.forEachChild(node, visit);
        if (pushed) paramStack.pop();
    };
    visit(sf);
}
log(`[4/6] L2 调用点: ${sourceTs.length} 源文件 → distinct ${callsites.size}`);

// 调试出口：启发式解析器出错时，先看它**实际记下了什么**再改代码。
//   ROUTE_AUDIT_DEBUG=auth_issuer node scripts/audit/compare-routes.mjs --quiet
if (process.env.ROUTE_AUDIT_DEBUG) {
    const dbg = (...a) => process.stdout.write(`${a.join(" ")}\n`);
    const rx = new RegExp(process.env.ROUTE_AUDIT_DEBUG);
    for (const [k, v] of callsites) {
        if (rx.test(v.path) || rx.test(v.file)) dbg(`  [debug] ${k}  <- ${v.file}:${v.line}  (${v.idiom})`);
    }
    dbg(`  [debug] ClientPrefix.Unstable = ${enumMembers.get("ClientPrefix.Unstable") ?? "(未捕获)"}`);
    dbg(`  [debug] prefix 候选含 msc2965: ${[...prefixCandidates].filter((p) => /msc2965/.test(p)).length}`);
}

// ────────────────────────── 5. L3 构造面（全量路径字面量） ──────────────────────────
const ctorEvidence = new Map(); // normPath -> {literal, file, line, snippet}
/** 版本不敏感键：把路径里的版本段（v1/v3/r0/r1/unstable/…）也归一化为 `{}`。
 *  仅用于识别"同一端点、前缀由变量/参数决定"（如
 *  `/_matrix/media/${version}/download/{s}/{m}`，version 默认 v3、可传 r0）。
 *  **绝不能用于覆盖率判定**——它是弱证据，只说明"该端点被参数化构造过"。 */
const vlessKey = (p) =>
    normalizeParams(p)
        .split("/")
        .map((s) => (/^(v\d+|r\d+|unstable)$/.test(s) ? "{}" : s))
        .join("/");
const vlessEvidence = new Map(); // vlessKey -> {literal, file, line}
const PATH_LIKE_RE = /["'`](\/(?!\/)[A-Za-z0-9_$@.:{}$-][^"'`\n]*)["'`]/g;
for (const f of sourceTs) {
    const text = fs.readFileSync(f, "utf8");
    if (!text.includes('"/') && !text.includes("`/") && !text.includes("'/")) continue;
    const lines = text.split("\n");
    let m;
    PATH_LIKE_RE.lastIndex = 0;
    while ((m = PATH_LIKE_RE.exec(text))) {
        // 模板串里的 `${encodeURIComponent(roomId)}` 会带出 () 和 ${}，
        // 必须先归一化再判定，否则 voice/key-rotation 这类"路径完全正确、
        // 只是插值写法复杂"的路由会被误判成缺口。
        const lit = m[1].replace(/\$\{[^}]*\}/g, "{}");
        if (/[\s<>\\]/.test(lit)) continue;
        const line = text.slice(0, m.index).split("\n").length;
        const candidates = isNamespaced(lit)
            ? [lit]
            : [...prefixCandidates].map((p) => `${p.replace(/\/+$/, "")}/${lit.replace(/^\/+/, "")}`);
        for (const c of candidates) {
            const np = normalizeParams(c);
            if (backendByNormPath.has(np) && !ctorEvidence.has(np)) {
                ctorEvidence.set(np, {
                    literal: lit,
                    file: rel(f),
                    line,
                    snippet: (lines[line - 1] ?? "").trim().slice(0, 120),
                });
            } else if (backendByNormPath.has(np)) {
                // 保留**最长**字面量作为证据：越长的 literal 越可能真对应本端点
                const prev = ctorEvidence.get(np);
                if (lit.length > prev.literal.length) {
                    ctorEvidence.set(np, {
                        literal: lit,
                        file: rel(f),
                        line,
                        snippet: (lines[line - 1] ?? "").trim().slice(0, 120),
                    });
                }
            }
            const vl = vlessKey(c);
            if (!vlessEvidence.has(vl)) {
                vlessEvidence.set(vl, {
                    literal: lit,
                    file: rel(f),
                    line,
                    snippet: (lines[line - 1] ?? "").trim().slice(0, 120),
                });
            }
        }
    }
}
log(`[5/6] L3 构造面: 精确命中后端路径 ${ctorEvidence.size} 条 / 版本不敏感命中 ${vlessEvidence.size} 条`);

// ── L3b 前缀片段证据 ──
// 某些端点不是以 `{ path }` 请求对象构造的，而是先拼 prefix、再把参数追加成 URL，
// 例如 src/media/index.ts 的 getDownloadUrl：
//     const prefix = `/_matrix/media/${version}/download`;   // version 默认 v3、可传 r0
//     new URL(`${prefix}/${server}/${mediaId}${filename}`, baseUrl)
// 这种"片段模板"必须单列，否则 r0/v3 下载会一起被误判成缺口。
const fragmentEvidence = [];
{
    const FRAG_RE = /["'`](\/(?:_matrix|_synapse)\/[^"'`\n]*\$\{[^}]*\}[^"'`\n]*)["'`]/g;
    for (const f of sourceTs) {
        const text = fs.readFileSync(f, "utf8");
        if (!text.includes("${")) continue;
        FRAG_RE.lastIndex = 0;
        let m;
        while ((m = FRAG_RE.exec(text))) {
            const raw = m[1];
            const lit = raw.replace(/\$\{[^}]*\}/g, "{}");
            if (/[\s<>\\]/.test(lit)) continue;
            const vl = vlessKey(lit).replace(/\/+$/, "");
            // 至少要有 3 段（命名空间 + 版本位 + 至少一个具体段），避免过宽匹配
            if (vl.split("/").filter(Boolean).length < 3) continue;
            const line = text.slice(0, m.index).split("\n").length;
            fragmentEvidence.push({ vl, literal: raw, file: rel(f), line });
        }
    }
}
function fragmentHit(path) {
    const vl = vlessKey(path);
    return fragmentEvidence.find((fr) => vl.startsWith(fr.vl)) ?? null;
}
log(`[5/6] L3b 前缀片段证据: ${fragmentEvidence.length} 个模板`);

// ────────────────────────── 6. 比对 ──────────────────────────
const declaredKeys = new Set(declared.keys());
const callsiteKeys = new Set(callsites.keys());
const looseCallsites = new Map();
for (const [k, v] of callsites) looseCallsites.set(looseKey(v.path), k);

const rows = backendEntries.map((e) => {
    const k = key(e.method, e.norm);
    const t1 = callsiteKeys.has(k) ? callsites.get(k) : null;
    const t3 = declaredKeys.has(k) ? declared.get(k) : null;
    const t2 = ctorEvidence.get(e.norm) ?? null;
    const drift =
        !t1 && !t2 && looseCallsites.has(looseKey(e.path)) ? callsites.get(looseCallsites.get(looseKey(e.path))) : null;
    return {
        ...e,
        scope: scopeOf(e.norm),
        t1,
        t2,
        t3,
        drift,
        conditional: vlessEvidence.get(vlessKey(e.norm)) ?? fragmentHit(e.norm),
    };
});

const isImpl = (r) => Boolean(r.t1 || r.t2);
/** 同签名的"已实现兄弟版本"索引：looseKey 抹掉版本段后相同的路由。
 *  用于把 `/_matrix/media/r0/download/...` 这类**版本别名**（SDK 默认只打 v3）
 *  与真缺口区分开——别名不是缺口，但也不是"已封装"。 */
const implementedByLoose = new Map();
for (const r of rows) {
    if (!isImpl(r)) continue;
    const lk = looseKey(r.path);
    if (!implementedByLoose.has(lk)) implementedByLoose.set(lk, r);
}
const bucketOf = (r) => {
    if (r.t1) return "T1_CALLSITE";
    if (r.t2) return "T2_CONSTRUCTOR";
    if (r.t3) return "T3_DECLARED_ONLY";
    if (r.drift) return "DRIFT";
    // 三级精确证据全无，但存在"版本段参数化"的构造点 → 条件覆盖，不是硬缺口
    if (r.conditional) return "CONDITIONAL";
    // 同签名兄弟路由已实现 → 版本/命名空间别名（如 media r0 ↔ v3）
    if (implementedByLoose.has(looseKey(r.path))) return "VERSION_ALIAS";
    return "GAP";
};
const buckets = {};
for (const r of rows) (buckets[bucketOf(r)] ||= []).push(r);

const scopeCount = (arr, s) => arr.filter((r) => r.scope === s).length;
const clientRows = rows.filter((r) => r.scope === "CLIENT_FACING");
const clientImpl = clientRows.filter(isImpl);
const b = (name) => buckets[name] ?? [];
const clientGap = b("GAP").filter((r) => r.scope === "CLIENT_FACING");
const clientDeclaredOnly = b("T3_DECLARED_ONLY").filter((r) => r.scope === "CLIENT_FACING");
const clientDrift = b("DRIFT").filter((r) => r.scope === "CLIENT_FACING");
const clientT2Count = b("T2_CONSTRUCTOR").filter((r) => r.scope === "CLIENT_FACING").length;
const declaredCovered = rows.filter((r) => r.t3).length;

const modOf = (e) => (e.registered_by || "unknown").split("::")[0];
function groupCount(arr, fn = modOf) {
    const m = new Map();
    for (const e of arr) {
        const k = fn(e);
        const g = m.get(k) || { n: 0, items: [] };
        g.n++;
        g.items.push(e);
        m.set(k, g);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
}
const idiomHistogram = [...callsites.values()].reduce((a, v) => ((a[v.idiom] = (a[v.idiom] || 0) + 1), a), {});

const summary = {
    backend: {
        file: path.relative(WORKSPACE_ROOT, BACKEND_LEDGER),
        count: backendEntries.length,
        distinct: backendByKey.size,
        schema: backend.schema_version,
        profile: backend.state_profile,
    },
    mirror: mirrorInfo && {
        file: mirrorInfo.file,
        count: mirrorInfo.count,
        commit: mirrorInfo.commit,
        generated_at: mirrorInfo.generated_at,
        missing: mirrorInfo.missing.length,
        extra: mirrorInfo.extra.length,
    },
    sdk: {
        routeTables: routeTables.length,
        t3Declared: declared.size,
        sourceFiles: sourceTs.length,
        t1Callsites: callsites.size,
        t2ConstructorHits: ctorEvidence.size,
        prefixCandidates: prefixCandidates.size,
    },
    idiomHistogram,
    buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
    gapScopeBreakdown: Object.entries(b("GAP").reduce((a, r) => ((a[r.scope] = (a[r.scope] || 0) + 1), a), {})).sort(
        (a, b) => b[1] - a[1],
    ),
    client: {
        total: clientRows.length,
        implemented: clientImpl.length,
        t1: clientRows.filter((r) => r.t1).length,
        t2Only: clientRows.filter((r) => !r.t1 && r.t2).length,
        declaredOnly: clientDeclaredOnly.length,
        drift: clientDrift.length,
        gap: clientGap.length,
    },
    declaredCoverage: {
        covered: declaredCovered,
        total: backendByKey.size,
        pct: +((declaredCovered / backendByKey.size) * 100).toFixed(1),
    },
};

log(`[6/6] 比对完成`);
log(
    `      T1 调用点 ${b("T1_CALLSITE")?.length ?? 0} / T2 构造 ${b("T2_CONSTRUCTOR")?.length ?? 0} / T3 仅声明 ${b("T3_DECLARED_ONLY")?.length ?? 0} / 漂移 ${b("DRIFT")?.length ?? 0} / 缺口 ${b("GAP")?.length ?? 0}`,
);
log(
    `      客户端面 ${clientRows.length}：实现证据 ${clientImpl.length}（${((clientImpl.length / clientRows.length) * 100).toFixed(1)}%），仅声明 ${clientDeclaredOnly.length}，漂移 ${clientDrift.length}，缺口 ${clientGap.length}`,
);

// ────────────────────────── 报告 ──────────────────────────
const mdTable = (headers, body) =>
    [
        `| ${headers.join(" | ")} |`,
        `| ${headers.map(() => "---").join(" | ")} |`,
        // 单元格里的裸 `|` 会破坏表格结构（grep 命令、正则里很常见），统一转义
        ...body.map((r) => `| ${r.map((c) => String(c).replace(/\|/g, "\\|")).join(" | ")} |`),
    ].join("\n");
const ev = (r) => {
    if (r.t1) return `\`${r.t1.file}:${r.t1.line}\` (${r.t1.idiom})`;
    if (r.t2) return `\`${r.t2.file}:${r.t2.line}\` (${r.t2.literal})`;
    if (r.t3) return `\`${r.t3.file}\`（仅声明）`;
    if (r.drift) return `漂移→\`${r.drift.path}\` \`${r.drift.file}:${r.drift.line}\``;
    return "—";
};

const L = [];
L.push(`# SDK 契约缺口报告：后端路由 ↔ SDK 封装面`);
L.push("");
L.push(`> 生成时间：${localStamp()}`);
L.push(
    `> 后端事实来源：\`${summary.backend.file}\`（RouteLedger schema v${backend.schema_version}，profile=\`${backend.state_profile}\`）`,
);
L.push(
    `> SDK 镜像底座：\`${summary.mirror?.file ?? "（缺失）"}\`${summary.mirror ? ` @ \`${String(summary.mirror.commit).slice(0, 8)}\`` : ""}`,
);
L.push(`> 生成器：\`matrix-js-sdk/scripts/audit/compare-routes.mjs\`（可重跑，无人工维护的映射表）`);
L.push("");
L.push(`## 0. 方法论：为什么"后端有 / SDK 未封装"需要三级证据`);
L.push("");
L.push(`本仓存在**多层**容易互相冒充的"路由集合"：`);
L.push("");
L.push(
    mdTable(
        ["层", "载体", "能回答", "**不能**回答"],
        [
            [
                `后端事实面`,
                "synapse-rust `RouteLedger` 导出（`ledger_export_sdk/all.json`）",
                "服务端真实注册的 `(method, path)`",
                "SDK 是否封装",
            ],
            [
                `SDK 镜像底座`,
                "`docs/api-contract/generated/route-manifest.all.json`",
                "SDK 侧 ledger 副本是否同步",
                "是否封装（纯副本，逐字节镜像）",
            ],
            [
                `L1 声明面`,
                "`src/**/__generated__/route-table.ts`",
                "codegen 渲染出了哪些路由常量",
                "**有没有调用方**——本仓 12 个模块被门禁标注 `WAIVED / no route-table consumer`，即「有表 ≠ 有人读」",
            ],
            [
                `L2 调用面`,
                "`src/**/*.ts` 的 `(prefix, path)` 调用点",
                "**真实发起过请求的路由**",
                "路径来自构造器函数时抓不到",
            ],
            [
                `L3 构造面`,
                '路径构造器返回的字面量（`utils.encodeUri("/profile/$userId")`、`buildSecureBackupPath` 等）',
                "该路由被 SDK 主动构造过",
                "无 caller；构造时前缀未必等于调用时前缀",
            ],
        ],
    ),
);
L.push("");
L.push(`因此覆盖率**分两个口径**给，且"缺口"只认三级证据全无：`);
L.push("");
L.push(
    mdTable(
        ["口径", "定义", "用途"],
        [
            [`声明面覆盖率`, "后端 distinct 路由 ∩ route-table 声明", "底座健康度（codegen 是否跟得上后端）"],
            [`实现面覆盖率`, "后端客户端面路由 ∩ (T1 调用点 ∪ T2 构造)", "**SDK 真实封装度**（本报告主指标）"],
        ],
    ),
);
L.push("");
L.push(`**L2 解析器覆盖的惯用法**：`);
L.push("");
L.push(
    mdTable(
        ["惯用法", "条数"],
        Object.entries(idiomHistogram)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => [`\`${k}\``, `${v}`]),
    ),
);
L.push("");
L.push(`**口径边界（诚实声明）**`);
L.push("- 版本前缀**不**互替：`v1` / `v3` / `r0` / `unstable` 视为不同租约，避免把 v1 与 v3 误判为同一端点。");
L.push(
    `- L2 只解析**字面量/纯字面量拼接**路径；变量路径（\`authedRequest(Method.Get, path)\`）无法静态求值，由 L3 兜底。`,
);
L.push(
    `- L3 按 \`BaseManager.KNOWN_PREFIXES\` + prefix.ts 枚举共 **${prefixCandidates.size}** 个候选前缀逐个尝试拼接，因此 **L3 命中不保证前缀正确**，仅证明"这条路径被构造过"。`,
);
L.push(`- L3 **不校验 HTTP method**（路径级证据），故 T2 桶里可能包含同一路径的不同 method 变体。`);
L.push(
    `- 因此 **T2 是强证据、但不是"已接通"的证明**；T3 是弱证据。本报告的"缺口"= 三者全无——**不会把已封装路由漏报为缺口**，但存在把"构造了却没接通"记为已实现的风险，已在 §3 单列待人工确认。`,
);
L.push("");
L.push(`---`);
L.push("");
L.push(`## 1. 结论速览`);
L.push("");
L.push(
    mdTable(
        ["维度", "数量", "说明"],
        [
            ["后端注册路由（事实面）", `**${backendEntries.length}**`, `distinct ${backendByKey.size}`],
            ["└ 客户端面 `CLIENT_FACING`", `**${clientRows.length}**`, "前端 SDK 应封装的面"],
            [
                "└ 服务端/运维面 `SERVER_ONLY`",
                `${scopeCount(rows, "SERVER_ONLY")}`,
                "federation / appservice / key 交换 / admin，**不应**封装",
            ],
            ["└ 根级与 SSO `ROOT_OR_SSO`", `${scopeCount(rows, "ROOT_OR_SSO")}`, "探活、CAS/SSO 重定向，浏览器处理"],
            ["└ 非 Matrix 命名空间 `NON_NAMESPACED`", `${scopeCount(rows, "NON_NAMESPACED")}`, "—"],
            [
                `**实现面覆盖（T1∪T2，客户端面）**`,
                `**${clientImpl.length} / ${clientRows.length} = ${((clientImpl.length / clientRows.length) * 100).toFixed(1)}%**`,
                "主指标",
            ],
            ["└ 其中 T1 有真实调用点", `${summary.client.t1}`, "最强证据"],
            ["└ 其中 T2 仅构造证据", `${summary.client.t2Only}`, "见 §3 需复核"],
            [
                `**声明面覆盖（T3，全后端）**`,
                `**${summary.declaredCoverage.pct}%**`,
                `${summary.declaredCoverage.covered}/${summary.declaredCoverage.total}`,
            ],
            [`**缺口（三级证据全无）**`, `**${b("GAP")?.length ?? 0}**`, `其中客户端面 ${clientGap.length}`],
            ["版本/前缀漂移", `${b("DRIFT")?.length ?? 0}`, "签名相同、前缀不同"],
        ],
    ),
);
L.push("");
L.push(`### 1.1 后端路由的证据分布（全量）`);
L.push("");
L.push(
    mdTable(
        ["证据等级", "条数", "含义"],
        [
            [`T1 调用点命中`, `${b("T1_CALLSITE")?.length ?? 0}`, "Manager 真实发起请求"],
            [`T2 构造命中`, `${b("T2_CONSTRUCTOR")?.length ?? 0}`, "有路径构造器，无精确调用点"],
            [`T3 仅声明`, `${b("T3_DECLARED_ONLY")?.length ?? 0}`, "route-table 有常量、仓内无调用方"],
            [`漂移`, `${b("DRIFT")?.length ?? 0}`, "末段签名一致、前缀/版本不同"],
            [`缺口`, `${b("GAP")?.length ?? 0}`, "三级证据全无"],
        ],
    ),
);
L.push("");
L.push(`### 1.2 处置清单（按优先级）`);
L.push("");
L.push(
    mdTable(
        ["优先级", "动作", "为什么", "验证方式"],
        [
            [
                "**P0**",
                `刷新 SDK 底座：\`pnpm contract:sync && pnpm contract:codegen\``,
                summary.mirror
                    ? `SDK 镜像已落后后端 **${summary.mirror.missing}** 条（镜像停留在 \`${String(summary.mirror.commit).slice(0, 8)}\`）。底座不刷新时，codegen 渲染的 route-table 与"真相"不一致，任何覆盖率数字都不可信。`
                    : "镜像缺失",
                "重跑本脚本，§1.4 归零",
            ],
            [
                "**P1**",
                `补 ${clientGap.length} 条客户端面真缺口（§2）`,
                "已被人工核实为「后端有、SDK 完全无」。其中 `admin/room/{id}/redact` 属运维面，可先确认是否由前端直连。",
                "补完后 §2 归零；`pnpm quality:manager-codegen` 仍绿",
            ],
            [
                "**P1**",
                "对照 Sprint 4 交付范围核实 MSC4155 / MSC4156（§7）",
                "两个不稳定端点在本仓 `src` 中 **0 命中**，与「Sprint 4 已交付」的记忆不一致；需确认是只交付了后端，还是前端走了 `relations` 自建实现。",
                "`grep -rn \"msc4155\\|msc4156\" src --include='*.ts' | grep -v __generated__`",
            ],
            [
                "**P2**",
                `清理 §3 的 ${clientT2Count} 条 T2 弱证据`,
                "这些端点只有构造点、没有可静态求值的调用点，混着「变量路径（真已封装）」与「死构造器（真问题）」两类。",
                "按 §3 结论逐模块抽查，把确认已封装的补进 §7 人工复核表",
            ],
            [
                "**P3**",
                "把 §7 人工复核结论回写进 `contract-module-map`/审计文档",
                "让下轮审计不必重复人工判断；同时 §7.1 的解析器盲区可作为下一版生成器的待办。",
                "本轮结束后重跑，§7 结论与 §2/§3.5 不冲突",
            ],
        ],
    ),
);
L.push("");
L.push(`### 1.3 缺口按范围拆分（决定该不该补）`);
L.push("");
L.push(
    mdTable(
        ["范围", "条数", "是否应在 SDK 封装"],
        summary.gapScopeBreakdown.map(([s, n]) => [
            `\`${s}\``,
            `**${n}**`,
            {
                SERVER_ONLY: "❌ 否 — 服务端/运维面",
                ROOT_OR_SSO: "❌ 否 — 根级探活 / SSO 重定向",
                NON_NAMESPACED: "❌ 否 — 不在 Matrix 命名空间下",
                CLIENT_FACING: "⚠️ **是** — 需逐个判定，见 §2",
            }[s] ?? "?",
        ]),
    ),
);
L.push("");

if (mirrorInfo) {
    L.push(`### 1.4 底座漂移（后端已注册、SDK 镜像未收录）`);
    L.push("");
    if (mirrorInfo.missing.length === 0) L.push("✅ 无漂移。");
    else {
        L.push(
            `SDK 镜像落后后端 **${mirrorInfo.missing.length}** 条（镜像 ${mirrorInfo.count} 条 @ \`${String(mirrorInfo.commit).slice(0, 8)}\`，\`generated_at=${mirrorInfo.generated_at}\`）。`,
        );
        L.push(
            `后果：这些路由在 SDK 侧连**声明**都没有，codegen 也渲染不出来。修复：\`pnpm contract:sync && pnpm contract:codegen\`。`,
        );
        L.push("");
        L.push(
            mdTable(
                ["后端模块", "条数"],
                groupCount(mirrorInfo.missing).map(([k, v]) => [`\`${k}\``, `${v.n}`]),
            ),
        );
        L.push("");
        L.push(`<details><summary>展开逐条（${mirrorInfo.missing.length} 条）</summary>`);
        L.push("");
        L.push(
            mdTable(
                ["Method", "Path", "registered_by", "范围"],
                mirrorInfo.missing.map((e) => [
                    `\`${e.method}\``,
                    `\`${e.path}\``,
                    `\`${e.registered_by}\``,
                    `\`${scopeOf(e.norm)}\``,
                ]),
            ),
        );
        L.push("");
        L.push("</details>");
    }
    if (mirrorInfo.extra.length > 0) {
        L.push("");
        L.push(`#### 反向：SDK 镜像有、后端已无（${mirrorInfo.extra.length} 条，陈旧残留，应清理）`);
        L.push("");
        L.push("<details><summary>展开逐条</summary>");
        L.push("");
        L.push(
            mdTable(
                ["Method", "Path", "registered_by"],
                mirrorInfo.extra.map((e) => [`\`${e.method}\``, `\`${e.path}\``, `\`${e.registered_by}\``]),
            ),
        );
        L.push("");
        L.push("</details>");
    }
    L.push("");
}

// §2 客户端面缺口
L.push(`---`);
L.push("");
L.push(`## 2. 客户端面缺口（三级证据全无）— ${clientGap.length} 条`);
L.push("");
if (clientGap.length === 0) {
    L.push("✅ 客户端面路由均有至少一级证据。");
} else {
    L.push(`判定口径：该 \`(method, path)\` 既无 L2 调用点、也无 L1 声明、也无 L3 路径构造证据。`);
    L.push("");
    groupCount(clientGap).forEach(([mod, g], i) => {
        L.push(`### 2.${i + 1} \`${mod}\` — ${g.n} 条`);
        L.push("");
        L.push(
            mdTable(
                ["Method", "Path", "registered_by", "处置建议"],
                g.items.map((r) => [
                    `\`${r.method}\``,
                    `\`${r.path}\``,
                    `\`${r.registered_by}\``,
                    /\/unstable\//.test(r.path) ? "MSC 未稳定 / 待定前端是否消费" : "需补封装或确认无前端消费者",
                ]),
            ),
        );
        L.push("");
    });
}

// §3 仅 T2 构造证据
const t2Only = (b("T2_CONSTRUCTOR") ?? []).filter((r) => r.scope === "CLIENT_FACING");
L.push(`---`);
L.push("");
L.push(`## 3. 仅构造证据（T2，无精确调用点）— 客户端面 ${t2Only.length} 条`);
L.push("");
L.push(`这些路由在 \`src\` 里有路径构造器，但解析器**没有**看到把对应前缀用上去的调用点。两种可能：`);
L.push(`(a) 调用点路径是变量（L2 无法静态求值）→ **实际已封装**，属解析误报；`);
L.push(`(b) 构造器是死代码，或构造前缀与调用前缀不一致 → **真问题**。`);
L.push(`**必须逐个开源码确认后再定性**，不要直接当缺口补。`);
L.push("");
L.push(`> ⚠️ **证据强度**：\`构造证据\` 列给出的是**产生命中的那条字面量**。它可能只是与前缀拼出了恰好相等的路径`);
L.push(
    `> （例：字面量 \`/config\` + 前缀 \`/_matrix/media/v3\` → \`/_matrix/media/v3/config\`），并不代表该文件真的在看这个端点。`,
);
L.push(`> 标 ⚠️ 的行就是**单段字面量**，属弱证据，核实时请以路径末段签名是否吻合为准。`);
L.push("");
L.push(`按后端模块分布：`);
L.push("");
L.push(
    mdTable(
        ["后端模块", "条数"],
        groupCount(t2Only).map(([k, v]) => [`\`${k}\``, `${v.n}`]),
    ),
);
L.push("");
const segN = (s) => s.split("/").filter(Boolean).length;
for (const [mod, g] of groupCount(t2Only)) {
    L.push(`<details><summary><code>${mod}</code> — ${g.n} 条</summary>`);
    L.push("");
    L.push(
        mdTable(
            ["Method", "Path", "构造证据"],
            g.items.map((r) => [
                `\`${r.method}\``,
                `\`${r.path}\``,
                r.t2 && segN(r.t2.literal) <= 1 ? `⚠️ ${ev(r)}` : ev(r),
            ]),
        ),
    );
    L.push("");
    L.push("</details>");
    L.push("");
}

// §3.5 条件覆盖（版本段参数化 / 前缀片段模板）
const condRows = b("CONDITIONAL");
L.push(`---`);
L.push("");
L.push(`## 3.5 条件覆盖（版本段参数化 / 前缀片段模板）— ${condRows.length} 条`);
L.push("");
L.push(`这些路由**没有**精确调用点，但 \`src\` 里存在"只拼前缀、参数后补"的模板（如`);
L.push(`\`/_matrix/media/\${version}/download\`，\`version\` 默认 \`v3\`、可由调用方传 \`r0\`）。`);
L.push(`定性：**不是缺口，但也不是默认覆盖**——是否真的可访问取决于调用方传参。`);
L.push("");
if (condRows.length === 0) L.push("（无）");
else
    L.push(
        mdTable(
            ["Method", "Path", "模板证据", "范围"],
            condRows.map((r) => [
                `\`${r.method}\``,
                `\`${r.path}\``,
                r.conditional ? `\`${r.conditional.file}:${r.conditional.line}\` (\`${r.conditional.literal}\`)` : "—",
                `\`${r.scope}\``,
            ]),
        ),
    );
L.push("");

// §4 漂移
L.push(`---`);
L.push("");
L.push(`## 4. 前缀/版本漂移 — ${b("DRIFT")?.length ?? 0} 条`);
L.push("");
L.push(
    `后端路径与 SDK 调用点的**末段签名相同**、命名空间/版本不同。这类问题是隐蔽的运行时 404：契约升版后 SDK 仍在打旧前缀。`,
);
L.push("");
if (!b("DRIFT")?.length) L.push("✅ 无漂移。");
else
    L.push(
        mdTable(
            ["后端 Method", "后端 Path", "SDK 实际调用 Path", "SDK 位置", "范围"],
            b("DRIFT").map((r) => [
                `\`${r.method}\``,
                `\`${r.path}\``,
                `\`${r.drift.path}\``,
                `\`${r.drift.file}:${r.drift.line}\``,
                `\`${r.scope}\``,
            ]),
        ),
    );
L.push("");

// §5 仅声明
L.push(`---`);
L.push("");
L.push(`## 5. 仅声明面命中（T3）— ${b("T3_DECLARED_ONLY")?.length ?? 0} 条`);
L.push("");
L.push(`**不是缺口**：后端路由已进入 SDK 的 route-table 声明面，但仓内没有调用方。`);
L.push(`已知系统性成因（来自 \`pnpm quality:manager-codegen\`）：admin / federation / voice / feature_flags /`);
L.push(`moderation / key_rotation / app_service / dm / reactions / vendor / push_notification / delayed_events`);
L.push(`共 12 个模块被标记为 \`WAIVED — no route-table consumer\`。若前端 \`Tjg\` 需要其中能力，`);
L.push(`须**回前端仓库查消费情况**后才能定性为"待补封装"。`);
L.push("");
for (const [mod, g] of groupCount(b("T3_DECLARED_ONLY") ?? [])) {
    L.push(`<details><summary><code>${mod}</code> — ${g.n} 条</summary>`);
    L.push("");
    L.push(
        mdTable(
            ["Method", "Path", "范围"],
            g.items.map((r) => [`\`${r.method}\``, `\`${r.path}\``, `\`${r.scope}\``]),
        ),
    );
    L.push("");
    L.push("</details>");
    L.push("");
}

// §6 服务端面缺口登记
const serverGap = (b("GAP") ?? []).filter((r) => r.scope !== "CLIENT_FACING");
L.push(`---`);
L.push("");
L.push(`## 6. 服务端/非产品面缺口（登记，**不应**封装）— ${serverGap.length} 条`);
L.push("");
for (const [mod, g] of groupCount(serverGap)) {
    L.push(`<details><summary><code>${mod}</code> — ${g.n} 条</summary>`);
    L.push("");
    L.push(
        mdTable(
            ["Method", "Path", "范围"],
            g.items.map((r) => [`\`${r.method}\``, `\`${r.path}\``, `\`${r.scope}\``]),
        ),
    );
    L.push("");
    L.push("</details>");
    L.push("");
}
// §7 人工复核记录
// ─────────────────────────────────────────────────────────────
// 本表由人工（审计者）维护，**不会**被自动重跑覆盖或删改。
// 每次重跑后请比对 §2/§3.5/§5，把新增的缺口/条件覆盖项逐个开源码核实后补进本表。
// key = 归一化路径（version 不敏感，用 looseKey 形式），便于跨版本复用。
const VERIFIED = {
    "client/unstable/org.matrix.msc2965/auth_issuer": {
        verdict: "🔴 真缺口（已核实）",
        evidence:
            "`grep -rn \"auth_issuer\\|msc2965\" src --include='*.ts' | grep -v __generated__` → **0 命中**；SDK 的 OIDC 走 `src/oidc/discovery.ts` 直接请求 `.well-known/openid-configuration`，从不调用后端的 MSC2965 委派认证入口。",
        action: "确认前端是否启用 MSC2965 委派认证；若启用，需补 `OidcManager.getAuthIssuer()`（`GET /_matrix/client/unstable/org.matrix.msc2965/auth_issuer`）；若不启用，登记为「后端有、前端不走」并保持缺口。",
    },
    "client/v3/admin/room/{}/redact": {
        verdict: "🔴 真缺口（已核实）",
        evidence:
            '`grep -rn "redact" src/admin` → **0 命中**；SDK 仅有用户态 `PUT /_matrix/client/{v1,v3}/rooms/{roomId}/redact/{eventId}/{txnId}`，无 admin 房间级 redact。',
        action: "若运营后台需要房间级 redact：`AdminRoomManager` 补 `redactRoomEvent(roomId, eventId, reason)`；若由前端 `AdminFacadeService` 直连（C 类运维面），则登记不补。",
    },
    "media/{}/download/{}/{}": {
        verdict: "🟡 版本别名（已核实，非缺口）",
        evidence:
            '`src/media/index.ts:461-462` `getDownloadUrl()`：`const version = options.version ?? "v3"` → `/_matrix/media/${version}/download/...`。r0 需调用方显式传 `version: "r0"`（默认 v3）。',
        action: "无需补封装。可选：在 `MediaDownloadUrlOptions.version` 处加 JSDoc 说明「r0 为兼容别名，默认 v3」，避免调用方误以为覆盖 r0。",
    },
    "client/unstable/org.matrix.msc4108/rendezvous/{}": {
        verdict: "🟢 已实现（解析器盲区，非缺口）",
        evidence:
            '`src/rendezvous/transports/MSC4108RendezvousSession.ts:106` `.getUrl("/org.matrix.msc4108/rendezvous", undefined, ClientPrefix.Unstable)`；GET/PUT/DELETE 三方法共用该基址，`{session_id}` 由 transport 追加。',
        action: "无需改动。这是本解析器的已知盲区（`getUrl(relativePath, ..., prefix)` 形态 + 尾部参数后拼），已在 §7.1 登记。",
    },
    "client/unstable/org.matrix.msc4155/rooms/{}/threads": {
        verdict: "🔴 真缺口（已核实）",
        evidence:
            "`grep -rn \"msc4155\\|msc4156\" src --include='*.ts' | grep -v __generated__` → **0 命中**；全仓除 `__generated__/route-table.ts` 外**没有任何 `/threads` 路径字面量**。",
        action: "**须与 Sprint 4 交付范围对照**：MSC4155（房间线程列表）在 SDK 侧无任何调用点。若该 ticket 只交付了后端，则前端线程能力仍走 `relations`（`m.thread`）自建；若要启用不稳定端点，需在 `ThreadManager` 补 `getRoomThreads()`。",
    },
    "client/unstable/org.matrix.msc4156/threads/subscribed": {
        verdict: "🔴 真缺口（已核实）",
        evidence: "同上，`msc4156` 在 `src` 中 0 命中（仅存在于 `src/thread/__generated__/route-table.ts` 声明面）。",
        action: "同上：补 `getSubscribedThreads()`，或明确该能力不在本期前端范围内。",
    },
};

const lk = (p) => {
    const segs = normalizeParams(p).split("/").filter(Boolean);
    const cut = segs.findIndex((s) => /^(v\d+|r\d+|unstable)$/.test(s));
    return segs.slice(cut + 1).join("/");
};
L.push(`---`);
L.push("");
L.push(`## 7. 人工复核记录（本轮，${localDate()}）`);
L.push("");
L.push(`> 本表由审计者人工维护，**重跑生成器不会覆盖**。机器只能给出"证据有几级"，`);
L.push(`> "该不该补"必须开源码看实现意图——这是本仓历史审计反复踩过的坑`);
L.push(`> （2026-08-17 那次曾把 8 个已实现的 \`room-summary\` 端点误判为待补）。`);
L.push("");
L.push(
    mdTable(
        ["端点（版本不敏感）", "复核结论", "证据", "处置"],
        Object.entries(VERIFIED).map(([k, v]) => [`\`/${k}\``, v.verdict, v.evidence, v.action]),
    ),
);
L.push("");
L.push(`### 7.1 本解析器的已知盲区（重跑时必须人工兜底）`);
L.push("");
L.push(
    mdTable(
        ["盲区", "例子", "后果", "兜底方式"],
        [
            [
                "`getUrl(relativePath, query, prefix)` 形态",
                "`MSC4108RendezvousSession.ts:106`",
                "该端点落入 §5「仅声明」桶，看起来像没实现",
                "对 §5 中每一条 MSC/vendor 端点 grep 特性名",
            ],
            [
                "前缀 + 尾部参数后拼（URL 拼接）",
                "`src/media/index.ts` `getDownloadUrl()`",
                "落入 §3.5「条件覆盖」桶",
                "看 `version`/`prefix` 是否为可传参数",
            ],
            [
                "变量路径（`authedRequest(Method.X, path)`）",
                "`src/client-*-requests.ts` 多处",
                "该端点靠 §3.5/§5 兜底",
                "按 `build*Path()` 函数名反查",
            ],
            [
                "前缀由函数动态拼（`buildUnstableFeaturePrefix()`）",
                "`src/delayed-events/index.ts:50`",
                "已通过 §4 前缀候选（MSC 特性名扫描）修复",
                "若新增同类写法，需补扫描规则",
            ],
        ],
    ),
);
L.push("");
L.push(`---`);
L.push("");
L.push(`## 附：复现命令`);
L.push("");
L.push("```bash");
L.push("# 1) 刷新后端 ledger 事实面（离线可跑，无需起服务）");
L.push("cd ../synapse-rust && ./scripts/generate_sdk_ledger_fixtures.sh");
L.push("# 2) 刷新 SDK 镜像底座 + route-table codegen");
L.push("cd ../matrix-js-sdk && pnpm contract:sync && pnpm contract:codegen");
L.push("# 3) 重新生成缺口报告 + 附录 JSON（两个产物必须一起刷，否则 gap.json 会停在旧底座）");
L.push(
    "node scripts/audit/compare-routes.mjs --output artifacts/sdk-contract-gap-report.md --json artifacts/sdk-contract-gap.json",
);
L.push("```");
L.push("");

const md = L.join("\n");
fs.mkdirSync(path.dirname(OUT_MD), { recursive: true });
// P2 fix (2026-10-05): format the report at the generator's exit so a
// regeneration never needs a follow-up manual `prettier --write`.
//
// The report is markdown with many wide CJK tables. Hand-built pipe tables come
// out unpadded (`| --- | --- |`), which prettier rewrites into aligned form — so
// a freshly generated report was *always* a lint:js failure until someone ran
// prettier by hand. Formatting here keeps
// `node scripts/audit/compare-routes.mjs && pnpm lint:js` green in one step.
const formattedMd = await formatWithPrettier(md, OUT_MD);
fs.writeFileSync(OUT_MD, formattedMd);
if (OUT_JSON) {
    const rawJson = JSON.stringify(
        {
            summary,
            mirrorMissing: mirrorInfo?.missing ?? [],
            mirrorExtra: mirrorInfo?.extra ?? [],
            gap: (b("GAP") ?? []).map((r) => ({
                method: r.method,
                path: r.path,
                scope: r.scope,
                registered_by: r.registered_by,
            })),
            t2Only: t2Only.map((r) => ({ method: r.method, path: r.path, evidence: r.t2 })),
            drift: (b("DRIFT") ?? []).map((r) => ({
                method: r.method,
                path: r.path,
                sdkPath: r.drift.path,
                file: r.drift.file,
                line: r.drift.line,
            })),
            declaredOnly: (b("T3_DECLARED_ONLY") ?? []).map((r) => ({
                method: r.method,
                path: r.path,
                scope: r.scope,
            })),
        },
        null,
        2,
    );
    // P2 fix (2026-10-05): the .md exit below is already routed through prettier;
    // the JSON exit was not, so a regenerated `gap.json` failed `lint:js`
    // (`artifacts/` is outside `.prettierignore`) until someone ran
    // `prettier --write` by hand. Format here too so both artefacts come out
    // lint-clean from a single generator run.
    const formattedJson = await formatWithPrettier(rawJson, OUT_JSON);
    fs.writeFileSync(OUT_JSON, formattedJson);
    log(`      附录 JSON: ${path.relative(process.cwd(), OUT_JSON)}`);
}
log(`      报告: ${path.relative(process.cwd(), OUT_MD)}  (${formattedMd.split("\n").length} 行)`);
