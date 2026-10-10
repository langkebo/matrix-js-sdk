/**
 * `check-large-file-changes.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** 跑一条 shell 命令并取 trim 后的 stdout。 */
export function run(cmd: string): string;

/**
 * diff 范围：PR 用 `GITHUB_BASE_SHA...GITHUB_SHA`；push 用 `GITHUB_EVENT_BEFORE...GITHUB_SHA`
 * （覆盖本次推送的全部提交，不再只看 tip）；都不可用时回退 `HEAD~1...HEAD`。
 */
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

/** 解析 `git diff --numstat` 单行 ⇒ 改动行数（added+deleted）；二进制/解析失败 ⇒ `null`。 */
export function parseNumstat(output: string): number | null;

/**
 * 从「超限文件」里筛出**真需要架构评审**的：还要求改动行数 ≥ `minDiffLines`。
 * fail-closed：`diffLines` 不是有限数 ⇒ 一律要求评审（判据不确定时不许放行）。
 */
export function selectReviewRequired(
    files: Array<{ relPath: string; lines: number; diffLines?: number | null }>,
    options: { minDiffLines: number },
): Array<{ relPath: string; lines: number; diffLines?: number | null }>;
