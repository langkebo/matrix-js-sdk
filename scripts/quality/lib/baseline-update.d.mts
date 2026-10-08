/**
 * `baseline-update.mjs` 的类型声明。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** `planBaselineWrite` 的结果。 */
export interface BaselineWritePlan {
    /** 当前扫到、基线里没有的 id（**需要人看过**）。 */
    added: string[];
    /** 基线里有、当前扫不到的 id（站点已消失或被改写）。 */
    removed: string[];
    /** 是否拒绝写入（有新增且没给 `--accept-new`）。 */
    refuse: boolean;
}

/**
 * 基线更新前的分类与审查门判据。
 *
 * 「重记行号」（纯 drift，`added` 为空）**永远不该被拦** —— 否则门禁会逼人写豁免而不是重记。
 */
export function planBaselineWrite(input: {
    previousIds: string[];
    currentIds: string[];
    acceptNew: boolean;
}): BaselineWritePlan;
