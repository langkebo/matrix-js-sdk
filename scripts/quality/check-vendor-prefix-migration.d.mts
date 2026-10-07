/**
 * `check-vendor-prefix-migration.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** 一处违规：用了 client 前缀、且附近没有标准 CS 路径。 */
export interface PrefixViolation {
    /** 1-based 行号 */
    line: number;
    /** 去空白后的原始行文本 */
    text: string;
}

/**
 * 逐行扫描，找出"用了 client 前缀、且附近没有标准 CS 路径"的行。
 *
 * 豁免窗口是**前后 4 行**（含自身）：端点定义与路径常量常常跨行。
 * 窗口太小会误判标准 API，太大则会把真正的私有端点一并豁免。
 */
export function scanLinesForViolations(lines: string[]): PrefixViolation[];
