/**
 * `check-git-hooks.mjs` 的类型声明（只声明导出给 spec 用的纯函数与常量）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** 未安装时给出的修复指令。 */
export const FIX_HINT: string;

/** 判定结果。 */
export type GitHooksStatus = "ok" | "skipped" | "missing";

/** `evaluateGitHooks` 的入参。 */
export interface GitHooksInput {
    /** `core.hooksPath` 的值（未设置为 null）。 */
    hooksPath: string | null;
    /** `core.hooksPath` 指向的目录下有没有 `pre-commit`。 */
    hookFileExists: boolean;
    /** 是否 CI 环境。 */
    ci: boolean;
    /** 是否强制检查（CI 下也检查）。 */
    strict: boolean;
}

/**
 * 判定提交前钩子的安装状态。
 *
 * `ci` / `strict` 显式入参而不是读环境：读环境会让用例随本机环境漂移。
 */
export function evaluateGitHooks(input: GitHooksInput): { status: GitHooksStatus; detail: string };

/** 读 `core.hooksPath`；不在 git 仓或 git 不可用则返回 null。 */
export function readHooksPath(): string | null;

/** 相对路径按仓库顶层解析（与 git 对 `core.hooksPath` 相对值的算法一致）。 */
export function resolveHooksDir(hooksPath: string): string;
