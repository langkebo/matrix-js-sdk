/*
 * `scripts/quality/lib/baseline-update.mjs` 的单元测试。
 *
 * 这条判据是「让债务可以永久不还」的**唯一闸门**：4 个 baseline 型门禁
 * （swallow / generated-dto-strictness / technical-debt / real-backend-types）的
 * `--update-baseline` 都靠它区分两种性质完全不同的写入：
 *
 *   · **重记（drift）**：指纹没变，只是行号字段变了 ⇒ 安全，无条件放行；
 *   · **赦免新条目（new）**：当前扫到、基线里本来没有 ⇒ **必须有人看过**。
 *
 * 出错的代价不对称：
 *   · 把"新增"当"重记"放行 → 一批新缺陷被一条命令静默洗白（这是要防的事）；
 *   · 把"重记"也拦下来 → 门禁会逼人不写豁免就没法重记行号，最后没人用它。
 */

import { describe, expect, it } from "vitest";

import { planBaselineWrite } from "../../scripts/quality/lib/baseline-update.mjs";

describe("planBaselineWrite", () => {
    it("纯重记（集合相同）⇒ 放行，且不把已有的当新增", () => {
        const plan = planBaselineWrite({ previousIds: ["a", "b"], currentIds: ["a", "b"], acceptNew: false });
        expect(plan).toEqual({ added: [], removed: [], refuse: false });
    });

    it("回归守卫：有新增且没给 --accept-new ⇒ 拒绝写入", () => {
        const plan = planBaselineWrite({ previousIds: ["a"], currentIds: ["a", "b"], acceptNew: false });
        expect(plan.added).toEqual(["b"]);
        expect(plan.refuse).toBe(true);
    });

    it("有新增但显式 --accept-new ⇒ 放行", () => {
        const plan = planBaselineWrite({ previousIds: ["a"], currentIds: ["a", "b"], acceptNew: true });
        expect(plan.added).toEqual(["b"]);
        expect(plan.refuse).toBe(false);
    });

    it("**只有退役**（removed 非空、added 为空）⇒ 不该被拦：退役不是赦免", () => {
        const plan = planBaselineWrite({ previousIds: ["a", "b"], currentIds: ["a"], acceptNew: false });
        expect(plan.removed).toEqual(["b"]);
        expect(plan.added).toEqual([]);
        expect(plan.refuse).toBe(false);
    });

    it("空基线 + 全新增 ⇒ 拒绝（首次冻结也必须显式接受）", () => {
        const plan = planBaselineWrite({ previousIds: [], currentIds: ["x"], acceptNew: false });
        expect(plan.refuse).toBe(true);
    });

    it("两侧都空 ⇒ 放行", () => {
        expect(planBaselineWrite({ previousIds: [], currentIds: [], acceptNew: false })).toEqual({
            added: [],
            removed: [],
            refuse: false,
        });
    });

    it("顺序稳定：added 按 currentIds 顺序、removed 按 previousIds 顺序（打印/diff 不抖）", () => {
        const plan = planBaselineWrite({
            previousIds: ["p2", "p1", "gone1", "gone2"],
            currentIds: ["p1", "p2", "new2", "new1"],
            acceptNew: true,
        });
        expect(plan.added).toEqual(["new2", "new1"]);
        expect(plan.removed).toEqual(["gone1", "gone2"]);
    });

    it("重复 id 不会把 added/removed 算重（按集合语义）", () => {
        const plan = planBaselineWrite({ previousIds: ["a", "a"], currentIds: ["a"], acceptNew: false });
        expect(plan.added).toEqual([]);
        expect(plan.removed).toEqual([]);
        expect(plan.refuse).toBe(false);
    });
});
