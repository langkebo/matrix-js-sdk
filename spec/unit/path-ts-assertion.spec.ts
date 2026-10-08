/*
 * `scripts/quality/verify-path-contract.mjs` 的 `stripTsAssertion` 的单元测试。
 *
 * 背景：本仓有 4 处把 TS 断言写在路径实参上，例如
 *   `this.doRequest(Method.Post, `/v1/workers/${encodeURIComponent(id)}` as `/v1/workers/${string}`)`
 * `as` / `satisfies` 是**纯类型层**语法，运行时值就是左侧表达式 ⇒ 剥掉它不改变真正发出去的
 * 路径，却能把"本来就能解的字面量"从 `unchecked` 桶里救回来（实测 139 → 135）。
 *
 * 出错的代价：剥错位置（把类型里的 `as` 当顶层、或在字符串里剥）会让**路径算错**，
 * 而算错的路径要么报假不匹配、要么更糟——**假匹配**。所以下面把"不能剥"的情形逐条钉死。
 */

import { describe, expect, it } from "vitest";

import { stripTsAssertion } from "../../scripts/quality/verify-path-contract.mjs";

describe("stripTsAssertion", () => {
    it("回归守卫：仓内真实写法（反引号模板 + `as` 断言模板类型）", () => {
        expect(stripTsAssertion("`/v1/workers/${encodeURIComponent(workerId)}` as `/v1/workers/${string}`")).toBe(
            "`/v1/workers/${encodeURIComponent(workerId)}`",
        );
    });

    it("`satisfies` 同样剥掉", () => {
        expect(stripTsAssertion('"/rooms/x" satisfies string')).toBe('"/rooms/x"');
    });

    it("多层断言剥到第一个顶层断言为止（左侧保持原样）", () => {
        expect(stripTsAssertion("`/x` as string as unknown as never")).toBe("`/x`");
    });

    it("没有断言 ⇒ 原样返回", () => {
        expect(stripTsAssertion('"/rooms/x"')).toBe('"/rooms/x"');
        expect(stripTsAssertion("path")).toBe("path");
        expect(stripTsAssertion("")).toBe("");
    });

    it("**不是顶层**的断言不剥：`f(x as T)` 的断言在括号里", () => {
        expect(stripTsAssertion("f(x as T)")).toBe("f(x as T)");
    });

    it("**字符串/模板内部**的 `as` 不剥（必须字符串感知）", () => {
        expect(stripTsAssertion('"/a as b/c"')).toBe('"/a as b/c"');
        expect(stripTsAssertion("`/a as b/c`")).toBe("`/a as b/c`");
    });

    it("字面量里的 `as` 与真的顶层断言要能区分开", () => {
        expect(stripTsAssertion('"/a as b" as string')).toBe('"/a as b"');
    });

    it("左侧为空（非法写法）⇒ 不剥成空串（首尾空白会被 trim，但不会只剩类型部分）", () => {
        expect(stripTsAssertion(" as T")).toBe("as T");
        expect(stripTsAssertion("  as T  ")).toBe("as T");
    });

    it("不把 `as` 当断言的边角：`assets` / `has as` 之类的子串不误伤", () => {
        expect(stripTsAssertion("assets")).toBe("assets");
        expect(stripTsAssertion('"/assets/x"')).toBe('"/assets/x"');
    });
});
