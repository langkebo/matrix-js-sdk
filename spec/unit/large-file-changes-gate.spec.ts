/*
 * `scripts/quality/check-large-file-changes.mjs` 的单元测试。
 *
 * 逻辑简单，但有几个边界一旦写错就会长期误伤**或长期假绿**：
 *
 *   · **阈值是 `>` 不是 `>=`**：文件"正好 1500 行"不算超限。写成 `>=` 会让
 *     恰好卡在阈值上的文件每次改动都要过架构评审 —— 这种红灯无法靠改代码消除
 *    （删一行就得改业务逻辑），最后只会逼人去调阈值或加 bypass。
 *   · **已删除的文件必须跳过**：`git diff --name-only` 会列出被删掉的文件，
 *     不判 `exists` 就去 `readFileSync` 会直接抛异常；即使不抛，"删掉一个大文件"
 *     也显然不需要评审它的体量。
 *   · **改动行数是第二道判据**（2026-10-10 新增）：只碰过大文件还不够，还要改动行数 ≥ 50。
 *     否则 `src/client.ts`（4399 行）上 2 行的签名收窄也会被拦，而该门禁只有全局旁路
 *     （`ARCH_REVIEW_APPROVED`）、没有 per-change 批准。
 *   · **fail-closed**：改动行数取不到 ⇒ 一律要求评审（判据不确定时不许放行）。
 *   · **push 事件不能只看 tip**：否则多提交推送里非 tip 提交的改动可绕过门禁。
 *   · **存量棘轮**（2026-10-11 新增）：两道 diff 判据都看不见"存量体量"本身，
 *     故补一条「只降不升」的棘轮 —— 基线外的新超限文件、或基线内文件行数增长，都失败。
 */

import { describe, expect, it } from "vitest";

import {
    LARGE_FILE_RATCHET_BASELINE,
    filterOversized,
    parseNumstat,
    planRatchet,
    resolveDiffRange,
    selectReviewRequired,
} from "../../scripts/quality/check-large-file-changes.mjs";

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
        expect(
            filterOversized(["src/a.js", "README.md"], opts({ files: { "src/a.js": 9999, "README.md": 9999 } })),
        ).toEqual([]);
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

describe("resolveDiffRange（push 事件用推送前的 ref ⇒ 覆盖全部提交）", () => {
    it("有 before → before...head（不再退化成 HEAD~1...HEAD 只看 tip）", () => {
        expect(resolveDiffRange({ GITHUB_EVENT_BEFORE: "aaa111", GITHUB_SHA: "bbb222" })).toBe("aaa111...bbb222");
    });

    it("before 全为 0（新分支首推）→ 视为不可用，回退 HEAD~1...HEAD", () => {
        expect(resolveDiffRange({ GITHUB_EVENT_BEFORE: "0".repeat(40), GITHUB_SHA: "bbb222" })).toBe("HEAD~1...HEAD");
    });

    it("before 与 head 相同 → 回退（避免空范围）", () => {
        expect(resolveDiffRange({ GITHUB_EVENT_BEFORE: "bbb222", GITHUB_SHA: "bbb222" })).toBe("HEAD~1...HEAD");
    });

    it("PR 的 base 优先于 before", () => {
        expect(resolveDiffRange({ GITHUB_BASE_SHA: "abc123", GITHUB_EVENT_BEFORE: "zzz", GITHUB_SHA: "def456" })).toBe(
            "abc123...def456",
        );
    });
});

describe("parseNumstat（git diff --numstat 单行 → added+deleted）", () => {
    it("普通改动 → 两侧相加", () => {
        expect(parseNumstat("2\t1\tsrc/client.ts")).toBe(3);
    });

    it("纯新增 / 纯删除", () => {
        expect(parseNumstat("40\t0\tsrc/client.ts")).toBe(40);
        expect(parseNumstat("0\t9\tsrc/client.ts")).toBe(9);
    });

    it("二进制（`-`）→ null（不可知，交回 fail-closed）", () => {
        expect(parseNumstat("-\t-\tassets/x.png")).toBeNull();
    });

    it("多余空行 → 取第一条有效行；全空 ⇒ null", () => {
        expect(parseNumstat("\n5\t5\tsrc/a.ts\n")).toBe(10);
        expect(parseNumstat("")).toBeNull();
        expect(parseNumstat("\n  \n")).toBeNull();
    });
});

