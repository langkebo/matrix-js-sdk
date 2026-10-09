#!/usr/bin/env node
/*
 * check-wire-format.mjs — SDK ↔ 后端「报文（body / query 键集）」契约门禁。
 *
 * ## 这个门禁关的洞
 *
 * `quality:path-contract` 只核对**路径**。报文层（请求体键名、查询键名、必填与否）在
 * 2026-10-09 之前**完全没有门禁**，于是 27 条 wire-format 缺陷（方案文档 §9）长期存活：
 *
 *   - SDK 发 `is_suggested_only`，后端 `#[serde(rename = "suggested_only")] + deny_unknown_fields`
 *     ⇒ **400**（P-01）；
 *   - SDK 发 `targetService`，后端读 `target_service` ⇒ **400 / 静默丢弃**（P-07 / P-08）；
 *   - SDK 声明 `CreateRoomKeyRequest{algorithm?}`，后端 `algorithm` **必填** ⇒ **400**（P-10）。
 *
 * ⚠️ 最危险的形态是**同文件里"一个方法对、另一个方法错"**（`room-summary/index.ts:469` 对、
 * `:504` 错；`friend-request-manager.ts:114` 对、`:149` 错）—— 人眼评审几乎必漏。
 *
 * ## 两个半场（与 `quality:admin-response-contract` 同范式）
 *
 * 后端只存在于同级 checkout（`../synapse-rust`），**CI 拿不到**。所以：
 *
 *   1. **CI 半场**（无后端也能跑）：台账 `wire-format-ledger.json` 冻结每个路由的
 *      「请求契约」（必填集 / 已声明键集 / 是否 `deny_unknown_fields`）。
 *      重抽 **SDK 发出的键集**与台账比对 ⇒ **改了请求键而没重新核后端，CI 直接红**。
 *   2. **工作区半场**（后端在场时）：重抽后端真实契约，先与台账对**漂移**（后端改了而台账旧），
 *      再与 SDK 键集对一遍。后端不在场时 **skip**；`--strict` 把 skip 变失败。
 *
 * ## fail-closed：认不出来的一律进**显式计数桶**，绝不静默
 *
 * 抽取器最危险的是"静默 `continue`"——认不出的调用点如果既不判也不计数，覆盖面就会
 * 以「分母变小」的方式缩水（本仓在可达性门禁上踩过同一个坑）。本门禁把所有认不出的情形
 * 落进具名桶（`route-not-resolved` / `backend-body-unknown` / `sdk-keys-unknown` …），
 * 桶计数写进 `wire-format-coverage.json` 且**只降不升**。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/quality/check-wire-format.mjs             # CI 半场 +（后端在场时）工作区半场
 * node scripts/quality/check-wire-format.mjs --strict    # 后端不在场也算失败（发布流程用）
 * node scripts/quality/check-wire-format.mjs --refresh   # 需要后端：重新冻结台账与覆盖桶
 * node scripts/quality/check-wire-format.mjs --json      # 机器可读输出
 * ```
 *
 * 环境变量：`SYNAPSE_RUST_REPO`（后端仓根，默认 `../synapse-rust`）
 *
 * 退出码：0 通过 / 1 违规 / 2 门禁自身无法运行
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
    DEFAULT_PREFIX,
    WRAPPER_NAMES,
    findLocalConstBinding,
    findTopLevel,
    matchBrace,
    normalizePath,
    resolvePathExpressionText,
    resolvePrefixExpression,
    stripTsAssertion,
} from "./verify-path-contract.mjs";
import { collectRustAdminContract, parseSerdeStructs, stripRustComments } from "./lib/admin-contract.mjs";
import { writeJsonFormatted } from "./lib/write-json.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SDK_ROOT = path.resolve(__dirname, "..", "..");
const SRC_ROOT = path.join(SDK_ROOT, "src");
const LEDGER_PATH = path.join(__dirname, "wire-format-ledger.json");
const COVERAGE_PATH = path.join(__dirname, "wire-format-coverage.json");
const WAIVERS_PATH = path.join(__dirname, "wire-format-waivers.json");
const BACKEND_ROOT = process.env.SYNAPSE_RUST_REPO ?? path.resolve(SDK_ROOT, "..", "synapse-rust");
const RUST_ROUTES_ROOT = path.join(BACKEND_ROOT, "synapse-web", "src");
const RUST_SINK_DIRS = ["synapse-storage/src", "synapse-common/src", "synapse-services/src"].map((d) =>
    path.join(BACKEND_ROOT, d),
);

const STRICT = process.argv.includes("--strict");
const REFRESH = process.argv.includes("--refresh");
const EMIT_JSON = process.argv.includes("--json");

// ---------------------------------------------------------------------------
// 纯函数：对象字面量 → 键集（spec 直接测）
// ---------------------------------------------------------------------------

/**
 * 按**顶层**逗号切分对象字面量的内部文本（嵌套的 `{}`/`[]`/`()` 与字符串里的逗号不切）。
 *
 * @param {string} inner 已去掉最外层花括号的文本
 * @returns {string[]}
 */
