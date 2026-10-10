/**
 * `scripts/quality/check-cross-line-gate-parity.mjs` 的单元测试（批次 F5）。
 *
 * 这个门禁的作用是**让"Tjg 消费的线缺哪些判据"变成一个只能变小的数字**。
 * 它一旦写松（例如把"未登记"当成通过），F 整批的意义就没了 —— 所以这里把
 * 三种失败形态（未登记 / 缺 reason / 腐烂条目）逐条钉死。
 */
import { describe, expect, it } from "vitest";

import {
    classifyQualityFile,
    diffSets,
    findWaiverProblems,
} from "../../scripts/quality/check-cross-line-gate-parity.mjs";

describe("classifyQualityFile —— 只有 gate 类进严格判据", () => {
    it("受管辖门禁（check- 前缀 / scripts/quality 下）⇒ gate", () => {
        expect(classifyQualityFile("scripts/quality/check-wire-format.mjs")).toBe("gate");
        expect(classifyQualityFile("scripts/quality/verify-path-contract.mjs")).toBe("gate");
    });

    it("**lib/ 支撑 ⇒ lib**（不受管辖；它不是独立判据，是别人 import 的实现）", () => {
        expect(classifyQualityFile("scripts/quality/lib/write-json.mjs")).toBe("lib");
        expect(classifyQualityFile("scripts/quality/lib/baseline-update.mjs")).toBe("lib");
    });

    it("类型声明 ⇒ types", () => {
        expect(classifyQualityFile("scripts/quality/check-wire-format.d.mts")).toBe("types");
    });

    it("台账 / 基线（json / csv）⇒ ledger", () => {
        expect(classifyQualityFile("scripts/quality/wire-format-ledger.json")).toBe("ledger");
        expect(classifyQualityFile("scripts/quality/technical-debt-inventory.csv")).toBe("ledger");
    });

    it("scripts/quality/ 下的**所有** .mjs 都受管辖 —— 判据按路径，不看文件名", () => {
        // 这条钉住 isGoverned 的语义：`probe-contract-drift.mjs` 这种"工具名"不在
        // check-/verify- 前缀里，但它位于 scripts/quality/ 之下 ⇒ 仍受管辖。
        // 历史教训（check-gate-reachability.d.mts 有记）：曾用「正文里有没有 exit-1」
        // 当判据，结果把判定逻辑抽到共享库的门禁集体掉出管辖范围。
        expect(classifyQualityFile("scripts/quality/probe-contract-drift.mjs")).toBe("gate");
        expect(classifyQualityFile("scripts/quality/whatever-helper.mjs")).toBe("gate");
    });

    it("目录外 / 非脚本文件 ⇒ other（防御性分支）", () => {
        expect(classifyQualityFile("scripts/audit/gate-golden.mjs")).toBe("other");
        expect(classifyQualityFile("scripts/quality/README")).toBe("other");
    });
});

describe("diffSets —— 双向都要看得见", () => {
    it("只有本线多出来的被列出", () => {
        const d = diffSets(["a", "b"], ["b"]);
        expect(d.onlyInThisLine).toEqual(["a"]);
        expect(d.onlyInOtherLine).toEqual([]);
    });

    it("**反向漂移同样要暴露**（另一线独有也是漂移，不能只看一个方向）", () => {
        const d = diffSets(["a"], ["a", "z"]);
        expect(d.onlyInThisLine).toEqual([]);
        expect(d.onlyInOtherLine).toEqual(["z"]);
    });

    it("结果稳定排序（台账 diff 不该因输入顺序而抖动）", () => {
        expect(diffSets(["c", "a", "b"], []).onlyInThisLine).toEqual(["a", "b", "c"]);
    });

    it("两线一致 ⇒ 双空", () => {
        expect(diffSets(["a", "b"], ["b", "a"])).toEqual({ onlyInThisLine: [], onlyInOtherLine: [] });
    });
});

describe("findWaiverProblems —— 三种失败形态（写松了 F 就白做）", () => {
    const diff = { onlyInThisLine: ["scripts/quality/check-a.mjs"], onlyInOtherLine: [] };

    it("差集里的门禁未登记 ⇒ 报未登记", () => {
        const problems = findWaiverProblems(diff, { gates: {} });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("未登记");
        expect(problems[0]).toContain("check-a.mjs");
    });

    it("登记了但 reason 是空串 / 空白 ⇒ 报缺 reason（『登记不等于说明』）", () => {
        expect(findWaiverProblems(diff, { gates: { "scripts/quality/check-a.mjs": "" } })[0]).toContain("缺 reason");
        expect(findWaiverProblems(diff, { gates: { "scripts/quality/check-a.mjs": "   " } })[0]).toContain("缺 reason");
    });

    it("**腐烂条目**：登记了但两线已一致 ⇒ 必须删（棘轮『修一条删一条』）", () => {
        const problems = findWaiverProblems(
            { onlyInThisLine: [], onlyInOtherLine: [] },
            { gates: { "scripts/quality/check-b.mjs": "F2 待移植" } },
        );
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("腐烂条目");
    });

    it("反向差集（另一线独有）同样要求登记", () => {
        const problems = findWaiverProblems(
            { onlyInThisLine: [], onlyInOtherLine: ["scripts/quality/check-z.mjs"] },
            { gates: {} },
        );
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("check-z.mjs");
    });

    it("全部登记且无腐烂 ⇒ 无问题", () => {
        expect(findWaiverProblems(diff, { gates: { "scripts/quality/check-a.mjs": "F2 待移植（低依赖组）" } })).toEqual(
            [],
        );
    });

    it("台账缺 gates 字段 ⇒ 等价于空台账（不抛异常，按未登记报）", () => {
        expect(findWaiverProblems(diff, {})).toHaveLength(1);
    });
});
