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

// ---------------------------------------------------------------------------
// CONTRACT_INDEX.md 逐行自证（2026-10-15 新增）
//
// 标量规则守「合计」，但合计可被两行错值抵消（真实事故：`auth` +1 / `external-service` -1
// ⇒ 两条规则全过而两行都错）。这里把每行与它的权威来源单独对上。
// ---------------------------------------------------------------------------

/** `CONTRACT_INDEX.md` 模块表的一行。 */
export interface ContractIndexRow {
    /** 文档页基名（来自 `[x.md](x.md)` 链接）。 */
    page: string;
    /** 该行声明的端点数。 */
    claimed: number;
}

/** 逐行自证失败项：行端点数 ≠ 该页承载的 ledger 模块 `entry_count` 之和。 */
export interface ContractIndexRowMismatch {
    page: string;
    claimed: number;
    /** 期望值；页面解析不到任何模块时为 `null`。 */
    expected: number | null;
    /** 该页承载的 ledger 模块名（解析不到时为空数组）。 */
    modules: string[];
    reason: string;
}

/** 逐行自证结果；任一数组非空即失败。 */
export interface ContractIndexRowResult {
    mismatches: ContractIndexRowMismatch[];
    /** 没有任何索引行认领的 ledger 模块。 */
    orphanModules: string[];
    /** 被多于一行重复认领的 ledger 模块。 */
    duplicateModules: { module: string; pages: string[] }[];
    checked: number;
}

/** 从页面 frontmatter 取 `module:`，返回 `page → 模块名 | null`（页面读不到会抛出）。 */
export function readContractIndexPageModules(
    readFile: ReadFile,
    rows: ContractIndexRow[],
): Record<string, string | null>;

/** 逐行自证。纯函数：`resolveSdkDir` 注入，故不依赖映射表内容。 */
export function evaluateContractIndexRows(params: {
    rows: ContractIndexRow[];
    pageModules: Record<string, string | null>;
    moduleNames: string[];
    entryCountByModule: Record<string, number>;
    resolveSdkDir: (moduleName: string) => string;
}): ContractIndexRowResult;

/** 任一判据命中（含 partition 破坏）即为失败。 */
export function hasContractIndexRowFailure(result: ContractIndexRowResult): boolean;

/** 把逐行自证结果渲染成人读的失败说明。 */
export function renderContractIndexRowFailure(result: ContractIndexRowResult): string;
