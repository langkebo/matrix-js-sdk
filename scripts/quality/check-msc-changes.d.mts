/**
 * `check-msc-changes.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** 一条"新增"的 MSC。 */
export interface MscAdded {
    num: string;
    /** 引用该 MSC 的源文件，已排序 */
    files: string[];
}

/** 一条"已移除"的 MSC。 */
export interface MscRemoved {
    num: string;
    files: string[];
}

/** 一条"迁移"的 MSC：引用文件集合发生了变化。 */
export interface MscMoved {
    num: string;
    oldFiles: string[];
    newFiles: string[];
}

/**
 * 对比「源码里实际出现的 MSC」与基线，输出三分类。
 *
 * `moved` 按**集合**比较（不是数组/长度）：文件集合相同、顺序不同不算迁移。
 * 两侧的 MSC 编号都是**字符串**，类型不一致会把全部 MSC 误报成 added。
 */
export function formatDiff(
    current: Map<string, Set<string>>,
    baseline: { entries?: Record<string, string[]> } | Record<string, unknown>,
): {
    added: MscAdded[];
    removed: MscRemoved[];
    moved: MscMoved[];
};
