/*
 * `scripts/quality/check-msc-changes.mjs` 的单元测试（MSC 编号变更检测）。
 *
 * 它维护的是「源码里出现的 MSC 编号」与「基线 + 文档」的一致性，判定核心是
 * `formatDiff` 的三分类：**新增 / 移除 / 迁移（引用文件变了）**。
 *
 * 值得钉死的是"迁移"这一类的判据 —— 它是**集合比较**而不是数组比较：
 *
 *   同一个 MSC 从 `src/a.ts` 挪到 `src/b.ts`，若只比较数组（或只比较长度），
 *   变更会被判成"没变"，于是没人去更新 docs/MSC_SDK_MAPPING.md 里记的文件清单，
 *   文档逐渐指向不存在的路径。反过来，只是 import 顺序导致数组元素顺序变化，
 *   不该被判成迁移 —— 否则每次格式化都会红。
 *
 * 另一处是 key 类型：源码里 `MSC(\d{4})` 抽出的是**字符串**（如 "4204"），
 * 而 baseline 的 JSON key 也是字符串。两侧必须按字符串对齐，否则
 * `baseKeys.has(num)` 会因为类型不一致永远 false，把所有 MSC 都报成"新增"。
 */

import { describe, expect, it } from "vitest";

import { formatDiff } from "../../scripts/quality/check-msc-changes.mjs";

/** 构造 current：Map<MSC 编号字符串, Set<文件>>。 */
function current(entries: Record<string, string[]>): Map<string, Set<string>> {
    return new Map(Object.entries(entries).map(([num, files]) => [num, new Set(files)]));
}

describe("formatDiff（MSC 变更三分类）", () => {
    it("源码新增的 MSC 记为 added（文件列表排序后输出）", () => {
        const { added, removed, moved } = formatDiff(current({ "4204": ["src/b.ts", "src/a.ts"] }), {
            entries: {},
        });
        expect(added).toEqual([{ num: "4204", files: ["src/a.ts", "src/b.ts"] }]);
        expect(removed).toEqual([]);
        expect(moved).toEqual([]);
    });

    it("源码里已消失的 MSC 记为 removed", () => {
        const { added, removed, moved } = formatDiff(current({}), {
            entries: { "3967": ["src/c.ts"] },
        });
        expect(added).toEqual([]);
        expect(removed).toEqual([{ num: "3967", files: ["src/c.ts"] }]);
        expect(moved).toEqual([]);
    });

    it("引用文件新增 → 记为 moved（挪到新文件不算 '没变'）", () => {
        const { moved } = formatDiff(current({ "4267": ["src/a.ts", "src/new.ts"] }), {
            entries: { "4267": ["src/a.ts"] },
        });
        expect(moved).toEqual([
            { num: "4267", oldFiles: ["src/a.ts"], newFiles: ["src/a.ts", "src/new.ts"] },
        ]);
    });

    it("引用文件减少 → 同样记为 moved", () => {
        const { moved } = formatDiff(current({ "4267": ["src/a.ts"] }), {
            entries: { "4267": ["src/a.ts", "src/old.ts"] },
        });
        expect(moved).toHaveLength(1);
        expect(moved[0].num).toBe("4267");
    });

    it("集合相同、顺序不同 → 不算 moved（否则每次格式化都会红）", () => {
        const { added, removed, moved } = formatDiff(current({ "4155": ["src/b.ts", "src/a.ts"] }), {
            entries: { "4155": ["src/a.ts", "src/b.ts"] },
        });
        expect(moved).toEqual([]);
        expect(added).toEqual([]);
        expect(removed).toEqual([]);
    });

    it("编号按字符串对齐：baseline key 与源码抽出的编号类型一致才不会误报新增", () => {
        // baseline 的 key 来自 JSON（字符串），current 的 key 来自正则切片（字符串）。
        // 若一侧变成数字，baseKeys.has(num) 恒 false ⇒ 全部误报成 added。
        const { added, moved } = formatDiff(current({ "4156": ["src/a.ts"] }), {
            entries: { "4156": ["src/a.ts"] },
        });
        expect(added).toEqual([]);
        expect(moved).toEqual([]);
    });

    it("baseline 缺 entries 字段时不抛异常，全部记为 added", () => {
        const { added, removed } = formatDiff(current({ "4204": ["src/a.ts"] }), {});
        expect(added).toHaveLength(1);
        expect(removed).toEqual([]);
    });

    it("两侧皆空 → 三类都为空", () => {
        expect(formatDiff(current({}), { entries: {} })).toEqual({ added: [], removed: [], moved: [] });
    });
});
