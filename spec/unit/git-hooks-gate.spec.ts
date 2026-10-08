/*
 * `scripts/quality/check-git-hooks.mjs` 的单元测试。
 *
 * 这条门禁防的是一次真实事故：`.husky/pre-commit` 一直在版本库里，但
 * `core.hooksPath` 未设置、`.husky/_` 不存在、`.git/hooks/pre-commit` 不存在 ——
 * husky v9 靠 `package.json` 的 `prepare` 装钩子，而 `prepare` 是 `pnpm build`。
 * 后果：4 个提交带着 prettier 不合格的文件进了 develop，`pnpm lint` 长期是红的，
 * 本地没有任何东西会提醒。
 *
 * 它出错的代价是不对称的：
 *   · 假阴性（该红不红）→ 钩子继续不装，lint 继续在远端才被发现；
 *   · 假阳性（该绿不绿）→ 每个开发者的 `pnpm lint` 都红，会被"顺手删掉这条门禁"。
 * 所以下面把四种状态与两条回归分别钉死。
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { evaluateGitHooks, resolveHooksDir } from "../../scripts/quality/check-git-hooks.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/*
 * lint-staged 用 picomatch 判定文件是否命中某条 glob（`node_modules/lint-staged/lib/matchFiles.js`），
 * 并且**开着 `matchBase`**（模式里没有 `/` 时按 basename 匹配任意目录，这正是 `*.(ts|tsx)`
 * 能命中 `src/foo.ts` 的原因）。
 *
 * 这里刻意复用它**自己的那一份** picomatch（经 `lint-staged/package.json` 解析），而不是自己
 * 写一套 glob 语义 —— 判据必须与"真跑钩子时"一致，否则测试通过也不代表钩子会格式化。
 */
const requireFromLintStaged = createRequire(createRequire(import.meta.url).resolve("lint-staged/package.json"));
const picomatch = requireFromLintStaged("picomatch") as (
    pattern: string,
    options: Record<string, unknown>,
) => (file: string) => boolean;

/** 与 `lint-staged/lib/matchFiles.js` 完全相同的选项。 */
function lintStagedMatches(pattern: string, file: string): boolean {
    return picomatch(pattern, {
        dot: true,
        matchBase: !pattern.includes("/"),
        posixSlashes: true,
        strictBrackets: true,
    })(file);
}

describe("evaluateGitHooks", () => {
    it("回归守卫：就是事故那天的状态（hooksPath 空 + 无钩子 + 非 CI）⇒ missing", () => {
        const r = evaluateGitHooks({ hooksPath: null, hookFileExists: false, ci: false, strict: false });
        expect(r.status).toBe("missing");
        expect(r.detail).toContain("core.hooksPath");
    });

    it("hooksPath 指向的目录里没有 pre-commit ⇒ missing（配了但没装）", () => {
        const r = evaluateGitHooks({ hooksPath: ".husky/_", hookFileExists: false, ci: false, strict: false });
        expect(r.status).toBe("missing");
        expect(r.detail).toContain(".husky/_");
    });

    it("hooksPath 有值且钩子在位 ⇒ ok", () => {
        const r = evaluateGitHooks({ hooksPath: ".husky/_", hookFileExists: true, ci: false, strict: false });
        expect(r.status).toBe("ok");
    });

    it("CI 且非 strict ⇒ skipped（CI 不跑本地钩子）", () => {
        const r = evaluateGitHooks({ hooksPath: null, hookFileExists: false, ci: true, strict: false });
        expect(r.status).toBe("skipped");
    });

    it("--strict 覆盖 CI 跳过（发布流程要能强制检查）", () => {
        const r = evaluateGitHooks({ hooksPath: null, hookFileExists: false, ci: true, strict: true });
        expect(r.status).toBe("missing");
    });

    it("CI + strict + 已装 ⇒ ok", () => {
        const r = evaluateGitHooks({ hooksPath: ".husky/_", hookFileExists: true, ci: true, strict: true });
        expect(r.status).toBe("ok");
    });
});

describe("resolveHooksDir", () => {
    it("相对路径按仓库顶层解析（与 git 对 core.hooksPath 相对值的算法一致）", () => {
        expect(resolveHooksDir(".husky/_")).toBe(path.join(projectRoot, ".husky/_"));
    });

    it("绝对路径原样返回", () => {
        expect(resolveHooksDir("/tmp/hooks")).toBe("/tmp/hooks");
    });
});

describe("仓库事实（防「配了但漏后缀」）", () => {
    it("`.husky/pre-commit` 本体在版本库里且非空 —— 删掉它就等于悄悄关掉守卫", () => {
        const hookPath = path.join(projectRoot, ".husky", "pre-commit");
        expect(existsSync(hookPath)).toBe(true);
        expect(readFileSync(hookPath, "utf8").trim().length).toBeGreaterThan(0);
    });

    it("`.d.mts` 被 `.lintstagedrc` 覆盖 —— 它就是 P0-1 里唯一漏网的后缀", () => {
        const patterns = Object.keys(JSON.parse(readFileSync(path.join(projectRoot, ".lintstagedrc"), "utf8")));
        const matched = patterns.filter((p) => lintStagedMatches(p, "scripts/quality/x.d.mts"));
        expect(matched.length).toBeGreaterThan(0);
    });
});
