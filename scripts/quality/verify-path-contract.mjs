#!/usr/bin/env node
/**
 * verify-path-contract.mjs — SDK ↔ 后端路径契约交叉校验门禁
 *
 * 背景（2026-09-30 联调发现）:
 *   `ApplicationServiceManager` 的 14 个方法全部使用 `/application_services`（下划线），
 *   而后端实际注册 `/_synapse/admin/v1/appservices`（无下划线）。
 *   该缺陷在 35/35 单测全绿的情况下完全不可见 —— 因为 mock 层不校验真实路径。
 *   本门禁把这类缺陷左移到 CI。
 *
 * 原理:
 *   1. 从后端 ledger 读出所有已注册路由（method + path），建立索引。
 *   2. 从 SDK 源码里提取每个请求调用的 (prefix, path, method) 三元组。
 *      SDK 的 `path` 是相对路径，前缀由 `prefix:` 字段单独给出（如 AdminPrefix.V1），
 *      所以要把两者拼接后再比对。关键难点：`prefix` 与 `path` 在源码里可能相隔
 *      十几行（中间夹着 body 对象），所以不能假设它们相邻。
 *   3. 参数化路径归一化：`{roomId}` / `$roomId` / `:roomId` → `{X}`。
 *   4. 拼接后的完整路径在 ledger 中找不到 → 报错并给出最接近的候选。
 *
 * 增强（2026-10-01）:
 *   - 通配符匹配：支持字面量 vs 通配符等价匹配（如 send/m.room.message/{txn} vs send/{event_type}/{txn_id}）
 *   - HTTP 方法校验：避免 PUT 误匹配到 GET 路由（假阳性）
 *   - MSC 编号格式校验：检测 SDK 中未注册的 MSC 编号引用
 *
 * 增强（2026-10-06）—— 补抽取器盲区（详见 docs/sdk-encapsulation-audit.md §13.15.7）:
 *   上一版只认两种写法：
 *     A) 对象字面量 { method: Method.X, path: "...", prefix: ... }
 *     B) `authedRequest<T>(Method.X, "...", ...)`
 *   于是**所有位置参数形态的包装器**都没进入校验 —— 其中 `adminRequest` 就有 234 处调用点。
 *   后果：admin 面 6 处「打后端未注册路径」的缺陷在门禁全绿的情况下长期存活
 *   （例：`getAdminInfo()` 打 `/_synapse/admin/v1/info`，而后端注册的是无 v1 段的
 *   `/_synapse/admin/info`）。
 *   本版把位置参数包装器改为**表驱动**（POSITIONAL_WRAPPERS），并对**故意不覆盖**的
 *   包装器显式登记（EXCLUDED_WRAPPERS）并打印在报告里 —— 覆盖率必须是可审计的，
 *   不能靠"没写就是没覆盖"这种沉默。
 *
 * 用法:
 *   node scripts/quality/verify-path-contract.mjs [--json] [--verbose]
 *
 * 退出码:
 *   0 = 全部匹配
 *   1 = 存在不匹配（CI 应红）
 *   2 = 门禁自身无法运行（ledger 缺失 / 源码无法解析）—— 刻意与 1 区分，
 *       避免把"环境问题"误报成"代码缺陷"。
 *
 * 环境变量:
 *   LEDGER_PATH  覆盖 ledger 路径
 *   SCAN_ROOTS   覆盖要扫描的目录（逗号分隔，默认 src）
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");

const EMIT_JSON = process.argv.includes("--json");
const VERBOSE = process.argv.includes("--verbose");

// ---------------------------------------------------------------------------
// 1. 加载后端 ledger
// ---------------------------------------------------------------------------

const LEDGER_PATH = process.env.LEDGER_PATH ?? "../synapse-rust/tests/unit/fixtures/ledger_export_sdk/all.json";
const ledgerFile = resolve(PROJECT_ROOT, LEDGER_PATH);

if (!existsSync(ledgerFile)) {
    console.error(`❌ ledger 不存在: ${ledgerFile}`);
    console.error(`   请先拉取/更新 synapse-rust，或设置 LEDGER_PATH 环境变量。`);
    process.exit(2);
}

let backendRoutes;
try {
    const ledger = JSON.parse(readFileSync(ledgerFile, "utf8"));
    backendRoutes = new Map();
    for (const entry of ledger.entries) {
        backendRoutes.set(`${entry.method.toUpperCase()} ${normalizePath(entry.path)}`, entry.path);
    }
} catch (e) {
    console.error(`❌ ledger 解析失败: ${e.message}`);
    process.exit(2);
}

// ---------------------------------------------------------------------------
// 2. 前缀常量表 —— 手工镜像 src/http-api/prefix.ts
//    （不解析 TS enum：那是另一层依赖，而这张表本身就是可审计的契约声明。
//      改动 prefix.ts 时必须同步改这里 —— 单元测试会校验两者一致。）
// ---------------------------------------------------------------------------

const PREFIX_CONSTANTS = {
    AdminPrefix: { V1: "/_synapse/admin/v1" },
    ClientPrefix: {
        R0: "/_matrix/client/r0",
        V1: "/_matrix/client/v1",
        V3: "/_matrix/client/v3",
        Unstable: "/_matrix/client/unstable",
    },
    IdentityPrefix: { V2: "/_matrix/identity/v2" },
    MediaPrefix: { V1: "/_matrix/media/v1", V3: "/_matrix/media/v3" },
    ServerPrefix: { V1: "/_matrix/server/v1" },
    FederationPrefix: { V1: "/_matrix/federation/v1" },
    VendorPrefix: { "": "/_matrix/vendor/v1" },
};

/**
 * SDK 在**没有显式 `prefix:` 字段**时使用的默认前缀。
 * 依据 `src/managers/base-manager.ts` 的 request 实现（client 默认走 ClientPrefix.V3）。
 * 若上游改成别的默认值，这里也要跟着改——`spec/unit/base-manager-request.spec.ts` 会先红。
 */
