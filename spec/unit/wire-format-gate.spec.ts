/*
 * wire-format-gate.spec.ts — 「SDK ↔ 后端 报文契约门禁」的守卫 spec（2026-10-10）。
 *
 * ## 为什么钉的是「抽取」而不是「门禁结论」
 *
 * 这条门禁的失效方式**不是报错**，而是**静默判错**——把"解错的键集/路由"当成正确结果去比对，
 * 于是要么放过真缺陷、要么报出假缺陷（本仓累计 24 次抽取器错误全属这一族）。首版实测就踩中两次：
 *
 *   1. **`body` 是方法形参**（`createReport(body: CreateReportBody)`）被读成"空键集"
 *      ⇒ 一次报出 4 条假的「缺必填」。根因是 `bodyArg === null` 有歧义：
 *      "该包装器没有这个位置"（不可知）与"调用点没传"（确定不发）必须分开；
 *   2. **`doRequest` 同名不同签名**（`widgets/index.ts` 是 `(method, path, body?)`，
 *      其余文件是 `(method, path, queryParams?, body?)`）⇒ 按统一位置取会把 body 读错位。
 *
 * 所以下面每个 `it` 都对应其中一条，并给出必须被识别（或必须**不**被识别）的样本。
 */

import { describe, expect, it } from "vitest";

import {
    classifyWire,
    countBuckets,
    diffBuckets,
    extractObjectFormCalls,
    objectLiteralKeys,
    resolveKeySet,
    splitTopLevelObjectProps,
    violationKey,
    waiverCovers,
} from "../../scripts/quality/check-wire-format.mjs";
import { resolveWrapperIoPositions } from "../../scripts/quality/verify-path-contract.mjs";

const NO_OPTS = { identityHelpers: null, templateBuilders: null };

describe("splitTopLevelObjectProps / objectLiteralKeys", () => {
    it("顶层逗号切分：嵌套对象/数组/字符串里的逗号不切", () => {
        expect(splitTopLevelObjectProps('a: 1, b: { x: 1, y: 2 }, c: "1,2"')).toHaveLength(3);
    });

    it("取顶层键集（含引号键）", () => {
        expect(objectLiteralKeys('{ rooms: r, suggested_only: true, "a-b": 1 }').keys).toEqual([
            "a-b",
            "rooms",
            "suggested_only",
        ]);
    });

    it("简写属性算键（`{ body }` ⇒ body）", () => {
        expect(objectLiteralKeys("{ body }").keys).toEqual(["body"]);
    });

    it("空对象 ⇒ 空键集（确定不发，不是'不知道'）", () => {
        expect(objectLiteralKeys("{}")).toEqual({ keys: [], reason: null });
    });

    it("展开 `...x` ⇒ null（键集不再是全貌，fail-closed）", () => {
        const r = objectLiteralKeys("{ ...base, id: 1 }");
        expect(r.keys).toBeNull();
        expect(r.reason).toBe("spread");
    });

    it("计算键 `[k]: v` ⇒ null", () => {
        const r = objectLiteralKeys("{ [k]: 1 }");
        expect(r.keys).toBeNull();
        expect(r.reason).toBe("unparsed-prop");
    });

    it("非对象字面量 / 尾部有残留 ⇒ null（TS 断言是类型层的，会被剥掉后正常解析）", () => {
        expect(objectLiteralKeys("someVar").reason).toBe("not-object-literal");
        expect(objectLiteralKeys("{ a: 1 } extra").reason).toBe("trailing-text");
        expect(objectLiteralKeys("{ a: 1 } as const").keys).toEqual(["a"]);
    });
});

