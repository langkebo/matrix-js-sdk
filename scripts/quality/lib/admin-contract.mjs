/*
 * admin-contract.mjs — 后端 (Rust) 与 SDK 两侧「契约形状」的纯函数抽取器。
 *
 * ## 为什么需要它
 *
 * 2026-10-07 的六轮人工核对（审计文档 §7.15-21 ~ §7.15-26）在 admin 面找出并修掉了
 * 几十处「SDK 声明的响应/请求形状与后端不一致」的缺陷。它们能长期存活，是因为
 * **没有任何门禁把两侧对起来看**：
 *
 *   - `quality:path-contract` 只核对**路径**（连 HTTP 方法都只是顺带）；
 *   - `quality:contract:codegen` 只核对**契约文档 ↔ 生成的 dto.ts**（同一侧的自我一致）；
 *   - `contract:codegen:check` 里对 `ROUTE_CONTRACT.md` 的消费同样是**路径**层面。
 *
 * 于是「字段名错 / 少字段 / 多伪造字段 / 请求体该不该有」这一整类缺陷在门禁全绿下长期存活。
 * 本模块把两侧的抽取逻辑沉淀成可测的纯函数，供门禁与 spec 共用。
 *
 * ## 抽取原则（每一条都是踩过的坑）
 *
 * 1. **只认「返回位置」的 `json!`**：函数体里还有 `record_audit_event(..., json!({...}))`
 *    之类的内部调用。第一版用「函数体内所有 `json!`」⇒ 把审计事件的键（`admin_role` /
 *    `target_user` / `target_is_admin`）当成了响应字段，凭空造出一批假差异。
 * 2. **只取对象字面量的第一层键**：`json!({ "results": [{ "user_id": ... }] })` 的
 *    嵌套键不属于响应顶层。第一版不区分层次 ⇒ `getUserSession` 被报成「缺 session_id」。
 * 3. **键检测必须先于字符串跳过**：`"key": value` 的键本身就是带引号的字符串。
 *    第一版先走「遇到 `"` 就跳到串尾」⇒ **所有带引号的键全部丢失**，结果恒为空集合
 *    （"抽错源"比漏抽更危险：会据此得出"没有问题"的结论）。
 * 4. **区分「未知」与「空」**：`responseVariants: null` 表示无法判定（处理器走
 *    `Ok(Json(struct))` 或先算后组装），`[]` 表示确认没有 `json!` 返回。
 *    门禁必须把 `null` 报成 unknown 而不是静默通过 —— 沉默不是同意。
 *
 * ## 入口
 *
 * 作为库被 import；直接执行时打印诊断（`--dir=<path>` 可覆盖后端目录）。
 *
 * @example
 * ```js
 * import { collectRustAdminContract, collectSdkAdminContract } from "./lib/admin-contract.mjs";
 * const rust = await collectRustAdminContract({ routesDir: "../synapse-rust/synapse-web/src/routes/admin" });
 * const sdk = await collectSdkAdminContract({ srcDir: "src/admin" });
 * ```
 */

import fs from "node:fs";
import path from "node:path";

const IDENT_START = /[A-Za-z_]/;

// ---------------------------------------------------------------------------
// 通用小工具
// ---------------------------------------------------------------------------

/**
 * 去掉 Rust 的行注释与块注释。
 *
 * 不做这件事会让注释里的 `.route("/x", get(y))` 或 `json!({...})` 被当代码。
 *
 * @param {string} src
 * @returns {string}
 */
