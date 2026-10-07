/**
 * `verify-path-contract.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** 前缀常量表：手工镜像 `src/http-api/prefix.ts`（两者由 spec 校验一致）。 */
export const PREFIX_CONSTANTS: Record<string, Record<string, string>>;

/** 没有显式 `prefix:` 时 SDK 实际使用的默认前缀。 */
export const DEFAULT_PREFIX: string;

/** 解析结果：`known=false` 表示无法静态求值（调用点计入「动态跳过」，不 silently 放行）。 */
export interface PrefixResolution {
    prefix: string | null;
    known: boolean;
}

/** 候选前缀集合。 */
export interface PrefixCandidates {
    candidates: string[];
    known: boolean;
}

/** 读后端 ledger，建「`METHOD /归一化路径` → 原始路径」索引。 */
export function loadBackendRoutes(file?: string): Map<string, string>;

/** 路径归一：插值/占位符统一成 `{X}`，去 query 与尾斜杠；空串得到 `/`。 */
export function normalizePath(p: string): string;

/** 求值一个前缀表达式（标识符 / 模板字面量 / 裸字符串 / VendorPrefix）。 */
export function resolvePrefix(expr: string | null): PrefixResolution;

/** 解析已剥去反引号的模板字面量。 */
export function resolveTemplateLiteral(literal: string): string;

/** 求值前缀表达式，返回**候选集合**；三元会同时给出两条腿。 */
export function resolvePrefixExpression(expr: string | null): PrefixCandidates;

/** `cond ? A : B` → 两条腿；跳过 `?.` 与 `??`；非三元返回 null。 */
export function splitTopLevelTernary(expr: string): { whenTrue: string; whenFalse: string } | null;

/** 按顶层 `+` 切分（字符串内的 `+` 不切）。 */
export function splitTopLevelPlus(expr: string): string[];

/** 在顶层（不在括号/字符串内）扫描，返回第一个满足 pred 的字符下标；无则 -1。 */
export function findTopLevel(src: string, pred: (char: string, index: number) => boolean): number;

/** 从 `{` 起找配对的 `}`；无则 -1。 */
export function matchBrace(src: string, openIndex: number): number;

/** 抽取形态 A（对象字面量）的调用点：method / path / prefix / line。 */
export function extractObjectCalls(source: string): Array<{
    method: string;
    pathRaw: string;
    prefixExpr: string | null;
    line: number;
}>;

/**
 * 与后端注册面比对：`exact` / `wildcard`（语义存疑，需人工复核）/ null。
 * `routes` 默认用门禁加载的 ledger；spec 可自行传入构造用例。
 */
export function matchAgainstLedger(
    method: string,
    fullPath: string,
    routes?: Map<string, string>,
): "exact" | "wildcard" | null;
