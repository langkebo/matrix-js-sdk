/**
 * `check-sdk-contract-alignment.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** 从追踪表格单元格里解析出的 SDK 调用引用。 */
export interface SdkReference {
    owner: string | null;
    method: string;
    raw: string;
}

/** 切 markdown 表格行；非 `|` 开头返回空数组。 */
export function splitTableCells(line: string): string[];

/** 分隔行判定：每格去掉空白后形如 `---` / `:---:` / `---:`。 */
export function isDividerRow(cells: string[]): boolean;

/** 取单元格里的第一个 inline code；没有则去掉 `**` 后返回整格。 */
export function extractInlineCode(cell: string): string;

/** 去掉成对的 `` ` `` / `'` / `"` 包裹；非字符串返回 undefined。 */
export function normalizePathLiteral(text: unknown): string | undefined;

/** 首字母大写；空值原样返回。 */
export function upperFirst(text: string): string;

/** owner 列归一化：`client` → `MatrixClient`，`getXxxManager` → `XxxManager`，`-` → null。 */
export function normalizeOwner(rawOwner: string): string | null;

/** 方法列归一化：取 `(` 前的标识符；无法解析返回 null。 */
export function normalizeMethod(rawMethod: string): string | null;

/** 从追踪表格单元格解析 SDK 调用引用；`-` 或无法解析返回 null。 */
export function parseSdkReferenceFromCell(cell: string): SdkReference | null;

/** `Method.Get` / `GET` / `"GET"` → `GET`；无法识别原样返回；非字符串返回 undefined。 */
export function canonicalizeMethod(methodExpr: unknown): string | undefined;

/** 前缀表达式 → 路径前缀；未知前缀返回 undefined（调用方据此保留多候选而非静默回退）。 */
export function resolvePrefix(prefixExpr: string): string | undefined;

/** 拼接前缀与请求路径；缺少路径返回 undefined。 */
export function joinPrefixAndPath(prefix: string | undefined, reqPath: string): string | undefined;

/** 路径归一：版本段/模板变量/字面 event type 一律折叠成 `{}`；非 `/` 开头返回 undefined。 */
export function normalizePathForMatch(input: unknown): string | undefined;

/** 是否通配段（`{roomId}`）；归一化后的空占位 `{}` 不算。 */
export function isWildcardSegment(segment: string): boolean;

/** 按 `/` 切段并丢弃空段。 */
export function splitPathSegments(routePath: string): string[];

/** 路径匹配：等长逐段比；不等长时短侧对齐长侧尾缀（Rust 相对路由 vs 文档全前缀）。 */
export function pathsMatchWithWildcards(leftPath: string, rightPath: string): boolean;

/** 尾缀匹配：suffix 比 full 长时直接 false。 */
export function pathEndsWithPattern(fullPath: string, suffixPath: string): boolean;

/** 从 openIndex 起找配对闭合符，跳过引号与转义；找不到返回 -1。 */
export function findMatchingDelimiter(input: string, openIndex: number, openChar?: string, closeChar?: string): number;

/** 按顶层逗号切成两半；找不到返回 `[整串, ""]`。 */
export function splitTopLevelArgs(input: string): [string, string];

/** 解析 Rust 字符串字面量（含换行）；非 `"..."` 形式返回 undefined。 */
export function parseRustStringLiteral(input: string): string | undefined;

/** 拼接 Rust 路由前缀与相对路径，处理重复斜杠。 */
export function joinRustRoutePrefix(prefix: string, routePath: string): string;
