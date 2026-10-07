/**
 * `check-repo-coverage.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** 单一维度的覆盖统计。 */
export interface CoverageMetric {
    hit: number;
    found: number;
    /** 百分比；found === 0 时为 100（"没数据"不能表现成"没覆盖"） */
    pct: number;
}

/** lcov 全仓聚合结果。 */
export interface LcovSummary {
    fileCount: number;
    lines: CoverageMetric;
    branches: CoverageMetric;
    functions: CoverageMetric;
}

/**
 * 解析 lcov 的 LF/LH，聚合成全仓**加权**覆盖率。
 *
 * 必须是加权求和而不是各文件比率的算术平均 —— 后者会被小文件稀释
 *（1000/1000 与 0/10 两个文件：加权 99.01%，平均 50%）。
 */
export function summarizeLcov(content: string): LcovSummary;