describe("resolveKeySet", () => {
    it("expr === null 专指「位置不可知」—— 绝不能当成空键集（首版 4 条假缺陷的根因）", () => {
        const r = resolveKeySet(null, "", 0);
        expect(r.keys).toBeNull();
        expect(r.reason).toBe("position-unknown");
    });

    it("字面量 undefined/null ⇒ 确定不发（空键集）", () => {
        expect(resolveKeySet("undefined", "", 0).keys).toEqual([]);
        expect(resolveKeySet("null", "", 0).keys).toEqual([]);
    });

    it("对象字面量 ⇒ 其键集", () => {
        expect(resolveKeySet("{ room_id: id }", "", 0).keys).toEqual(["room_id"]);
    });

    it("裸标识符指向 `const` 对象字面量 ⇒ 追进去", () => {
        const src = 'const payload = { a: 1, b: 2 };\nthis.request(Method.Post, "/x", undefined, payload);';
        expect(resolveKeySet("payload", src, src.indexOf("this.request")).keys).toEqual(["a", "b"]);
    });

    it("裸标识符是**形参** ⇒ null（不是空键集）", () => {
        const src = 'async createReport(body: B) {\n  this.request(Method.Post, "/x", undefined, body);\n}';
        const r = resolveKeySet("body", src, src.indexOf("this.request"));
        expect(r.keys).toBeNull();
        expect(r.reason).toBe("binding-unresolved");
    });

    it("同名 `const` 出现多于一处 ⇒ null（不拿另一个同名绑定去比对）", () => {
        const src = 'const p = { a: 1 };\nconst p = { b: 2 };\nthis.request(Method.Post, "/x", undefined, p);';
        expect(resolveKeySet("p", src, src.indexOf("this.request")).keys).toBeNull();
    });

    it("函数调用 / 成员访问 ⇒ null", () => {
        expect(resolveKeySet("buildBody()", "", 0).reason).toBe("not-object-literal");
        expect(resolveKeySet("opts.body", "", 0).reason).toBe("not-object-literal");
    });
});

describe("extractObjectFormCalls", () => {
    it("认出 `request({ method: Method.X, path, body, queryParams })`", () => {
        const src = `this.request({ method: Method.Post, path: "/summaries/batch",
            queryParams: { q: 1 }, body: { rooms: r } });`;
        const { calls, unchecked } = extractObjectFormCalls(src, "src/x.ts", NO_OPTS);
        expect(unchecked).toHaveLength(0);
        expect(calls).toHaveLength(1);
        expect(calls[0].method).toBe("POST");
        expect(calls[0].pathRaw).toBe('"/summaries/batch"');
        expect(calls[0].bodyArg).toBe("{ rooms: r }");
        expect(calls[0].queryArg).toBe("{ q: 1 }");
    });

    it("简写属性 `body` 必须被认成「传了 body」（而不是「没这个属性」）", () => {
        const src = 'this.request({ method: Method.Post, path: "/x", body });';
        const { calls } = extractObjectFormCalls(src, "src/x.ts", NO_OPTS);
        expect(calls[0].bodyArg).toBe("body");
    });

    it("属性缺失 ⇒ 字面量 undefined（确定不发），绝不是 null（不可知）", () => {
        const src = 'this.request({ method: Method.Get, path: "/x" });';
        const { calls } = extractObjectFormCalls(src, "src/x.ts", NO_OPTS);
        expect(calls[0].bodyArg).toBe("undefined");
        expect(calls[0].queryArg).toBe("undefined");
    });

    it("没有 `method: Method.X` 的对象字面量不算请求规格", () => {
        expect(extractObjectFormCalls("foo({ success: true });", "src/x.ts", NO_OPTS).calls).toHaveLength(0);
        expect(extractObjectFormCalls('foo({ method: "GET", path: "/x" });', "src/x.ts", NO_OPTS).calls).toHaveLength(
            0,
        );
    });

    it("path 走 `const` 绑定也能解开；解不出则进 unchecked（不静默）", () => {
        // 真实形态：调用点在类方法里（`findLocalConstBinding` 沿未闭合 `{}` 栈找绑定）
        const ok = `class M { m() { const path = "/services";\n this.request({ method: Method.Get, path, prefix: P }); } }`;
        expect(extractObjectFormCalls(ok, "src/x.ts", NO_OPTS).calls).toHaveLength(1);
        const bad = "class M { m() { this.request({ method: Method.Get, path: computePath(), prefix: P }); } }";
        const r = extractObjectFormCalls(bad, "src/x.ts", NO_OPTS);
        expect(r.calls).toHaveLength(0);
        expect(r.unchecked).toHaveLength(1);
    });
});