export function splitTopLevelObjectProps(inner) {
    const parts = [];
    let start = 0;
    for (;;) {
        const idx = findTopLevel(inner.slice(start), (c) => c === ",");
        if (idx < 0) {
            parts.push(inner.slice(start));
            return parts;
        }
        parts.push(inner.slice(start, start + idx));
        start += idx + 1;
    }
}

/**
 * 从**对象字面量**取顶层键集。fail-closed：任一情形判不出来就返回 `null`（附 `reason`），
 * **绝不返回半份键集** —— 半份键集会凭空造出"少字段/多字段"的假缺陷。
 *
 * @param {string} text 表达式原文（应形如 `{…}`）
 * @returns {{ keys: string[] | null, reason: string | null }}
 */
export function objectLiteralKeys(text) {
    const t = stripTsAssertion(String(text ?? "").trim());
    if (!t.startsWith("{")) return { keys: null, reason: "not-object-literal" };
    const close = matchBrace(t, 0);
    if (close !== t.length - 1) return { keys: null, reason: "trailing-text" };
    const inner = t.slice(1, -1);
    if (!inner.trim()) return { keys: [], reason: null };
    const keys = [];
    for (const raw of splitTopLevelObjectProps(inner)) {
        const prop = raw.replace(/^\s+|\s+$/g, "");
        if (!prop) continue;
        if (prop.startsWith("...")) return { keys: null, reason: "spread" };
        if (prop.startsWith("//") || prop.startsWith("/*")) continue;
        const kv = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*:/.exec(prop);
        if (kv) {
            keys.push(kv[1] ?? kv[2] ?? kv[3]);
            continue;
        }
        const shorthand = /^([A-Za-z_$][\w$]*)$/.exec(prop);
        if (shorthand) {
            keys.push(shorthand[1]);
            continue;
        }
        // 计算键（`[k]: v`）/ 方法简写 / 认不出的写法 ⇒ 键集不再是全貌
        return { keys: null, reason: "unparsed-prop" };
    }
    return { keys: [...new Set(keys)].sort(), reason: null };
}

/**
 * 找 `const <name> = <对象字面量>` 绑定（**只看对象**，与 path-contract 的
 * `findLocalConstBinding` 不同 —— 后者要求 RHS 解得成**路径**字面量，拿来解键集会恒为 null）。
 *
 * fail-closed：文件里出现**多于一处** `const/let/var <name> =` 就返回 `null`
 * （作用域链没做完整模拟，宁可不判也不能拿另一个同名绑定的键集去比对 ⇒ 那是假缺陷）。
 *
 * @param {string} source
 * @param {number} callIndex
 * @param {string} name
 * @returns {string | null} 对象字面量原文，或 null
 */
