/*
 * `scripts/quality/verify-path-contract.mjs` 的「未校验调用点形态拆解」的单元测试。
 *
 * 背景：这份报告长期只有一句「未校验调用点 : 139（路径实参非字面量）」—— 139 是个看不出
 * 下一步的大数字。实测（2026-10-08）拆开后形态高度集中：
 *   this-method 49 / bare-call 46 / identifier 38 / cast 4 / other 1 / concat 1
 * 这份拆解是**下一步解析器改造的工作清单**（`this.roomPath(...)` 那 49 处是最值得先收的，
 * 因为 `roomPath` 的定义体对第一个参数恒等）。
 *
 * ⚠️ 它**不参与任何判定** —— 分类器写错只会让报表分组难看，不会让门禁放行/拦住任何东西。
 * 所以这里的用例覆盖的是"分组读得准"，而不是"判据正确"。
 */

import { describe, expect, it } from "vitest";

import { classifyPathArgShape, summarizeUncheckedShapes } from "../../scripts/quality/verify-path-contract.mjs";

describe("classifyPathArgShape（用仓内真实样本钉形态）", () => {
    it('`this.roomPath("/rooms/$roomId/sync", roomId)` ⇒ this-method（仓内最主流写法）', () => {
        expect(classifyPathArgShape('this.roomPath("/rooms/$roomId/sync", roomId)')).toBe("this-method");
    });

    it('`utils.encodeUri("/rooms/$roomId/x", {$roomId: roomId})` ⇒ member-call', () => {
        expect(classifyPathArgShape('utils.encodeUri("/rooms/$roomId/x", { $roomId: roomId })')).toBe("member-call");
    });

    it("`buildUserAccountDataPath(userId, eventType)` ⇒ bare-call", () => {
        expect(classifyPathArgShape("buildUserAccountDataPath(userId, eventType)")).toBe("bare-call");
    });

    it("裸标识符（`path` / `endpoint`）⇒ identifier", () => {
        expect(classifyPathArgShape("path")).toBe("identifier");
        expect(classifyPathArgShape("  endpoint  ")).toBe("identifier");
    });

    it("`\\`...\\` as \\`...\\`` ⇒ cast（先剥断言口径，不把它混进 template）", () => {
        expect(classifyPathArgShape("`/v1/workers/${encodeURIComponent(workerId)}` as `/v1/workers/${string}`")).toBe(
            "cast",
        );
    });

    it("不参与判定的边角：空串 / 拼接 / 三元 / 括号 / 其它", () => {
        expect(classifyPathArgShape("   ")).toBe("empty");
        expect(classifyPathArgShape('"/a" + suffix')).toBe("concat");
        expect(classifyPathArgShape('cond ? "/a" : "/b"')).toBe("ternary");
        expect(classifyPathArgShape('("/a")')).toBe("paren");
        expect(classifyPathArgShape("{ ...x }")).toBe("other");
    });

    it("回归守卫：字面量落进 literal —— 真出现就说明抽取器漏了（不该发生）", () => {
        expect(classifyPathArgShape('"/rooms/x"')).toBe("literal");
    });

    it("优先级：`as` 断言优先于模板判定（否则 cast 会被吞进 template）", () => {
        expect(classifyPathArgShape("`/x` as `/x`")).toBe("cast");
        expect(classifyPathArgShape("`/x`")).toBe("template");
    });
});

describe("summarizeUncheckedShapes", () => {
    it("按形态计数并按计数降序（报表直接可读）", () => {
        const out = summarizeUncheckedShapes([
            { expr: "path" },
            { expr: "path" },
            { expr: 'this.roomPath("/x", id)' },
            { expr: "foo()" },
            { expr: "foo()" },
            { expr: "foo()" },
        ]);
        expect(Object.keys(out)).toEqual(["bare-call", "identifier", "this-method"]);
        expect(out["bare-call"]).toBe(3);
        expect(out.identifier).toBe(2);
        expect(out["this-method"]).toBe(1);
    });

    it("空输入 ⇒ 空对象（不产生噪声键）", () => {
        expect(summarizeUncheckedShapes([])).toEqual({});
    });
});
