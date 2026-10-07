/**
 * `check-entrypoint-layering.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** 抽出 `export * from "…"` / `export { … } from "…"` 的来源说明符（只认双引号、行首 export）。 */
export function extractExportSpecifiers(source: string): string[];

/** 命中的禁用模式（全部返回，不 early return）。 */
export function findForbiddenPatterns(source: string, forbidden: string[]): string[];

/** 不在白名单里的来源（全部返回）。 */
export function findDisallowedExportFrom(exportFrom: string[], allowed: Set<string>): string[];

/** 收集文件导出的符号集合；`export * from` 递归展开但不传递 `default`。 */
export function collectExportedSymbols(absFilePath: string, visited?: Set<string>): Set<string>;

/** 解析相对 import 说明符为真实文件（.ts / .d.ts / index.ts / index.d.ts）；非相对返回 null。 */
export function resolveRelativeModule(fromFile: string, importSpecifier: string): string | null;

/** 命中禁用符号的那些（按 forbiddenSymbols 原顺序返回）。 */
export function findForbiddenExportedSymbols(exportedSymbols: Set<string>, forbiddenSymbols: string[]): string[];
