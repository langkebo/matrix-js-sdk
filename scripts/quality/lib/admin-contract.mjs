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
        if (c === '"') {
            str = c;
            out += c;
            i++;
            continue;
        }
        if (c === "'") {
            // ⚠️ **生命周期不是字符字面量**。把 `'` 一律当字符串起始会让 `&'static str` 之后
            // 直接跳到下一个 `'`（那是很远的地方），把中间的花括号一并吞掉 ⇒ 下游按括号配平取
            // 函数体/`impl` 块时**整个块返回 null**（本仓 `room/messaging/events.rs` 的
            // `impl MessagingService` 就这样整块隐身，78 个 `async fn` 一个都没被索引）。
            // 判据：`'x'` / `'\n'` 是字符字面量；其余 `'ident`（后面不是闭合撇号）是生命周期。
            // 生命周期原地换成**等宽空格**（长度不变 ⇒ 下游所有下标都不受影响）。
            const isCharLiteral = src[i + 1] === "\\" ? true : src[i + 1] !== undefined && src[i + 2] === "'";
            if (!isCharLiteral) {
                out += " ";
                i++;
                continue;
            }
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
 * 只服务于**请求体**检查（`Json<T>` 的 T 必须 Deserialize，且 `deny_unknown_fields`
 * 决定"多一个字段就 400"）。响应侧的 struct 走 `parseSerdeStructs`。
 *
 * @param {string} src 已去注释的源码
 * @returns {Map<string, { fields: string[], optionalFields: string[], ignoredFields: string[], denyUnknownFields: boolean, flatten: boolean }>}
 */
export function parseDeserializeStructs(src) {
    const out = new Map();
    for (const [name, v] of parseSerdeStructs(src)) {
        if (v.derives.includes("Deserialize"))
            out.set(name, {
                fields: v.fields,
                optionalFields: v.optionalFields,
                ignoredFields: v.ignoredFields,
                denyUnknownFields: v.denyUnknownFields,
                flatten: v.flatten,
            });
    }
    return out;
}

/**
 * 索引带 `Serialize` 或 `Deserialize` 的 struct：字段名 / `deny_unknown_fields` / 派生列表。
 *
 * 与 `parseDeserializeStructs` 的区别是**要能解析响应**：响应 struct 往往只派生
 * `Serialize`（`#[derive(Debug, Serialize)]`），只认 `Deserialize` 会让它们全部落空。
 *
 * `fields` 是**序列化后的键**（已应用字段级 `#[serde(rename = "…")]`），`rustFields` 是
 * Rust 侧声明名 —— 两者要分开存：与本门禁比对的是前者，而"struct 字面量"（`X { rust_name: .. }`）
 * 写的是后者，交叉校验时得用并集。
 *
 * `opaque` 的含义（**不做猜测**）：只有两种情况会标它 ——
 *   1. 出现了 `rename` 但值解析不出来（属性写法超出本抽取器覆盖范围）；
 *   2. struct 级 `rename_all` 不是 `snake_case`（等价于对已是 snake_case 的字段名做恒等变换，
 *      其余（`camelCase` / `lowercase` / …）需要按规则改写每个键，本抽取器不去猜）。
 * 标 `opaque` 的 struct 会被调用方当成"形状未知"落回覆盖桶，而不是拿错键去比对。
 *
 * @param {string} src 已去注释的源码
 * @returns {Map<string, { fields: string[], rustFields: string[], optionalFields: string[], ignoredFields: string[], denyUnknownFields: boolean, flatten: boolean, derives: string[], opaque: boolean }>}
 */
export function parseSerdeStructs(src) {
    const out = new Map();
    for (const m of src.matchAll(/(pub\s+)?struct\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\{/g)) {
        // 往前看属性块（`#[...]` 行），限制在同一声明之前
        const headStart = Math.max(0, src.lastIndexOf("\n\n", m.index) + 1);
        const head = src.slice(headStart, m.index);
        if (!/#\[/.test(head)) continue;
        // 容器级属性只认**紧邻本 struct** 的那一段（见 `containerAttributes`）
        const container = containerAttributes(head);
        const dm = head.match(/#\[derive\(([^)]*)\)/);
        const derives = dm ? dm[1].split(",").map((s) => s.trim()) : [];
        if (!derives.includes("Serialize") && !derives.includes("Deserialize")) continue;
        const brace = m.index + m[0].length - 1;
        const slice = balancedSlice(src, brace);
        if (!slice) continue;
        const { rust, json, optionalJson, ignoredJson, flatten, unparsedRename } = scanStructFields(
            slice.text.slice(1, -1),
        );
        const renameAll = container.match(/rename_all\s*=\s*"([^"]+)"/);
        const opaque = unparsedRename || (renameAll ? renameAll[1] !== "snake_case" : false);
        // 容器级 `#[serde(default)]` ⇒ 每一个缺席字段都取容器默认值 ⇒ 全是可选。
        const containerDefault = /#\[serde\([^)]*\bdefault\b/.test(container);
        out.set(m[2], {
            fields: [...new Set(json)].sort(),
            rustFields: [...new Set(rust)].sort(),
            optionalFields: containerDefault ? [...new Set(json)].sort() : [...new Set(optionalJson)].sort(),
            ignoredFields: [...new Set(ignoredJson)].sort(),
            denyUnknownFields: /deny_unknown_fields/.test(container),
            flatten,
            derives,
            opaque,
        });
    }
    return out;
}

/** `#[serde(rename = "x")]` / `#[serde(rename(serialize = "x"))]` 的值。 */
const SERDE_RENAME_RE = /rename\s*(?:=\s*"([^"]+)"|\(\s*(?:serialize\s*=\s*)?\s*"([^"]+)")/;

/**
 * 从 `字段名:` 之后读出**类型文本**（到同层的 `,` / `}` 为止）。
 *
 * 需要它是因为"这个字段能不能不传"完全由类型决定：`Option<T>` 与
 * `#[serde(default)]` 缺席时 serde 会填默认值，而其余类型缺席即反序列化失败。
 * 泛型里的逗号不能当分隔符（`HashMap<String, Vec<u8>>`），所以要跟深度。
 *
 * @param {string} bodyText struct 体
 * @param {number} start 冒号之后的下标
 * @returns {string} 归一化空白后的类型文本
 */
function readFieldType(bodyText, start) {
    let depth = 0;
    let i = start;
    const n = bodyText.length;
    while (i < n) {
        const c = bodyText[i];
        if (c === "<" || c === "(" || c === "[") depth++;
        else if (c === ">" || c === ")" || c === "]") depth = Math.max(0, depth - 1);
        else if (depth === 0 && (c === "," || c === "}")) break;
        i++;
    }
    return bodyText.slice(start, i).replace(/\s+/g, " ").trim();
}

/**
 * 扫描 struct 体，把每个字段的 **JSON 键**（应用字段级 rename）与 **Rust 名**一起取出来。
 *
 * 用词法扫描而不是一条正则，是因为 rename 属性**在字段之前一行**：正则扫 `ident:` 拿不到
 * 上一行的属性，于是 `#[serde(rename = "allowed")] pub is_allowed: bool` 会被读成
 * JSON 键 `is_allowed` —— 而 SDK 侧写的是后端真实的键 `allowed`，
 * 结果会把"其实一致"报成"字段名不一致"（本仓有 103 处字段级 rename）。
 *
 * `optionalJson` 与 `ignoredJson` 服务于**请求体**检查（`Json<T>` 的 T）：
 *
 *   - `optionalJson`：缺席也不会让反序列化失败（`Option<T>` / `#[serde(default)]`）。
 *     缺了它就没法区分"后端必填字段而 SDK 没声明"（真缺陷）与"后端本来就不要求"（无事）；
 *   - `ignoredJson`：`#[serde(skip*)]` 的键**根本不是线上键**（`skip_deserializing` 传了也读不到、
 *     `skip_serializing` 不会出现在响应里）⇒ 从键集里剔除，否则会制造"SDK 多声明字段"的假阳。
 *
 * @param {string} bodyText struct 体（不含最外层花括号）
 * @returns {{ rust: string[], json: string[], optionalJson: string[], ignoredJson: string[], flatten: boolean, unparsedRename: boolean }}
 */
export function scanStructFields(bodyText) {
    const rust = [];
    const json = [];
    const optionalJson = [];
    const ignoredJson = [];
    let pending = null;
    let pendingOptional = false;
    let pendingSkip = false;
    let flatten = false;
    let unparsedRename = false;
    let i = 0;
    const n = bodyText.length;
    while (i < n) {
        const c = bodyText[i];
        if (c === "#" && bodyText[i + 1] === "[") {
            const s = balancedSlice(bodyText, i + 1);
            if (s) {
                if (/\brename\s*[=(]/.test(s.text) && !/rename_all/.test(s.text)) {
                    const rm = SERDE_RENAME_RE.exec(s.text);
                    if (rm) pending = rm[1] ?? rm[2];
                    else unparsedRename = true;
                }
                // `#[serde(flatten)]` ⇒ 这些字段的键**不在本 struct 的键集里**，
                // 且还能接受任意其余键 ⇒ 键集不再闭合，调用方须按"未知"处理。
                if (/\bflatten\b/.test(s.text)) flatten = true;
                // ⚠️ 不能用 `/\bskip\b/`：`skip_serializing_if` 是**条件序列化**（键照样存在），
                // 把它当成 `skip` 会把字段从键集里剔掉 ⇒ 凭空造出"SDK 多声明字段"。
                if (/\bskip(?:_(?:serializing|deserializing))?(?![_\w])/.test(s.text)) pendingSkip = true;
                if (/\bdefault\b/.test(s.text)) pendingOptional = true;
                i = s.end;
                continue;
            }
        }
        if (c === "/" && bodyText[i + 1] === "/") {
            while (i < n && bodyText[i] !== "\n") i++;
            continue;
        }
        if (i === 0 || /[\s;{}]/.test(bodyText[i - 1])) {
            // `(?!:)` 不能省：`pub target_user_ids: serde_json::Value,` 里，`serde_json` 后面跟的是
            // **路径分隔符** `::` 而不是字段的冒号。少了这个否定断言，`\s*:` 会吃掉 `::` 的第一个冒号
            // ⇒ 凭空多出一个叫 `serde_json` 的字段（实测把 `ServerNotification` 报成"SDK 少一个字段"）。
            // 同类泄漏还有 `pub x: std::collections::HashMap<..>` ⇒ 多出键 `std`。
            const m = /^(?:pub\s+)?([A-Za-z_]\w*)\s*:(?!:)/.exec(bodyText.slice(i, i + 200));
            if (m) {
                const key = pending ?? m[1];
                const typeText = readFieldType(bodyText, i + m[0].length);
                rust.push(m[1]);
                if (pendingSkip) {
                    ignoredJson.push(key);
                } else {
                    json.push(key);
                    if (pendingOptional || /^Option\s*</.test(typeText)) optionalJson.push(key);
                }
                pending = null;
                pendingOptional = false;
                pendingSkip = false;
                i += m[0].length;
                continue;
            }
        }
        i++;
    }
    return { rust, json, optionalJson, ignoredJson, flatten, unparsedRename };
}

/**
 * 取 struct 声明**紧邻上方**的容器属性区（`#[derive(..)]` / `#[serde(..)]`）。
 *
 * 只取"最后一个 `}` 或 `;` 之后"那一段：`parseSerdeStructs` 原来用"上个空行到目前为止"，
 * 当两个 struct 紧挨着（中间没有空行）时，**上一个 struct 的字段级属性**会落进这个窗口，
 * 于是 `#[serde(default)]` 会被误读成容器级默认（把必填字段判成可选 ⇒ 真缺陷静默）。
 *
 * @param {string} head 上一个空行到 struct 关键字之间的文本
 * @returns {string}
 */
function containerAttributes(head) {
    const cut = Math.max(head.lastIndexOf("}"), head.lastIndexOf(";"));
    return head.slice(cut + 1);
}

// ---------------------------------------------------------------------------
// 形状解析：把「返回表达式」下沉到 struct 定义 / 辅助函数
// ---------------------------------------------------------------------------

/**
 * 响应形状。`object` 可核对字段集；`array` 表示 JSON 顶层是数组（`item` 为元素类型名，
 * 判不出时 `null`）。
 *
 * @typedef {{ kind: "object", keys: string[] } | { kind: "array", item: string | null }} ResponseShape
 */

/**
 * 取 `fn` 签名里的返回类型文本（不含 `->`）。
 *
 * @param {string} sig `findRustFunctions` 给的签名片段
 * @returns {string | null}
 */
export function extractReturnType(sig) {
    const paren = sig.indexOf("(");
    if (paren < 0) return null;
    const params = balancedSlice(sig, paren);
    if (!params) return null;
    const rest = sig.slice(params.end).trim();
    const m = rest.match(/^->\s*([\s\S]+)$/);
    return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

/**
 * 找出源码里所有 `fn`（含同步函数、含 `pub(crate)` 等可见性修饰）。
 *
 * 与 `findRustFunctions`（只认 `async fn`，用于"路由指向的处理器"）分开：
 * 响应形状的解析要能下沉到**同步辅助函数**（如 `fn report_to_json(..) -> Value`），
 * 但把同步函数也算进"处理器"会让 `handlerCount` 之类的统计失真。
 *
 * `topLevel` 只对**行首无缩进**的定义为真 —— 这是在刻意排除 `impl` 里的方法：
 * 同一方法名在多个 `impl` 块里重复定义（本仓 `cleanup_abnormal_data` 就有 3 处），
 * 靠名字下沉到方法体会把"接收者类型未知"悄悄变成"形状已知"。宁可少解析。
 *
 * @param {string} src 已去注释的源码
 * @returns {Array<{ name: string, sig: string, body: string, topLevel: boolean, start: number }>}
 */
export function findAllRustFunctions(src) {
    const out = [];
    for (const m of src.matchAll(/\n([ \t]*)(pub(?:\([^)]*\))?\s+)?(async\s+)?fn\s+([A-Za-z_]\w*)\s*[(<]/g)) {
        const brace = src.indexOf("{", m.index);
        if (brace < 0) continue;
        const slice = balancedSlice(src, brace);
        if (!slice) continue;
        out.push({
            name: m[4],
            sig: src.slice(m.index, brace),
            body: slice.text,
            topLevel: m[1] === "",
            start: m.index,
        });
    }
    return out;
}

/**
 * 按深度 0 的分隔符切分一段文本（不切字符串/字符字面量里的分隔符）。
 *
 * @param {string} text
 * @param {string} sep 单字符分隔符
 * @returns {string[]}
 */
export function splitTopLevel(text, sep) {
    const parts = [];
    let depth = 0;
    let cur = "";
    let i = 0;
    const n = text.length;
    while (i < n) {
        const c = text[i];
        if (c === '"' || c === "'") {
            const q = c;
            cur += c;
            i++;
            while (i < n) {
                cur += text[i];
                if (text[i] === "\\") {
                    cur += text[i + 1] ?? "";
                    i += 2;
                    continue;
                }
                if (text[i] === q) {
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) depth--;
        else if (c === sep && depth === 0) {
            parts.push(cur);
            cur = "";
            i++;
            continue;
        }
        cur += c;
        i++;
    }
    parts.push(cur);
    return parts;
}

/**
 * 取 Rust 块体的**尾表达式**（函数体在 Rust 里就是返回值）。
 *
 * 处理器写成 `fn a(..) { let x = ..; b(..).await }` 这种纯委派时，体内根本没有
 * `Ok(Json(..))`；尾表达式是唯一能指出"形状由谁决定"的线索。
 *
 * @param {string} body 含最外层花括号的函数体
 * @returns {string | null}
 */
export function tailExpression(body) {
    const inner = body.replace(/^\s*\{/, "").replace(/\}\s*$/, "");
    const parts = splitTopLevel(inner, ";");
    for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i].trim();
        if (p.length > 0) return p;
    }
    return null;
}

/**
 * 找出函数体里所有 `Ok(Json(<expr>))` 的 `<expr>`（含 `Ok((StatusCode::X, Json(..)))` 元组形态）。
 *
 * 与 `extractResponseVariants` 的分工：后者只看返回值**是不是 `json!` 对象字面量**，
 * 前者把表达式原样交出来，供"下沉到 struct / 辅助函数"的解析器继续处理。
 * 必须在 `Ok(` 之后立刻找 `Json(`：`Ok(Json(f(x, Json(body))))` 这种写法里的内层
 * `Json(` 属于**参数位置**，不是返回值。
 *
 * @param {string} fnBody
 * @returns {string[]}
 */
export function extractJsonReturnExprs(fnBody) {
    const out = [];
    for (const m of fnBody.matchAll(/(?<![\w.])Ok\s*\(/g)) {
        const paren = fnBody.indexOf("(", m.index + m[0].length - 1);
        if (paren < 0) continue;
        const slice = balancedSlice(fnBody, paren);
        if (!slice) continue;
        let args = splitTopLevelArgs(slice.text.slice(1, -1));
        // `Ok((StatusCode::CREATED, Json(..)))` —— 元组响应把整个返回值又包了一层括号，
        // 只按 `,` 切会得到**一个**以 `(` 开头的实参，形如 `(StatusCode::.., Json(..))`，
        // 于是所有"带状态码的创建类"处理器（本仓十几处）整体落进未知桶。必须再拆一层。
        if (args.length === 1 && args[0].startsWith("(")) {
            const tuple = balancedSlice(args[0], 0);
            if (tuple) args = splitTopLevelArgs(tuple.text.slice(1, -1));
        }
        for (const a of args) {
            const t = a.trim();
            const jm = /^(?:[A-Za-z_]\w*\s*::\s*)*Json\s*\(/.exec(t);
            if (!jm) continue;
            const p = t.indexOf("(", jm[0].length - 1);
            const inner = balancedSlice(t, p);
            if (!inner) continue;
            out.push(inner.text.slice(1, -1).trim());
        }
    }
    return out;
}

/**
 * 取 struct 字面量 `Type { a, b: v }` 的一层字段名。
 *
 * `..base` / `..Default::default()` 这类展开无法静态判断 ⇒ 返回 `spread: true`，
 * 调用方必须落回"未知"（把展开当"没有其余字段"会制造"SDK 多编字段"的假阳）。
 *
 * @param {string} text
 * @returns {{ type: string, keys: string[] | null, spread: boolean } | null}
 */
export function structLiteralShape(text) {
    const t = text.trim();
    const m = /^((?:[A-Za-z_]\w*\s*::\s*)*[A-Za-z_]\w*)\s*(?:<[^<>]*>)?\s*\{/.exec(t);
    if (!m) return null;
    const brace = t.indexOf("{", m.index + m[0].length - 1);
    const slice = balancedSlice(t, brace);
    if (!slice) return null;
    const body = slice.text.slice(1, -1);
    const keys = [];
    let depth = 0;
    let prevToken = "";
    let i = 0;
    const n = body.length;
    while (i < n) {
        const c = body[i];
        if (c === '"' || c === "'") {
            const q = c;
            i++;
            while (i < n) {
                if (body[i] === "\\") {
                    i += 2;
                    continue;
                }
                if (body[i] === q) {
                    i++;
                    break;
                }
                i++;
            }
            prevToken = "str";
            continue;
        }
        if (c === "/" && body[i + 1] === "/") {
            while (i < n && body[i] !== "\n") i++;
            continue;
        }
        if ("([{".includes(c)) {
            depth++;
            prevToken = c;
            i++;
            continue;
        }
        if (")]}".includes(c)) {
            depth--;
            prevToken = c;
            i++;
            continue;
        }
        if (depth === 0 && c === "." && body[i + 1] === ".") return { type: m[1], keys: null, spread: true };
        if (depth === 0 && IDENT_START.test(c)) {
            let k = i;
            while (k < n && /\w/.test(body[k])) k++;
            const word = body.slice(i, k);
            let j = k;
            while (j < n && /\s/.test(body[j])) j++;
            // 简写字段（`flags,` / 尾随 `flags`）**只允许出现在"字段起始位"**，即前面
            // 紧邻的深度 0 token 是 `,` 或整个字面量的开头。少了这个前置条件，
            // 值里的裸标识符会被当成键：`expires_in: r.expires_in.max(0) as u64,`
            // 会凭空多出一个键 `u64`（实测在 `register` 上就是这样）。
            const atFieldStart = prevToken === "," || prevToken === "";
            if (atFieldStart && (body[j] === "," || j >= n)) {
                keys.push(word);
                // 消费掉 `,`，于是下一个字段的"起始位"判据成立
                prevToken = ",";
                i = j + 1;
                continue;
            }
            if (atFieldStart && body[j] === ":") {
                keys.push(word);
                prevToken = ":";
                i = j + 1;
                continue;
            }
            prevToken = word;
            i = k;
            continue;
        }
        // 只记录**非空白** token：把空格写进 prevToken 会让"字段起始位"判据永远不成立
        // （`X { a, b, c }` 会解析出空键集 —— 这种"恒为空"的抽取器比漏抽更危险）。
        if (!/\s/.test(c)) prevToken = c;
        i++;
    }
    return { type: m[1], keys: [...new Set(keys)].sort(), spread: false };
}

/**
 * 取 `serde_json::Map` 变量上 `insert("k", ..)` 的键集合。
 *
 * `cleanup_all` 就是这样组装的响应：它没有 `json!` 字面量，键是靠 `insert` 一个个塞进去的。
 * `\b` 边界是必须的：`results.insert` 不能匹配到 `token_results.insert`，
 * 否则会把嵌套 map 的键当成顶层键（`cleanup_all` 就会凭空多出 4 个 `*_deleted`）。
 *
 * @param {string} bodyText 函数体（或任意作用域文本）
 * @param {string} varName
 * @returns {string[] | null} 排序去重后的键；没有 `insert` 时 `null`（未知）
 */
export function collectMapInsertKeys(bodyText, varName) {
    const re = new RegExp(`(?<![\\w.])${varName}\\s*\\.\\s*insert\\s*\\(\\s*"([^"]+)"`, "g");
    const keys = [];
    for (const m of bodyText.matchAll(re)) keys.push(m[1]);
    return keys.length ? [...new Set(keys)].sort() : null;
}

/**
 * 在作用域文本里找 `let <name> [: <type>] = <rhs>` 的绑定。
 *
 * @param {string} bodyText
 * @param {string} name
 * @returns {{ type: string | null, rhs: string } | null}
 */
export function findLetBinding(bodyText, name) {
    const re = new RegExp(`(?<![\\w.])let\\s+(?:mut\\s+)?${name}\\s*(?::\\s*([^=;]+?))?\\s*=\\s*`, "g");
    const m = re.exec(bodyText);
    if (!m) return null;
    const rhsStart = m.index + m[0].length;
    const n = bodyText.length;
    let depth = 0;
    let i = rhsStart;
    while (i < n) {
        const c = bodyText[i];
        if (c === '"' || c === "'") {
            const q = c;
            i++;
            while (i < n) {
                if (bodyText[i] === "\\") {
                    i += 2;
                    continue;
                }
                if (bodyText[i] === q) {
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) {
            if (depth === 0) break;
            depth--;
        } else if (c === ";" && depth === 0) break;
        i++;
    }
    return { type: m[1] ? m[1].replace(/\s+/g, " ").trim() : null, rhs: bodyText.slice(rhsStart, i).trim() };
}

/** 只有当被下沉的函数**可能**返回序列化结果时才允许下沉。 */
const SHAPE_RETURN = /\bValue\b|\bJson\s*<|IntoResponse/;

/**
 * 找 `match <scrutinee> { … Some(<name>) … }` 里把 `<name>` 绑起来的那次 match，返回 scrutinee 文本。
 *
 * `match x { Some(n) => Ok(Json(json!(n))) }` 这类写法在 admin 面很常见（"查到就返回、查不到 404"）。
 * 变量 `n` 没有 `let` 绑定，只能从 match 的模式里反推：**绑定值的类型 = scrutinee 的类型**。
 *
 * ⚠️ 只认"构造器模式 `Some(name)` / `Ok(name)`"与"裸标识符模式 `name =>` / `name |`"，
 * 且只在同一函数体内找**第一处**命中 —— 遮蔽（shadowing）会取到最近的那层，与 Rust 语义一致。
 *
 * @param {string} bodyText
 * @param {string} name
 * @returns {string | null}
 */
export function findMatchScrutinee(bodyText, name) {
    const patternRe = new RegExp(`\\b(?:Some|Ok)\\s*\\(\\s*${name}\\s*\\)|\\b(?:mut\\s+)?${name}\\s*(?:=>|\\|)`);
    for (const m of bodyText.matchAll(/\bmatch\s+/g)) {
        const start = m.index + m[0].length;
        let depth = 0;
        let i = start;
        let brace = -1;
        while (i < bodyText.length) {
            const c = bodyText[i];
            if (c === '"') {
                i++;
                while (i < bodyText.length) {
                    if (bodyText[i] === "\\") {
                        i += 2;
                        continue;
                    }
                    if (bodyText[i] === '"') {
                        i++;
                        break;
                    }
                    i++;
                }
                continue;
            }
            if ("([".includes(c)) depth++;
            else if (")]".includes(c)) depth--;
            else if (c === "{" && depth === 0) {
                brace = i;
                break;
            }
            i++;
        }
        if (brace < 0) continue;
        const block = balancedSlice(bodyText, brace);
        if (!block || !patternRe.test(block.text)) continue;
        return bodyText.slice(start, brace).trim();
    }
    return null;
}

/**
 * 形状解析的最大递归深度。
 *
 * 一个真实的链**很深**：处理器 → `Ok(Json(expr))` → 变量 → `Ok(..)` 解包 → `serde_json::to_value(..)`
 * → 表达式 → 服务方法体 → 又一条链 → storage 方法体 → `Value::Object(map)` ——
 * 每层都要吃掉一格。定 5 的时候 `get_event_context_admin` 会**刚好差一层**返回 `null`
 * （表现为"这条链就是解析不出来"，没有任何报错）。定 12 留足余量；配上"命名歧义即拒绝"
 * 与"链上每段都要唯一"两条判据，深度本身不再是精度问题，只是终止性保障。
 */
const MAX_RESOLVE_DEPTH = 12;

/**
 * 链上的**透明后缀**：它们只做包装/解包，不改变"这个值是什么类型"。
 *
 * ⚠️ 刻意**不含** `.map(..)` / `.and_then(..)` / `.into()` / `.collect()` —— 那些会改变类型，
 * 当透明跳过会让链条解析出的类型与实际不符（而错的形状比未知更危险）。
 */
const TRANSPARENT_POSTFIX = new Set([
    "await",
    "ok_or",
    "ok_or_else",
    "map_err",
    "expect",
    "unwrap",
    "unwrap_or",
    "unwrap_or_else",
    "clone",
    "as_ref",
    "borrow",
    "to_owned",
]);

/**
 * 序列化类型：**值类型是不可知的**（`serde_json::Value` / `Value`）。
 *
 * 遇到它不算失败 —— 应当**继续下沉到被调方法的函数体**（`Ok(Value::Object(map))` 这种）。
 */
const OPAQUE_TYPES = new Set(["Value", "serde_json_Value", "serde_json::Value"]);

/** 通用容器：脱掉外壳后继续看里面。不是容器也不认识的类型名就直接返回。 */
const RUST_WRAPPERS = /^(?:std\s*::\s*)?(?:Arc|Rc|Box|Option|Vec|Mutex|RwLock|Cow|Pin|RefCell)$/;

/**
 * 按**深度 0 的逗号**切分泛型实参（`Result<HashMap<String, i64>, ApiError>` → 两段）。
 *
 * @param {string} text
 * @returns {string[]}
 */
export function splitGenericArgs(text) {
    const out = [];
    let depth = 0;
    let cur = "";
    for (const c of text) {
        if ("<([".includes(c)) depth++;
        else if (">)]".includes(c)) depth--;
        else if (c === "," && depth === 0) {
            out.push(cur.trim());
            cur = "";
            continue;
        }
        cur += c;
    }
    out.push(cur.trim());
    return out.filter((s) => s.length > 0);
}

/**
 * 把 Rust 类型文本化成 `{ name, isArray }`（脱掉 `&`/`Arc`/`Option`/`Vec`… 外壳，取末段名）。
 *
 * `Vec<T>` ⇒ `isArray = true`（响应顶层是**数组**，不是对象）—— 这是本门禁区分
 * 「SDK 声明包装对象而后端返裸数组」的关键信号。
 *
 * 判不出来返回 `null`（如 `&dyn Trait`、`impl IntoResponse`、裸元组）。
 *
 * @param {string} text
 * @returns {{ name: string, isArray: boolean } | null}
 */
export function unwrapRustType(text) {
    let t = text.replace(/\s+/g, " ").trim();
    t = t.replace(/^&\s*(?:'\w+\s*)?/, "");
    let isArray = false;
    for (;;) {
        const m = /^([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)\s*<([\s\S]*)>$/.exec(t);
        if (!m) break;
        const short = m[1].split("::").pop();
        if (!RUST_WRAPPERS.test(short)) break;
        const inner = splitGenericArgs(m[2]);
        if (inner.length !== 1) break;
        if (short === "Vec") isArray = true;
        t = inner[0].trim();
    }
    // `dyn Trait` / `impl Trait` 不是具体类型
    if (/^(?:dyn|impl)\b/.test(t)) return null;
    // ⚠️ 必须取**最后一段**路径：`synapse_services::admin::AdminAuditService` 的类型名是
    // `AdminAuditService`，取首个标识符会得到 `synapse_services` —— 后续按这个"类型名"去查
    // `impl` 会一无所获（表现为"整类方法解析不出来"，不报错）。
    const m = /^([A-Za-z_]\w*)/.exec(t.split("::").pop().trim());
    return m ? { name: m[1], isArray } : null;
}

/**
 * 从 `Arc<dyn Trait>` / `&dyn Trait` 这类**特征对象**里取出特征名。
 *
 * 服务结构体的存储字段普遍写成 `Arc<dyn RoomStoreApi>`（`unwrapRustType` 会对 `dyn` 返回
 * `null`）—— 也就是说"值是什么类型"这一层信息在类型文本里只有特征名。要接着往下解析
 * `self.room_storage.cleanup_abnormal_data(..)`，只能靠 `impl Trait for X` 关系把 `X` 找回来。
 *
 * @param {string} text
 * @returns {{ trait: string } | null}
 */
export function unwrapRustTraitType(text) {
    const m = /(?:^|[\s<&])(?:dyn\s+)([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)/.exec(text.replace(/\s+/g, " ").trim());
    if (!m) return null;
    return { trait: m[1].split("::").pop() };
}

/**
 * 索引 `impl <Trait> for <Type>` 关系：`traitName → [selfType, …]`。
 *
 * @param {string} src 已去注释的源码
 * @returns {Map<string, string[]>}
 */
export function parseRustTraitImpls(src) {
    const out = new Map();
    for (const m of src.matchAll(/\nimpl\b/g)) {
        const brace = src.indexOf("{", m.index);
        if (brace < 0) continue;
        const head = src.slice(m.index, brace).trimStart();
        const m2 = /^impl(?:\s*<[^>]*>)?\s+([A-Za-z_][\w:]*)\s+for\s+([A-Za-z_][\w:]*)/.exec(head);
        if (!m2) continue;
        const trait = m2[1].split("::").pop();
        const self = m2[2].split("::").pop();
        out.set(trait, [...(out.get(trait) ?? []), self]);
    }
    return out;
}

/**
 * 从**返回类型**求值类型：先剥 `Result<X, E>` / `ApiResult<X>` 一层，再去壳。
 *
 * `Result<Option<ServerNotification>, ApiError>` ⇒ `ServerNotification`（`?` + `match` 已经把
 * Option 消费掉了，剩下的是值本身）。
 *
 * @param {string | null} ret
 * @returns {{ name: string, isArray: boolean } | null}
 */
export function typeOfRustReturn(ret) {
    if (!ret) return null;
    let t = ret.replace(/\s+/g, " ").trim();
    for (;;) {
        const m = /^([A-Za-z_]\w*(?:\s*::\s*[A-Za-z_]\w*)*)\s*<([\s\S]*)>$/.exec(t);
        if (!m) break;
        const short = m[1].split("::").pop();
        if (short !== "Result" && short !== "ApiResult") break;
        const parts = splitGenericArgs(m[2]);
        if (parts.length < 1) break;
        t = parts[0];
    }
    return unwrapRustType(t);
}

/**
 * 取处理器签名里 `State(<name>): State<<Type>>` 的变量名与类型 —— 也就是"链的根"。
 *
 * 没有它就完全无法解析 `ctx.<service>.<method>(..)`；有了它，配合 `parseRustImplMethods`
 * 才谈得上"接收者类型是**推出来的**"而不是"按方法名猜的"。
 *
 * @param {string} sig
 * @returns {{ name: string, type: string } | null}
 */
export function extractStateContext(sig) {
    const paren = sig.indexOf("(");
    if (paren < 0) return null;
    const params = balancedSlice(sig, paren);
    if (!params) return null;
    const m = /State\s*\(\s*([A-Za-z_]\w*)\s*\)\s*:\s*State\s*<\s*([A-Za-z_]\w*)\s*>/.exec(params.text);
    return m ? { name: m[1], type: m[2] } : null;
}

/**
 * 索引 struct 的**字段类型**：`structName → (field → typeText)`。
 *
 * 复用 `parseJsonObjectTopLevel`（它本来就是"取一层 `key: value`"，`pub` 会被当成
 * 非键的自然跳过）。
 *
 * ⚠️ 同名 struct 只保留首次出现：名字撞了就**不索引**（标 `__ambiguous`），
 * 否则会把 A 的字段类型当成 B 的 —— 而下游据此推出的形状会是错的。
 *
 * @param {string} src 已去注释的源码
 * @returns {Map<string, Map<string, string>>}
 */
export function parseRustStructFieldTypes(src) {
    const out = new Map();
    for (const m of src.matchAll(/(?:pub\s+)?struct\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\{/g)) {
        const slice = balancedSlice(src, m.index + m[0].length - 1);
        if (!slice) continue;
        const fields = parseJsonObjectTopLevel(slice.text.slice(1, -1));
        const prev = out.get(m[1]);
        if (prev) {
            // 字段集不同 ⇒ 名字撞了，整条类型不可信
            const a = [...prev.keys()].sort().join(",");
            const b = [...fields.keys()].sort().join(",");
            if (a !== b) out.set(m[1], null);
            continue;
        }
        out.set(m[1], fields);
    }
    return out;
}

/**
 * 索引 `impl` 块里的方法：`selfType → methodName → [{ ret, body, selfType }]`。
 *
 * self 类型判定：有 `for`（取 `for` 之后的类型名）就取其，否则取 `impl` 后第一段。
 * 泛型 `impl<T> Foo<T>` 取 `Foo`；限定路径 `impl a::b::Foo` 取末段。
 *
 * 同名方法**不在这里去重**：调用方按 `length === 1` 判唯一性，多份即拒绝解析。
 *
 * @param {string} src 已去注释的源码
 * @returns {Map<string, Map<string, object[]>>}
 */
export function parseRustImplMethods(src) {
    const out = new Map();
    for (const m of src.matchAll(/\nimpl\b/g)) {
        const brace = src.indexOf("{", m.index);
        if (brace < 0) continue;
        const head = src.slice(m.index, brace).trimStart();
        const slice = balancedSlice(src, brace);
        if (!slice) continue;
        let selfType = null;
        let depth = 0;
        for (let i = 0; i < head.length; i++) {
            const c = head[i];
            if (c === "<") depth++;
            else if (c === ">") depth--;
            else if (
                depth === 0 &&
                head.startsWith("for", i) &&
                !/\w/.test(head[i - 1] ?? "") &&
                !/\w/.test(head[i + 3] ?? "")
            ) {
                const m2 = /^for\s+(?:<[^>]*>\s*)?([A-Za-z_][\w:]*)/.exec(head.slice(i));
                if (m2) selfType = m2[1].split("::").pop();
                break;
            }
        }
        if (!selfType) {
            const m2 = /^impl(?:\s*<[^>]*>)?\s+([A-Za-z_][\w:]*)/.exec(head);
            if (m2) selfType = m2[1].split("::").pop();
        }
        if (!selfType) continue;
        // `traitName` 记录这个 `impl` 是不是某个特征的实现：
        //   - Rust 的方法解析**优先取固有方法**（`impl Type`）而不是特征方法 ⇒ 两个同名 def 时
        //     优先用 `traitName === null` 那个，这不是启发式而是语言规则；
        //   - 经由 `dyn Trait` 调用时，必须用**该特征**的实现（动态派发没有别的选择）。
        const traitName = /\bfor\b/.test(head)
            ? (/^impl(?:\s*<[^>]*>)?\s+([A-Za-z_][\w:]*)\s+for\b/.exec(head)?.[1].split("::").pop() ?? null)
            : null;
        const inner = out.get(selfType) ?? new Map();
        for (const fn of findAllRustFunctions(slice.text)) {
            const list = inner.get(fn.name) ?? [];
            list.push({ name: fn.name, ret: extractReturnType(fn.sig), body: fn.body, selfType, traitName });
            inner.set(fn.name, list);
        }
        out.set(selfType, inner);
    }
    return out;
}

/**
 * 造一个"响应形状解析器"：把 `Ok(Json(<expr>))` 的 `<expr>` 一路下沉到
 * struct 定义 / struct 字面量 / `::from` / `Map::insert` / 同步辅助函数 / 委派目标。
 *
 * ## 判定不了就返回 `null`（= 未知），绝不猜
 *
 * 明确**不做**的事（都在 `null` 一侧）：
 *   - 接收者类型推断：`ctx.foo_service.bar(..)` 的 `bar` 返回什么，需要知道
 *     `AdminContext::foo_service` 的类型再找对应 `impl`；本仓 `bar` 常常在
 *     services/storage 两处同名（`cleanup_abnormal_data` 有 3 处），靠名字下沉
 *     会把"不知道"变成"知道"，方向错得比漏检更危险。这类留在 unknown 桶。
 *   - `match` 模式绑定（`Some(n) => Ok(Json(json!(n)))`）的变量类型。
 *   - `..` 展开的 struct 字面量。
 *
 * @param {{ structs: Map<string, { fields: string[], opaque?: boolean }>, functions: Map<string, { body: string, ret: string | null, topLevel: boolean, isHandler?: boolean, ambiguous?: boolean }> }} input
 */
export function createResponseResolver({
    structs,
    functions,
    types = { structFields: new Map(), methods: new Map(), traitImpls: new Map() },
}) {
    const structShape = (name) => {
        const st = structs.get(name);
        if (!st || st.opaque) return null;
        return { kind: "object", keys: st.fields };
    };

    /**
     * 解析 `ctx.a.b(..).c()` / `self.a.b(..)` 这类链，返回**末段的类型**。
     *
     * **fail-closed**：链上任何一段判不出来（方法名在本类型下不存在 / 同名多处 / 字段类型
     * 不是已知 struct / 出现无法归类的后缀）⇒ 整体 `null`。**不允许"解析到一半就交结论"**：
     * `ctx.a.b().c()` 的类型由整条链决定，停在 `b()` 上会给出错的形状 —— 而错的形状比未知更危险。
     *
     * 只把 `.await` / `?` / `ok_or[_else]` / `map_err` / `unwrap[_or[_else]]` / `expect` / `clone`
     * / `as_ref` 当**透明后缀**跳过（它们不改变"值是什么类型"这一事实，只做包装/解包）。
     * `.map(..)` / `.and_then(..)` / `.into()` 会改变类型 ⇒ 不在透明表里。
     *
     * @param {string} text
     * @param {{ selfType: string | null, rootName: string | null }} scope
     * @returns {{ name: string, isArray: boolean, def: object | null } | null}
     */
    /**
     * `dyn Trait` ⇒ 该特征的**生产实现**类型。
     *
     * 判据是"**非测试路径**下的实现恰好一个"：本仓每个存储特征都有两个 `impl`，一个在
     * `synapse-storage/src/<domain>/…`（生产），一个在 `synapse-storage/src/test_mocks/…`
     * （内存测试替身）。唯一的例外情况（0 个或 ≥2 个非测试实现）**拒绝解析**——
     * 也就是说，将来真加出第二个生产实现时，这里会退化成"未知"并让覆盖桶计数上涨
     * （门禁会据此报红），而不是挑一个继续给出可能错的形状。
     */
    const resolveTraitObject = (typeText) => {
        const t = unwrapRustTraitType(typeText);
        if (!t) return null;
        const impls = types.traitImpls?.get(t.trait);
        if (!impls || impls.length !== 1) return null;
        return { name: impls[0], isArray: false, viaTrait: t.trait };
    };

    /**
     * 在 `cur` 类型上找一个**唯一**的方法定义。
     *
     * `viaTrait` 非空表示"当前接收者是 `dyn Trait`"：此时必须用该特征的实现
     * （动态派发没有别的选择）。否则按 Rust 的规则**优先固有方法**（`impl Type { … }`），
     * 固有方法不存在时才接受唯一的特征实现 —— 本仓的特征实现常常只是薄薄一层委派
     * （`self.cleanup_abnormal_data(..).await`），抓错了会绕回自己。
     */
    const pickMethod = (cur, name, viaTrait) => {
        const defs = types.methods.get(cur)?.get(name) ?? [];
        if (viaTrait) {
            const d = defs.filter((x) => x.traitName === viaTrait);
            return d.length === 1 ? d[0] : null;
        }
        const inherent = defs.filter((x) => !x.traitName);
        if (inherent.length === 1) return inherent[0];
        if (inherent.length === 0 && defs.length === 1) return defs[0];
        return null;
    };

    const resolveChain = (text, scope) => {
        if (!scope.selfType) return null;
        let rest = text.replace(/\s+/g, " ").trim();
        const rootRe = scope.rootName ? new RegExp(`^(?:self|${scope.rootName})\\b`) : /^self\b/;
        if (!rootRe.test(rest)) return null;
        rest = rest.replace(rootRe, "").replace(/^\s*/, "");
        let cur = scope.selfType;
        let viaTrait = null;
        let last = null;
        while (rest.length) {
            if (rest[0] === "?") {
                rest = rest.slice(1).replace(/^\s*/, "");
                continue;
            }
            const m = /^\.\s*([A-Za-z_]\w*)/.exec(rest);
            if (!m) return null;
            const name = m[1];
            let after = rest.slice(m[0].length);
            if (/^\s*\(/.test(after)) {
                const p = after.indexOf("(");
                const s = balancedSlice(after, p);
                if (!s) return null;
                after = after.slice(s.end);
                if (!TRANSPARENT_POSTFIX.has(name)) {
                    const def = pickMethod(cur, name, viaTrait);
                    if (!def) return null;
                    const ty = typeOfRustReturn(def.ret);
                    if (!ty) return null;
                    cur = ty.name;
                    viaTrait = null;
                    last = { ...ty, def };
                }
            } else if (!TRANSPARENT_POSTFIX.has(name)) {
                const ft = types.structFields.get(cur)?.get(name);
                if (!ft) return null;
                const ty = unwrapRustType(ft) ?? resolveTraitObject(ft);
                if (!ty) return null;
                cur = ty.name;
                viaTrait = ty.viaTrait ?? null;
                last = { ...ty, def: null };
            }
            rest = after.replace(/^\s*/, "");
        }
        return last;
    };

    /** 把「类型」变成「形状」；返回类型是 `Value` 时会**下沉到被调方法的函数体**。 */
    const shapeOfResolved = (resolved, depth) => {
        if (!resolved) return null;
        if (resolved.isArray) {
            const st = structs.get(resolved.name);
            return [
                {
                    kind: "array",
                    item: st ? resolved.name : null,
                    itemKeys: st && !st.opaque ? st.fields : null,
                },
            ];
        }
        if (OPAQUE_TYPES.has(resolved.name)) {
            // 返回类型是 `Value` ⇒ 值类型不可知，但**方法体自己知道**：下沉进去接着解析
            return resolved.def ? resolveBody(resolved.def.body, resolved.def.selfType, "self", depth + 1) : null;
        }
        const st = structs.get(resolved.name);
        if (!st || st.opaque) return null;
        return [{ kind: "object", keys: st.fields }];
    };

    const resolveExpr = (rawExpr, scope, depth) => {
        if (depth > MAX_RESOLVE_DEPTH) return null;
        let expr = rawExpr.trim();
        expr = expr
            .replace(/\s*\.await\s*\??\s*$/, "")
            .replace(/\?\s*$/, "")
            .trim();

        // 0) `Ok(<expr>)` 解包（storage 层的返回值常写成 `Ok(Value::Object(map))`，没有 `Json(`）。
        //    `Err(..)` 不是响应 ⇒ 未知。
        const okM = /^Ok\s*\(/.exec(expr);
        if (okM) {
            const s = balancedSlice(expr, okM[0].length - 1);
            if (!s) return null;
            return resolveExpr(s.text.slice(1, -1), scope, depth + 1);
        }
        if (/^Err\s*\(/.test(expr)) return null;
        // `Some(<expr>)` —— storage 层常把可选结果写成 `Ok(Some(json!({…})))`。
        // 解包后形状由 `<expr>` 决定；`None` 不携带形状 ⇒ 交不出结论（但要与"整块未知"区分开，
        // 所以这里返回 `[]`：**确认为空**，对应"该分支没有响应体"）。
        const someM = /^Some\s*\(/.exec(expr);
        if (someM) {
            const s = balancedSlice(expr, someM[0].length - 1);
            const inner = s ? s.text.slice(1, -1).trim() : "";
            if (inner === "None" || inner === "") return [];
            return resolveExpr(inner, scope, depth + 1);
        }

        // 0b) `self.` / `<ctx 变量>.` 链 —— 下沉一层到被调方法的返回类型
        if (/^(?:self|ctx|ctx_)\b/.test(expr) || (scope.rootName && new RegExp(`^${scope.rootName}\\b`).test(expr))) {
            return shapeOfResolved(resolveChain(expr, scope), depth);
        }

        // 1) json!(...) / serde_json::json!(...)
        const jm = /^(?:[A-Za-z_]\w*\s*::\s*)*json!\s*\(/.exec(expr);
        if (jm) {
            const bang = expr.indexOf("!", jm[0].length - 2);
            const keys = jsonMacroTopLevelKeys(expr, bang);
            if (keys !== null) return [{ kind: "object", keys }];
            // json!(ident) —— 参数不是对象字面量，跟着标识符走
            const p = expr.indexOf("(", bang);
            const s = balancedSlice(expr, p);
            const inner = s ? s.text.slice(1, -1).trim() : "";
            if (/^[A-Za-z_]\w*$/.test(inner)) return resolveIdent(inner, scope, depth + 1);
            return null;
        }

        // 1b) `serde_json::to_value(<expr>)` —— 服务层常把 `json!` 结果先 to_value 再返回。
        //     只看括号里的那个表达式（外面的 `.map_err(..)?` 不改变值）。
        const tv = /^(?:[A-Za-z_]\w*\s*::\s*)*to_value\s*\(/.exec(expr);
        if (tv) {
            const s = balancedSlice(expr, expr.indexOf("(", tv[0].length - 1));
            const inner = s ? s.text.slice(1, -1).trim() : "";
            return inner ? resolveExpr(inner, scope, depth + 1) : null;
        }

        // 2) T::from(x) / T::try_from(x) —— 形状由 T 决定
        const fm = /^([A-Za-z_]\w*)\s*::\s*(?:from|try_from)\s*\(/.exec(expr);
        if (fm) {
            const s = structShape(fm[1]);
            return s ? [s] : null;
        }

        // 3) struct 字面量
        const lit = structLiteralShape(expr);
        if (lit) {
            if (lit.spread || !lit.keys) return null;
            const declared = structs.get(lit.type);
            // 字面量本身就是真值；但若解析到的字段与 struct 定义对不上，说明是简写下标/多行
            // 写法把解析带偏了 ⇒ 不猜。字面量写的是 **Rust 名**（`is_allowed: ..`）而
            // `fields` 存的是 **JSON 键**（`allowed`），所以交叉校验必须用两者并集。
            if (declared) {
                const known = new Set([...declared.fields, ...(declared.rustFields ?? [])]);
                if ([...known].some((k) => !lit.keys.includes(k))) return null;
            }
            return [{ kind: "object", keys: lit.keys }];
        }

        // 4) Value::Object(mapVar) —— 允许限定写法（`serde_json::Value::Object(results)`，
        //    storage 层就是这样把 `serde_json::Map` 转成响应的）
        const vm = /^(?:[A-Za-z_]\w*\s*::\s*)*Value\s*::\s*Object\s*\(\s*([A-Za-z_]\w*)\s*\)$/.exec(expr);
        if (vm) {
            const keys = collectMapInsertKeys(scope.body ?? "", vm[1]);
            return keys ? [{ kind: "object", keys }] : null;
        }

        // 5) 裸标识符 —— 看它的 let 绑定
        if (/^[A-Za-z_]\w*$/.test(expr)) return resolveIdent(expr, scope, depth + 1);

        // 6) 无接收者的自由函数调用 —— 下沉（受 SHAPE_RETURN 约束）
        const cm = /^([A-Za-z_]\w*)\s*(?:::\s*[A-Za-z_]\w*)?\s*\(/.exec(expr);
        if (cm) return resolveFunction(functions.get(cm[1]), depth + 1);

        // 7) 其余（方法链等）—— 未知
        return null;
    };

    const resolveIdent = (name, scope, depth) => {
        if (depth > MAX_RESOLVE_DEPTH) return null;
        const b = findLetBinding(scope.body ?? "", name);
        if (!b) {
            // 没有 `let` 绑定 ⇒ 可能是 `match x { Some(name) => .. }` 的模式绑定
            const scrutinee = findMatchScrutinee(scope.body ?? "", name);
            return scrutinee ? resolveExpr(scrutinee, scope, depth + 1) : null;
        }
        if (b.type) {
            const ty = unwrapRustType(b.type);
            // 显式类型标注最多能给出"是数组/是哪个 struct"；标注成 `Value` 时仍要去解析 rhs
            if (ty && (ty.isArray || (!OPAQUE_TYPES.has(ty.name) && structs.has(ty.name)))) {
                return shapeOfResolved({ ...ty, def: null }, depth);
            }
        }
        return resolveExpr(b.rhs, scope, depth + 1);
    };

    /**
     * 解析一段**函数体**。
     *
     * `rootType` / `rootName` 描述"链的根"：处理器体里是 `State(ctx): State<AdminContext>`
     * 的变量名与类型；下沉到服务方法体里是隐式的 `self` + 该 `impl` 的目标类型。
     * 两者不可混用 —— 处理器体里的 `ctx` 与服务方法体里的 `self` 是不同世界的根。
     */
    const resolveBody = (body, rootType, rootName, depth) => {
        if (depth > MAX_RESOLVE_DEPTH) return null;
        const scope = { body, selfType: rootType ?? null, rootName: rootName ?? null };
        const exprs = extractJsonReturnExprs(body);
        if (exprs.length) {
            const out = [];
            for (const e of exprs) {
                const s = resolveExpr(e, scope, depth + 1);
                if (!s) return null; // 任一分支判不出来 ⇒ 整体"未知"，不给半份结论
                out.push(...s);
            }
            return out;
        }
        const tail = tailExpression(body);
        if (!tail) return null;
        return resolveExpr(tail, scope, depth + 1);
    };

    const resolveFunction = (fn, depth) => {
        if (!fn || fn.ambiguous || depth > MAX_RESOLVE_DEPTH) return null;
        if (!fn.isHandler && !(fn.topLevel && SHAPE_RETURN.test(fn.ret ?? ""))) return null;
        return resolveBody(fn.body, fn.selfType ?? null, fn.selfType ? "self" : null, depth);
    };

    return {
        /**
         * @param {{ body: string, ret: string | null, name?: string, sig?: string }} fn
         */
        resolveHandler(fn) {
            const ctx = fn.sig ? extractStateContext(fn.sig) : null;
            return resolveBody(fn.body, ctx?.type ?? null, ctx?.name ?? "ctx", 0);
        },
        resolveExpr,
    };
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
 * 解析 `Json<Value>` 型请求体：处理器**读了哪些键**、哪些是必填。
 *
 * 本仓有十来个处理器不声明请求 struct，而是 `Json(body): Json<Value>` 后手工
 * `body.get("k")` 取值（`cleanup_all` / `purge_room` / `purge_history` / `set_admin` /
 * `restart_server` / `shutdown_room` …）。这类处理器**没有 struct 可读**，
 * 于是它们的请求体长期落在"未知"桶里 —— 而"SDK 声明的字段处理器根本不读"
 * 恰恰是隐形的（后端不报错，调用方以为设置生效了）。
 *
 * 判据（**fail-closed**）：只有整个函数体里**该变量的每一次出现都紧跟 `.get(`**
 * （或 `["…"]`）时才敢下结论；一旦出现其它用法（`f(body)`、`Json(merged_body)`、
 * `body.as_object()` …）就返回 `null` —— 那时键集无法穷举，给半份结论会把
 * "其实一致"报成"多声明了"。
 *
 * 「必填」= 该次读取后面紧跟 `.ok_or` / `.ok_or_else` / `?`（本仓写法统一），
 * 其余（`and_then(...)` 直接赋给变量）视为可选。
 *
 * @param {{ body: string, io: { hasJson: boolean, jsonType: string | null } }} fn
 * @returns {{ keys: string[], required: string[] } | null}
 */
export function extractJsonValueBodyKeys(fn) {
    if (!fn.io?.hasJson) return null;
    if (fn.io.jsonType !== "Value" && fn.io.jsonType !== "serde_json_Value") return null;
    const sigParen = fn.sig.indexOf("(");
    const params = sigParen < 0 ? "" : (balancedSlice(fn.sig, sigParen)?.text.slice(1, -1) ?? "");
    // `Json(body): Json<Value>` 或 `body: Json<Value>`（含 `mut`）
    const bound =
        /(?:^|,)\s*(?:mut\s+)?([A-Za-z_]\w*)\s*:\s*(?:[A-Za-z_]\w*\s*::\s*)*Json\s*</.exec(params) ??
        /(?:^|,)\s*Json\s*\(\s*(?:mut\s+)?([A-Za-z_]\w*)\s*\)\s*:\s*(?:[A-Za-z_]\w*\s*::\s*)*Json\s*</.exec(params);
    if (!bound) return null;
    const varName = bound[1];
    const body = fn.body;
    const keys = new Map(); // key → required
    const identRe = new RegExp(`(?<![\\w.])${varName}\\b`, "g");
    let m;
    while ((m = identRe.exec(body)) !== null) {
        const rest = body.slice(m.index + varName.length);
        const gm = /^\s*\.\s*get\s*\(\s*"([^"]+)"\s*\)/.exec(rest) ?? /^\s*\[\s*"([^"]+)"\s*\]/.exec(rest);
        if (!gm) return null; // 有别的用法 ⇒ 键集无法穷举
        // 读完之后到语句结束之间出现 ok_or / ok_or_else / `?` ⇒ 必填
        const tail = rest.slice(gm[0].length);
        const stmt = tail.split(";")[0] ?? "";
        const required = /\.\s*ok_or(?:_else)?\b/.test(stmt) || /\)\s*\?/.test(stmt) || /\?\s*$/.test(stmt);
        keys.set(gm[1], (keys.get(gm[1]) ?? false) || required);
        // 同一次出现只记一遍：后续 `.get` 链上不会再有同名变量（`body.get(..)` 的返回值不是 body）
        identRe.lastIndex = m.index + varName.length;
    }
    if (keys.size === 0) return null;
    const sorted = [...keys.keys()].sort();
    return { keys: sorted, required: sorted.filter((k) => keys.get(k)) };
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
 * 收集后端 admin 契约：路由 → { handler, responseShapes, responseVariants, io, bodyStruct }。
 *
 * `sinkDirs` 是**响应形状的下沉目录**：响应 struct 常常定义在 `synapse-storage/src` /
 * `synapse-common/src`（`ServerNotification` / `AuditEvent` / `RateLimitConfig` …），
 * 而辅助函数（`fn report_to_json(..) -> Value`）也在 `synapse-web/src` 里。
 * 不索引它们，`Ok(Json(<struct>))` 这一大类处理器就只能落进"未知"桶 —— 沉默不是通过。
 *
 * ## `responseShapes` 与 `responseVariants` 的关系
 *
 * `responseShapes` 是**严格**结论：所有返回分支都能判定才算数，任一分支判不出来就整体
 * `null`（不交半份结论）。`responseVariants` 是兼容旧台账/旧 spec 的**对象视图**：
 * 全部变体都是对象时才给出键集，否则 `null`。
 *
 * @param {{ routesDir: string, sinkDirs?: string[] }} options
 * @returns {Promise<{ byRoute: Map<string, object>, stats: object, files: string[] }>}
 */
export async function collectRustAdminContract({ routesDir, sinkDirs = [] }) {
    const walk = (dir) => {
        const out = [];
        const rec = (d) => {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                const full = path.join(d, e.name);
                if (e.isDirectory()) rec(full);
                else if (e.name.endsWith(".rs")) out.push(full);
            }
        };
        rec(dir);
        return out;
    };
    const files = walk(routesDir);
    const sinkFiles = [];
    for (const d of sinkDirs) if (fs.existsSync(d)) sinkFiles.push(...walk(d));

    const byRoute = new Map();
    const structs = new Map();
    const structHits = new Map();
    const perFile = new Map();
    const rawFunctions = new Map();
    // 接收者类型推断需要的两张表：`struct → 字段类型` 与 `impl 目标类型 → 方法`。
    const structFields = new Map();
    const methods = new Map();
    // `dyn Trait` ⇒ 生产实现。测试替身（`test_mocks` / `tests` / `test_*.rs`）不进这张表：
    // 它们与生产实现同名，混在一起会让"唯一实现"判据恒不成立（本仓每个存储特征都有两个 impl）。
    const traitImpls = new Map();
    const isTestishPath = (p) =>
        /(?:^|\/)(?:test_mocks|tests?|testutils|mocks)\/|(?:^|\/)test_[^/]*\.rs$|_tests?\.rs$/.test(p);
    for (const f of [...files, ...sinkFiles]) {
        const src = stripRustComments(fs.readFileSync(f, "utf8"));
        if (files.includes(f)) perFile.set(f, src);
        for (const [k, v] of parseRustStructFieldTypes(src)) {
            if (v === null) structFields.set(k, null);
            else if (!structFields.has(k)) structFields.set(k, v);
        }
        if (!isTestishPath(f)) {
            for (const [trait, selfs] of parseRustTraitImpls(src)) {
                const seen = new Set([...(traitImpls.get(trait) ?? []), ...selfs]);
                traitImpls.set(trait, [...seen]);
            }
        }
        for (const [k, v] of parseRustImplMethods(src)) {
            const prev = methods.get(k);
            if (!prev) {
                methods.set(k, v);
                continue;
            }
            for (const [mn, defs] of v) prev.set(mn, [...(prev.get(mn) ?? []), ...defs]);
        }
        // 同一个 struct 名在多处定义时，字段集不同就说明"名字撞了" ⇒ 标 opaque 拒绝下沉。
        // 字段集相同但**可选性不同**（如 `Option<T>` vs `T`）同样是两个类型撞名：拿其中一个的
        // 可选性去判"后端是否必填"会静默地把真缺陷放行 ⇒ 也标 opaque。
        for (const [k, v] of parseSerdeStructs(src)) {
            structHits.set(k, (structHits.get(k) ?? 0) + 1);
            const prev = structs.get(k);
            if (!prev) structs.set(k, v);
            else if (prev.fields.join(",") !== v.fields.join(",")) structs.set(k, { ...prev, opaque: true });
            else if (prev.optionalFields.join(",") !== v.optionalFields.join(","))
                structs.set(k, { ...prev, opaque: true });
            else structs.set(k, { ...prev, opaque: prev.opaque || v.opaque });
        }
        for (const fn of findAllRustFunctions(src)) {
            const list = rawFunctions.get(fn.name) ?? [];
            list.push({ ...fn, ret: extractReturnType(fn.sig), file: f });
            rawFunctions.set(fn.name, list);
        }
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

    /**
     * 按名字挑出**唯一**可下沉的函数定义。
     *
     * 名字撞了就返回 `null`（拒绝下沉），而不是"随便挑一个"：本仓同一方法名在多个
     * `impl` 里重复定义很常见，猜错会把"不知道"变成"知道"，而错的形状比未知更危险。
     *
     * @param {string} name
     * @returns {object | null}
     */
    const pickFunction = (name) => {
        const list = rawFunctions.get(name);
        if (!list) return null;
        if (handlerRoutes.has(name)) {
            // 路由指向的处理器：限定在**扫描根之内**、且返回类型像响应（排除同名普通函数）
            const inRoutes = list.filter(
                (f) => f.file.startsWith(routesDir + path.sep) && SHAPE_RETURN.test(f.ret ?? ""),
            );
            if (inRoutes.length === 1) return inRoutes[0];
            return null;
        }
        const tops = list.filter((f) => f.topLevel);
        return tops.length === 1 ? tops[0] : null;
    };
    const functions = new Map();
    for (const name of rawFunctions.keys()) functions.set(name, pickFunction(name));

    const resolver = createResponseResolver({
        structs,
        functions,
        types: { structFields, methods, traitImpls },
    });

    let handlerCount = 0;
    let responseKnown = 0;
    let requestKnown = 0;
    let ambiguous = 0;
    for (const [f, src] of perFile) {
        for (const fn of findRustFunctions(src)) {
            const routes = handlerRoutes.get(fn.name);
            if (!routes) continue;
            handlerCount++;
            const responseShapes = resolver.resolveHandler({
                name: fn.name,
                body: fn.body,
                sig: fn.sig,
                ret: extractReturnType(fn.sig),
            });
            const responseVariants =
                responseShapes && responseShapes.every((s) => s.kind === "object")
                    ? responseShapes.map((s) => s.keys)
                    : null;
            const io = extractHandlerIo(fn.sig);
            const bodyStruct = io.jsonType && structs.has(io.jsonType) ? structs.get(io.jsonType) : null;
            // `Json<Value>` 的处理器没有 struct，但它读了哪些键是静态可判的（见
            // `extractJsonValueBodyKeys`）；判不出来时保持 null（未知桶）。
            const bodyKeys = bodyStruct ? null : extractJsonValueBodyKeys({ sig: fn.sig, body: fn.body, io });
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
                    responseShapes,
                    responseVariants,
                    io,
                    bodyStruct: bodyStruct
                        ? {
                              name: io.jsonType,
                              fields: bodyStruct.fields,
                              optional: bodyStruct.optionalFields,
                              ignored: bodyStruct.ignoredFields,
                              denyUnknownFields: bodyStruct.denyUnknownFields,
                              // `opaque`（改不出键的 rename_all）或 `flatten`（键集不闭合）
                              // 都让"键集"不再是全貌 ⇒ 调用方按"未知"处理，不拿去比对。
                              opaque: bodyStruct.opaque || bodyStruct.flatten,
                          }
                        : bodyKeys
                          ? {
                                name: `${io.jsonType}（手工 body.get）`,
                                fields: bodyKeys.keys,
                                optional: bodyKeys.keys.filter((k) => !bodyKeys.required.includes(k)),
                                ignored: [],
                                // `Json<Value>` 从不因多余键报错（没有 serde 反序列化在把关）
                                denyUnknownFields: false,
                                // 键集来自"读哪些键"，没有 flatten 概念；但要标出这行的来源，
                                // 便于报告区分"struct 定义的键集"与"处理器实际读的键集"。
                                manualRead: true,
                                opaque: false,
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
            sinkFileCount: sinkFiles.length,
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
 * 解析 **TS 类型位置**上的对象体（`interface X { … }` 的体、`type X = { … }` 的体）的一层成员。
 *
 * 与旧实现的「4 空格缩进」启发式相比，这里按**深度 0 的分隔符**（`;` `,` 换行）切成员：
 * 嵌套对象的字段天然落在 depth > 0 ⇒ 不会被算成外层字段（旧启发式同样能做到，
 * 但会把「单行 interface」整条漏掉）。同时比旧实现多取一个东西：**可选性**（`a?: T`）——
 * 「后端必填而 SDK 标成可选」意味着调用方可以合法地不传，然后收到 422。
 *
 * 三条**踩过的坑**都钉在这里：
 *   1. `<`/`>` 必须计入深度：`devices: Record<\n string,\n {…}\n>;` 这种**多行泛型**里，
 *      泛型实参会被当成独立成员 ⇒ 凭空多出字段名（实测多出一个 `string`）；
 *   2. 类型位置**没有简写成员**（`{ a }` 不是合法 TS 类型）⇒ 不许有"裸标识符也算字段"的兜底，
 *      否则上面那个 `string` 就会被收进字段集；
 *   3. 索引签名 / 映射类型 / 计算键（都以 `[` 开头）⇒ `open: true`（键集不闭合）；
 *      认不出的成员（方法签名等）**忽略**而不是标 open —— 它们本来就不产生线上键。
 *
 * @param {string} bodyText 不含最外层花括号的对象体
 * @returns {{ fields: string[], optionalFields: string[], open: boolean }}
 */
function parseTsObjectMembers(bodyText) {
    const fields = [];
    const optionalFields = [];
    let open = false;
    let cur = "";
    let depth = 0;
    const flush = () => {
        const t = cur.replace(/\s+/g, " ").trim();
        cur = "";
        if (!t) return;
        if (t.startsWith("[")) {
            open = true;
            return;
        }
        const m = /^(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*(\?)?\s*:/.exec(t);
        if (m) {
            fields.push(m[1]);
            if (m[2]) optionalFields.push(m[1]);
        }
    };
    for (let i = 0; i < bodyText.length; i++) {
        const c = bodyText[i];
        if (c === '"' || c === "'" || c === "`") {
            const q = c;
            cur += c;
            i++;
            while (i < bodyText.length) {
                cur += bodyText[i];
                if (bodyText[i] === "\\") {
                    cur += bodyText[i + 1] ?? "";
                    i += 2;
                    continue;
                }
                if (bodyText[i] === q) break;
                i++;
            }
            continue;
        }
        if (c === "<" || c === "(" || c === "[" || c === "{") depth++;
        else if (c === ">" || c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
        else if (depth === 0 && (c === ";" || c === "," || c === "\n")) {
            flush();
            continue;
        }
        cur += c;
    }
    flush();
    return { fields: [...new Set(fields)].sort(), optionalFields: [...new Set(optionalFields)].sort(), open };
}

/**
 * 解析 **TS 值位置**上的对象字面量体，取一层键。
 *
 * 与类型位置的区别：这里有简写（`{ accept }`）与展开（`{ ...rest }`）。
 * 展开 ⇒ 键集不闭合 ⇒ `open: true`（把展开当"没有其余字段"会制造"SDK 多声明字段"的假阳）。
 * 值里的 `?` / 逗号都在 depth > 0，不会干扰键检测。
 *
 * @param {string} bodyText 不含最外层花括号的字面量体
 * @returns {{ keys: string[], open: boolean }}
 */
function tsObjectLiteralKeys(bodyText) {
    const keys = [];
    let open = false;
    let cur = "";
    let depth = 0;
    const flush = () => {
        const t = cur.replace(/\s+/g, " ").trim();
        cur = "";
        if (!t) return;
        if (t.startsWith("...")) {
            open = true;
            return;
        }
        const m = /^(?:([A-Za-z_$][\w$]*)|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*(?::|$|,)/.exec(t);
        if (m) {
            keys.push(m[1] ?? m[2] ?? m[3]);
            return;
        }
        open = true; // 计算键 `[k]: v` 之类 ⇒ 不假装知道
    };
    for (let i = 0; i < bodyText.length; i++) {
        const c = bodyText[i];
        if (c === '"' || c === "'" || c === "`") {
            const q = c;
            cur += c;
            i++;
            while (i < bodyText.length) {
                cur += bodyText[i];
                if (bodyText[i] === "\\") {
                    cur += bodyText[i + 1] ?? "";
                    i += 2;
                    continue;
                }
                if (bodyText[i] === q) break;
                i++;
            }
            continue;
        }
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) depth = Math.max(0, depth - 1);
        else if (depth === 0 && c === ",") {
            flush();
            continue;
        }
        cur += c;
    }
    flush();
    return { keys, open };
}

/**
 * 索引 TS 侧的类型形状：`interface` / `type X = {…}` / `type X = Y` / `type X = 其它`。
 *
 * 三个字段：
 *   - `fields`：一层字段名；
 *   - `optionalFields`：其中带 `?` 的（请求体检查要用）；
 *   - `open`：键集不闭合（索引签名 / 映射类型 / 展开 / 联合等非对象 RHS）⇒ 调用方按"未知"处理。
 *
 * @param {string} src 已去注释的源码
 * @returns {Map<string, { fields: string[], optionalFields: string[], open: boolean }>}
 */
export function extractTsTypeShapes(src) {
    const own = new Map();
    const bases = new Map();
    const aliases = new Map();
    for (const m of src.matchAll(/export\s+interface\s+([A-Za-z_$]\w*)\s*(?:<[^>]*>)?\s*(extends\s[^{]*)?\{/g)) {
        const brace = src.indexOf("{", m.index + m[0].length - 1);
        if (brace < 0) continue;
        const slice = balancedSlice(src, brace);
        if (!slice) continue;
        own.set(m[1], parseTsObjectMembers(slice.text.slice(1, -1)));
        if (m[2]) {
            bases.set(
                m[1],
                [...m[2].replace(/^extends\s*/, "").matchAll(/([A-Za-z_$]\w*)/g)].map((x) => x[1]),
            );
        }
    }
    for (const m of src.matchAll(/export\s+type\s+([A-Za-z_$]\w*)\s*(?:<[^>]*>)?\s*=\s*/g)) {
        const after = m.index + m[0].length;
        const head = src.slice(after);
        const lead = head.length - head.replace(/^\s+/, "").length;
        const body = head.replace(/^\s+/, "");
        if (body.startsWith("{")) {
            const slice = balancedSlice(src, after + lead);
            if (!slice) continue;
            // ⚠️ 必须看**对象字面量之后**还有什么：`export type X = { a: string } | { b: string }`
            // 的第一个分支也是 `{`，只解析它就等于把联合类型当成单个对象类型
            // （字段集静默少一半，且 `open` 为 false ⇒ 会被拿去比对）。
            const rest = src.slice(slice.end).replace(/^\s+/, "");
            if (rest.length > 0 && !rest.startsWith(";")) {
                own.set(m[1], { fields: [], optionalFields: [], open: true });
                continue;
            }
            own.set(m[1], parseTsObjectMembers(slice.text.slice(1, -1)));
            continue;
        }
        const am = /^([A-Za-z_$]\w*)\s*;/.exec(body);
        if (am) {
            aliases.set(m[1], { target: am[1], modifier: null });
            continue;
        }
        // 工具类型别名（`type X = Partial<Y>` / `Required<Y>` / `Readonly<Y>`）：
        // `Partial<CreateNotificationRequest>` 是"同一字段集、全部可选"，
        // 判成 open 会让这类请求体**永远不被检查**（本仓 `UpdateNotificationRequest` 即如此）。
        const um = /^(Partial|Required|Readonly|NonNullable)\s*<\s*([A-Za-z_$][\w$]*)\s*>\s*;/.exec(body);
        if (um) {
            aliases.set(m[1], { target: um[2], modifier: um[1] });
            continue;
        }
        // 联合 / 交叉 / 数组等：键集判不出来 ⇒ open（而不是"没有字段"）
        own.set(m[1], { fields: [], optionalFields: [], open: true });
    }
    // `interface X extends Y` 必须把 Y 的字段并进来：第一版的正则把 `extends Y` 与花括号
    // 一并吃掉，只留自身字段 ⇒ `RoomRetentionPolicy extends RetentionPolicy` 少了 3 个键，
    // 且**看起来像是 SDK 漏声明**（假阳/假阴同时出现）。凡用 extends 的类型都会中招。
    const byName = (name, seen) => {
        if (seen.has(name)) return null;
        seen.add(name);
        const self = own.get(name);
        if (self) {
            const fields = new Set(self.fields);
            const optionalFields = new Set(self.optionalFields);
            let open = self.open;
            for (const b of bases.get(name) ?? []) {
                const bv = byName(b, seen);
                if (!bv) continue;
                for (const f of bv.fields) fields.add(f);
                for (const f of bv.optionalFields) optionalFields.add(f);
                open = open || bv.open;
            }
            return { fields: [...fields].sort(), optionalFields: [...optionalFields].sort(), open };
        }
        const alias = aliases.get(name);
        if (!alias) return null;
        const v = byName(alias.target, seen);
        if (!v || !alias.modifier) return v;
        if (alias.modifier === "Partial") return { ...v, optionalFields: [...v.fields] };
        if (alias.modifier === "Required") return { ...v, optionalFields: [] };
        return v; // Readonly / NonNullable 不改字段集
    };
    const out = new Map();
    for (const name of new Set([...own.keys(), ...aliases.keys()])) {
        const v = byName(name, new Set());
        if (v) out.set(name, v);
    }
    return out;
}

/**
 * 取一个 `interface` / `type` 对象的**第一层**字段名（响应侧用）。
 *
 * 只收「键集闭合」的形状：`open` 的类型（索引签名 / 联合）只给出部分键，
 * 拿它去比后端响应会凭空报"缺字段"或"多字段"（方向不定的假阳）⇒ 宁可落进
 * 「接口找不到」覆盖桶（沉默必须可见），也不给半份结论。
 *
 * @param {string} src 已去注释的源码
 * @returns {Map<string, string[]>} 类型名 → 字段名（排序）
 */
export function extractInterfaceFields(src) {
    const out = new Map();
    for (const [name, shape] of extractTsTypeShapes(src)) {
        if (!shape.open) out.set(name, shape.fields);
    }
    return out;
}

/**
 * 跳过一段引号包起来的字面量，返回**收尾引号**的下标（没有收尾则返回末位）。
 *
 * @param {string} text
 * @param {number} start 起始引号下标
 * @returns {number}
 */
function skipQuoted(text, start) {
    const q = text[start];
    let i = start + 1;
    while (i < text.length) {
        if (text[i] === "\\") {
            i += 2;
            continue;
        }
        if (text[i] === q) return i;
        i++;
    }
    return text.length - 1;
}

/**
 * 把 `cond ? A : B` 切成三段；不是三元（或找不到配对的 `:`）返回 `null`。
 *
 * `??` / `?.` 会被排除，否则 `payload ?? {}` 会被当成三元。
 *
 * @param {string} text
 * @returns {[string, string, string] | null}
 */
function splitTsTernary(text) {
    let depth = 0;
    let q = -1;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"' || c === "'" || c === "`") {
            i = skipQuoted(text, i);
            continue;
        }
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
        else if (depth === 0 && c === "?" && text[i + 1] !== "?" && text[i + 1] !== ".") {
            q = i;
            break;
        }
    }
    if (q < 0) return null;
    let d2 = 0;
    for (let i = q + 1; i < text.length; i++) {
        const c = text[i];
        if (c === '"' || c === "'" || c === "`") {
            i = skipQuoted(text, i);
            continue;
        }
        if (c === "(" || c === "[" || c === "{") d2++;
        else if (c === ")" || c === "]" || c === "}") d2 = Math.max(0, d2 - 1);
        else if (d2 === 0 && c === ":") return [text.slice(0, q), text.slice(q + 1, i), text.slice(i + 1)];
    }
    return null;
}

/**
 * 解析 TS 参数表为 `参数名 → { typeText, optional }`。
 *
 * 默认值（`options?: X = {}`）要切掉：它属于**调用点**，不属于类型。
 *
 * @param {string} paramsText 不含最外层圆括号的参数表
 * @returns {Map<string, { typeText: string | null, optional: boolean }>}
 */
function parseTsParams(paramsText) {
    const out = new Map();
    for (const raw of splitTopLevelArgs(paramsText)) {
        const m =
            /^\s*(?:public\s+|private\s+|protected\s+|readonly\s+)*([A-Za-z_$][\w$]*)\s*(\??)\s*(?::\s*([\s\S]*))?$/.exec(
                raw,
            );
        if (!m) continue;
        let typeText = (m[3] ?? "").replace(/\s+/g, " ").trim();
        if (typeText) {
            // 首个深度 0 的 `=` 之后是默认值
            const eq = splitTopLevel(typeText, "=");
            if (eq.length > 1) typeText = eq[0].trim();
        }
        out.set(m[1], { optional: m[2] === "?", typeText: typeText || null });
    }
    return out;
}

/**
 * 找 `const/let/var <name>` 的类型标注与初始化表达式（方法体内）。
 *
 * 需要它是因为"请求体"常常先组装到局部变量再传：
 * `const body: {...} = {...}; ... this.adminRequest(Method.Post, p, {}, body)`。
 *
 * @param {string} bodyText 方法体（含最外层花括号）
 * @param {string} name
 * @returns {{ typeText: string | null, rhs: string | null } | null}
 */
function findTsLetBinding(bodyText, name) {
    const re = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*(?=[:=;,)]|$)`, "g");
    const m = re.exec(bodyText);
    if (!m) return null;
    let i = m.index + m[0].length;
    let typeText = null;
    const n = bodyText.length;
    if (bodyText[i] === ":") {
        const start = i + 1;
        let depth = 0;
        while (i < n) {
            const c = bodyText[i];
            if (c === '"' || c === "'" || c === "`") {
                i = skipQuoted(bodyText, i);
            } else if (c === "<" || c === "(" || c === "[" || c === "{") depth++;
            else if (c === ">" || c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
            else if (depth === 0 && (c === "=" || c === ";" || c === ",")) break;
            i++;
        }
        typeText = bodyText.slice(start, i).replace(/\s+/g, " ").trim() || null;
    }
    if (bodyText[i] !== "=") return { typeText, rhs: null };
    const start = i + 1;
    let depth = 0;
    while (i < n) {
        const c = bodyText[i];
        if (c === '"' || c === "'" || c === "`") {
            i = skipQuoted(bodyText, i);
        } else if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
        else if (depth === 0 && c === ";") break;
        i++;
    }
    return { typeText, rhs: bodyText.slice(start, i).trim() || null };
}

/**
 * 解析 SDK 侧**请求体**的形状（字段名 + 可选性）；判不出来一律 `null`。
 *
 * 判据链（从"最直接"到"要推"）：
 *   1. 内联对象字面量 `{ server_name: x, accept }` ⇒ 键集即字面量；含展开 ⇒ 判不了；
 *   2. `x ?? {}` / `x || {}` ⇒ 回落成 `x`（右侧空对象不贡献键）；
 *   3. 三元 `cond ? A : B` ⇒ 只有"一侧是缺席（`undefined`/`null`）"才敢定形状，两侧都成形且不同 ⇒ 判不了；
 *   4. 裸标识符 ⇒ 先查**方法参数**的类型标注，再查**局部变量**的声明（类型标注优先，其次初始化表达式）；
 *   5. 类型标注 ⇒ 内联对象类型或命名 interface/type（`open` 的、联合的、`&` 交叉的、`Partial<T>` 之外的
 *      工具类型一律判不了；`Partial<T>` 把全部字段变可选）。
 *
 * ⚠️ **绝不**用"方法声明返回类型"或"某个同名类型"兜底 —— 猜出来的字段集比未知危险得多：
 * 它会同时制造假阳（把其实一致的键报成不一致）与假阴（把真缺陷报成一致）。
 *
 * @param {{ params?: string, bodyArg?: string | null, methodBody?: string, shapes?: Map<string, object> }} input
 * @returns {{ fields: string[], optionalFields: string[] } | null}
 */
export function resolveSdkRequestShape({ params, bodyArg, methodBody, shapes, ownShapes }) {
    if (!bodyArg || !shapes) return null;
    // 本文件先声明先赢：`ownShapes` 是该文件自己的表，跨文件重名时它才是"这个调用点
    // 看到的那个类型"。
    const lookup = (name) => ownShapes?.get(name) ?? shapes.get(name);
    const parsedParams = parseTsParams(params ?? "");
    const seenNames = new Set();

    const resolveType = (raw, depth) => {
        if (depth > 6 || !raw) return null;
        const parts = splitTopLevel(raw, "|")
            .map((s) => s.trim())
            .filter(Boolean);
        const real = parts.filter((p) => p !== "null" && p !== "undefined" && p !== "void");
        if (real.length !== 1) return null; // 联合（含"全是 null"）⇒ 判不了
        const t = real[0];
        if (splitTopLevel(t, "&").length > 1) return null; // 交叉类型：静态合并不可靠
        const w = /^(Readonly|Required|Partial)\s*<\s*([\s\S]+?)\s*>$/.exec(t);
        if (w) {
            const inner = resolveType(w[2], depth + 1);
            if (!inner) return null;
            return w[1] === "Partial" ? { fields: inner.fields, optionalFields: [...inner.fields] } : inner;
        }
        if (t.startsWith("{")) {
            const slice = balancedSlice(t, 0);
            if (!slice) return null;
            const body = parseTsObjectMembers(slice.text.slice(1, -1));
            return body.open ? null : { fields: body.fields, optionalFields: body.optionalFields };
        }
        if (/^[A-Za-z_$][\w$]*$/.test(t)) {
            const sh = lookup(t);
            if (!sh || sh.open) return null;
            return { fields: sh.fields, optionalFields: sh.optionalFields };
        }
        return null;
    };

    const resolveExpr = (raw, depth) => {
        if (depth > 6 || !raw) return null;
        const t = raw.replace(/\s+/g, " ").trim();
        const nm = /^([A-Za-z_$][\w$]*)\s*(?:\?\?|\|\|)\s*([\s\S]+)$/.exec(t);
        if (nm) {
            if (!/^\{\s*\}$/.test(nm[2].trim())) return null; // 两侧都成形（且不同）⇒ 判不了
            return resolveExpr(nm[1], depth + 1);
        }
        const tern = splitTsTernary(t);
        if (tern) {
            const absent = (s) => /^(?:undefined|null)$/.test(s.trim());
            const a = absent(tern[1]) ? null : resolveExpr(tern[1], depth + 1);
            const b = absent(tern[2]) ? null : resolveExpr(tern[2], depth + 1);
            if (a && b) return a.fields.join(",") === b.fields.join(",") ? a : null;
            return a ?? b;
        }
        if (t.startsWith("{")) {
            const slice = balancedSlice(t, 0);
            if (!slice) return null;
            const lit = tsObjectLiteralKeys(slice.text.slice(1, -1));
            return lit.open ? null : { fields: [...new Set(lit.keys)].sort(), optionalFields: [] };
        }
        if (/^[A-Za-z_$][\w$]*$/.test(t)) {
            const p = parsedParams.get(t);
            if (p?.typeText) {
                const r = resolveType(p.typeText, depth + 1);
                if (r) return r;
            }
            if (!seenNames.has(t)) {
                seenNames.add(t);
                const b = findTsLetBinding(methodBody ?? "", t);
                if (b) {
                    const byType = b.typeText ? resolveType(b.typeText, depth + 1) : null;
                    if (byType) return byType;
                    return resolveExpr(b.rhs, depth + 1);
                }
            }
            return null;
        }
        return null;
    };

    return resolveExpr(bodyArg, 0);
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
 * @returns {Promise<{ callSites: object[], fields: Map<string, string[]>, typeShapes: Map<string, object>, files: string[], stats: object }>}
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
    // 请求体字段名比对用的「完整形状表」：带**可选性**与**是否闭合**（响应侧只认闭合形状，
    // 请求侧则要把"闭合但可选/必填"区分开，见 `resolveSdkRequestShape`）。
    // ⚠️ 形状表要**按文件**保留一份：TS 的类型解析是按模块的，同名类型在两个文件里
    // 声明成不同形状时（本仓实测 `CleanupRoomsRequest`：`admin-cleanup-manager.ts`
    // 是 `{min_age_ms}`、`admin-server-types.ts` 是带索引签名的 `{room_id?}`），
    // 只用一张全局表 + 后写覆盖 ⇒ **同一个名字只有最后一个文件的形状生效**，
    // 于是"哪个调用点被判成什么形状"取决于目录遍历顺序（不报错、静默判错）。
    // 全局表只保留"形状唯一"的名字；拆不开的名字进本文件表优先、全局表按未知处理。
    const typeShapes = new Map();
    const typeShapeFiles = new Map();
    const typeShapesByFile = new Map();
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
        const ownShapes = extractTsTypeShapes(src);
        typeShapesByFile.set(rel, ownShapes);
        for (const [k, v] of ownShapes) {
            const shapeKey = (s) => `${s.fields.join(",")}|${s.optionalFields.join(",")}|${s.open}`;
            const prev = typeShapes.get(k);
            if (!prev) {
                typeShapes.set(k, v);
                typeShapeFiles.set(k, rel);
            } else if (shapeKey(prev) !== shapeKey(v)) {
                // 同名不同形 ⇒ **不许挑一个**（挑错会让调用方拿到另一份字段集）
                typeShapes.set(k, { fields: [], optionalFields: [], open: true });
                typeShapeFiles.set(k, rel);
            }
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
                // 这个调用点是不是**原样返回**（`return [await] this.adminRequest(..);`）？
                //
                // 决定了"方法的声明返回类型"能不能当**线格式声明**用：
                //   `return await this.adminRequest<T>(..)` ⇒ 响应原样交给调用方 ⇒ T 就是线格式；
                //   `const r = await this.adminRequest(..); return r.destinations;`
                //   ⇒ 声明返回类型是**加工后**的值，拿它去比后端响应形状会误报
                //   （`getFederationDestinations` 就这样被误报成"SDK 声明数组、后端返回对象"）。
                const beforeCall = slice.text.slice(0, cm.index);
                const afterCall = slice.text.slice(callSlice.end).replace(/^\s*/, "");
                const directReturn =
                    /(?:^|[;{}\s])return\s+(?:await\s+)?this\s*\.\s*$/.test(beforeCall) && afterCall.startsWith(";");
                callSites.push({
                    file: path.relative(path.dirname(srcDir), f),
                    managerMethod: m[1],
                    declaredReturn,
                    typeArg: cm[2] ? cm[2].replace(/\s+/g, " ").trim() : null,
                    directReturn,
                    httpMethod: hm[1].toUpperCase(),
                    route: `${hm[1].toUpperCase()} ${norm}`,
                    argCount: args.length,
                    hasQueryArg: present(2),
                    hasBodyArg: present(3),
                    // 请求体字段名比对要用的三样东西（只在内存里，不进台账）：
                    // 参数表（`payload: X` 的类型）、方法体（局部 `const body = {…}`）、
                    // 以及第 4 实参原文（内联字面量 / `payload ?? {}` / 三元）。
                    params: paren.text.slice(1, -1),
                    methodBody: slice.text,
                    bodyArg: present(3) ? args[3] : null,
                    ownShapes,
                });
            }
        }
    }
    return {
        callSites,
        fields,
        fieldFiles,
        typeShapes,
        typeShapeFiles,
        typeShapesByFile,
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
 * 比对**请求体字段名**（两侧都判得出来时才比）。
 *
 * 四档判定，全部以「后端处理器怎么写」为准：
 *
 *   - `request-unknown-field-rejected`：SDK 声明了后端没有的键，且后端带
 *     `#[serde(deny_unknown_fields)]` ⇒ **必然 400**（`unknown field`）。最严重的一档；
 *   - `request-unknown-field-ignored`：SDK 多声明了键而后端不 deny ⇒ 请求体被**静默忽略**。
 *     字段名写错的调用方会以为设置生效了（本仓 `updateAccountDetails` 曾传 `suspended`、
 *     `createAccountDataCallback` 曾传 `callback_type`，都属于这一类）；
 *   - `request-missing-required-field` / `request-optional-vs-required`：后端必填（非
 *     `Option`、无 `#[serde(default)]`）而 SDK 没声明（或声明成可选）⇒ 调用方可以合法地
 *     不传，然后拿到 422。
 *
 * @param {{ sdkFields: string[], sdkOptional: string[], backendFields: string[], backendOptional: string[], denyUnknownFields: boolean, backendType: string }} input
 * @returns {{ kind: string, detail: string } | null}
 */
export function diffRequestShape({
    sdkFields,
    sdkOptional,
    backendFields,
    backendOptional,
    denyUnknownFields,
    backendType,
}) {
    const bf = new Set(backendFields);
    const bo = new Set(backendOptional);
    const sf = new Set(sdkFields);
    const so = new Set(sdkOptional);
    const extra = sdkFields.filter((f) => !bf.has(f));
    if (extra.length > 0) {
        return {
            kind: denyUnknownFields ? "request-unknown-field-rejected" : "request-unknown-field-ignored",
            detail: `后端 ${backendType} 没有 [${extra.join(", ")}]`,
        };
    }
    const missingRequired = backendFields.filter((f) => !bo.has(f) && !sf.has(f));
    if (missingRequired.length > 0) {
        return {
            kind: "request-missing-required-field",
            detail: `后端 ${backendType} 必填而 SDK 未声明 [${missingRequired.join(", ")}]`,
        };
    }
    const optionalMismatch = backendFields.filter((f) => !bo.has(f) && sf.has(f) && so.has(f));
    if (optionalMismatch.length > 0) {
        return {
            kind: "request-optional-vs-required",
            detail: `后端 ${backendType} 必填而 SDK 标成可选 [${optionalMismatch.join(", ")}]`,
        };
    }
    return null;
}

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
// 覆盖桶（unresolved）的自解释汇总
// ---------------------------------------------------------------------------

/**
 * 「覆盖桶」每一类的**含义**。
 *
 * 为什么要有这张表：`unresolved` 原先在台账里只留 `{ count: n }` —— 15 条
 * `route-not-resolved` 到底是哪 15 个方法、各自卡在哪一步，**从台账里看不出来**。
 * 一个只报数字的覆盖桶会被读成"已知的少量噪声"，而它实际是"抽取器看不见的地面"。
 * 逐条带 reason 之后，"桶里是什么"和"为什么进桶"都能被审阅（并且能被 spec 钉住）。
 */
export const UNRESOLVED_KIND_REASONS = Object.freeze({
    "route-not-resolved":
        "SDK 调用点拼出的路由在后端处理器映射里找不到（路径由局部变量 / 方法返回值决定，静态解析不出来）⇒ 响应与请求都无法核",
    "array-return": "后端返回裸数组，而 SDK 声明的是另一种响应种类 ⇒ 该形状不参与逐字段比对（但仍计覆盖桶）",
    "inline-type-arg": "SDK 在泛型实参里写了内联对象字面量类型 ⇒ 判不出「线格式」（见 wireClaim ①）",
    "request-shape-unknown":
        "请求体形状有一侧不可知：reason=backend（后端 struct 没解析出来）/ backend-opaque（键集不闭合）/ sdk（SDK 第 4 实参解析不出来）",
    "backend-shape-unknown":
        "后端响应形状解析不出来（既不是 json! / struct 字面量 / Map::insert，也不是纯委派或已知辅助函数）",
    "return-type-not-named": "SDK 声明的返回类型不是具名类型 ⇒ 没有键集可比",
    "interface-not-found": "wireClaim 解出的具名类型在 src/admin 里找不到（改名或删除后未重新核对后端）",
    "backend-shape-mixed": "后端同一路由在不同分支返回多种形状 ⇒ 无法与单一 SDK 声明比对",
});

/**
 * 把 `classify()` 吐出的 `unresolved` 拍平成「逐条带 reason」的台账形状。
 *
 * 纯函数（spec 直接测）。三个性质是有意为之：
 *   ① **每条都有非空 reason**：条目自带的 `reason`（如 `backend` / `sdk`）会用括号补充细分，
 *      否则回退到 `UNRESOLVED_KIND_REASONS`；未登记的新 kind 直接拿 kind 名兜底（仍是非空）；
 *   ② **entries 长度恒等于 count**：CI 半场据此判"台账是否被降级成只有数字"；
 *   ③ **排序稳定**：按 `route|managerMethod` 排，否则每次 `--refresh` 都会产生随机 diff。
 *
 * @param {Array<object>} unresolved `classify()` 的覆盖桶条目
 * @returns {Record<string, { count: number, entries: Array<object> }>}
 */
export function summarizeUnresolved(unresolved) {
    const out = {};
    for (const u of unresolved) {
        const kind = u.kind ?? "(unknown)";
        const bucket = (out[kind] ??= { count: 0, entries: [] });
        bucket.count += 1;
        const why = UNRESOLVED_KIND_REASONS[kind] ?? kind;
        bucket.entries.push({
            managerMethod: u.managerMethod ?? null,
            route: u.route ?? null,
            declaredReturn: u.declaredReturn ?? null,
            handler: u.handler ?? null,
            sdkType: u.sdkType ?? null,
            reason: u.reason ? `${why}（细分：${u.reason}）` : why,
        });
    }
    for (const bucket of Object.values(out)) {
        bucket.entries.sort((a, b) => `${a.route}|${a.managerMethod}`.localeCompare(`${b.route}|${b.managerMethod}`));
    }
    return out;
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
