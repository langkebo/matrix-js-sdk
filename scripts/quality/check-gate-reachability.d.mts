/**
 * `check-gate-reachability.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：门禁 / 工具脚本导出函数供 spec 使用时，**vitest 走运行时（真实 .mjs）、
 * tsc 走本声明文件**。两者必须同步 —— 只改 .mjs 不改这里，`tsc --noEmit` 会报
 * `TS2305 has no exported member`。
 */

/** 判据：正文里出现 `process.exitCode = 1` / `process.exit(1)` 即"自称门禁"。 */
export const GATE_PATTERN: RegExp;

/** 判据：位于 `scripts/quality/` 之下，或文件名以 check-/verify-/validate-/assert-/enforce- 开头。 */
export const GATE_LIKE: RegExp;

/**
 * 去掉 JS 注释，保留字符串/模板串/正则字面量内容。
 * 用于"谁真的调用了谁"——注释里的路径不算调用。
 */
export function stripComments(text: string): string;

/**
 * 从一段文本里抽出被引用的 npm script 名与脚本文件路径。
 *
 * @param text 待扫描文本（调用方应传去注释后的正文）。
 * @param baseDir 该文本所属文件所在目录（仓库根相对，posix 分隔）；CI 命令传 `""`。
 */
export function extractReferences(
    text: string,
    baseDir?: string,
): {
    /** 被引用的 npm script 名。 */
    scripts: Set<string>;
    /** 被引用的脚本文件路径（已归一化为仓库根相对）。 */
    files: Set<string>;
};

/** 把简易 glob（`*` / `**`）编译成正则。 */
export function globToRegExp(glob: string): RegExp;

/**
 * 受管辖判据：**只看路径**，不看正文有没有 exit-1。
 *
 * 用「自称 exit-1」当判据的后果：把判定逻辑抽到共享库的门禁会集体掉出管辖范围
 * （实测会让 18 个 granular 门禁在抽库后从 44 掉到 26）。故改为路径认定。
 */
export function isGoverned(rel: string): boolean;

/** 共享库匹配（`scripts/**\/lib/*.mjs`）：被门禁 import 的实现，不受管辖。 */
export declare const SHARED_LIB: RegExp;