describe("selectReviewRequired（第二道判据：改动行数 ≥ minDiffLines）", () => {
    it("**本轮实证**：4399 行的大文件只改 2 行 → 豁免（原判据会误拦合法小改动）", () => {
        expect(
            selectReviewRequired([{ relPath: "src/client.ts", lines: 4399, diffLines: 2 }], { minDiffLines: 50 }),
        ).toEqual([]);
    });

    it("改动行数达到阈值 → 仍要求评审（不削弱真正的架构级改动）", () => {
        const minDiffLines = 50;
        expect(
            selectReviewRequired([{ relPath: "src/client.ts", lines: 4399, diffLines: 50 }], { minDiffLines }),
        ).toHaveLength(1);
        expect(
            selectReviewRequired([{ relPath: "src/client.ts", lines: 4399, diffLines: 500 }], { minDiffLines }),
        ).toHaveLength(1);
    });

    it("边界是 `>=`：49 豁免 / 50 拦截", () => {
        expect(selectReviewRequired([{ relPath: "a.ts", lines: 2000, diffLines: 49 }], { minDiffLines: 50 })).toEqual(
            [],
        );
        expect(
            selectReviewRequired([{ relPath: "a.ts", lines: 2000, diffLines: 50 }], { minDiffLines: 50 }),
        ).toHaveLength(1);
    });

    it("**fail-closed**：diffLines 为 null / 缺失 / NaN → 一律要求评审", () => {
        const minDiffLines = 50;
        expect(
            selectReviewRequired([{ relPath: "a.ts", lines: 2000, diffLines: null }], { minDiffLines }),
        ).toHaveLength(1);
        expect(selectReviewRequired([{ relPath: "a.ts", lines: 2000 }], { minDiffLines })).toHaveLength(1);
        expect(
            selectReviewRequired([{ relPath: "a.ts", lines: 2000, diffLines: Number.NaN }], { minDiffLines }),
        ).toHaveLength(1);
    });

    it("多文件混合：只返回需要评审的那些", () => {
        const files = [
            { relPath: "src/client.ts", lines: 4399, diffLines: 2 },
            { relPath: "src/huge.ts", lines: 9000, diffLines: 300 },
            { relPath: "src/unknown.ts", lines: 3000, diffLines: null },
        ];
        expect(selectReviewRequired(files, { minDiffLines: 50 }).map((f) => f.relPath)).toEqual([
            "src/huge.ts",
            "src/unknown.ts",
        ]);
    });
});

describe("planRatchet（存量巨型文件棘轮：只降不升）", () => {
    it("current 与 baseline 一致 → 既不新增也不增长，refuse 为假", () => {
        const plan = planRatchet({
            baseline: { "src/a.ts": 2000 },
            current: { "src/a.ts": 2000 },
            allowGrowth: false,
        });
        expect(plan.added).toEqual([]);
        expect(plan.grown).toEqual([]);
        expect(plan.shrunk).toEqual([]);
        expect(plan.refuse).toBe(false);
    });

    it("变小（lines < baseline）→ 放行（只降不升，降下去永远安全）", () => {
        const plan = planRatchet({
            baseline: { "src/a.ts": 2000 },
            current: { "src/a.ts": 1501 },
            allowGrowth: false,
        });
        expect(plan.grown).toEqual([]);
        expect(plan.refuse).toBe(false);
    });

    it("**基线外出现新的超限文件** → added，且未 accept 时 refuse", () => {
        const plan = planRatchet({
            baseline: {},
            current: { "src/new.ts": 1600 },
            allowGrowth: false,
        });
        expect(plan.added).toEqual([{ relPath: "src/new.ts", lines: 1600 }]);
        expect(plan.refuse).toBe(true);
    });

    it("**同行数增长** → grown（记录 baseline 与当前值），且未 accept 时 refuse", () => {
        const plan = planRatchet({
            baseline: { "src/client.ts": 4383 },
            current: { "src/client.ts": 4400 },
            allowGrowth: false,
        });
        expect(plan.grown).toEqual([{ relPath: "src/client.ts", lines: 4400, baseline: 4383 }]);
        expect(plan.added).toEqual([]);
        expect(plan.refuse).toBe(true);
    });

    it("正好等于基线上限 → 不算增长（判据是 `>` 不是 `>=`）", () => {
        const plan = planRatchet({
            baseline: { "src/a.ts": 2000 },
            current: { "src/a.ts": 2000 },
            allowGrowth: false,
        });
        expect(plan.grown).toEqual([]);
        expect(plan.refuse).toBe(false);
    });

    it("allowGrowth 为真（--accept-new）→ 即使有新增/增长也不 refuse", () => {
        const plan = planRatchet({
            baseline: {},
            current: { "src/new.ts": 1600 },
            allowGrowth: true,
        });
        expect(plan.added).toHaveLength(1);
        expect(plan.refuse).toBe(false);
    });

    it("基线里已降到阈值以下的条目 → shrunk（可 --update-baseline 收编），不触发失败", () => {
        const plan = planRatchet({
            baseline: { "src/shrunk.ts": 2000, "src/kept.ts": 1800 },
            current: { "src/kept.ts": 1750 },
            allowGrowth: false,
        });
        expect(plan.shrunk).toEqual(["src/shrunk.ts"]);
        expect(plan.refuse).toBe(false);
    });

    it("空集 → 全空且放行", () => {
        const plan = planRatchet({ baseline: {}, current: {}, allowGrowth: false });
        expect(plan).toEqual({ added: [], grown: [], shrunk: [], refuse: false });
    });

    it("**内嵌基线常量**：非空、值都是正整数、路径为仓库相对 `.ts`", () => {
        const entries = Object.entries(LARGE_FILE_RATCHET_BASELINE);
        expect(entries.length).toBeGreaterThan(0);
        for (const [relPath, lines] of entries) {
            expect(relPath.startsWith("src/")).toBe(true);
            expect(relPath.endsWith(".ts")).toBe(true);
            expect(Number.isInteger(lines)).toBe(true);
            expect(lines).toBeGreaterThan(1500);
        }
    });
});
