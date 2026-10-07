/**
 * `scripts/quality/lib/stable-id.mjs` 的类型声明。
 *
 * 这是 α 缺陷（「指纹把行号编进身份」）的正解实现，被 baseline 机制共用；
 * spec 直接 import 真实 `.mjs` 运行，本声明只给 `tsc` 走类型用。
 */

/**
 * 由稳定维度构造指纹。
 *
 * @param filePath 归一化后的仓库相对路径（正斜杠）。
 * @param stableParts 稳定维度，例如代码片段、错误码。**不要传行号**。
 * @returns `${filePath}#${digest}`，digest 为 16 个 hex 字符。
 */
export function stableId(filePath: string, stableParts: readonly (string | number)[]): string;

/**
 * 为「本文件内完全相同的片段」分配 1-based 序数。
 *
 * @param counter 本次扫描的累加器，由调用方持有。
 * @param key 片段指纹（通常是 `文件` + 规范化片段）。
 */
export function nextOrdinal(counter: Map<string, number>, key: string): number;

/** 把一行文本规范化成可比对的片段：折叠所有空白、去首尾。 */
export function normalizeSnippet(snippet: string): string;