const DEFAULT_PREFIX = "/_matrix/client/v3";

// ---------------------------------------------------------------------------
// 2b. 位置参数请求包装器表（2026-10-06 新增）
//
// 每个条目描述一个形如 `helper(Method.X, "<relative-path>", ...)` 的包装器，
// 以及它会把该 relative-path 拼到哪个前缀上。字段三选一：
//   fixed: [...]      前缀是固定字面量列表；任一命中即算匹配
//   byDir: [...]      **同名 helper 在不同模块注入不同前缀**时按目录区分（见下方 doRequest）：
//                     `[["src/widgets/", ["/_matrix/client/v1"]], ...]` + fallback。
//                     不按目录区分就会造出假阳性 —— widgets 的 `doRequest` 走 V1，
//                     若统一按 V3 校验，14 个本来正确的调用点会被一起报成错误。
//   opts:  n          前缀取自第 n 个参数（0-based）的 `prefix:` 字段；缺省 → DEFAULT_PREFIX
//   arg:   n          前缀就是第 n 个参数（0-based）本身
//
// ⚠️ 新增请求包装器时必须同步登记此表 —— 否则其调用点不会被校验。
//    回归守卫：spec/unit/path-contract-extractor.spec.ts
// ---------------------------------------------------------------------------
const POSITIONAL_WRAPPERS = {
    // ── admin 面（本表存在的直接原因：这 234 处调用点此前完全未被校验）──
    adminRequest: { fixed: ["/_synapse/admin/v1"] }, // base-manager.ts:adminRequest，前缀恒为 AdminPrefix.V1
    v2Request: { fixed: ["/_synapse/admin"] }, // admin-base-manager.ts:v2Request，注意**无版本段**
    // ── room-summary 内部面 ──
    requestInternal: { fixed: ["/_synapse/room_summary/v1"] }, // room-summary-base-manager.ts
    requestV3: { fixed: ["/_matrix/client/v3"] },
    // ── 其他固定前缀包装器 ──
    doRequestV3: { fixed: ["/_matrix/client/v3"] }, // widgets/index.ts（仅 capabilities / send / create）
    doRequest: {
        byDir: [
            ["src/widgets/", ["/_matrix/client/v1"]], // widgets/index.ts:doRequest → ClientPrefix.V1
            ["src/space/", ["/_matrix/client/v3"]], // space/sub-managers/*.ts → ClientPrefix.V3
            ["src/client/worker/", ["/_synapse/worker"]], // client/worker/worker.ts → WORKER_PREFIX
        ],
        fallback: ["/_matrix/client/v3"],
    },
    // ── 完整字面量路径（prefix 为 ""，path 自带 /_matrix/... 前缀）──
    requestWithRetry: { fixed: [""] }, // rust-crypto/OutgoingRequestProcessor.ts
    makeRequestWithUIA: { fixed: [""] },
    // ── 前缀由调用方给出 ──
    idServerRequest: { arg: 3 }, // http-api/fetch.ts — 第 4 个参数就是 prefix
    authedRequest: { opts: 4 }, // http-api/fetch.ts — opts.prefix，缺省 v3
    request: { opts: 4 }, // http-api/fetch.ts — 同上（此前完全未被提取）
};

/**
 * 故意**不**纳入校验的包装器 —— 显式登记而非默默略过。
 * 报告里会打印这张表，使「覆盖面」本身可被审阅：想偷偷漏掉一类写法，
 * 就必须在这里写下一行理由。
 */
const EXCLUDED_WRAPPERS = {
    requestOtherUrl:
        "第 2 个参数是**完整 URL**（含 host），用于联邦/身份服务器的跨 host 请求；" +
        "不属于「SDK relative path ↔ 后端 ledger」的校验范畴。",
    rawJsonRequest:
        '同 requestOtherUrl（prefix 为 "" + 完整字面量），且其调用点全部经由 ' +
        "requestWithRetry / makeRequestWithUIA 这两个已登记的入口。",
    sendToDeviceRequest:
        "rust-crypto 的 to-device 特化入口，内部把 path 拼成完整字面量后交给 requestWithRetry；" +
        "其字面量由 msg 运行时决定，静态不可求值。",
};

/**
 * 不属于「homeserver ledger」校验范畴的路径命名空间 —— 单独成桶，**不计入 mismatch**。
 *
 * ledger 是 homeserver 的路由表。identity server（身份服务器）是独立部署的服务，
 * 它的路由永远不会出现在 ledger 里：这是**结构性的**，不是缺口。
 * 显式登记并单独计数，避免两件坏事：
 *   ① 把它们当成 mismatch（假阳性）；② 用一堆豁免把它们盖掉（豁免注水）。
 */
const OUT_OF_SCOPE_PREFIXES = {
    "/_matrix/identity/":
        "identity server（身份服务器）是独立部署的服务，本后端 ledger 只含 homeserver 路由；" +
        "SDK 打的是配置里指定的身份服务器地址。",
};

