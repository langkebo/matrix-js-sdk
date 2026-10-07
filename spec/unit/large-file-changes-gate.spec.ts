/*
 * `scripts/quality/check-large-file-changes.mjs` 的单元测试。
 *
 * 逻辑简单，但有两个边界一旦写错就会长期误伤：
 *
 *   · **阈值是 `>` 不是 `>=`**：文件"正好 1500 行"不算超限。写成 `>=` 会让
 *     恰好卡在阈值上的文件每次改动都要过架构评审 —— 这种红灯无法靠改代码消除
 *    （删一行就得改业务逻辑），最后只会逼人去调阈值或加 bypass。
 *   · **已删除的文件必须跳过**：`git diff --name-only` 会列出被删掉的文件，
 *     不判 `exists` 就去 `readFileSync` 会直接抛异常；即使不抛，"删掉一个大文件"
 *     也显然不需要评审它的体量。
 */

import { describe, expect, it } from "vitest";

import { filterOversized, resolveDiffRange } from "../../scripts/quality/check-large-file-changes.mjs";

function opts(overrides: { threshold?: number; files?: Record<string, number> } = {}) {
    const files = overrides.files ?? {};
    return {
        threshold: overrides.threshold ?? 1500,
        exists: (relPath: string) => relPath in files,
        lineCount: (relPath: string) => files[relPath],
    };
}

describe("resolveDiffRange（CI 用 PR 的 base/head，本地回退上一个提交）", () => {
    it("两个 env 都给了 → base...head", () => {
        expect(resolveDiffRange({ GITHUB_BASE_SHA: "abc123", GITHUB_SHA: "def456" })).toBe("abc123...def456");
    });

    it("缺任一 → 回退 HEAD~1...HEAD", () => {
        expect(resolveDiffRange({ GITHUB_BASE_SHA: "abc123" })).toBe("HEAD~1...HEAD");
        expect(resolveDiffRange({ GITHUB_SHA: "def456" })).toBe("HEAD~1...HEAD");
        expect(resolveDiffRange({})).toBe("HEAD~1...HEAD");
    });
});

describe("filterOversized（只管 .ts，阈值是严格大于）", () => {
    it("超过阈值 → 收录（带行数）", () => {
        expect(filterOversized(["src/a.ts"], opts({ files: { "src/a.ts": 1501 } }))).toEqual([
            { relPath: "src/a.ts", lines: 1501 },
        ]);
    });

    it("正好等于阈值 → **不算超限**（判据是 > 不是 >=）", () => {
        expect(filterOversized(["src/a.ts"], opts({ files: { "src/a.ts": 1500 } }))).toEqual([]);
    });

    it("非 .ts 文件不参与", () => {
        expect(filterOversized(["src/a.js", "README.md"], opts({ files: { "src/a.js": 9999, "README.md": 9999 } }))).toEqual(
            [],
        );
    });

    it("已删除的文件（exists 为假）跳过，不去读它的行数", () => {
        // 不跳过的话这里会抛异常 —— 而"删掉一个大文件"本就不该触发评审
        expect(filterOversized(["src/gone.ts"], opts({ files: {} }))).toEqual([]);
    });

    it("阈值可配置（LARGE_FILE_THRESHOLD）", () => {
        expect(filterOversized(["src/a.ts"], opts({ threshold: 10, files: { "src/a.ts": 11 } }))).toHaveLength(1);
        expect(filterOversized(["src/a.ts"], opts({ threshold: 10, files: { "src/a.ts": 10 } }))).toEqual([]);
    });

    it("多个文件各自判定，只返回超限的那些", () => {
        const result = filterOversized(
            ["src/big.ts", "src/small.ts", "src/deleted.ts"],
            opts({ files: { "src/big.ts": 2000, "src/small.ts": 100 } }),
        );
        expect(result).toEqual([{ relPath: "src/big.ts", lines: 2000 }]);
    });

    it("空变更列表 → 空结果", () => {
        expect(filterOversized([], opts())).toEqual([]);
    });
});
