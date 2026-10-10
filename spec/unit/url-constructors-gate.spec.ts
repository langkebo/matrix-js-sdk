/*
 * `scripts/quality/check-url-constructors.mjs` 的单元测试（批次 K2）。
 *
 * 它拦的是"不发请求、纯字符串拼 URL"的构造点（SSO/CAS/SAML/OIDC 登录跳转、媒体直链等）：
 * 这类返回值直接交给浏览器做整页跳转，拼错就是 404，却因零 `request()` 调用点而在
 * 旧门禁下完全隐形（方案文档 §9.14.4 盲区 1）。
 *
 * 判据有三个容易写错的边界，各自钉死：
 *   1. 符号定义体范围 —— 必须跳过 JSDoc 示例与调用点，且返回类型里的对象字面量
 *      （`Promise<{ … }>`）不能被误当成函数体起点。
 *   2. 路径产物核对 —— manifest 命中 / 具名桶未命中 / 桶内容回潮进 manifest。
 *   3. 桶棘轮 —— 只降不升，且"缩小未刷新"也要报（逼人显式 --refresh）。
 */

import { describe, expect, it } from "vitest";

import {
    classifyPathExpectation,
    collectConstructionSites,
    diffBuckets,
    findSymbolBody,
    lineOf,
    matchBalanced,
    missingGuards,
} from "../../scripts/quality/check-url-constructors.mjs";

describe("lineOf", () => {
    it("返回 1-based 行号", () => {
        const src = "a\nb\nc";
        expect(lineOf(src, 0)).toBe(1);
        expect(lineOf(src, 2)).toBe(2);
        expect(lineOf(src, 4)).toBe(3);
    });
});

describe("matchBalanced（跳过字符串/模板/注释）", () => {
    it("简单括号配平", () => {
        expect(matchBalanced("(()())", 0)).toBe(5);
    });

    it("右括号出现在字符串里不参与配平", () => {
        expect(matchBalanced('(")")', 0)).toBe(4);
    });

    it("右括号出现在模板字面量里不参与配平", () => {
        expect(matchBalanced("(`)`)", 0)).toBe(4);
    });

    it("行注释里的括号被跳过", () => {
        expect(matchBalanced("(// )\n)", 0)).toBe(6);
    });

    it("不配平返回 -1", () => {
        expect(matchBalanced("(a", 0)).toBe(-1);
    });
});

describe("findSymbolBody（定义体定位）", () => {
    it("跳过 JSDoc 示例行，锚定真正的定义", () => {
        const src = [
            "/**",
            " * @example",
            " *   client.getSsoLoginUrl(redirectUrl);",
            " */",
            "getSsoLoginUrl(u: string): string {",
            '    return "/login/sso/redirect";',
            "}",
        ].join("\n");
        const found = findSymbolBody(src, "getSsoLoginUrl");
        expect(found).not.toBeNull();
        expect(found!.lineStart).toBe(5);
        expect(found!.body).toContain('"/login/sso/redirect"');
        expect(found!.body).not.toContain("@example");
    });

    it("跳过调用点（`this.getSsoLoginUrl(…)`），取的是定义体", () => {
        const src = [
            "class A {",
            "    getCasLoginUrl(u: string): string {",
            '        return this.getSsoLoginUrl(u, "cas");',
            "    }",
            "    getSsoLoginUrl(u: string, t?: string): string {",
            '        return "/login/sso/redirect";',
            "    }",
            "}",
        ].join("\n");
        const found = findSymbolBody(src, "getSsoLoginUrl");
        expect(found!.lineStart).toBe(5);
        expect(found!.body).toContain('"/login/sso/redirect"');
    });

    it("返回类型里的对象字面量（`Promise<{ … }>`）不能被误当成函数体起点", () => {
        const src = [
            "class X {",
            "    public register(token: IOpenIDToken): Promise<{",
            "        access_token: string;",
            "        token: string;",
            "    }> {",
            '        const uri = this.http.getUrl("/account/register", undefined, IdentityPrefix.V2);',
            "        return uri;",
            "    }",
            "}",
        ].join("\n");
        const found = findSymbolBody(src, "register");
        expect(found).not.toBeNull();
        expect(found!.body).toContain("/account/register");
        expect(found!.body).toContain("IdentityPrefix.V2");
    });

    it("找不到符号返回 null", () => {
        expect(findSymbolBody("const x = 1;", "nope")).toBeNull();
    });
});

