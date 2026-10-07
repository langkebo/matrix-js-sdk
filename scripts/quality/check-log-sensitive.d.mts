/**
 * `check-log-sensitive.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** 敏感词表（小写子串匹配）。 */
export const SENSITIVE_TERMS: string[];

/**
 * 扫描源码行，找出"调了 logger 且把敏感值插进/拼进消息"的位置。
 *
 * @param rel 仓库相对路径（仅用于报错）
 * @param lines 源码行
 */
export function scanLines(
    rel: string,
    lines: string[],
): {
    /** 仓库相对路径 */
    rel: string;
    /** 1-based 行号 */
    line: number;
    /** 命中的敏感词 */
    term: string;
    /** 该行内容（trim 过） */
    snippet: string;
}[];