describe("resolveWrapperIoPositions（同名不同签名必须按文件区分）", () => {
    it("widgets 的 doRequest 是 (method, path, body?) ⇒ body 在 2、无 queryParams", () => {
        expect(resolveWrapperIoPositions("doRequest", "src/widgets/index.ts")).toEqual({ query: null, body: 2 });
    });

    it("其余文件的 doRequest 是 (method, path, queryParams?, body?)", () => {
        expect(resolveWrapperIoPositions("doRequest", "src/space/sub-managers/space-query-manager.ts")).toEqual({
            query: 2,
            body: 3,
        });
    });

    it("未登记的包装器 ⇒ null（位置不可判，按'未知'计数）", () => {
        expect(resolveWrapperIoPositions("idServerRequest", "src/x.ts")).toBeNull();
    });
});

interface Side {
    type: string;
    required: string[];
    declared: string[];
    denyUnknown: boolean;
    opaque: boolean;
}

function be(body: Side | null, query: Side | null, hasJson = true, hasQuery = Boolean(query)) {
    return { handler: "h", hasJson, hasQuery, body, query };
}

const SIDE = (type: string, required: string[], declared: string[], denyUnknown = false, opaque = false): Side => ({
    type,
    required,
    declared,
    denyUnknown,
    opaque,
});