describe("missingGuards", () => {
    it("返回缺失的守卫子串", () => {
        expect(missingGuards("abc", ["a", "z", "q"])).toEqual(["z", "q"]);
    });

    it("全部存在时为空数组", () => {
        expect(missingGuards("abc", ["a", "b", "c"])).toEqual([]);
    });
});

describe("collectConstructionSites（覆盖率规则）", () => {
    it("分别命中 R1/R2/R3 且行号正确", () => {
        const src = [
            "const a = new URL(`/x/${y}`, base);",
            'const b = this.getUrl("/upload");',
            "return `${baseUrl}/z`;",
        ].join("\n");
        const sites = collectConstructionSites(src);
        expect(sites.map((s) => s.rule)).toEqual(["R1", "R2", "R3"]);
        expect(sites.map((s) => s.line)).toEqual([1, 2, 3]);
        expect(sites.every((s) => typeof s.index === "number")).toBe(true);
    });

    it("`new URL(value)`（解析已有字符串）不算构造点", () => {
        expect(collectConstructionSites("const c = new URL(value);")).toEqual([]);
    });
});

describe("classifyPathExpectation（manifest 命中 / 具名桶）", () => {
    const routes = new Map([
        ["GET /_matrix/client/v3/login/sso/redirect", "/_matrix/client/v3/login/sso/redirect"],
        ["GET /_matrix/client/v3/auth/{X}/fallback/web", "/_matrix/client/v3/auth/{auth_type}/fallback/web"],
    ]);

    it("manifest 精确命中", () => {
        expect(classifyPathExpectation("GET", "/_matrix/client/v3/login/sso/redirect", "manifest", routes)).toEqual({
            ok: true,
            kind: "exact",
        });
    });

    it("模板槽位归一化后命中 manifest", () => {
        const r = classifyPathExpectation(
            "GET",
            "/_matrix/client/v3/auth/${loginType}/fallback/web",
            "manifest",
            routes,
        );
        expect(r).toEqual({ ok: true, kind: "exact" });
    });

    it("manifest 未命中 → manifest-miss", () => {
        const r = classifyPathExpectation("GET", "/_matrix/client/v3/does-not-exist", "manifest", routes);
        expect(r.ok).toBe(false);
        expect(r.kind).toBe("manifest-miss");
    });

    it("expect 为具名桶、且确实未命中 → ok 且计入该桶", () => {
        const r = classifyPathExpectation(
            "POST",
            "/_matrix/identity/v2/account/register",
            "bucket:identity-server",
            routes,
        );
        expect(r).toEqual({ ok: true, kind: "bucket", bucket: "identity-server" });
    });

    it("expect 为具名桶、但路径已命中 manifest → bucket-now-in-manifest（应从桶迁出）", () => {
        const r = classifyPathExpectation(
            "GET",
            "/_matrix/client/v3/login/sso/redirect",
            "bucket:identity-server",
            routes,
        );
        expect(r.ok).toBe(false);
        expect(r.kind).toBe("bucket-now-in-manifest");
    });

    it("无法识别的 expect → bad-expect", () => {
        const r = classifyPathExpectation("GET", "/_matrix/client/v3/login/sso/redirect", "weird", routes);
        expect(r.ok).toBe(false);
        expect(r.kind).toBe("bad-expect");
    });
});

describe("diffBuckets（只降不升）", () => {
    it("计数上升 → bucket-grown", () => {
        const issues = diffBuckets({ a: 1 }, { a: 2 });
        expect(issues).toHaveLength(1);
        expect(issues[0].kind).toBe("bucket-grown");
    });

    it("计数缩小 → bucket-stale（缩小未刷新也要报）", () => {
        const issues = diffBuckets({ a: 2 }, { a: 1 });
        expect(issues).toHaveLength(1);
        expect(issues[0].kind).toBe("bucket-stale");
    });

    it("桶被清空 → bucket-stale", () => {
        const issues = diffBuckets({ a: 1 }, {});
        expect(issues).toHaveLength(1);
        expect(issues[0].kind).toBe("bucket-stale");
    });

    it("计数不变 → 无问题", () => {
        expect(diffBuckets({ a: 1 }, { a: 1 })).toEqual([]);
    });
});
