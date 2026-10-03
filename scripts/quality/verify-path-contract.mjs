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

/**
 * 形态 B（位置参数）：authedRequest<T>(Method.Post, "/path", query, body, opts)
 *
 * `opts` 是第 5 个参数，里面的 `prefix:` 同样是有效声明 ——
 * `client-secure-backup-requests.ts:getClientConfigRequest` 就是这个写法。
 * 之前只读到第 2 个参数，导致这些调用被误判为"用默认前缀"。
 */
function extractPositionalCalls(source) {
    const calls = [];
    const re = /\bauthedRequest<[^>]*>\(\s*Method\.(\w+)\s*,\s*(`[^`]*`|"[^"]*"|'[^']*')/g;
    for (const m of source.matchAll(re)) {
        // 从 path 之后取到该调用的闭合括号，扫描其中的 prefix:
        const afterPath = m.index + m[0].length;
        const openParen = source.indexOf("(", m.index);
        const closeParen = matchParen(source, openParen);
        const tail = closeParen > 0 ? source.slice(afterPath, closeParen) : "";
        const prefixM = tail.match(/\bprefix:\s*([\w.]+|"[^"]*"|'[^']*')/);

        calls.push({
            method: m[1].toUpperCase(),
            pathRaw: m[2],
            prefixExpr: prefixM?.[1] ?? null,
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

for (const file of srcFiles) {
    const raw = readFileSync(file, "utf8");
    // 注释里的示例代码不是真实调用，先剥掉再提取
    const source = stripComments(raw);
    const relFile = file.slice(PROJECT_ROOT.length + 1);

    // 同一调用可能被两种提取器各命中一次，按 method+path 去重
    const seen = new Set();
    const calls = [...extractObjectCalls(source), ...extractPositionalCalls(source)];

    for (const call of calls) {
        const dedupKey = `${call.method}|${call.pathRaw}|${call.prefixExpr ?? ""}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        // 模板字面量现在可通过归一化处理（${...} → {X}）
        // 不再跳过，而是直接归一化后校验
        let pathOnly = call.pathRaw.replace(/^["'`]|["'`]$/g, "");

        // 如果包含插值，用 {X} 占位后再校验
        if (pathOnly.includes("${")) {
            // 允许带插值的模板字面量进入校验流程
        } else if (!pathOnly.startsWith("/")) {
            skipped.push({ file: relFile, line: call.line, reason: "非字面量路径" });
            continue;
        }

        const { prefix, known } = resolvePrefix(call.prefixExpr);
        if (!known) {
            skipped.push({ file: relFile, line: call.line, reason: `未知前缀 ${call.prefixExpr}` });
            continue;
        }

        // 如果 pathOnly 本身已是完整路径（以 /_matrix 开头且含 /client/ 或 /admin/），
        // 则忽略 prefix，直接用 pathOnly（避免双重前缀）
        const isFullUrl = /^\/_matrix\/(client|admin|vendor)/.test(pathOnly);
        const combinedPath = isFullUrl ? pathOnly : (prefix ?? "") + pathOnly;
        const fullPath = normalizePath(combinedPath);
        const key = `${call.method} ${fullPath}`;

        // 精确匹配
        let matched = backendRoutes.has(key);

        // 增强匹配：通配符 vs 字面量（如 send/m.room.message/{txnId} vs send/{event_type}/{txn_id}）
        if (!matched) {
            const sdkSegments = fullPath.split("/");
            for (const [backendKey, originalBackendPath] of backendRoutes.entries()) {
                // 首先比较 HTTP 方法
                const [backendMethod] = backendKey.split(" ");
                if (backendMethod !== call.method) continue;

                const backendSegments = normalizePath(originalBackendPath).split("/");
                if (sdkSegments.length === backendSegments.length) {
                    const isCompatible = sdkSegments.every((seg, i) => {
                        const bSeg = backendSegments[i];
                        return seg === bSeg || seg === "{X}" || bSeg.startsWith("{");
                    });
                    if (isCompatible) {
                        matched = true;
                        break;
                    }
                }
            }
        }

        const finding = {
            file: relFile,
            line: call.line,
            method: call.method,
            sdkPath: pathOnly,
            fullPath,
            matched,
        };

        if (!matched) {
            const bare = normalizePath(pathOnly);
            const candidates = [...backendRoutes.entries()]
                .filter(([, original]) => {
                    const n = normalizePath(original);
                    return n.endsWith(bare) || bare.endsWith(n);
                })
                .map(([k]) => k);
            if (candidates.length > 0) finding.suggestion = candidates.slice(0, 3).join(" | ");
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
    waived: rawMismatches.length - mismatches.length,
    mismatched: mismatches.length,
    expiredWaivers: expiredWaivers.length,
    unusedWaivers: unusedWaivers.length,
    skippedDynamic: skipped.length,
    mismatches: mismatches.map((m) => ({
        file: m.file,
        line: m.line,
        method: m.method,
        fullPath: m.fullPath,
        suggestion: m.suggestion ?? null,
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
    console.log(`  匹配成功     : ${payload.matched}`);
    console.log(`  已豁免       : ${payload.waived}（后端未实现，见 path-contract-waivers.json）`);
    console.log(`  不匹配       : ${payload.mismatched}`);
    console.log(`  豁免已过期   : ${payload.expiredWaivers}`);
    console.log(`  豁免未被引用 : ${payload.unusedWaivers}（后端已补齐？应删除条目）`);
    console.log(`  动态跳过     : ${skipped.length}`);
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
    console.log("");
}

// 门禁失败条件：有不匹配、有过期豁免、有未被引用的豁免
const failed = mismatches.length > 0 || expiredWaivers.length > 0 || unusedWaivers.length > 0;
process.exit(failed ? 1 : 0);