describe("classifyWire（判据）", () => {
    const call = (route: string, bodyKeys?: string[], queryKeys?: string[]) => ({
        route,
        file: "src/x.ts",
        line: 1,
        wrapper: "request",
        body: bodyKeys === undefined ? { keys: null, reason: "binding-unresolved" } : { keys: bodyKeys, reason: null },
        query:
            queryKeys === undefined ? { keys: null, reason: "binding-unresolved" } : { keys: queryKeys, reason: null },
    });

    it("缺必填 ⇒ request-required-missing", () => {
        const backend = new Map([["POST /x", be(SIDE("B", ["algorithm", "room_id"], ["algorithm", "room_id"]), null)]]);
        const { violations } = classifyWire({ calls: [call("POST /x", ["room_id"], [])], backend });
        expect(violations).toHaveLength(1);
        expect(violations[0].kind).toBe("request-required-missing");
        expect(violations[0].missing).toEqual(["algorithm"]);
    });

    it("deny_unknown_fields + 多传键 ⇒ request-unknown-key（P-01 形态）", () => {
        const backend = new Map([
            ["POST /x", be(SIDE("RoomSummaryBatchRequest", ["rooms"], ["rooms", "suggested_only"], true), null)],
        ]);
        const { violations } = classifyWire({ calls: [call("POST /x", ["rooms", "is_suggested_only"], [])], backend });
        expect(violations).toHaveLength(1);
        expect(violations[0].kind).toBe("request-unknown-key");
        expect(violations[0].extra).toEqual(["is_suggested_only"]);
    });

    it("非 deny_unknown_fields 时多传键不算违规（后端会忽略）", () => {
        const backend = new Map([["POST /x", be(SIDE("B", ["a"], ["a"], false), null)]]);
        expect(classifyWire({ calls: [call("POST /x", ["a", "extra"], [])], backend }).violations).toHaveLength(0);
    });

    it("后端无 Json 提取器而 SDK 传了 body ⇒ body-sent-ignored", () => {
        const backend = new Map([["GET /x", be(null, null, false, false)]]);
        const { violations } = classifyWire({ calls: [call("GET /x", ["a"], [])], backend });
        expect(violations[0].kind).toBe("body-sent-ignored");
    });

    it("query 键不符 ⇒ query-unknown-key（W-01 形态：后端 deny_unknown_fields）", () => {
        // `redirectUrl` 是 `Option<String>` ⇒ 非必填，故只报"多传键"
        const backend = new Map([
            ["GET /s", be(null, { ...SIDE("Q", [], ["redirectUrl"], true, false) }, false, true)],
        ]);
        const { violations } = classifyWire({ calls: [call("GET /s", undefined, ["idp_id"])], backend });
        expect(violations[0].kind).toBe("query-unknown-key");
        expect(violations[0].extra).toEqual(["idp_id"]);
    });

    it("SDK 不下发 query 而后端有必填 query ⇒ query-required-missing", () => {
        const backend = new Map([
            ["GET /s", be(null, { ...SIDE("Q", ["target_service"], ["target_service"], false, false) }, false, true)],
        ]);
        const { violations } = classifyWire({ calls: [call("GET /s", undefined, [])], backend });
        expect(violations[0].kind).toBe("query-required-missing");
        expect(violations[0].missing).toEqual(["target_service"]);
    });

    it("后端形状不可知（opaque）⇒ 进桶，不判", () => {
        const backend = new Map([["POST /x", be(SIDE("B", ["a"], ["a"], false, true), null)]]);
        const r = classifyWire({ calls: [call("POST /x", ["a"], [])], backend });
        expect(r.violations).toHaveLength(0);
        expect(r.unresolved.some((u) => u.kind === "backend-body-unknown")).toBe(true);
    });

    it("SDK 键集不可知 ⇒ 进桶（形参透传的情形），绝不冒充空键集", () => {
        const backend = new Map([["POST /x", be(SIDE("B", ["a", "b"], ["a", "b"]), null)]]);
        const r = classifyWire({ calls: [call("POST /x", undefined, [])], backend });
        expect(r.violations).toHaveLength(0);
        expect(r.unresolved.some((u) => u.kind === "sdk-keys-unknown" && u.side === "body")).toBe(true);
    });

    it("路由未解析 ⇒ route-not-resolved（不并进'通过'）", () => {
        const r = classifyWire({ calls: [call("POST /nope", ["a"], [])], backend: new Map() });
        expect(r.unresolved[0].kind).toBe("route-not-resolved");
    });

    it("请求体检查不得被响应/其它分支的 continue 吞掉（后端 hasJson + body 不可知时仍要计数）", () => {
        const backend = new Map([["POST /x", be(SIDE("B", ["a"], ["a"]), null)]]);
        const r = classifyWire({ calls: [call("POST /x", undefined, ["q"])], backend });
        expect(r.unresolved.map((u) => u.kind)).toContain("sdk-keys-unknown");
        expect(r.unresolved.map((u) => u.kind)).toContain("backend-query-unknown");
    });
});

describe("countBuckets / diffBuckets / waiverCovers", () => {
    it("桶按 kind:side 计数", () => {
        expect(
            countBuckets([
                { kind: "sdk-keys-unknown", side: "body" },
                { kind: "sdk-keys-unknown", side: "body" },
            ]),
        ).toEqual({
            "sdk-keys-unknown:body": 2,
        });
    });

    it("只把'变多'算违规（棘轮只降不升）", () => {
        expect(diffBuckets({ a: 2 }, { a: 2, b: 1 })).toEqual([{ kind: "b", baseline: 0, observed: 1 }]);
        expect(diffBuckets({ a: 3 }, { a: 1 })).toEqual([]);
    });

    it("waiver：`file` 可省（按 kind+route 覆盖），给出时须一致；过期即不覆盖", () => {
        const v = { kind: "query-unknown-key", route: "GET /s", file: "src/auth/index.ts" };
        expect(waiverCovers([{ kind: "query-unknown-key", route: "GET /s" }], v, "2026-10-10")).toBe(true);
        expect(
            waiverCovers([{ kind: "query-unknown-key", route: "GET /s", file: "src/other.ts" }], v, "2026-10-10"),
        ).toBe(false);
        expect(
            waiverCovers([{ kind: "query-unknown-key", route: "GET /s", expires: "2026-01-01" }], v, "2026-10-10"),
        ).toBe(false);
        expect(violationKey(v)).toBe("query-unknown-key|GET /s|src/auth/index.ts");
    });
});