function resolvePrefix(expr) {
    // 无 prefix 字段 → 用默认前缀（不是"无法判断"）
    if (!expr) return { prefix: DEFAULT_PREFIX, known: true };

    const literal = expr.trim().replace(/^["'`]|["'`]$/g, "");

    // VendorPrefix 是 const 字符串（不是 enum），源码里直接当值用
    if (literal === "VendorPrefix") return { prefix: PREFIX_CONSTANTS.VendorPrefix[""], known: true };

    // 模板字面量前缀：`${ClientPrefix.Unstable}/org.matrix.msc4143`
    // 注意：上面的 strip 已经去掉了两端的引号/反引号，所以这里的正则不能再要求反引号，
    // 否则永远匹配不上 → 正确的 unstable 前缀会被误判为「用默认 v3 前缀」。
    // 纯字符串不可能以 `${` 开头，所以这里只可能是（被剥了反引号的）模板字面量。
    if (literal.startsWith("${")) {
        const resolved = resolveTemplateLiteral(literal);
        return { prefix: resolved, known: true };
    }

    // 裸字符串前缀（少数地方直接写字面量）
    if (literal.startsWith("/")) return { prefix: literal, known: true };

    const m = /^(\w+)\.(\w+)$/.exec(literal);
    if (m) {
        const group = PREFIX_CONSTANTS[m[1]];
        if (group && group[m[2]] !== undefined) return { prefix: group[m[2]], known: true };
        return { prefix: null, known: false };
    }
    return { prefix: null, known: false };
}

// ---------------------------------------------------------------------------
// 模板字面量解析辅助函数
// ---------------------------------------------------------------------------

/**
 * 解析模板字面量字符串（已剥去反引号），返回最终拼接的完整前缀字符串。
 * 支持简单的插值表达式：`${ClientPrefix.Unstable}...`
 */
function resolveTemplateLiteral(literal) {
    // 简单实现：只支持当前出现的插值表达式的类型
    // 例如 `${ClientPrefix.Unstable}/org.matrix.msc4143`
    // 支持组合：先解析插值，再拼接后缀

    // 匹配第一个 `${...}` 表达式的类型
    const interpMatch = /^\$\{(\w+)\.(\w+)\}(.*)$/.exec(literal);
    if (interpMatch) {
        const [_, group, key, rest] = interpMatch;
        const base = PREFIX_CONSTANTS[group]?.[key] || "";
        // 递归解析剩余部分（可能包含其他插值表达式）
        const restResult = rest.includes("$") ? resolveTemplateLiteral(rest) : rest;
        return base + restResult;
    }

    // 没有插值表达式，返回字符串本身
    return literal;
}

// ---------------------------------------------------------------------------
// 3. 路径归一化
// ---------------------------------------------------------------------------

function normalizePath(p) {
    return (
        p
            // ${encodeURIComponent(x)} / ${this.encode(x)} / ${x || y} 等任意插值表达式 → {X}
            .replace(/\$\{[^}]*\}/g, "{X}")
            .replace(/\$(\w+)/g, "{X}") // $roomId（无花括号形态）
            .replace(/\{[^}]+\}/g, "{X}") // {roomId}
            .replace(/:(\w+)/g, "{X}") // :roomId
            .split("?")[0]
            .replace(/\/+$/, "") || "/"
    );
}

/**
 * 形态 A（对象字面量，主流写法）：
 *   this.request({ method: Method.Post, path: "/appservices", body: {...}, prefix: AdminPrefix.V1 })
 *
 * 难点：prefix 与 path 之间可能夹着整个 body 对象。所以不能靠正则的固定顺序，
 * 而是：先锚定 `method:`，再在该调用对象的括号配平范围内分别找 `path:` 和 `prefix:`。
 */
