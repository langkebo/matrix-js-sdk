/**
 * `check-url-constructors.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** 一处 API 路径构造点（覆盖率规则命中处）。 */
export interface ConstructionSite {
    /** 命中规则：R1 / R2 / R3 */
    rule: string;
    /** 在源码中的字符下标 */
    index: number;
    /** 1-based 行号 */
    line: number;
}

/** `findSymbolBody` 的返回：符号定义体在源码中的范围。 */
export interface SymbolBody {
    /** 定义起始下标 */
    start: number;
    /** 定义结束下标（函数体闭合 `}`） */
    end: number;
    /** 定义起始行的 1-based 行号 */
    lineStart: number;
    /** 定义体原文（含签名与函数体） */
    body: string;
}

/** 桶棘轮问题。 */
export interface BucketIssue {
    kind: string;
    detail: string;
}

/** `classifyPathExpectation` 的判定结果。 */
export type PathExpectationResult =
    | { ok: true; kind: "exact" | "wildcard" | "bucket"; bucket?: string }
    | { ok: false; kind: string; detail: string; bucket?: string };

/** 1-based 行号：`index` 处之前有多少个换行。 */
export function lineOf(source: string, index: number): number;

/** 括号配平：返回配对闭合括号的下标；找不到返回 -1。 */
export function matchBalanced(source: string, startIndex: number): number;

/** 定位符号定义体（跳过参数表与返回类型标注），找不到返回 null。 */
export function findSymbolBody(source: string, symbol: string): SymbolBody | null;

/** 定义体里缺失的守卫子串（空数组 = 全部命中）。 */
export function missingGuards(body: string, guards: string[]): string[];

/** 收集源码里所有覆盖率规则命中的构造点。 */
export function collectConstructionSites(source: string): ConstructionSite[];

/** 核对一条 `(method, path)` 的期望。 */
export function classifyPathExpectation(
    method: string,
    rawPath: string,
    expect: string,
    routes: Map<string, string>,
): PathExpectationResult;

/** 桶棘轮：观测值相对基线只准降不准升（缩小未刷新也报）。 */
export function diffBuckets(baseline: Record<string, number>, observed: Record<string, number>): BucketIssue[];
