/**
 * `check-docs-counts.mjs` 的类型声明（只声明导出给 spec 用的纯函数与数据）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** 文件读取器；测试注入夹具实现。 */
export type ReadFile = (relPath: string) => string;

/** 一条「文档里的某个句子声明了某个可计算指标」的规则。 */
export interface DocsCountRule {
    /** 被锚定的文档路径。 */
    file: string;
    /** 人读的锚点说明，出现在失败信息里。 */
    anchor: string;
    /** 指标名，必须存在于传入的 metricValues 里。 */
    metric: string;
    /** 必须**恰好一个**捕获组，捕获文档里写的数字。 */
    pattern: RegExp;
}

/** 数值不一致：文档写了一个值，代码算出来是另一个。 */
export interface DocsCountMismatch {
    file: string;
    anchor: string;
    metric: string;
    claimed: number;
    actual: number;
}

/** 锚点失配：句子被改写或删除，规则表没跟上。 */
export interface DocsCountAnchorMiss {
    file: string;
    anchor: string;
    metric: string;
    reason: string;
}

/** 判定结果；任一数组非空即失败。 */
export interface DocsCountsResult {
    anchorMisses: DocsCountAnchorMiss[];
    mismatches: DocsCountMismatch[];
    checked: number;
}

/** 全部可计算指标：`(readFile) => number`。 */
export const METRICS: Record<string, (readFile: ReadFile) => number>;

/** 声明式规则表。 */
export const RULES: DocsCountRule[];

/**
 * 核心判定。纯函数：不读文件、不写文件、不 exit。
 *
 * 指标值以 `name → number` 注入（而不是注入计算函数），因此本函数不依赖目录布局。
 */
export function evaluateDocsCounts(params: {
    rules: DocsCountRule[];
    metricValues: Record<string, number>;
    readFile: ReadFile;
}): DocsCountsResult;

/** 任一判据命中即为失败。 */
export function hasDocsCountsFailure(result: DocsCountsResult): boolean;

/** 把判定结果渲染成人读的失败说明。 */
export function renderDocsCountsFailure(result: DocsCountsResult): string;