function extractObjectCalls(source) {
    const calls = [];
    const methodRe = /\bmethod:\s*Method\.(\w+)/g;

    let m;
    while ((m = methodRe.exec(source)) !== null) {
        const start = m.index;

        // 从 method: 往后找到包裹它的对象字面量的闭合括号
        const openIdx = source.lastIndexOf("{", start);
        if (openIdx < 0) continue;
        const closeIdx = matchBrace(source, openIdx);
        if (closeIdx < 0) continue;

        const region = source.slice(start, closeIdx);

        const pathM = region.match(/\bpath:\s*(`[^`]*`|"[^"]*"|'[^']*')/);
        if (!pathM) continue;

        // prefix 允许在 path 之前或之后，null 表示"无显式前缀，用默认值"
        // 支持：标识符（ClientPrefix.V3）、普通字符串、模板字面量（`/_matrix/client/unstable/org.matrix.msc4143`）
        const prefixM =
            region.match(/\bprefix:\s*(`[^`]*`|[\w.]+|"[^"]*"|'[^']*')/) ??
            source.slice(openIdx, closeIdx).match(/\bprefix:\s*(`[^`]*`|[\w.]+|"[^"]*"|'[^']*')/);

        calls.push({
            method: m[1].toUpperCase(),
            pathRaw: pathM[1],
            // 有字面量就用它；null 会让 resolvePrefix 走默认前缀分支
            prefixExpr: prefixM?.[1] ?? null,
            line: source.slice(0, start).split("\n").length,
        });
    }
    return calls;
}

// ---------------------------------------------------------------------------
// 前缀表达式求值（支持多候选）—— 位置参数包装器用
// ---------------------------------------------------------------------------

/** 在顶层（不在括号/字符串内）扫描，返回第一个满足 pred 的字符下标 */
function findTopLevel(src, pred) {
    let depth = 0;
    let inStr = null;
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (inStr) {
            if (c === "\\") i++;
            else if (c === inStr) inStr = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            inStr = c;
            continue;
        }
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") depth--;
        else if (depth === 0 && pred(c, i)) return i;
    }
    return -1;
}

/**
 * `cond ? A : B` → { whenTrue: "A", whenFalse: "B" }，否则 null。
 * 两条腿都要合法，因为**fallback 的两条路径都真会被发出去**——
 * 只校验其中一条等于没校验（`client-auth.ts` 的 MSC2965 稳定/unstable 回退就是这种）。
 */
function splitTopLevelTernary(expr) {
    // 跳过 `?.`（可选链）与 `??`（空值合并）
    const q = findTopLevel(expr, (c, i) => c === "?" && expr[i + 1] !== "." && expr[i + 1] !== "?");
    if (q < 0) return null;
    const colon = findTopLevel(expr.slice(q + 1), (c) => c === ":");
    if (colon < 0) return null;
    return {
        whenTrue: expr.slice(q + 1, q + 1 + colon).trim(),
        whenFalse: expr.slice(q + 1 + colon + 1).trim(),
    };
}

/** 顶层 `+` 切分（不在字符串内的拼接） */
function splitTopLevelPlus(expr) {
    const parts = [];
    let rest = expr;
    let offset = 0;
    for (;;) {
        const p = findTopLevel(rest, (c, i) => c === "+" && rest[i - 1] !== "+" && rest[i + 1] !== "+");
        if (p < 0) {
            parts.push(rest.trim());
            break;
        }
        parts.push(rest.slice(0, p).trim());
        offset += p + 1;
        rest = rest.slice(p + 1);
    }
    return parts.filter((p) => p !== "");
}

/**
 * 求值一个前缀表达式，返回**候选前缀集合**。
 * known=false 表示无法静态求值 —— 调用点会被计入「动态跳过」并显示在 --verbose 里，
 * 而不是被悄悄当成"匹配成功"。
 */
function resolvePrefixExpression(expr) {
    const e = (expr ?? "").trim();
    if (!e) return { candidates: [DEFAULT_PREFIX], known: true };

    const tern = splitTopLevelTernary(e);
    if (tern) {
        const a = resolvePrefixExpression(tern.whenTrue);
        const b = resolvePrefixExpression(tern.whenFalse);
        if (a.known && b.known) {
            return { candidates: [...new Set([...a.candidates, ...b.candidates])], known: true };
        }
        return { candidates: [], known: false };
    }

    const plusParts = splitTopLevelPlus(e);
    if (plusParts.length > 1) {
        let acc = [""];
        for (const part of plusParts) {
            const r = resolvePrefixExpression(part);
            if (!r.known) return { candidates: [], known: false };
            const next = [];
            for (const a of acc) for (const c of r.candidates) next.push(a + c);
            acc = next;
        }
        return { candidates: [...new Set(acc)], known: true };
    }

    const { prefix, known } = resolvePrefix(e);
    return known ? { candidates: [prefix], known: true } : { candidates: [], known: false };
}

/** 根据包装器声明 + 实参 + 所在文件，得出该调用的前缀候选 */
function candidatesForWrapper(spec, args, relFile) {
    if (spec.byDir) {
        const hit = spec.byDir.find(([dirPrefix]) => relFile.startsWith(dirPrefix));
        return { candidates: hit ? hit[1] : spec.fallback, known: true };
    }

    if (spec.fixed) return { candidates: spec.fixed, known: true };

    if (spec.arg !== undefined) {
        const expr = args[spec.arg];
        if (expr === undefined) return { candidates: [], known: false };
        return resolvePrefixExpression(expr);
    }

    if (spec.opts !== undefined) {
        const optsArg = args[spec.opts];
        // 没传 opts → 走默认前缀；传了但没有 prefix: 字段 → 同样走默认前缀
        if (optsArg === undefined) return { candidates: [DEFAULT_PREFIX], known: true };
        const pm = /\bprefix:\s*([^,}]*)/.exec(optsArg);
        const expr = pm?.[1]?.trim();
        // 空值（如 `prefix: undefined`）也按默认前缀处理
        if (!expr || expr === "undefined") return { candidates: [DEFAULT_PREFIX], known: true };
        return resolvePrefixExpression(expr);
    }

    return { candidates: [], known: false };
}

// ---------------------------------------------------------------------------
// 形态 C（位置参数，表驱动）：helper(Method.X, "<relative-path>", ...)
// 覆盖范围完全由 POSITIONAL_WRAPPERS 决定 —— 见文件头「增强（2026-10-06）」。
// ---------------------------------------------------------------------------

/** 跳过 `<...>` 泛型参数（支持嵌套），返回 `>` 之后的下标；不是泛型则原样返回 */
function skipGenerics(src, i) {
    if (src[i] !== "<") return i;
    let depth = 0;
    for (; i < src.length; i++) {
        const c = src[i];
        if (c === "<") depth++;
        else if (c === ">") {
            depth--;
            if (depth === 0) return i + 1;
        }
    }
    return -1;
}

/** 从 `(` 起按顶层逗号切分实参（自动忽略字符串/括号内部的逗号） */
function splitTopLevelArgs(src, openIdx) {
    const closeParen = matchParen(src, openIdx);
    if (closeParen < 0) return null;
    const inner = src.slice(openIdx + 1, closeParen);
    const args = [];
    let depth = 0;
    let inStr = null;
    let start = 0;
    for (let i = 0; i < inner.length; i++) {
        const c = inner[i];
        if (inStr) {
            if (c === "\\") i++;
            else if (c === inStr) inStr = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            inStr = c;
            continue;
        }
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") depth--;
        else if (c === "," && depth === 0) {
            args.push(inner.slice(start, i));
            start = i + 1;
        }
    }
    args.push(inner.slice(start));
    return args.map((a) => a.trim());
}

function extractWrapperCalls(source, relFile) {
    const calls = [];
    const names = Object.keys(POSITIONAL_WRAPPERS);
    // 名字前的 `this.` / `api.` / `this.client.http.` 等链式前缀由 \b 天然丢弃。
    // 方法**定义处**（`protected async adminRequest<T>(method: Method, ...)`）也会被本正则命中，
    // 但会在下面「第 1 个实参必须是 Method.X」这一步被过滤掉。
    const nameRe = new RegExp(`\\b(${names.join("|")})\\b`, "g");

    for (const m of source.matchAll(nameRe)) {
        let i = skipGenerics(source, m.index + m[1].length);
        if (i < 0) continue;
        while (i < source.length && /\s/.test(source[i])) i++;
        if (source[i] !== "(") continue;

        const args = splitTopLevelArgs(source, i);
        if (!args || args.length < 2) continue;

        const methodM = /^Method\.(\w+)$/.exec(args[0]);
        if (!methodM) continue;
        if (!/^(`[^`]*`|"[^"]*"|'[^']*')$/.test(args[1])) continue; // 路径必须是字面量

        const { candidates, known } = candidatesForWrapper(POSITIONAL_WRAPPERS[m[1]], args, relFile);
        calls.push({
            method: methodM[1].toUpperCase(),
            pathRaw: args[1],
            prefixCandidates: candidates,
            prefixKnown: known,
            wrapper: m[1],
            line: source.slice(0, m.index).split("\n").length,
        });
    }
    return calls;
}

/** 从 openIdx 处的 `(` 开始做圆括号配平，返回闭合 `)` 的下标 */
function matchParen(src, openIdx) {
    if (openIdx < 0) return -1;
    let depth = 0;
    let inStr = null;
    for (let i = openIdx; i < src.length; i++) {
        const c = src[i];
        if (inStr) {
            if (c === "\\") i++;
            else if (c === inStr) inStr = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            inStr = c;
            continue;
        }
        if (c === "(") depth++;
        else if (c === ")") {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/**
 * 去掉注释，避免把 JSDoc `@example` 里的示例代码当成真实调用。
 * `base-manager.ts` 和 `errors.ts` 的文档块里都写了完整的 request 示例，
 * 不剔除就会产出「代码里根本不存在」的假缺口。
 */
function stripComments(source) {
    let out = "";
    let i = 0;
    const n = source.length;
    // 简单状态机：normal → lineComment / blockComment / string
    let state = "normal";
    let quote = "";

    while (i < n) {
        const c = source[i];
        const next = source[i + 1];

        if (state === "normal") {
            if (c === "/" && next === "/") {
                state = "lineComment";
                out += "  ";
                i += 2;
                continue;
            }
            if (c === "/" && next === "*") {
                state = "blockComment";
                out += "  ";
                i += 2;
                continue;
            }
            if (c === '"' || c === "'" || c === "`") {
                state = "string";
                quote = c;
                out += c;
                i++;
                continue;
            }
            out += c;
            i++;
            continue;
        }

        if (state === "lineComment") {
            if (c === "\n") {
                state = "normal";
                out += c;
            } else {
                out += " "; // 保留列宽，便于按行号定位
            }
            i++;
            continue;
        }

        if (state === "blockComment") {
            if (c === "*" && next === "/") {
                state = "normal";
                out += "  ";
                i += 2;
                continue;
            }
            out += c === "\n" ? "\n" : " ";
            i++;
            continue;
        }

        if (state === "string") {
            out += c;
            if (c === "\\") {
                out += next ?? "";
                i += 2;
                continue;
            }
            if (c === quote) {
                state = "normal";
            }
            i++;
            continue;
        }
    }
    return out;
}

/** 从 openIdx 处的 `{` 开始做括号配平，返回闭合 `}` 的下标 */
function matchBrace(src, openIdx) {
    let depth = 0;
    let inStr = null;
    for (let i = openIdx; i < src.length; i++) {
        const c = src[i];
        if (inStr) {
            if (c === "\\") i++;
            else if (c === inStr) inStr = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            inStr = c;
            continue;
        }
        if (c === "{") depth++;
        else if (c === "}") {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

// ---------------------------------------------------------------------------
// 4b. 与后端注册面比对
// ---------------------------------------------------------------------------

/**
 * 判断 (method, 完整路径) 是否在后端注册面内，并返回**匹配方式**：
 *   "exact"    — 与 ledger 条目逐段完全一致
 *   "wildcard" — 仅靠「SDK 字面量段 ↔ 后端占位符段」等价规则命中。**语义存疑**，
 *                必须单独汇报让人复核：`DELETE /notifications/deactivate` 正是靠这条规则
 *                被误当成 `DELETE /notifications/{notification_id}` 而长期隐形的
 *                （真实情况是后端只有 `PUT /notifications/{id}/deactivate`）。
 *   null       — 未命中
 */
function matchAgainstLedger(method, fullPath) {
    if (backendRoutes.has(`${method} ${fullPath}`)) return "exact";

    const sdkSegments = fullPath.split("/");
    for (const [backendKey, originalBackendPath] of backendRoutes.entries()) {
        const [backendMethod] = backendKey.split(" ");
        if (backendMethod !== method) continue;

        const backendSegments = normalizePath(originalBackendPath).split("/");
        if (sdkSegments.length !== backendSegments.length) continue;

        const compatible = sdkSegments.every((seg, i) => {
            const bSeg = backendSegments[i];
            if (seg === bSeg) return true;
            // 只允许一种放宽：SDK 写了**具体值**而后端声明为占位符，且该具体值形如
            // Matrix 的事件类型 / 域名（含 "."）。这是为
            // `send/m.room.message/{txn}` vs `send/{event_type}/{txn_id}` 这类等价而留的。
            //
            // 早期版本还允许「SDK 的任意字面量段顶掉任意 {占位符} 段」，结果把
            // `/notifications/deactivate` 当成 `/notifications/{notification_id}`、
            // `/federation/blacklist/add` 当成 `/federation/blacklist/{server_name}` ——
            // 两处真缺陷因此长期隐形。收紧后它们会被正常报出。
            if (bSeg.startsWith("{") && seg !== "{X}" && seg.includes(".")) return true;
            return false;
        });
        if (compatible) return "wildcard";
    }
    return null;
}

// ---------------------------------------------------------------------------
// 5. 遍历源码
// ---------------------------------------------------------------------------

function walkSrc(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "__generated__" || entry.name === "__tests__") continue;
            out.push(...walkSrc(full));
        } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
            out.push(full);
        }
    }
    return out;
}

const scanRoots = (process.env.SCAN_ROOTS ?? "src").split(",").map((r) => resolve(PROJECT_ROOT, r.trim()));
const srcFiles = scanRoots.flatMap((r) => (existsSync(r) ? walkSrc(r) : []));

const findings = [];
const skipped = [];
const outOfScopeCalls = [];

for (const file of srcFiles) {
    const raw = readFileSync(file, "utf8");
    // 注释里的示例代码不是真实调用，先剥掉再提取
    const source = stripComments(raw);
    const relFile = file.slice(PROJECT_ROOT.length + 1);

    // 同一调用可能被两种提取器各命中一次，按 method+path+候选前缀 去重
    const seen = new Set();
    const calls = [...extractObjectCalls(source), ...extractWrapperCalls(source, relFile)];

    for (const call of calls) {
        // 统一成「前缀候选集」：
        //   对象形态 → 单候选；位置参数形态 → 可能多候选（如 doRequest 的两种前缀、
        //   三元 fallback 的两条腿）。任一候选命中即视为匹配 —— 见 POSITIONAL_WRAPPERS 注释。
        let candidates;
        let known;
        if (call.prefixCandidates) {
            candidates = call.prefixCandidates;
            known = call.prefixKnown;
        } else {
            const r = resolvePrefix(call.prefixExpr);
            candidates = r.known ? [r.prefix] : [];
            known = r.known;
        }

        // 去重键含行号：既避免「同一调用被两种提取器各命中一次」，又不会把
        // 同一文件里两个**不同调用点**（如 getServerInfo / getAdminInfo 都打 /info）合并成一条。
        const dedupKey = `${call.method}|${call.pathRaw}|${candidates.join("\u0001")}|${call.line}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        // 模板字面量可通过归一化处理（${...} → {X}），不跳过
        const pathOnly = call.pathRaw.replace(/^["'`]|["'`]$/g, "");
        if (!pathOnly.includes("${") && !pathOnly.startsWith("/")) {
            skipped.push({ file: relFile, line: call.line, reason: "非字面量路径" });
            continue;
        }

        if (!known) {
            skipped.push({
                file: relFile,
                line: call.line,
                reason: `无法静态求值的前缀（${call.prefixExpr ?? call.wrapper ?? "?"}）`,
            });
            continue;
        }

        // pathOnly 本身已是完整路径时忽略 prefix，避免双重前缀
        const isFullUrl = /^\/_matrix\/(client|admin|vendor|identity|media|federation|server)/.test(pathOnly);

        // 域外命名空间：结构性不属于本 ledger，单独计数后跳过
        const probePath = isFullUrl ? pathOnly : (candidates[0] ?? "") + pathOnly;
        const outOfScopePrefix = Object.keys(OUT_OF_SCOPE_PREFIXES).find((p) => probePath.startsWith(p));
        if (outOfScopePrefix) {
            outOfScopeCalls.push({
                file: relFile,
                line: call.line,
                method: call.method,
                fullPath: normalizePath(probePath),
                prefix: outOfScopePrefix,
            });
            continue;
        }

        let matchKind = null;
        let fullPath = null; // 报告用：第一个候选算出的路径作为「主路径」
        for (const prefix of candidates) {
            const fp = normalizePath(isFullUrl ? pathOnly : (prefix ?? "") + pathOnly);
            if (fullPath === null) fullPath = fp;
            const kind = matchAgainstLedger(call.method, fp);
            if (kind) {
                matchKind = kind;
                fullPath = fp;
                break;
            }
        }
        const matched = matchKind !== null;

        const finding = {
            file: relFile,
            line: call.line,
            method: call.method,
            sdkPath: pathOnly,
            fullPath,
            matched,
            matchKind,
        };

        if (!matched) {
            const bare = normalizePath(pathOnly);
            const candidatesList = [...backendRoutes.entries()]
                .filter(([, original]) => {
                    const n = normalizePath(original);
                    return n.endsWith(bare) || bare.endsWith(n);
                })
                .map(([k]) => k);
            if (candidatesList.length > 0) finding.suggestion = candidatesList.slice(0, 3).join(" | ");
        }

        findings.push(finding);
    }
}

// ---------------------------------------------------------------------------
// 6. Waiver 处理
// ---------------------------------------------------------------------------

/**
 * 豁免表的作用是「让已知缺口可见但不作红」，而不是「让门禁闭嘴」。
 * 三条约束：
 *   1. 每条豁免必须有 reason 和 expires —— 没有主人的豁免等于删除门禁；
 *   2. 过期即失败 —— 强制定期复核；
 *   3. 没被用到的豁免也要报 —— 后端补齐后忘记删豁免，会让门禁的失败面被旧条目遮住。
 */
const WAIVER_FILE = join(__dirname, "path-contract-waivers.json");
let waivers = new Map(); // "<METHOD> <path>" -> {reason, expires, file}
let expiredWaivers = [];
let unusedWaivers = [];

if (existsSync(WAIVER_FILE)) {
    let waiverDoc;
    try {
        waiverDoc = JSON.parse(readFileSync(WAIVER_FILE, "utf8"));
    } catch (e) {
        console.error(`❌ 豁免表解析失败: ${WAIVER_FILE}\n   ${e.message}`);
        process.exit(2);
    }

    const today = new Date();
    for (const w of waiverDoc.waivers ?? []) {
        const key = `${w.sdkCall}`;
        if (!w.reason || !w.expires) {
            console.error(`❌ 豁免条目缺少 reason 或 expires: ${key}`);
            process.exit(2);
        }
        if (new Date(w.expires) < today) {
            expiredWaivers.push({ key, ...w });
            continue;
        }
        waivers.set(key, w);
    }
} else {
    console.error(`❌ 豁免表不存在: ${WAIVER_FILE}`);
    process.exit(2);
}

// ---------------------------------------------------------------------------
// 7. 报告
// ---------------------------------------------------------------------------

/**
 * MSC 编号格式校验：检测 SDK 中引用的 MSC 编号是否与后端实现一致
 * 常见错误：MSC3882（Allow an existing session to sign in a new session）vs MSC3720（Account status）张冠李戴
 */
function validateMSCReferences(findings, backendRoutes) {
    const mscIssues = [];

    // 从所有调用中提取可能的 MSC 引用
    for (const finding of findings) {
        if (finding.sdkPath.includes("org.matrix.msc")) {
            const mscMatch = finding.sdkPath.match(/org\.matrix\.msc(\d+)/i);
            if (mscMatch) {
                const mscNum = mscMatch[1];
                const mscPath = finding.sdkPath;

                // 检查该 MSC 路径是否在后端已注册
                let mscMatched = false;
                for (const [key, orig] of backendRoutes.entries()) {
                    if (orig.includes(`org.matrix.msc${mscNum}`) || orig.includes(`msc${mscNum}`)) {
                        mscMatched = true;
                        break;
                    }
                }

                if (!mscMatched) {
                    mscIssues.push({
                        msc: `MSC${mscNum}`,
                        path: mscPath,
                        file: finding.file,
                        line: finding.line,
                        note: "SDK 声称实现该 MSC 端点，但后端 ledger 中无对应路由。请核实 MSC 编号是否正确。",
                    });
                }
            }
        }
    }

    return mscIssues;
}

const rawMismatches = findings.filter((f) => !f.matched);

// 仅靠通配符规则命中的调用点 —— 单独汇报，避免「形似而已」被当成匹配成功。
const wildcardMatches = findings.filter((f) => f.matchKind === "wildcard");

const mismatches = rawMismatches.filter((f) => {
    const key = `${f.method} ${f.fullPath}`;
    if (waivers.has(key)) {
        waivers.delete(key); // 标记为「已使用」
        return false;
    }
    return true;
});

// 没被任何不匹配命中到的豁免 = 后端已补齐但豁免没删
unusedWaivers = [...waivers.entries()].map(([key, w]) => ({ key, ...w }));

const payload = {
    generatedAt: new Date().toISOString(),
    ledger: LEDGER_PATH,
    scannedFiles: srcFiles.length,
    totalCalls: findings.length,
    matched: findings.length - rawMismatches.length,
    wildcardMatched: wildcardMatches.length,
    waived: rawMismatches.length - mismatches.length,
    mismatched: mismatches.length,
    expiredWaivers: expiredWaivers.length,
    unusedWaivers: unusedWaivers.length,
    skippedDynamic: skipped.length,
    outOfScope: outOfScopeCalls.length,
    outOfScopeCalls: outOfScopeCalls.map((c) => ({
        file: c.file,
        line: c.line,
        method: c.method,
        fullPath: c.fullPath,
    })),
    coveredWrappers: Object.keys(POSITIONAL_WRAPPERS),
    excludedWrappers: Object.keys(EXCLUDED_WRAPPERS),
    mismatches: mismatches.map((m) => ({
        file: m.file,
        line: m.line,
        method: m.method,
        fullPath: m.fullPath,
        suggestion: m.suggestion ?? null,
    })),
    wildcardMatches: wildcardMatches.map((m) => ({
        file: m.file,
        line: m.line,
        method: m.method,
        fullPath: m.fullPath,
    })),
};

if (EMIT_JSON) {
    console.log(JSON.stringify(payload, null, 2));
} else {
    console.log("");
    console.log("╔══════════════════════════════════════════════════════════════════╗");
    console.log("║        SDK ↔ 后端路径契约交叉校验（P2-a 门禁）                   ║");
    console.log("╚══════════════════════════════════════════════════════════════════╝");
    console.log("");
    console.log(`  ledger       : ${LEDGER_PATH}`);
    console.log(`  扫描源文件   : ${srcFiles.length}`);
    console.log(`  提取请求调用 : ${findings.length}`);
    console.log(`  匹配成功     : ${payload.matched}（其中 ${payload.wildcardMatched} 处为通配符匹配，见下）`);
    console.log(`  已豁免       : ${payload.waived}（后端未实现，见 path-contract-waivers.json）`);
    console.log(`  不匹配       : ${payload.mismatched}`);
    console.log(`  豁免已过期   : ${payload.expiredWaivers}`);
    console.log(`  豁免未被引用 : ${payload.unusedWaivers}（后端已补齐？应删除条目）`);
    console.log(`  动态跳过     : ${skipped.length}`);
    console.log(`  域外命名空间 : ${payload.outOfScope}（不属于本 ledger 的服务，如 identity server）`);
    console.log(`  覆盖的包装器 : ${payload.coveredWrappers.length}（${payload.coveredWrappers.join(", ")}）`);
    console.log(`  未覆盖的包装器: ${payload.excludedWrappers.length}（${payload.excludedWrappers.join(", ")}）`);
    console.log("");

    if (expiredWaivers.length > 0) {
        console.log("─".repeat(84));
        console.log("⏰ 已过期的豁免（必须复核并处理）：");
        console.log("─".repeat(84));
        for (const w of expiredWaivers) {
            console.log(`  ${w.key}  (expires ${w.expires})`);
            console.log(`    ${w.file} — ${w.reason}`);
        }
        console.log("");
    }

    if (unusedWaivers.length > 0) {
        console.log("─".repeat(84));
        console.log("🧹 未被引用的豁免（对应的缺口已不存在，请删除条目）：");
        console.log("─".repeat(84));
        for (const w of unusedWaivers) {
            console.log(`  ${w.key}  (expires ${w.expires})`);
        }
        console.log("");
    }

    if (mismatches.length > 0) {
        console.log("─".repeat(84));
        console.log("不匹配的路径（在真实后端上会 404）：");
        console.log("─".repeat(84));
        for (const m of mismatches) {
            console.log("");
            console.log(`  ${m.method} ${m.fullPath}`);
            console.log(`    at ${m.file}:${m.line}`);
            if (m.suggestion) {
                console.log(`    ledger 相近条目: ${m.suggestion}`);
            } else {
                console.log(`    ledger 中无相近条目`);
                console.log(`    → 若后端确实未实现，请加进 path-contract-waivers.json 并写明原因与期限；`);
                console.log(`      若后端已实现，说明 SDK 拼错了路径，请修正 SDK。`);
            }
        }
        console.log("");
        console.log("─".repeat(84));
        console.log(`❌ ${mismatches.length} 处路径契约不符 —— 门禁失败。`);
    } else {
        console.log(`✅ 全部静态请求路径均与后端 ledger 一致（豁免 ${payload.waived} 处已登记）。`);
    }

    // MSC 编号格式校验报告
    const mscIssues = validateMSCReferences(findings, backendRoutes);
    if (mscIssues.length > 0) {
        console.log("");
        console.log("─".repeat(84));
        console.log("⚠️  MSC 编号引用疑似张冠李戴（SDK 声称的 MSC 端点后耑未注册）：");
        console.log("─".repeat(84));
        for (const issue of mscIssues) {
            console.log("");
            console.log(`  ${issue.msc}: ${issue.path}`);
            console.log(`    at ${issue.file}:${issue.line}`);
            console.log(`    ${issue.note}`);
            console.log(`    → 建议核对 matrix.org 官方 MSC 列表确认该 MSC 的实际编号。`);
        }
        console.log("");
    }

    if (VERBOSE && outOfScopeCalls.length > 0) {
        console.log("");
        console.log("─".repeat(84));
        console.log("🌐 域外命名空间调用点（不计入 mismatch —— 不属于本 homeserver ledger）：");
        console.log("─".repeat(84));
        for (const [prefix, reason] of Object.entries(OUT_OF_SCOPE_PREFIXES)) {
            const hits = outOfScopeCalls.filter((c) => c.prefix === prefix);
            if (hits.length === 0) continue;
            console.log(`  ${prefix}  —— ${hits.length} 处`);
            console.log(`    ${reason}`);
            for (const h of hits) console.log(`      ${h.method} ${h.fullPath}  @ ${h.file}:${h.line}`);
        }
        console.log("");
    }

    if (VERBOSE && wildcardMatches.length > 0) {
        console.log("");
        console.log("─".repeat(84));
        console.log("🔍 仅靠「字面量段 ↔ 占位符段」规则命中的调用点（语义存疑，请人工复核）：");
        console.log("─".repeat(84));
        console.log("   规则：SDK 的字面量段可以顶掉后端的任意 {占位符} 段。这条规则是为");
        console.log("   `send/m.room.message/{txn}` vs `send/{event_type}/{txn_id}` 这类等价而加的，");
        console.log("   但它同样会把 `/notifications/deactivate` 误认成 `/notifications/{id}`。");
        console.log("");
        for (const w of wildcardMatches) {
            console.log(`  ${w.method} ${w.fullPath}`);
            console.log(`    at ${w.file}:${w.line}`);
        }
        console.log("");
    }

    if (VERBOSE && skipped.length > 0) {
        console.log("");
        console.log("跳过的动态调用（无法静态求值，未参与校验）：");
        const byReason = new Map();
        for (const s of skipped) {
            byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
        }
        for (const [reason, count] of byReason) {
            console.log(`  ${reason}: ${count} 处`);
        }
    }

    if (VERBOSE) {
        console.log("");
        console.log("故意不覆盖的请求包装器（覆盖率声明 —— 想漏掉一类写法必须在此写理由）：");
        for (const [name, reason] of Object.entries(EXCLUDED_WRAPPERS)) {
            console.log(`  ${name}`);
            console.log(`    ${reason}`);
        }
    }
    console.log("");
}

// 门禁失败条件：有不匹配、有过期豁免、有未被引用的豁免
const failed = mismatches.length > 0 || expiredWaivers.length > 0 || unusedWaivers.length > 0;
process.exit(failed ? 1 : 0);