export function findConstObjectBinding(source, callIndex, name) {
    const before = source.slice(0, callIndex);
    const re = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=`, "g");
    const hits = [...before.matchAll(re)];
    if (hits.length !== 1) return null;
    const at = hits[0].index + hits[0][0].length;
    let i = at;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] !== "{") return null;
    const close = matchBrace(source, i);
    if (close < 0) return null;
    return source.slice(i, close + 1);
}

/**
 * 把一个实参表达式解析成**键集**。支持两类：对象字面量、指向 `const` 绑定的裸标识符。
 *
 * `undefined` / `null` 视作「显式不传」⇒ `keys=[]`（这是"不发这个字段"的**确定**结论，
 * 不是"不知道"）。其余（函数调用、成员访问、`Object.assign(…)` …）一律 `null`。
 *
 * @param {string | null} expr
 * @param {string} source 该文件全文（用于追 `const` 绑定）
 * @param {number} callIndex 调用点在 source 里的下标
 * @returns {{ keys: string[] | null, reason: string | null }}
 */
export function resolveKeySet(expr, source, callIndex) {
    // `null` 专指**不可知**（该包装器没有这个实参位置）。"确定不发"必须传字面量 `"undefined"`
    // —— 两者混淆过一次：形参透传（`body` 是方法形参）被读成空键集 ⇒ 4 条 `缺必填` 全是假缺陷。
    if (expr == null) return { keys: null, reason: "position-unknown" };
    const text = stripTsAssertion(String(expr).trim());
    if (text === "undefined" || text === "null") return { keys: [], reason: null };
    if (text.startsWith("{")) return objectLiteralKeys(text);
    if (/^[A-Za-z_$][\w$]*$/.test(text)) {
        const bound = findConstObjectBinding(source, callIndex, text);
        if (bound == null) return { keys: null, reason: "binding-unresolved" };
        return objectLiteralKeys(stripTsAssertion(bound));
    }
    return { keys: null, reason: "not-object-literal" };
}

/**
 * 抽「对象字面量形态」的包装器调用：`this.request({ method: Method.Get, path, queryParams, body, prefix })`。
 *
 * ⚠️ 这类调用**占本仓一半以上**（实测 576 处，`body` 198 / `queryParams` 103），
 * 且 `quality:path-contract` 的 `extractWrapperCalls` **只认位置形态**（要求第 1 实参是
 * `Method.X`）⇒ cas 全族（`this.request({…})`）在那边**根本不存在**。若本门禁也只做位置形态，
 * P-07 / P-08 / P-09 这类缺陷永远抓不到。
 *
 * 判据（fail-closed）：对象里必须有 `method: Method.<Name>` 与 `path:`，否则不算调用点
 * （避免把 `{success}`、`{method: "GET"}` 这类普通对象字面量误当请求规格）。
 *
 * @param {string} source
 * @param {string} relFile
 * @param {{ identityHelpers?: Map<string, unknown> | null, templateBuilders?: Map<string, string> | null }} [options]
 * @returns {{ calls: object[], unchecked: object[] }}
 */
export function extractObjectFormCalls(source, relFile, options = {}) {
    const calls = [];
    const unchecked = [];
    const nameRe = new RegExp(`\\b(${WRAPPER_NAMES.join("|")})\\b`, "g");
    for (const m of source.matchAll(nameRe)) {
        let i = m.index + m[1].length;
        // 跳过泛型实参 `<T>`（只处理平衡的单层尖括号，嵌套交给 fail-closed）
        while (i < source.length && /\s/.test(source[i])) i++;
        if (source[i] === "<") {
            const close = source.indexOf(">", i);
            if (close < 0) continue;
            i = close + 1;
            while (i < source.length && /\s/.test(source[i])) i++;
        }
        if (source[i] !== "(") continue;
        let j = i + 1;
        while (j < source.length && /\s/.test(source[j])) j++;
        if (source[j] !== "{") continue;
        const closeBrace = matchBrace(source, j);
        if (closeBrace < 0) continue;
        const literal = source.slice(j, closeBrace + 1);
        const line = source.slice(0, m.index).split("\n").length;

        // 顶层属性（只取 depth===1）。`{ method, path, body, prefix }` 这种**简写**必须一起认，
        // 否则 `body` 会被当成"没这个属性" ⇒ 报"缺必填"的假缺陷。
        const propText = new Map();
        for (const raw of splitTopLevelObjectProps(literal.slice(1, -1))) {
            const p = raw.replace(/^\s+|\s+$/g, "");
            if (!p) continue;
            const kv = /^([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*)$/.exec(p);
            if (kv) {
                if (!propText.has(kv[1])) propText.set(kv[1], kv[2].trim());
                continue;
            }
            const shorthand = /^([A-Za-z_$][\w$]*)$/.exec(p);
            if (shorthand && !propText.has(shorthand[1])) propText.set(shorthand[1], shorthand[1]);
        }
        // 判据：必须同时有 `method: Method.<Name>` 与 `path`。（**不能用正则探 `path:`** ——
        // 简写 `path` 没有冒号，会被静默跳过，实测就是这样漏掉一整类调用点。）
        const methodExpr = propText.get("method");
        const methodM = methodExpr ? /^Method\.([A-Za-z]+)$/.exec(stripTsAssertion(methodExpr)) : null;
        if (!methodM || !propText.has("path")) continue; // 不是请求规格对象

        const pathExpr = propText.get("path");
        const pathResolved =
            pathExpr == null
                ? null
                : (resolvePathExpressionText(pathExpr, options) ??
                  (() => {
                      const id = stripTsAssertion(pathExpr).trim();
                      if (!/^[A-Za-z_$][\w$]*$/.test(id)) return null;
                      return findLocalConstBinding(source, m.index, id, options);
                  })());
        if (pathResolved == null) {
            unchecked.push({
                file: relFile,
                line,
                wrapper: m[1],
                expr: (pathExpr ?? "(无 path 属性)").replace(/\s+/g, " ").slice(0, 120),
            });
            continue;
        }
        const prefixExpr = propText.get("prefix") ?? null;
        calls.push({
            method: methodM[1].toUpperCase(),
            pathRaw: pathResolved,
            prefixExpr,
            wrapper: m[1],
            line,
            // 属性缺失 = 运行时 `undefined` = **确定不发**（不是"不可知"）
            queryArg: propText.has("queryParams") ? propText.get("queryParams") : "undefined",
            bodyArg: propText.has("body") ? propText.get("body") : "undefined",
            form: "object",
            callIndex: m.index,
        });
    }
    return { calls, unchecked };
}

/**
 * 把「已解析到路由 + 键集」的调用点与后端契约对账。**纯函数**（spec 直接测）。
 *
 * 判据（fail-closed，逐条独立 —— 任一检查都不得被别的 `continue` 吞掉）：
 *
 *   - `request-required-missing`：SDK 键集 ⊉ 后端必填集 ⇒ axum/serde 反序列化失败（400/415）；
 *   - `request-unknown-key`：后端 `deny_unknown_fields` 且 SDK 键集 ⊄ 已声明键集 ⇒ 400；
 *   - `query-required-missing` / `query-unknown-key`：同上，作用于 `Query<T>`；
 *   - `body-sent-ignored`：后端该路由**没有** `Json` 提取器而 SDK 传了非空 body ⇒ 请求体被静默忽略。
 *
 * 认不出的情形一律落具名桶，不并入"通过"。
 *
 * @param {{ calls: object[], backend: Map<string, object> }} input
 *   `calls[i]`: `{ route, file, line, wrapper, method, body: {keys, reason}, query: {keys, reason} }`
 *   `backend`: `route → { handler, hasJson, hasQuery, body, query }`，`body/query` 为
 *   `{ type, required, declared, denyUnknown, opaque }` 或 null。
 * @returns {{ violations: object[], unresolved: object[], comparable: object[] }}
 */
export function classifyWire({ calls, backend }) {
    const violations = [];
    const unresolved = [];
    const comparable = [];
    for (const cs of calls) {
        const base = { route: cs.route, file: cs.file, line: cs.line, wrapper: cs.wrapper };
        const be = backend.get(cs.route);
        if (!be) {
            unresolved.push({ ...base, kind: "route-not-resolved" });
            continue;
        }
        // ── 请求体 ──
        const bodyKnown = cs.body.keys !== null;
        if (!be.hasJson) {
            if (bodyKnown && cs.body.keys.length > 0) {
                violations.push({ ...base, kind: "body-sent-ignored", handler: be.handler, sdkKeys: cs.body.keys });
            } else if (!bodyKnown) {
                unresolved.push({ ...base, kind: "backend-body-unknown", handler: be.handler });
            }
        } else if (!be.body || be.body.opaque) {
            unresolved.push({ ...base, kind: "backend-body-unknown", handler: be.handler });
        } else if (!bodyKnown) {
            unresolved.push({
                ...base,
                kind: "sdk-keys-unknown",
                side: "body",
                reason: cs.body.reason,
                handler: be.handler,
            });
        } else {
            const missing = be.body.required.filter((k) => !cs.body.keys.includes(k));
            if (missing.length) {
                violations.push({
                    ...base,
                    kind: "request-required-missing",
                    handler: be.handler,
                    missing,
                    backendType: be.body.type,
                });
            }
            if (be.body.denyUnknown) {
                const extra = cs.body.keys.filter((k) => !be.body.declared.includes(k));
                if (extra.length) {
                    violations.push({
                        ...base,
                        kind: "request-unknown-key",
                        handler: be.handler,
                        extra,
                        backendType: be.body.type,
                    });
                }
            }
            comparable.push({ ...base, side: "body", handler: be.handler, backendType: be.body.type });
        }
        // ── 查询参数（独立检查，不受上面任何分支影响）──
        const queryKnown = cs.query.keys !== null;
        const sendsQuery = queryKnown && cs.query.keys.length > 0;
        if (!queryKnown) {
            unresolved.push({ ...base, kind: "sdk-keys-unknown", side: "query", reason: cs.query.reason });
        } else if (!sendsQuery) {
            // SDK 不下发 query ⇒ 若后端有必填 query 字段，那是"缺必填"，必须判
            if (be.query && !be.query.opaque && be.query.required.length) {
                violations.push({
                    ...base,
                    kind: "query-required-missing",
                    handler: be.handler,
                    missing: be.query.required,
                    backendType: be.query.type,
                });
            }
        } else if (!be.query || be.query.opaque) {
            unresolved.push({ ...base, kind: "backend-query-unknown", handler: be.handler, sdkKeys: cs.query.keys });
        } else {
            const missing = be.query.required.filter((k) => !cs.query.keys.includes(k));
            if (missing.length) {
                violations.push({
                    ...base,
                    kind: "query-required-missing",
                    handler: be.handler,
                    missing,
                    backendType: be.query.type,
                });
            }
            const extra = cs.query.keys.filter((k) => !be.query.declared.includes(k));
            if (extra.length) {
                violations.push({
                    ...base,
                    kind: "query-unknown-key",
                    handler: be.handler,
                    extra,
                    backendType: be.query.type,
                });
            }
            comparable.push({ ...base, side: "query", handler: be.handler, backendType: be.query.type });
        }
    }
    return { violations, unresolved, comparable };
}

/** 覆盖桶计数（按 `kind`，带 side 细分）。 */
export function countBuckets(unresolved) {
    const out = {};
    for (const u of unresolved) {
        const key = u.side ? `${u.kind}:${u.side}` : u.kind;
        out[key] = (out[key] ?? 0) + 1;
    }
    return out;
}

/** 覆盖率棘轮判据：观测相对基线「变多」的桶。 */
export function diffBuckets(baseline = {}, observed = {}) {
    const issues = [];
    for (const [k, n] of Object.entries(observed)) {
        const b = baseline[k] ?? 0;
        if (n > b) issues.push({ kind: k, baseline: b, observed: n });
    }
    return issues;
}

/** 违规项的稳定键（waiver 用它匹配）。 */
export function violationKey(v) {
    return `${v.kind}|${v.route}|${v.file}`;
}

/**
 * 不属于「homeserver 路由」范畴的命名空间 —— 与 `verify-path-contract.mjs` 同一口径
 * （identity server 是独立部署的服务，本后端 ledger 里永远没有它的路由）。
 * 单独成桶，避免把一个**结构性**事实报成 162 条"未解析"噪声。
 */
export const OUT_OF_SCOPE_PREFIXES = ["/_matrix/identity/", "/_matrix/media/"];

/** 路由前缀（前 3 段）——报告里按前缀聚合，便于分诊一大桶"未解析"。 */
export function routePrefix(route) {
    const m = /^([A-Z]+)\s+(\/.*)$/.exec(route ?? "");
    if (!m) return "(unknown)";
    return m[1] + " " + m[2].split("/").slice(0, 4).join("/");
}

// ---------------------------------------------------------------------------
// 门禁本体
// ---------------------------------------------------------------------------

/** 递归列 `.ts`（跳过 `__generated__`：那些是 codegen 产物，不是手写调用点）。 */
function listSourceFiles(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === "__generated__") continue;
            out.push(...listSourceFiles(full));
        } else if (e.name.endsWith(".ts")) {
            out.push(full);
        }
    }
    return out;
}

function readJsonIfExists(file, fallback) {
    if (!fs.existsSync(file)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}

function backendCommit() {
    try {
        return execFileSync("git", ["-C", BACKEND_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    } catch {
        return null;
    }
}

/** 建「恒等包装器 / 模板构造器」索引（与 path-contract 同源，保证两侧对 SDK 的解读一致）。 */
async function buildSdkContext() {
    const { indexIdentityPathHelpers, analyzeTemplateBuilders, parseStripPrefixAliases } =
        await import("./verify-path-contract.mjs");
    const files = listSourceFiles(SRC_ROOT);
    const sourcesByFile = new Map();
    for (const f of files) sourcesByFile.set(path.relative(SDK_ROOT, f), fs.readFileSync(f, "utf8"));
    const stripSrc = fs.readFileSync(path.join(SRC_ROOT, "http-api", "strip-prefix.ts"), "utf8");
    const { helpers } = indexIdentityPathHelpers(sourcesByFile, { stripAliases: parseStripPrefixAliases(stripSrc) });
    const templateBuilders = analyzeTemplateBuilders(sourcesByFile);
    return { sourcesByFile, identityHelpers: helpers, templateBuilders };
}

/** 全仓扫 SDK 调用点，解析到 `METHOD /归一化路径` + body/query 键集。 */
async function collectSdkCalls() {
    const { extractWrapperCalls } = await import("./verify-path-contract.mjs");
    const { sourcesByFile, identityHelpers, templateBuilders } = await buildSdkContext();
    const options = { identityHelpers, templateBuilders };
    const calls = [];
    const badPath = [];
    for (const [rel, source] of sourcesByFile) {
        const { calls: positional } = extractWrapperCalls(source, rel, options);
        const { calls: object, unchecked } = extractObjectFormCalls(source, rel, options);
        const all = [...positional.map((c) => ({ ...c, form: "positional" })), ...object];
        // 同一个调用点可能被两种形态各命中一次（`request({…})` 不会，`request(Method.X,…)` 也不会）
        // —— 位置形态要求首实参是 `Method.X`，对象形态要求 `{method: Method.X`，两者互斥。
        for (const c of all) {
            const pathText = resolvePathExpressionText(String(c.pathRaw), options);
            if (pathText == null) {
                badPath.push({ file: rel, line: c.line, wrapper: c.wrapper, form: c.form });
                continue;
            }
            const inner = pathText.slice(1, -1);
            const candidates =
                c.form === "object"
                    ? (resolvePrefixExpression(c.prefixExpr)?.candidates ?? [DEFAULT_PREFIX])
                    : (c.prefixCandidates ?? [DEFAULT_PREFIX]);
            const fullPaths = [...new Set(candidates.map((p) => normalizePath(p + inner)))];
            const callIndex = c.callIndex ?? source.indexOf(String(c.pathRaw));
            calls.push({
                file: rel,
                line: c.line,
                wrapper: c.wrapper,
                method: c.method,
                candidates: fullPaths,
                body: resolveKeySet(c.bodyArg ?? null, source, Math.max(0, callIndex)),
                query: resolveKeySet(c.queryArg ?? null, source, Math.max(0, callIndex)),
            });
        }
        for (const u of unchecked) badPath.push({ file: u.file, line: u.line, wrapper: u.wrapper, form: "object" });
    }
    return { calls, badPath };
}

/** 抽后端每个路由的请求契约（body + query）。 */
async function collectBackendContract() {
    const { byRoute } = await collectRustAdminContract({ routesDir: RUST_ROUTES_ROOT, sinkDirs: RUST_SINK_DIRS });
    // 建全局 struct 索引（Query<T> 的字段集要从定义处取；collectRustAdminContract 只回传 body 的）
    const structs = new Map();
    const walk = (dir) => {
        if (!fs.existsSync(dir)) return [];
        const out = [];
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) out.push(...walk(full));
            else if (e.name.endsWith(".rs")) out.push(full);
        }
        return out;
    };
    for (const f of [...walk(RUST_ROUTES_ROOT), ...RUST_SINK_DIRS.flatMap(walk)]) {
        const src = stripRustComments(fs.readFileSync(f, "utf8"));
        for (const [name, info] of parseSerdeStructs(src)) {
            if (!structs.has(name)) structs.set(name, info);
        }
    }
    const shapeOf = (name) => {
        if (!name) return null;
        const s = structs.get(name);
        if (!s) return null;
        const declared = [...s.fields].sort();
        const optional = new Set(s.optionalFields ?? []);
        return {
            type: name,
            declared,
            required: declared.filter((k) => !optional.has(k)),
            denyUnknown: Boolean(s.denyUnknownFields),
            // `flatten`（键集不闭合）或 `opaque`（改不出键的 rename_all / 撞名）⇒ 不可当全貌
            opaque: Boolean(s.opaque || s.flatten),
        };
    };
    const backend = new Map();
    for (const [route, e] of byRoute) {
        const body = e.bodyStruct
            ? {
                  type: e.bodyStruct.name,
                  declared: [...e.bodyStruct.fields].sort(),
                  required: [...e.bodyStruct.fields].sort().filter((k) => !(e.bodyStruct.optional ?? []).includes(k)),
                  denyUnknown: Boolean(e.bodyStruct.denyUnknownFields),
                  opaque: Boolean(e.bodyStruct.opaque),
              }
            : null;
        backend.set(route, {
            handler: e.handler,
            hasJson: Boolean(e.io?.hasJson),
            hasQuery: Boolean(e.io?.hasQuery),
            body,
            query: shapeOf(e.io?.queryType),
        });
    }
    return backend;
}

function loadWaivers() {
    const j = readJsonIfExists(WAIVERS_PATH, { schemaVersion: 1, entries: [] });
    return Array.isArray(j.entries) ? j.entries : [];
}

/** waiver 是否覆盖该违规：`kind` + `route` 必须一致；`file` 给出时再要求一致。过期即不覆盖。 */
export function waiverCovers(waivers, v, today) {
    return waivers.some(
        (w) =>
            w.kind === v.kind &&
            w.route === v.route &&
            (!w.file || w.file === v.file) &&
            !(w.expires && w.expires < today),
    );
}

async function main() {
    const today = new Date().toISOString().slice(0, 10);
    const sdk = await collectSdkCalls();
    const backendAvailable = fs.existsSync(RUST_ROUTES_ROOT);
    const backend = backendAvailable ? await collectBackendContract() : null;

    const ledger = readJsonIfExists(LEDGER_PATH, { entries: {} });
    const frozen = new Map(Object.entries(ledger.entries ?? {}));
    const effective = backend ?? frozen;
    const hasRoute = (key) => effective.has(key);
    // 镜像 manifest 只作**路由存在性**的第二判据：把"路由压根不存在"（真问题）与
    // "路由存在但请求契约抽不出来"（覆盖率上限）分成两个桶 —— 否则 700+ 条混在一个桶里，
    // 真问题会被淹没（本仓在"分母变小"上踩过坑，这里要的是反过来：不掩盖，但要能读）。
    const manifestRoutes = new Set();
    const manifestPath = path.join(SDK_ROOT, "docs", "api-contract", "generated", "route-manifest.all.json");
    if (fs.existsSync(manifestPath)) {
        for (const e of readJsonIfExists(manifestPath, { entries: [] }).entries ?? []) {
            manifestRoutes.add(`${e.method} ${normalizePath(e.path)}`);
        }
    }

    // 把 SDK 调用点的候选路径解析成**唯一**路由键；多候选或零候选都落桶
    const resolved = [];
    const routeBuckets = [];
    for (const c of sdk.calls) {
        // 前缀解不出（`resolvePrefixExpression` 返回空候选，例如 `prefix` 是形参）⇒ 单独成桶。
        // **不能当成零命中**：那会造出 `route === undefined` 的桶条目，把"前缀不可知"伪装成
        // "路由不存在"（实测 112 条）。
        if (!c.candidates || c.candidates.length === 0) {
            routeBuckets.push({
                file: c.file,
                line: c.line,
                wrapper: c.wrapper,
                kind: "route-prefix-unknown",
                route: null,
            });
            continue;
        }
        const tried = c.candidates.map((p) => `${c.method} ${p}`);
        const hits = [...new Set(tried.filter(hasRoute))];
        if (hits.length === 0) {
            const inBackend = tried.some((k) => manifestRoutes.has(k));
            const outOfScope = tried.some((k) => OUT_OF_SCOPE_PREFIXES.some((p) => k.includes(` ${p}`)));
            routeBuckets.push({
                file: c.file,
                line: c.line,
                wrapper: c.wrapper,
                kind: outOfScope
                    ? "route-out-of-scope"
                    : inBackend
                      ? "route-contract-unavailable"
                      : "route-not-resolved",
                route: tried[0],
            });
            continue;
        }
        if (hits.length > 1) {
            routeBuckets.push({
                file: c.file,
                line: c.line,
                wrapper: c.wrapper,
                kind: "route-ambiguous",
                route: hits[0],
            });
            continue;
        }
        resolved.push({ ...c, route: hits[0] });
    }

    const result = {
        generatedAt: new Date().toISOString(),
        backendAvailable,
        backendCommit: backendAvailable ? backendCommit() : null,
        scannedCalls: sdk.calls.length,
        unresolvedPaths: sdk.badPath.length,
        ledgerSource: backendAvailable ? "workspace" : "ledger",
    };

    if (!backendAvailable && !fs.existsSync(LEDGER_PATH)) {
        const msg = `❌ 台账缺失：${LEDGER_PATH}（首次请在有后端的环境跑 --refresh 生成）`;
        if (EMIT_JSON) console.log(JSON.stringify({ ...result, error: msg }, null, 2));
        else console.error(msg);
        return 2;
    }

    // 工作区半场：后端在场时先对「台账 ↔ 后端」漂移
    const drift = [];
    if (backend) {
        for (const [route, be] of backend) {
            const f = frozen.get(route);
            if (!f) {
                drift.push({ kind: "backend-route-new", route });
                continue;
            }
            const same =
                JSON.stringify([f.body?.required ?? [], f.body?.declared ?? [], f.body?.denyUnknown ?? false]) ===
                    JSON.stringify([be.body?.required ?? [], be.body?.declared ?? [], be.body?.denyUnknown ?? false]) &&
                JSON.stringify([f.query?.required ?? [], f.query?.declared ?? []]) ===
                    JSON.stringify([be.query?.required ?? [], be.query?.declared ?? []]);
            if (!same) drift.push({ kind: "backend-contract-drift", route });
        }
    }

    const { violations, unresolved, comparable } = classifyWire({ calls: resolved, backend: effective });
    for (const b of routeBuckets) unresolved.push(b);
    const buckets = countBuckets(unresolved);
    const waivers = loadWaivers();
    const unwaived = violations.filter((v) => !waiverCovers(waivers, v, today));
    const expired = waivers.filter((w) => w.expires && w.expires < today);

    const coverage = readJsonIfExists(COVERAGE_PATH, { buckets: {} });
    const bucketRegressions = REFRESH ? [] : diffBuckets(coverage.buckets ?? {}, buckets);

    if (REFRESH) {
        if (!backend) {
            console.error(`❌ --refresh 需要后端仓，未找到 ${RUST_ROUTES_ROOT}`);
            return 2;
        }
        const entries = {};
        for (const [route, be] of [...backend].sort((a, b) => a[0].localeCompare(b[0]))) {
            entries[route] = {
                handler: be.handler,
                hasJson: be.hasJson,
                hasQuery: be.hasQuery,
                body: be.body,
                query: be.query,
            };
        }
        writeJsonFormatted(LEDGER_PATH, {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            generatedBy: "node scripts/quality/check-wire-format.mjs --refresh",
            backendCommit: backendCommit(),
            notice: "本台账由 --refresh 冻结后端请求契约；手工编辑会掩盖后端漂移。",
            entries,
        });
        writeJsonFormatted(COVERAGE_PATH, { schemaVersion: 1, buckets, totalCalls: sdk.calls.length });
    }

    const report = {
        ...result,
        violations: violations.length,
        unwaived: unwaived.length,
        waived: violations.length - unwaived.length,
        expiredWaivers: expired.length,
        comparable: comparable.length,
        buckets,
        bucketRegressions,
        drift,
        sampleViolations: unwaived.slice(0, 25),
        sampleBuckets: unresolved
            .slice(0, 15)
            .map((u) => ({ kind: u.kind, file: u.file, line: u.line, route: u.route })),
        /** 全部「路由类」桶（供分诊：这些是 path-contract **抽不到的**对象形态调用点）。 */
        routeBuckets,
        bucketPrefixes: Object.fromEntries(
            Object.entries(
                unresolved
                    .filter((u) => u.route && u.kind.startsWith("route-"))
                    .reduce((acc, u) => {
                        const p = routePrefix(u.route);
                        acc[p] = (acc[p] ?? 0) + 1;
                        return acc;
                    }, {}),
            ).sort((a, b) => b[1] - a[1]),
        ),
    };

    if (EMIT_JSON) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        console.log("================================================================");
        console.log("[wire-format] SDK ↔ 后端 报文契约门禁");
        console.log("----------------------------------------------------------------");
        console.log(
            `  磁盘/台账来源 : ${report.ledgerSource}${backendAvailable ? `（后端 ${report.backendCommit?.slice(0, 9)}）` : "（后端不在场 ⇒ CI 半场）"}`,
        );
        console.log(`  SDK 调用点     : ${report.scannedCalls}`);
        console.log(`  路径未解析     : ${report.unresolvedPaths}`);
        console.log(`  已知偏差(豁免) : ${report.waived}`);
        console.log(`  违规（未豁免） : ${report.unwaived}`);
        console.log(`  可比对条目     : ${report.comparable}`);
        console.log(`  覆盖桶         : ${JSON.stringify(buckets)}`);
        if (drift.length) {
            console.log(`  ⚠️ 后端契约漂移 : ${drift.length}（需 --refresh 重新冻结台账）`);
        }
        if (unwaived.length) {
            console.log("---------------------------------------------------------------");
            for (const v of unwaived.slice(0, 25)) {
                console.log(
                    `  ❌ ${v.kind} @ ${v.route}  ${v.file}:${v.line}  ${JSON.stringify({ ...v }).slice(0, 220)}`,
                );
            }
            if (unwaived.length > 25) console.log(`  … 其余 ${unwaived.length - 25} 条见 --json`);
        }
        if (bucketRegressions.length) {
            console.log("---------------------------------------------------------------");
            for (const r of bucketRegressions) {
                console.log(`  ❌ 覆盖桶上升 ${r.kind}: ${r.baseline} → ${r.observed}（只准降；新增请先核对后端）`);
            }
        }
        if (expired.length) {
            console.log(`  ❌ 豁免过期 ${expired.length} 条（需重新核对后更新 expires 或删除）`);
        }
        console.log("================================================================");
    }

    if (STRICT && !backendAvailable) {
        console.error("[wire-format] ❌ --strict 要求工作区半场实际运行，但后端仓不在场");
        return 2;
    }
    const failed =
        unwaived.length > 0 || bucketRegressions.length > 0 || expired.length > 0 || (!REFRESH && drift.length > 0);
    if (!failed) {
        if (!EMIT_JSON)
            console.log(
                `✅ 报文契约与后端一致（豁免 ${report.waived} 处已登记；覆盖桶 ${Object.keys(buckets).length} 类）。`,
            );
        return 0;
    }
    return 1;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
    main()
        .then((code) => process.exit(code))
        .catch((err) => {
            console.error("[wire-format] 门禁自身失败：", err);
            process.exit(2);
        });
}
