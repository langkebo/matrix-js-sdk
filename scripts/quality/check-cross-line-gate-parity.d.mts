/**
 * `check-cross-line-gate-parity.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：门禁 / 工具脚本导出函数供 spec 使用时，**vitest 走运行时（真实 .mjs）、
 * tsc 走本声明文件**。两者必须同步 —— 只改 .mjs 不改这里，`tsc --noEmit` 会报
 * `TS2305 has no exported member`。
 */

/** 文件分类；只有 `gate` 参与严格判据。 */
export type QualityFileClass = "gate" | "lib" | "types" | "ledger" | "other";

/** 把 `scripts/quality/**` 下的仓库根相对路径分类。 */
export function classifyQualityFile(rel: string): QualityFileClass;

/** 双向差集（均已排序）。 */
export function diffSets(
    thisLine: Iterable<string>,
    otherLine: Iterable<string>,
): {
    onlyInThisLine: string[];
    onlyInOtherLine: string[];
};

/**
 * 找出台账的问题：未登记 / 缺 reason / 腐烂条目。
 *
 * @returns 问题清单；空数组 = 通过。
 */
export function findWaiverProblems(
    gateDiff: { onlyInThisLine: string[]; onlyInOtherLine: string[] },
    waivers: { gates?: Record<string, string> },
): string[];