export function stripRustComments(src) {
    let out = "";
    let i = 0;
    const n = src.length;
    let str = null;
    while (i < n) {
        const c = src[i];
        if (str) {
            out += c;
            if (c === "\\" && i + 1 < n) {
                out += src[i + 1];
                i += 2;
                continue;
            }
            if (c === str) str = null;
            i++;
            continue;
        }
        if (c === '"' || c === "'") {
            str = c;
            out += c;
            i++;
            continue;
        }
        if (c === "/" && src[i + 1] === "/") {
            while (i < n && src[i] !== "\n") i++;
            continue;
        }
        if (c === "/" && src[i + 1] === "*") {
            i += 2;
            while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
            i += 2;
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

/**
 * 从 `start` 处的开括号开始，按**括号配对**取出到配对闭合为止的片段（含两端）。
 *
 * 会跳过字符串字面量与字符字面量，避免 `")"` 提前收尾。
 *
 * @param {string} src
 * @param {number} start 开括号所在下标
 * @returns {{ text: string, end: number } | null}
 */
export function balancedSlice(src, start) {
    const openers = "([{";
    const closers = ")]}";
    const open = src[start];
    if (!openers.includes(open)) {
        const idx = src.indexOf(open, start);
        if (idx < 0) return null;
        start = idx;
    }
    const stack = [];
    let i = start;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        if (c === '"' || c === "'" || c === "`") {
            const quote = c;
            i++;
            while (i < n) {
                if (src[i] === "\\") {
                    i += 2;
                    continue;
                }
                if (src[i] === quote) break;
                i++;
            }
            i++;
            continue;
        }
        if (c === "/" && src[i + 1] === "/") {
            while (i < n && src[i] !== "\n") i++;
            continue;
        }
        if (openers.includes(c)) {
            stack.push(closers[openers.indexOf(c)]);
            i++;
            continue;
        }
        if (closers.includes(c)) {
            if (stack.length === 0 || stack[stack.length - 1] !== c) {
                i++;
                continue;
            }
            stack.pop();
            if (stack.length === 0) return { text: src.slice(start, i + 1), end: i + 1 };
            i++;
            continue;
        }
        i++;
    }
    return null;
}

/**
 * 按**深度 0 的逗号**切分一段「实参列表」文本（不含外层括号）。
 *
 * @param {string} text
 * @returns {string[]}
 */
export function splitTopLevelArgs(text) {
    const parts = [];
    let depth = 0;
    let cur = "";
    let i = 0;
    const n = text.length;
    while (i < n) {
        const c = text[i];
        if (c === '"' || c === "'" || c === "`") {
            const quote = c;
            cur += c;
            i++;
            while (i < n) {
                cur += text[i];
                if (text[i] === "\\") {
                    cur += text[i + 1] ?? "";
                    i += 2;
                    continue;
                }
                if (text[i] === quote) {
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) depth--;
        else if (c === "," && depth === 0) {
            parts.push(cur.trim());
            cur = "";
            i++;
            continue;
        }
        cur += c;
        i++;
    }
    if (cur.trim().length > 0) parts.push(cur.trim());
    return parts;
}

// ---------------------------------------------------------------------------
// 后端（Rust）
// ---------------------------------------------------------------------------

/**
 * 取 Rust 对象字面量文本的**第一层**键 → 值文本。
 *
 * 实现要点（见文件头「抽取原则」2/3）：键检测先于字符串跳过；只在深度 0 取键；
 * 值文本按深度 0 的逗号或对象结尾截断，供调用方判断"值是不是一个数组/子对象"。
 *
 * @param {string} objectText 不含最外层花括号的对象内容
 * @returns {Map<string, string>}
 */
export function parseJsonObjectTopLevel(objectText) {
    const out = new Map();
    const n = objectText.length;
    let i = 0;
    let depth = 0;
    while (i < n) {
        const c = objectText[i];
        if ("([{".includes(c)) {
            depth++;
            i++;
            continue;
        }
        if (")]}".includes(c)) {
            depth--;
            i++;
            continue;
        }
        if (depth !== 0 || (!IDENT_START.test(c) && c !== '"')) {
            i++;
            continue;
        }
        // 先尝试读「键 :」；不是键就按字符串跳过（避免中间态把后面的键吃掉）
        let key = null;
        let after = i;
        if (c === '"') {
            let k = i + 1;
            while (k < n) {
                if (objectText[k] === "\\") {
                    k += 2;
                    continue;
                }
                if (objectText[k] === '"') break;
                k++;
            }
            key = objectText.slice(i + 1, k);
            after = k + 1;
        } else {
            let k = i;
            while (k < n && /[\w.]/.test(objectText[k])) k++;
            key = objectText.slice(i, k);
            after = k;
        }
        let colon = after;
        while (colon < n && /\s/.test(objectText[colon])) colon++;
        if (objectText[colon] !== ":") {
            i = Math.max(after, i + 1);
            continue;
        }
        // 值文本：到深度 0 的逗号或对象结尾
        const v = colon + 1;
        let vDepth = 0;
        let inStr = false;
        let vend = v;
        while (vend < n) {
            const ch = objectText[vend];
            if (inStr) {
                if (ch === "\\") {
                    vend += 2;
                    continue;
                }
                if (ch === '"') inStr = false;
                vend++;
                continue;
            }
            if (ch === '"') {
                inStr = true;
                vend++;
                continue;
            }
            if ("([{".includes(ch)) vDepth++;
            else if (")]}".includes(ch)) {
                if (vDepth === 0) break;
                vDepth--;
            } else if (ch === "," && vDepth === 0) break;
            vend++;
        }
        out.set(key, objectText.slice(v, vend).trim());
        i = vend;
    }
    return out;
}

/**
 * 取一个 `json!({ ... })` 调用的第一层键。
 *
 * 返回 `null` 表示**参数不是对象字面量**（如 `json!(notification)`、`json!(event)`、
 * `json!(notifications)`）—— 这种情况的响应形状在本层**不可知**，必须与
 * 「空对象 `json!({})` ⇒ `[]`」区分开。
 * 第一版把两者都返回 `[]`，于是 `notifications.get/create/update` 与
 * `get_audit_event` 被误报成「响应是空对象、SDK 声明了 16 个真实字段」
 * —— 方向正好相反的假阳性（把"后端不透明"读成了"SDK 多编字段"）。
 *
 * @param {string} src
 * @param {number} jsonBangIndex `json!` 中 `!` 的下标；函数会自行定位其后的 `(`
 * @returns {string[] | null} 排序后的键；`[]` 表示空对象字面量；`null` 表示非对象字面量
 */
export function jsonMacroTopLevelKeys(src, jsonBangIndex) {
    const parenIdx = src.indexOf("(", jsonBangIndex);
    if (parenIdx < 0) return null;
    const slice = balancedSlice(src, parenIdx);
    if (!slice) return null;
    const inner = slice.text.slice(1, -1).trim();
    if (!inner.startsWith("{")) return null;
    // 去掉最外层花括号：靠配对找到对象自身的结尾，而不是简单 lastIndexOf("}")
    const obj = balancedSlice(inner, 0);
    if (!obj || obj.text[0] !== "{") return null;
    const body = obj.text.slice(1, -1);
    return [...parseJsonObjectTopLevel(body).keys()].sort();
}

/**
 * 找出源码里所有 `pub async fn` / `async fn` 的函数**签名**与函数体（按花括号配对）。
 *
 * 同时返回签名与函数体：提取器（`Query<T>` / `Path<T>` / `Json<T>`）写在**签名**里，
 * 而响应体写在**函数体**里。第一版只返回函数体，于是 `extractHandlerIo` 拿到的
 * "签名"是从 `{` 开始的一小段 ⇒ 永远解析不到提取器（`requestKnown: 0`）。
 *
 * @param {string} src 已去注释的源码
 * @returns {Array<{ name: string, sig: string, body: string, start: number }>}
 */
export function findRustFunctions(src) {
    const out = [];
    for (const m of src.matchAll(/\n(?:pub\s+)?async\s+fn\s+([A-Za-z_]\w*)\s*[(<]/g)) {
        const brace = src.indexOf("{", m.index);
        if (brace < 0) continue;
        const slice = balancedSlice(src, brace);
        if (!slice) continue;
        out.push({ name: m[1], sig: src.slice(m.index, brace), body: slice.text, start: m.index });
    }
    return out;
}

/**
 * 抽取函数体里**返回位置**的 `json!` 顶层键集合（每个分支一个变体）。
 *
 * 只认 `Ok(Json(json!(` 形态。处理器若走 `Ok(Json(some_struct))` 或先算变量再
 * `Ok(Json(v))`，返回 `null`（**未知**，不是空 —— 沉默不等于同意）。
 *
 * 空对象 `Ok(Json(json!({})))` 会被记录成 `[[]]`（"确认没有任何响应字段"），
 * 与"未知"是两件事。
 *
 * @param {string} fnBody
 * @returns {string[][] | null}
 */
export function extractResponseVariants(fnBody) {
    const variants = [];
    for (const m of fnBody.matchAll(/Ok\(\s*Json\(\s*json!\s*\(/g)) {
        const bang = m.index + m[0].lastIndexOf("!");
        const keys = jsonMacroTopLevelKeys(fnBody, bang);
        if (keys !== null) variants.push(keys);
    }
    return variants.length ? variants : null;
}

/**
 * 抽取带 `Deserialize` 的 struct：字段名 + 是否 `deny_unknown_fields`。
 *
 * @param {string} src 已去注释的源码
 * @returns {Map<string, { fields: string[], denyUnknownFields: boolean }>}
 */
export function parseDeserializeStructs(src) {
    const out = new Map();
    for (const m of src.matchAll(/(pub\s+)?struct\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\{/g)) {
        // 往前看属性块（`#[...]` 行），限制在同一声明之前
        const headStart = Math.max(0, src.lastIndexOf("\n\n", m.index) + 1);
        const head = src.slice(headStart, m.index);
        if (!/Deserialize/.test(head)) continue;
        const deny = /deny_unknown_fields/.test(head);
        const brace = m.index + m[0].length - 1;
        const slice = balancedSlice(src, brace);
        if (!slice) continue;
        const fields = [];
        for (const fm of slice.text.matchAll(/\n\s*(?:pub\s+)?([A-Za-z_]\w*)\s*:/g)) fields.push(fm[1]);
        out.set(m[2], { fields: fields.sort(), denyUnknownFields: deny });
    }
    return out;
}

/**
 * 从函数**参数表**里抽取提取器：Query / Path / Json 分别绑到哪个类型。
 *
 * ⚠️ 只看参数表，**不能看整段签名**：返回类型是 `Result<Json<Value>, ApiError>`，
 * `Json<` 会出现在签名里，于是"该处理器接收 Json 请求体"会恒真。
 * 本模块第一版就是这样，导致「SDK 传了 body 但后端不读」与「后端要 body 但 SDK 没传」
 * 两类检查全部恒绿（假绿比漏检更危险）。
 *
 * 支持 `Json(body): Json<T>` 与 `body: Json<T>` 两种参数写法；`Query<T>` / `Path<T>` 同理。
 * 拿不到泛型参数时 `type` 为 `null`（"有该提取器，但类型未知"）。
 *
 * @param {string} sig 函数签名（`async fn name(...)` 到 `{` 之前，含返回类型）
 * @returns {{ hasQuery: boolean, hasPath: boolean, hasJson: boolean, queryType: string|null, pathType: string|null, jsonType: string|null }}
 */
export function extractHandlerIo(sig) {
    const paren = sig.indexOf("(");
    const params = paren < 0 ? "" : (balancedSlice(sig, paren)?.text.slice(1, -1) ?? "");
    const pick = (wrapper) => {
        const m = params.match(new RegExp(`${wrapper}\\s*<\\s*([A-Za-z_][\\w:]*)`));
        return { present: new RegExp(`${wrapper}\\s*<`).test(params), type: m ? m[1].split("::").pop() : null };
    };
    const q = pick("Query");
    const p = pick("Path");
    const j = pick("Json");
    return {
        hasQuery: q.present,
        hasPath: p.present,
        hasJson: j.present,
        queryType: q.type,
        pathType: p.type,
        jsonType: j.type,
    };
}

/**
 * 解析 `.route("path", get(handler).post(handler2))` 表。
 *
 * 用括号配对而非行正则，才能覆盖本仓大量存在的多行 `.route(` 写法。
 *
 * @param {string} src 已去注释的源码
 * @returns {Array<{ path: string, methods: string[], handlers: string[] }>}
 */
export function parseRouteTable(src) {
    const out = [];
    for (const m of src.matchAll(/\.route\s*\(/g)) {
        const parenIdx = src.indexOf("(", m.index);
        const slice = balancedSlice(src, parenIdx);
        if (!slice) continue;
        const args = slice.text.slice(1, -1);
        const pm = args.match(/^\s*"([^"]+)"/);
        if (!pm) continue;
        const methods = [];
        const handlers = [];
        // handler 可能是限定路径（`management::block_room`），必须允许 `::`；
        // 只认裸标识符会让子模块路由整体落进「路由未解析」覆盖桶。
        for (const hm of args.matchAll(
            /\b(get|post|put|delete|patch)\s*\(\s*([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)\s*\)/g,
        )) {
            methods.push(hm[1].toUpperCase());
            handlers.push(hm[2]);
        }
        if (handlers.length) out.push({ path: pm[1], methods, handlers });
    }
    return out;
}

/**
 * 收集后端 admin 契约：路由 → { handler, responseVariants, io, bodyStruct }。
 *
 * @param {{ routesDir: string }} options
 * @returns {Promise<{ byRoute: Map<string, object>, stats: object, files: string[] }>}
 */
export async function collectRustAdminContract({ routesDir }) {
    const files = [];
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.name.endsWith(".rs")) files.push(full);
        }
    };
    walk(routesDir);
    const byRoute = new Map();
    const structs = new Map();
    const perFile = new Map();
    for (const f of files) {
        const src = stripRustComments(fs.readFileSync(f, "utf8"));
        perFile.set(f, src);
        for (const [k, v] of parseDeserializeStructs(src)) structs.set(k, v);
    }
    const handlerRoutes = new Map();
    for (const src of perFile.values()) {
        for (const r of parseRouteTable(src)) {
            for (let i = 0; i < r.handlers.length; i++) {
                // 路由里可能写限定路径（`management::block_room`），而函数定义在
                // 该文件的子模块里 ⇒ 按**最后一段**建索引（函数名）。
                const fnName = r.handlers[i].split("::").pop();
                const key = `${r.methods[i]} ${r.path}`;
                handlerRoutes.set(fnName, [...(handlerRoutes.get(fnName) ?? []), key]);
            }
        }
    }
    let handlerCount = 0;
    let responseKnown = 0;
    let requestKnown = 0;
    let ambiguous = 0;
    for (const [f, src] of perFile) {
        for (const fn of findRustFunctions(src)) {
            const routes = handlerRoutes.get(fn.name);
            if (!routes) continue;
            handlerCount++;
            const responseVariants = extractResponseVariants(fn.body);
            const io = extractHandlerIo(fn.sig);
            const bodyStruct = io.jsonType && structs.has(io.jsonType) ? structs.get(io.jsonType) : null;
            if (responseVariants) responseKnown++;
            if (bodyStruct) requestKnown++;
            for (const rawRoute of routes) {
                const route = normalizeRoute(rawRoute);
                const prev = byRoute.get(route);
                if (prev) ambiguous++;
                const entry = {
                    rawRoute,
                    file: path.relative(routesDir, f),
                    handler: fn.name,
                    responseVariants,
                    io,
                    bodyStruct: bodyStruct
                        ? {
                              name: io.jsonType,
                              fields: bodyStruct.fields,
                              denyUnknownFields: bodyStruct.denyUnknownFields,
                          }
                        : null,
                };
                byRoute.set(route, prev ? { ...prev, merged: [...(prev.merged ?? [prev]), entry] } : entry);
            }
        }
    }
    return {
        byRoute,
        files: files.map((f) => path.relative(routesDir, f)),
        stats: {
            fileCount: files.length,
            handlerCount,
            responseKnown,
            requestKnown,
            structCount: structs.size,
            ambiguous,
        },
    };
}

/**
 * 归一化一条 `METHOD /path` 路由键（方法大写 + 路径参数归一）。
 *
 * @param {string} route
 * @returns {string}
 */
export function normalizeRoute(route) {
    const m = route.match(/^([A-Z]+)\s+(.*)$/);
    if (!m) return normalizePath(route);
    return `${m[1]} ${normalizePath(m[2])}`;
}

// ---------------------------------------------------------------------------
// SDK（TypeScript）
// ---------------------------------------------------------------------------

/**
 * 去 TS 注释。朴素词法器，但跳过字符串/模板字面量与正则字面量，
 * 避免把字符串里的双斜杠或正则里的斜杠当成注释开头。
 *
 * 注意：本文件里凡是描述注释语法的地方都不要写出「星号紧跟斜杠」的字面量，
 * 那会提前闭合它所在的块注释（本模块第一版就栽在这里）。
 *
 * @param {string} src
 * @returns {string}
 */
export function stripTsComments(src) {
    let out = "";
    let i = 0;
    const n = src.length;
    let str = null;
    let prevSignificant = "";
    while (i < n) {
        const c = src[i];
        if (str) {
            out += c;
            if (c === "\\") {
                out += src[i + 1] ?? "";
                i += 2;
                continue;
            }
            if (c === str) str = null;
            i++;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            str = c;
            out += c;
            i++;
            continue;
        }
        if (c === "/" && src[i + 1] === "/") {
            while (i < n && src[i] !== "\n") i++;
            continue;
        }
        if (c === "/" && src[i + 1] === "*") {
            i += 2;
            while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
            i += 2;
            continue;
        }
        // 正则字面量：仅当上一有效字符不是标识符/右括号时才可能是除法
        if (c === "/" && !/[\w$)\]]/.test(prevSignificant)) {
            let k = i + 1;
            let inClass = false;
            let closed = false;
            while (k < n) {
                if (src[k] === "\\") {
                    k += 2;
                    continue;
                }
                if (src[k] === "[") inClass = true;
                else if (src[k] === "]") inClass = false;
                else if (src[k] === "/" && !inClass) {
                    closed = true;
                    k++;
                    break;
                } else if (src[k] === "\n") break;
                k++;
            }
            if (closed) {
                while (k < n && /[a-z]/.test(src[k])) k++;
                i = k;
                continue;
            }
        }
        if (!/\s/.test(c)) prevSignificant = c;
        out += c;
        i++;
    }
    return out;
}

/**
 * 把路径里的参数段归一化成 `{x}`，用于两侧对表。
 *
 * 后端写 `/_synapse/admin/v1/reports/{report_id}`，SDK 写
 * `` `/reports/${encodeURIComponent(id)}` ``，两边都要归一才能对上。
 * 必须先吃掉模板字面量的 `$`，否则会得到 `${x}` 这种半成品键。
 *
 * **两侧必须用同一个函数**：本模块第一版只归一了 SDK 侧的 `{...}` 形态、
 * 没有归一后端侧，于是 134 个调用点被误报成「后端没有这条路由」
 * —— 假阳性数量大到足以淹没真问题。
 *
 * @param {string} p
 * @returns {string}
 */
export function normalizePath(p) {
    return p.replace(/\$\{[^}]*\}/g, "{x}").replace(/\{[^}]*\}/g, "{x}");
}

/**
 * 取一个 `interface` / `type` 对象的**第一层**字段名。
 *
 * @param {string} src 已去注释的源码
 * @returns {Map<string, string[]>} 类型名 → 字段名（排序）
 */
export function extractInterfaceFields(src) {
    const own = new Map();
    const bases = new Map();
    for (const m of src.matchAll(/export\s+interface\s+([A-Za-z_]\w*)\s*(extends\s[^{]*)?\{/g)) {
        const brace = src.indexOf("{", m.index);
        const slice = balancedSlice(src, brace);
        if (!slice) continue;
        const fields = [];
        for (const fm of slice.text.matchAll(/\n\s{4}(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:/g))
            fields.push(fm[1]);
        own.set(m[1], fields.sort());
        if (m[2]) {
            bases.set(
                m[1],
                [...m[2].replace(/^extends\s*/, "").matchAll(/([A-Za-z_]\w*)/g)].map((x) => x[1]),
            );
        }
    }
    // `interface X extends Y` 必须把 Y 的字段并进来：第一版的正则把 `extends Y` 与花括号
    // 一并吃掉，只留自身字段 ⇒ `RoomRetentionPolicy extends RetentionPolicy` 少了 3 个键，
    // 且**看起来像是 SDK 漏声明**（假阳/假阴同时出现）。凡用 extends 的类型都会中招。
    const resolve = (name, seen = new Set()) => {
        if (seen.has(name)) return own.get(name) ?? [];
        seen.add(name);
        const merged = new Set(own.get(name) ?? []);
        for (const b of bases.get(name) ?? []) for (const f of resolve(b, seen)) merged.add(f);
        return [...merged].sort();
    };
    const out = new Map();
    for (const name of own.keys()) out.set(name, resolve(name));
    // `export type X = Y;` 形式的别名（如 `AdminFederationDestinationDetail = FederationDestination`）
    // 也要能查到字段，否则这类返回类型会整体落进「接口找不到」桶而**完全不被检查**。
    for (const m of src.matchAll(/export\s+type\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*;/g)) {
        const target = out.get(m[2]);
        if (target) out.set(m[1], [...target]);
    }
    return out;
}

/**
 * 抽取 SDK admin 面的请求调用点。
 *
 * 每个调用点记录：所属管理器方法、方法声明返回类型、被请求类型参数、HTTP 方法、
 * 归一化路径、以及**第 3/4 个实参是否存在**（query / body）。
 *
 * 「有没有 body」是本轮新增的一类缺陷（后端用 `Json<T>` 而 SDK 不传 body ⇒ 415），
 * 必须在数据里显式记录下来，否则无从检查。
 *
 * @param {{ srcDir: string, prefixes?: Record<string, string> }} options
 * @returns {Promise<{ callSites: object[], fields: Map<string, string[]>, files: string[], stats: object }>}
 */
export async function collectSdkAdminContract({ srcDir, prefixes = {} }) {
    const PREFIX_BY_WRAPPER = {
        adminRequest: "/_synapse/admin/v1",
        v2Request: "/_synapse/admin",
        ...prefixes,
    };
    const files = [];
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) files.push(full);
        }
    };
    walk(srcDir);
    const fields = new Map();
    const fieldFiles = new Map();
    const callSites = [];
    let methodsScanned = 0;
    // 类型声明所在文件按**仓库相对路径**记录，台账要据此在 CI 里定位文件
    const repoRoot = path.resolve(srcDir, "..", "..");
    for (const f of files) {
        const src = stripTsComments(fs.readFileSync(f, "utf8"));
        const rel = path.relative(repoRoot, f).split(path.sep).join("/");
        for (const [k, v] of extractInterfaceFields(src)) {
            fields.set(k, v);
            fieldFiles.set(k, rel);
        }
        for (const m of src.matchAll(/\n\s{4}(?:public\s+)?async\s+([A-Za-z_]\w*)\s*[(<]/g)) {
            // 函数体开括号必须**先跳过参数表**再找：参数类型里可能直接写对象字面量类型
            // （`cleanupAll(payload?: { min_age_ms?: number })`），
            // 直接 `indexOf("{")` 会命中参数里的那个花括号 ⇒ 签名被截断、该方法**完全不被抽取**
            // （静默漏检，且漏的正是"带内联对象参数"这一类）。
            const parenIdx = src.indexOf("(", m.index);
            const paren = parenIdx < 0 ? null : balancedSlice(src, parenIdx);
            if (!paren) continue;
            const brace = src.indexOf("{", paren.end);
            if (brace < 0) continue;
            const head = src.slice(m.index, brace);
            const rm = head.match(/\)\s*:\s*Promise<\s*([\s\S]*?)\s*>\s*$/);
            const declaredReturn = rm ? rm[1].replace(/\s+/g, " ").trim() : null;
            const slice = balancedSlice(src, brace);
            if (!slice) continue;
            methodsScanned++;
            for (const cm of slice.text.matchAll(/\b(adminRequest|v2Request)\s*(?:<\s*([^;]*?)\s*>)?\s*\(/g)) {
                const callParen = slice.text.indexOf("(", cm.index + cm[0].length - 1);
                const callSlice = balancedSlice(slice.text, callParen);
                if (!callSlice) continue;
                const args = splitTopLevelArgs(callSlice.text.slice(1, -1));
                const hm = args[0]?.match(/Method\.([A-Za-z]+)/);
                if (!hm) continue;
                // 第 2 实参常常是**包装调用**而不是裸字面量：`apu("/retention/policy")`
                // （admin-config-manager 全篇如此）、`apu(\`/x/${id}\`)` 等。
                // 第一版要求第 2 实参直接以引号开头 ⇒ **整个 `apu(...)` 家族从未进入检查**
                // ——门禁"全绿"，但被它覆盖的几十个端点其实一个都没核。抽取器的第 7 个坑。
                const rawPath = args[1] ?? "";
                const pm = rawPath.match(/^[`"]/) ? rawPath : (rawPath.match(/[`"][^`"]*[`"]/) ?? [null])[0];
                if (!pm) continue;
                const pathText = pm.slice(1, -1);
                const norm = normalizePath(`${(PREFIX_BY_WRAPPER[cm[1]] ?? "").trim()}${pathText}`);
                // `undefined` / `void 0` 是**字面量的缺席**，不是"传了实参"。
                // 不排除它会把 `adminRequest(Method.Get, p, q, undefined, label)` 误判成"GET 带 body"。
                const present = (i) => {
                    const a = args[i];
                    return typeof a === "string" && a.length > 0 && a !== "undefined" && a !== "void 0";
                };
                callSites.push({
                    file: path.relative(path.dirname(srcDir), f),
                    managerMethod: m[1],
                    declaredReturn,
                    typeArg: cm[2] ? cm[2].replace(/\s+/g, " ").trim() : null,
                    httpMethod: hm[1].toUpperCase(),
                    route: `${hm[1].toUpperCase()} ${norm}`,
                    argCount: args.length,
                    hasQueryArg: present(2),
                    hasBodyArg: present(3),
                });
            }
        }
    }
    return {
        callSites,
        fields,
        fieldFiles,
        files: files.map((f) => path.relative(process.cwd(), f)),
        stats: {
            fileCount: files.length,
            methodsScanned,
            callSiteCount: callSites.length,
            interfaceCount: fields.size,
        },
    };
}

// ---------------------------------------------------------------------------
// 比较
// ---------------------------------------------------------------------------

/**
 * 把声明返回类型归一化成「可查表的类型名」。
 *
 * 处理 `X | null`（去掉 null 分支）、`X[]`（标记为数组）。
 *
 * @param {string | null} declared
 * @returns {{ base: string | null, isArray: boolean }}
 */
export function normalizeReturnType(declared) {
    if (!declared) return { base: null, isArray: false, primitive: true };
    let s = declared
        .replace(/\s*\|\s*null\b/g, "")
        .replace(/\s*\|\s*undefined\b/g, "")
        .trim();
    const isArray = /\[\]$/.test(s);
    if (isArray) s = s.replace(/\[\]$/, "").trim();
    // TS 内置类型不是"可查表的接口"：`Promise<void>` 曾被当成类型名 `void` 去查表，
    // 于是 40 个 `Promise<void>` 方法被误记进「接口找不到」覆盖桶（把噪声当覆盖缺口）。
    // 标 `primitive` 让调用方把它们**排除在覆盖桶之外**——没有响应体就没有形状可核对。
    if (/^(void|boolean|string|number|bigint|unknown|any|never|null|undefined|object)$/.test(s)) {
        return { base: null, isArray: false, primitive: true };
    }
    return { base: /^[A-Za-z_]\w*$/.test(s) ? s : null, isArray, primitive: false };
}

/**
 * 比较 SDK 字段集合与后端响应键集合。
 *
 * @param {{ sdkFields: string[], backendKeys: string[] }} input
 * @returns {{ missing: string[], extra: string[], ok: boolean }}
 */
export function diffFields({ sdkFields, backendKeys }) {
    const sdk = new Set(sdkFields);
    const be = new Set(backendKeys);
    const missing = [...be].filter((k) => !sdk.has(k)).sort();
    const extra = [...sdk].filter((k) => !be.has(k)).sort();
    return { missing, extra, ok: missing.length === 0 && extra.length === 0 };
}

/**
 * 判定后端响应键集合是否被 SDK 字段集合覆盖（用于"变体联合"比较）。
 *
 * @param {{ sdkFields: string[], variants: string[][] | null }} input
 * @returns {{ missing: string[], extra: string[], ok: boolean, unknown: boolean }}
 */
export function diffResponse({ sdkFields, variants }) {
    if (!variants) return { missing: [], extra: [], ok: false, unknown: true };
    const union = new Set(variants.flat());
    const sdk = new Set(sdkFields);
    const missing = [...union].filter((k) => !sdk.has(k)).sort();
    const extra = [...sdk].filter((k) => !union.has(k)).sort();
    return { missing, extra, ok: missing.length === 0 && extra.length === 0, unknown: false };
}

// ---------------------------------------------------------------------------
// 诊断入口
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
    const dirArg = process.argv.find((a) => a.startsWith("--dir="));
    const sdkArg = process.argv.find((a) => a.startsWith("--sdk="));
    const routesDir = dirArg
        ? path.resolve(dirArg.slice(6))
        : path.resolve(process.cwd(), "..", "synapse-rust", "synapse-web", "src", "routes", "admin");
    const srcDir = sdkArg ? path.resolve(sdkArg.slice(6)) : path.resolve(process.cwd(), "src", "admin");
    if (!fs.existsSync(routesDir)) {
        console.error(`后端目录不存在：${routesDir}`);
        process.exit(2);
    }
    const rust = await collectRustAdminContract({ routesDir });
    const sdk = await collectSdkAdminContract({ srcDir });
    console.log("[admin-contract] 后端:", JSON.stringify(rust.stats));
    console.log("[admin-contract] SDK :", JSON.stringify(sdk.stats));
    console.log(`[admin-contract] 路由条目: ${rust.byRoute.size}`);
}
