/**
 * `check-large-file-changes.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** 跑一条 shell 命令并取 trim 后的 stdout。 */
export function run(cmd: string): string;

/** diff 范围：CI 给 GITHUB_BASE_SHA / GITHUB_SHA，否则回退 `HEAD~1...HEAD`。 */
export function resolveDiffRange(env?: Record<string, string | undefined>): string;

/** 一个超限文件。 */
export interface OversizedFile {
    relPath: string;
    lines: number;
}

/**
 * 筛出"行数超过阈值"的 .ts 变更文件。
 *
 * 阈值是**严格大于**（正好等于不算），否则卡在阈值上的文件会留下无法靠改代码
 * 消除的红灯。`exists` 为假的文件（已删除）直接跳过。
 */
export function filterOversized(
    changedFiles: string[],
    options: {
        threshold: number;
        exists: (relPath: string) => boolean;
        lineCount: (relPath: string) => number;
    },
): OversizedFile[];
