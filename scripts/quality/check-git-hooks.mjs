#!/usr/bin/env node

/**
 * 提交前守卫可用性自检（2026-10-08）。
 *
 * ## 为什么需要这条门禁
 *
 * 实测事故：`.husky/pre-commit`（内容 `npx lint-staged`）**一直在版本库里**，
 * `origin/develop` 也有，但本地三处证据表明它从未生效：
 *
 *   · `ls .husky/_`                    → No such file or directory
 *   · `git config core.hooksPath`      → 空
 *   · `ls .git/hooks/pre-commit`       → 不存在
 *
 * 根因：husky v9 靠 `package.json` 的 `prepare` 脚本里那条 `husky` 命令安装钩子，
 * 而本仓（含上游）`prepare` 是 `pnpm build` ⇒ **那条命令永远不执行**。
 * 后果不是"少了一层便利"，而是：4 个 2026-10-07 的提交带着 prettier 不合格的文件
 * 进了 develop，`pnpm lint` 长期是红的，而本地没有任何东西会提醒。
 *
 * ⇒ 把"钩子到底装没装"做成**可执行判据**，而不是靠"我明明配了 .lintstagedrc"的直觉。
 *
 * ## CI 上为什么跳过
 *
 * CI 不跑本地 git 钩子；`core.hooksPath` 这类本地 git 配置在 runner 上没有意义。
 * 默认在 `CI` 非空时跳过（exit 0），`--strict` 可强制检查（发布流程用）。
 *
 * 用法：node scripts/quality/check-git-hooks.mjs [--strict]
 * 退出码：0 = 已安装 / CI 跳过；1 = 未安装；2 = 无法运行（不在 git 仓 / git 不可用）
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 未安装时给出的修复指令（两选一都能装上）。 */
const FIX_HINT = "执行 `pnpm install`（`prepare` 会跑 `husky`）或直接 `pnpm exec husky`。";

/**
 * 判定钩子状态（纯函数，spec 直接测）。
 *
 * `ci` / `strict` 显式入参而不是读环境：读环境会让用例随本机环境漂移。
 *
 * @param {object} input
 * @param {string | null} input.hooksPath `core.hooksPath` 的值（未设置为 null）
 * @param {boolean} input.hookFileExists `core.hooksPath` 指向的目录下有没有 `pre-commit`
 * @param {boolean} input.ci 是否 CI 环境
 * @param {boolean} input.strict 是否强制检查（CI 下也检查）
 * @returns {{ status: "ok" | "skipped" | "missing"; detail: string }}
 */
export function evaluateGitHooks({ hooksPath, hookFileExists, ci, strict }) {
    if (ci && !strict) {
        return {
            status: "skipped",
            detail: "CI 环境：CI 不执行本地 git 钩子（加 --strict 可强制检查）",
        };
    }
    if (!hooksPath) {
        return {
            status: "missing",
            detail: "`core.hooksPath` 未设置 ⇒ 提交前钩子不会执行，`.husky/pre-commit` 形同虚设",
        };
    }
    if (!hookFileExists) {
        return {
            status: "missing",
            detail: `\`core.hooksPath=${hooksPath}\` 已设置，但该目录下没有 \`pre-commit\` 钩子`,
        };
    }
    return { status: "ok", detail: `\`core.hooksPath=${hooksPath}\`，\`pre-commit\` 钩子已在位` };
}

/** 读 `core.hooksPath`；不在 git 仓或 git 不可用则返回 null。 */
function readHooksPath() {
    try {
        return execFileSync("git", ["config", "--get", "core.hooksPath"], {
            cwd: projectRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
    } catch {
        return null;
    }
}

/** 相对路径按仓库顶层解析（git 对 `core.hooksPath` 的相对值就是这么算的）。 */
function resolveHooksDir(hooksPath) {
    return path.isAbsolute(hooksPath) ? hooksPath : path.join(projectRoot, hooksPath);
}

function main() {
    const strict = process.argv.includes("--strict");

    let inGitRepo = true;
    try {
        execFileSync("git", ["rev-parse", "--git-dir"], { cwd: projectRoot, stdio: "ignore" });
    } catch {
        inGitRepo = false;
    }
    if (!inGitRepo) {
        console.error("[git-hooks] ❌ 无法运行：当前目录不是 git 仓库（或 git 不可用）");
        process.exit(2);
    }

    const hooksPath = readHooksPath();
    const hookFileExists = Boolean(hooksPath) && existsSync(path.join(resolveHooksDir(hooksPath), "pre-commit"));
    const { status, detail } = evaluateGitHooks({
        hooksPath,
        hookFileExists,
        ci: Boolean(process.env.CI),
        strict,
    });

    if (status === "skipped") {
        console.log(`[git-hooks] ⏭ 跳过：${detail}`);
        return;
    }
    if (status === "missing") {
        console.error(`[git-hooks] ❌ ${detail}`);
        console.error(`[git-hooks]    ${FIX_HINT}`);
        process.exit(1);
    }
    console.log(`[git-hooks] ✅ ${detail}`);
}

export { FIX_HINT, readHooksPath, resolveHooksDir };

const invokedDirectly =
    typeof process.argv[1] === "string" && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
