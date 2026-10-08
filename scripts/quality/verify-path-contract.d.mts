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

/** 位置参数包装器形态的调用点，以及**解不出来**的调用点（路径实参非字面量）。 */
export function extractWrapperCalls(
    source: string,
    relFile: string,
    options?: { identityHelpers?: Map<string, IdentityHelperInfo> | null },
): {
    calls: Array<{
        method: string;
        pathRaw: string;
        prefixCandidates: string[];
        prefixKnown: boolean;
        wrapper: string;
        guard: "plain" | "guarded" | null;
        prefixFromHelper: boolean;
        line: number;
    }>;
    unchecked: Array<{ file: string; line: number; wrapper: string; expr: string }>;
};

/** 被识别出来的恒等路径包装器。 */
export interface IdentityHelperInfo {
    /** `guarded` = 参数类型带 `PathAssert<…>`（tsc 已逐段断言）；`plain` = 裸恒等，只有本门禁核对。 */
    kind: "plain" | "guarded";
    files: string[];
    /** 从参数类型里的 `StripXxx<…>` 推出来的真实前缀；推不出来为 null。 */
    stripPrefix: string | null;
}

/** 判断一个 `function <name>(…)` 声明是否为恒等函数（全仓同名多处定义必须一致）。 */
export function verifyIdentityHelperShape(input: {
    source: string;
    name: string;
}): { ok: true; param: string; typeText: string | null } | { ok: false; reason: string };

/** 判定**一个**函数声明（`nameEnd` 是函数名之后的下标）；支持泛型参数与返回类型注解。 */
export function analyzeIdentityFunction(
    source: string,
    nameEnd: number,
): { ok: true; param: string; typeText: string | null } | { ok: false; reason: string };

/** 扫出源码里所有 `function <name>(…)` 声明并逐条判定。 */
export function analyzeFunctionDeclarations(
    source: string,
): Array<{ name: string; ok: boolean; param?: string; typeText?: string | null; reason?: string }>;

/** 全仓扫描，建「恒等包装器名 → 种类 / 前缀 / 定义文件」索引（同名有非恒等定义 ⇒ 整名作废）。 */
export function indexIdentityPathHelpers(
    sourcesByFile: Map<string, string>,
    options?: { stripAliases?: Map<string, string> },
): { helpers: Map<string, IdentityHelperInfo> };

/** 把 `helper(<字面量>)` 展开成 `<字面量>`；不是恒等包装器调用返回 null。 */
export function unwrapIdentityPath(raw: string, helpers: { has(name: string): boolean } | null): string | null;

/** 覆盖率棘轮判据：观测值相对基线「变多」的项（总量 + 逐文件）。 */
export function diffCoverage(
    baseline: { uncheckedPathArg: number; byFile?: Record<string, number> },
    observed: { uncheckedPathArg: number; byFile: Record<string, number> },
): Array<{ kind: string; detail: string }>;

/** 解析 `strip-prefix.ts` 里单前缀形态的别名 → 真实前缀。 */
export function parseStripPrefixAliases(source: string): Map<string, string>;

/** 从参数类型文本里取出唯一的剥离别名对应的前缀；判不出来返回 null。 */
export function resolveStripPrefixFromType(typeText: string | null, stripAliases: Map<string, string>): string | null;

/**
 * 与后端注册面比对：`exact` / `wildcard`（语义存疑，需人工复核）/ null。
 * `routes` 默认用门禁加载的 ledger；spec 可自行传入构造用例。
 */
export function matchAgainstLedger(
    method: string,
    fullPath: string,
    routes?: Map<string, string>,
): "exact" | "wildcard" | null;

/**
 * 解析 ledger 来源。优先级：显式 `LEDGER_PATH` > 兄弟仓实时导出 > 仓内镜像
 * （`docs/api-contract/generated/route-manifest.all.json`，CI 上只可能有这个）。
 */
export function resolveLedgerPath(input: {
    explicitPath: string | null;
    siblingExists: boolean;
    mirrorExists: boolean;
}): { path: string; source: "env" | "sibling" | "mirror" | "none" };

/**
 * 给「未校验的路径实参」分形态。**只是报表口径，不参与任何判定**。
 */
export function classifyPathArgShape(
    expr: string,
):
    | "this-method"
    | "member-call"
    | "bare-call"
    | "cast"
    | "template"
    | "concat"
    | "ternary"
    | "paren"
    | "identifier"
    | "empty"
    | "literal"
    | "other";

/** 把若干「未校验调用点」按形态汇总（按计数降序）。 */
export function summarizeUncheckedShapes(unchecked: Array<{ expr: string }>): Record<string, number>;
