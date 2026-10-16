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
    collapseContractEntries,
    countBuckets,
    diffBuckets,
    extractObjectFormCalls,
    gateRouteKey,
    objectLiteralKeys,
    rebaseLedgerKeys,
    resolveKeySet,
    splitTopLevelObjectProps,
    stripCommentsInChunk,
    violationKey,
    waiverCovers,
    waiverMatch,
} from "../../scripts/quality/check-wire-format.mjs";
import { resolveWrapperIoPositions } from "../../scripts/quality/verify-path-contract.mjs";
import { blankTsComments } from "../../scripts/quality/lib/admin-contract.mjs";

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

/**
 * 「注释粘住属性」的回归守卫（2026-10-15 实测的静默盲区）。
 *
 * 判据按**顶层逗号**切块，块首是 `//` 时整块被当纯注释跳过 ⇒ 被粘住的那个属性消失。
 * 后果双向且都不报错，所以必须逐条钉死：
 *   · 粘 `method`/`path` ⇒ 该调用点被第 260 行 `continue` **静默丢弃**
 *     （不进 `calls` 也不进 `unchecked`，覆盖面以"分母变小"的方式缩水）；
 *   · 粘 `body`/`queryParams` ⇒ 被读成"确定不发"⇒ 凭空报缺必填。
 * 真实命中：4 处纯丢弃 + 3 处读成"确定不发"（crypto-keys / media / room-state）。
 */
describe("stripCommentsInChunk / 注释不得改变判定", () => {
    it("剥行注释与块注释（含 JSDoc），并保留换行", () => {
        expect(stripCommentsInChunk("// c\nfoo").trim()).toBe("foo");
        expect(stripCommentsInChunk("/* c */ foo").trim()).toBe("foo");
        expect(stripCommentsInChunk("/** @example x */ foo").trim()).toBe("foo");
        expect(stripCommentsInChunk("// a\n/** b */ foo").trim()).toBe("foo");
    });

    it('**不碰**字符串与模板字面量内容（`path: "/a//b"` 的 `//` 必须原样保留）', () => {
        expect(stripCommentsInChunk('foo: "/a//b"')).toBe('foo: "/a//b"');
        expect(stripCommentsInChunk("foo: '/x//y'")).toBe("foo: '/x//y'");
        expect(stripCommentsInChunk("foo: `/a//b`")).toBe("foo: `/a//b`");
        // 转义引号不提前结束字符串
        expect(stripCommentsInChunk('foo: "a\\"//b"')).toBe('foo: "a\\"//b"');
    });

    it("objectLiteralKeys：注释不能吃掉它粘住的那个键", () => {
        expect(objectLiteralKeys("{ // note\n a: 1, b: 2 }").keys).toEqual(["a", "b"]);
        expect(objectLiteralKeys("{ /* note */ a: 1, b: 2 }").keys).toEqual(["a", "b"]);
    });

    it("注释紧贴 `method:` 时，调用点仍被抽出（原先被静默丢弃）", () => {
        const src = [
            "class M { m() {",
            "  this.request({",
            "    // 后端形状说明",
            "    method: Method.Get,",
            '    path: "/rooms",',
            "    prefix: ClientPrefix.V3,",
            "  });",
            "} }",
        ].join("\n");
        const r = extractObjectFormCalls(src, "src/x.ts", NO_OPTS);
        expect(r.calls).toHaveLength(1);
        expect(r.calls[0].method).toBe("GET");
        expect(r.unchecked).toHaveLength(0);
    });

    it("注释紧贴 `path:` 时，调用点仍被抽出（原先被静默丢弃）", () => {
        const src = [
            "class M { m() {",
            "  this.request({",
            "    method: Method.Post,",
            "    // 路径说明",
            '    path: "/rooms/create",',
            "    prefix: ClientPrefix.V3,",
            "  });",
            "} }",
        ].join("\n");
        expect(extractObjectFormCalls(src, "src/x.ts", NO_OPTS).calls).toHaveLength(1);
    });

    it("注释紧贴 `body:` 时，body 不得被读成「确定不发」（原先会报假的缺必填）", () => {
        const src = [
            "class M { m() {",
            "  this.request({",
            "    method: Method.Post,",
            '    path: "/keys/signatures/upload",',
            "    // 请求体直接是签名映射",
            "    body: { signatures: sigs },",
            "    prefix: ClientPrefix.V3,",
            "  });",
            "} }",
        ].join("\n");
        const r = extractObjectFormCalls(src, "src/x.ts", NO_OPTS);
        expect(r.calls).toHaveLength(1);
        expect(r.calls[0].bodyArg).not.toBe("undefined");
        // 键集确实解得出来，而不是"不可知"
        expect(resolveKeySet(r.calls[0].bodyArg, src, r.calls[0].callIndex).keys).toEqual(["signatures"]);
    });
});

/**
 * `gateRouteKey`：后端路由 key 必须用**本门禁的** `normalizePath` 重建。
 *
 * 真实事故（2026-10-16 实测）：仓里有两个 `normalizePath`，差的**不只是大小写** ——
 * `lib/admin-contract.mjs` 自己的那个（`normalizeRoute` 用它建 `byRoute`）产出 `{x}` 且**保留尾斜杠**；
 * 本文件从 `verify-path-contract.mjs` 转出的那个（候选 key 与 manifest key 都用它）产出 `{X}`、
 * **去掉尾斜杠**、还会吞 query 与认 `$var`/`:param`。
 *
 * 不重建就直接 `effective.has(key)` ⇒ **任何含动态段的路由两侧 key 永远不相等**，
 * 于是被静默归进 `route-contract-unavailable`：实测 599 个未解析调用点里有 **263** 个
 * 只要把 `{X}` 换成 `{x}` 就能命中 ⇒ 那不是"覆盖率上限"，是拼写不一致造成的**假上限**。
 * （`comparable` 长期只有 24，正是这个原因。）
 *
 * ⚠️ 只修后端一侧是不够的：台账（`frozen`）那一侧必须一起重建，否则漂移比较与 CI 半场都会失真
 * —— 见下面 `rebaseLedgerKeys` 的用例。
 */
describe("gateRouteKey（后端 key 必须用本门禁的归一化）", () => {
    it("占位符统一成 `{X}`（大写）—— 与候选 key / manifest key 的拼写一致", () => {
        expect(gateRouteKey("GET /_matrix/client/v3/rooms/{room_id}/state")).toBe(
            "GET /_matrix/client/v3/rooms/{X}/state",
        );
    });

    it("已是 `{x}`（小写）的 byRoute key 也要被重新拼成 `{X}`", () => {
        // 这正是修复点：byRoute 里存的是小写形态，直接比对必然失配
        expect(gateRouteKey("PUT /_matrix/vendor/v1/friends/{x}/status")).toBe(
            "PUT /_matrix/vendor/v1/friends/{X}/status",
        );
    });

    it("静态路径（无占位符）不受影响", () => {
        expect(gateRouteKey("POST /_matrix/client/v3/login")).toBe("POST /_matrix/client/v3/login");
        expect(gateRouteKey("POST /_synapse/admin/v1/cleanup/all")).toBe("POST /_synapse/admin/v1/cleanup/all");
    });

    it("key 里不得残留小写 `{x}`（残留 = 比较必然失配）", () => {
        for (const k of ["GET /a/{x}/b", "GET /a/{user_id}/b", "GET /a/{x}/b/{y}"]) {
            expect(gateRouteKey(k)).not.toContain("{x}");
        }
    });
});

/**
 * `rebaseLedgerKeys`：与 `gateRouteKey` 是**同一个不变式的两半**，缺一不可。
 *
 * 真实事故（2026-10-16 实测，只修了一半时）：把 `backend` 的 key 重建了、却把**台账**那一侧
 * 留在原拼写 ⇒ 两个后果同时发生，且都不报错：
 *   1. **漂移假报告**：`frozen.get(gateKey)` 恒不命中 ⇒ 每条动态段路由都被报成
 *      `backend-route-new`（实测 406 条，而实时收集与台账其实**逐条一致**、差集为 0）；
 *   2. **CI 半场静默变弱**：无后端时 `effective = frozen`，动态段调用点两侧永远对不上 ⇒
 *      可比对条目从 50 掉回 24、违规 2 → 0（**门禁照旧绿，只是查得更少**）。
 */
describe("rebaseLedgerKeys（台账 key 必须进同一个 key 空间）", () => {
    it("`{x}`（台账拼写）→ `{X}`（门禁拼写）", () => {
        const m = rebaseLedgerKeys({ "GET /a/{x}/b": { handler: "h" } });
        expect([...m.keys()]).toEqual(["GET /a/{X}/b"]);
        expect(m.get("GET /a/{X}/b")).toEqual({ handler: "h" });
    });

    it("尾斜杠也要被同化 —— 只对齐大小写仍会漏", () => {
        // 台账里真实存在 `GET /user/{x}/account_data/`（带尾斜杠），
        // 而门禁的 normalizePath 会 `.replace(/\/+$/, "")` ⇒ 不对齐这一条就永远失配。
        const ledgerKey = "GET /user/{x}/account_data/";
        const backendKey = "GET /user/{X}/account_data";
        expect(gateRouteKey(ledgerKey)).toBe(gateRouteKey(backendKey));
    });

    it("幂等：`--refresh` 写出的门禁拼写再过一次不变", () => {
        const once = rebaseLedgerKeys({ "GET /user/{x}/account_data/": 1 });
        const twice = rebaseLedgerKeys(Object.fromEntries(once));
        expect([...twice.keys()]).toEqual([...once.keys()]);
    });

    it("静态 key 与空输入都安全", () => {
        expect([...rebaseLedgerKeys({ "POST /_matrix/client/v3/login": 1 }).keys()]).toEqual([
            "POST /_matrix/client/v3/login",
        ]);
        expect([...rebaseLedgerKeys(undefined).keys()]).toEqual([]);
        expect([...rebaseLedgerKeys({}).keys()]).toEqual([]);
    });

    it("**不变式**：台账 key 重建后必须落在 backend key 的同一空间（真实的一对）", () => {
        // 这两条是同一路由的两种写法：左=台账（lib 拼写），右=后端收集器重建后的 key。
        const pairs: Array<[string, string]> = [
            ["POST /_synapse/admin/v1/federation/blacklist/{x}", "POST /_synapse/admin/v1/federation/blacklist/{X}"],
            ["PUT /_matrix/vendor/v1/friends/{x}/status", "PUT /_matrix/vendor/v1/friends/{X}/status"],
            ["GET /user/{x}/account_data/", "GET /user/{X}/account_data"],
        ];
        for (const [ledgerKey, backendKey] of pairs) {
            expect(rebaseLedgerKeys({ [ledgerKey]: 1 }).has(backendKey)).toBe(true);
        }
    });
});

/**
 * `collapseContractEntries`：门禁归一化造成的**同形折叠**必须显式。
 *
 * 真实事故（2026-10-16 实测）：后端 `routes/push.rs:15` 把 `get_pushers` 同时注册在
 * `GET /pushers` 与 `GET /pushers/`（`POST` 同 `set_pusher`）⇒ 门禁的 `normalizePath` 去尾斜杠后
 * 两条同形，`--refresh` 后台账 655 → **653** 条（那不是"路由消失"）。
 * 这一对契约恰好逐字段相同 ⇒ 折叠无害；但**契约不同的同形路由绝不能折叠** ——
 * `Map.set` 会让后写者静默胜出，等于拿错的契约去校验调用点。
 */
describe("collapseContractEntries（同形折叠必须显式，冲突必须报错）", () => {
    const c = { handler: "get_pushers", hasJson: false, hasQuery: false, body: null, query: null };

    it("契约相同的同形路由 ⇒ 折叠成一条，并登记为 collapsedIdentical", () => {
        const r = collapseContractEntries([
            ["GET /pushers", c],
            ["GET /pushers/", c],
        ]);
        expect([...r.entries.keys()]).toEqual(["GET /pushers"]);
        expect(r.collapsedIdentical).toEqual([{ key: "GET /pushers", routes: ["GET /pushers", "GET /pushers/"] }]);
        expect(r.conflicts).toEqual([]);
    });

    it("契约不同的同形路由 ⇒ 进 conflicts，且**先见者**留在 entries（不静默换掉）", () => {
        const other = { ...c, handler: "other_handler" };
        const r = collapseContractEntries([
            ["GET /pushers", c],
            ["GET /pushers/", other],
        ]);
        expect(r.conflicts).toEqual([{ key: "GET /pushers", routes: ["GET /pushers", "GET /pushers/"] }]);
        expect(r.entries.get("GET /pushers")).toEqual(c);
    });

    it("占位符拼写不同也算同形（`{x}` vs `{X}` vs `{room_id}`）", () => {
        const r = collapseContractEntries([
            ["GET /_matrix/client/v3/rooms/{room_id}/state", c],
            ["GET /_matrix/client/v3/rooms/{X}/state", c],
        ]);
        expect(r.entries.size).toBe(1);
        expect(r.collapsedIdentical).toHaveLength(1);
    });

    it("不同路由之间互不影响", () => {
        const r = collapseContractEntries([
            ["GET /a", c],
            ["POST /a", c],
        ]);
        expect([...r.entries.keys()]).toEqual(["GET /a", "POST /a"]);
        expect(r.collapsedIdentical).toEqual([]);
        expect(r.conflicts).toEqual([]);
    });
});

/**
 * `blankTsComments`：抽调用前先把注释**原地抹成空格**（保长）。
 *
 * 真实事故（2026-10-16 实测）：抽取器直接吃原文 ⇒ 会看见 JSDoc `@example` 里的用法示例。
 * `src/friend/paths.ts:24` 的示例（`await this.request({ method: Method.Put, path: friendPath(...) })`）
 * 与 `src/errors.ts:290` 的示例都被当成**真调用点**，前者还让门禁报出一条假的
 * `request-required-missing`（后端 `UpdateStatusRequest.status` 必填，而"示例"没传）。
 *
 * 保长是**硬要求**：下游要按**原下标**做 `indexOf(pathRaw)` 与
 * `findConstObjectBinding(source, callIndex, …)`，长度一变这些就全错位。
 */
describe("blankTsComments（保长空白化注释）", () => {
    it("输出与输入**等长**，且换行数量不变（行号不漂）", () => {
        const src = "// a\nconst x = 1; /* b\nc */\nconst y = 2;\n";
        const out = blankTsComments(src);
        expect(out).toHaveLength(src.length);
        expect(out.split("\n")).toHaveLength(src.split("\n").length);
    });

    it("行注释 / 块注释 / JSDoc 都被抹成空格，代码本身保留", () => {
        const src = [
            "/**",
            " * @example",
            ' * await this.request({ method: Method.Get, path: "/rooms/123" });',
            " */",
            "function f() { return 1; } // tail",
        ].join("\n");
        const out = blankTsComments(src);
        expect(out).not.toContain("request(");
        expect(out).not.toContain("@example");
        expect(out).not.toContain("// tail");
        expect(out).toContain("function f() { return 1; }");
    });

    it("**不碰**字符串与模板字面量里的 `//` / `/*`", () => {
        expect(blankTsComments('const a = "http://x";')).toBe('const a = "http://x";');
        expect(blankTsComments("const a = '/* not a comment */';")).toBe("const a = '/* not a comment */';");
        expect(blankTsComments("const a = `a//b`;")).toBe("const a = `a//b`;");
    });

    it("正则字面量里的 `//` 不被当行注释（沿用已验证的启发式）", () => {
        const out = blankTsComments('const a = "x//y".replace(/\\/\\//g, "-");');
        expect(out).toContain("replace(");
        expect(out).toContain("-");
    });

    it("**回归守卫**：JSDoc 里的 `this.request({…})` 不再被抽成调用点", () => {
        // 必须复刻**单行**示例的形态（`{` 落在行中）—— 多行示例的首块以 `*` 开头，
        // 会被属性解析偶然丢掉，复现不出真事故。`src/friend/paths.ts:24` 就是单行形态。
        // （真实站点用的是恒等助手 `friendPath(...)`；这里用字面量路径，机制相同。）
        const src = [
            "/**",
            " * 校验并返回 friends 路径。",
            " *",
            " * @example",
            ' * await this.request({ method: Method.Put, path: "/friends/x/status", prefix: VendorPrefix });',
            " */",
            "export function friendPath(p) { return p; }",
        ].join("\n");
        // 不空白化 ⇒ 会被当成真调用点（这就是那个假阳性）
        expect(extractObjectFormCalls(src, "src/friend/paths.ts", NO_OPTS).calls).toHaveLength(1);
        // 空白化后 ⇒ 不认得
        expect(extractObjectFormCalls(blankTsComments(src), "src/friend/paths.ts", NO_OPTS).calls).toHaveLength(0);
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

    it("waiverMatch：不含过期判断（过期 ≠ 失效）", () => {
        const w = { kind: "query-unknown-key", route: "GET /s", expires: "2026-01-01" };
        const v = { kind: "query-unknown-key", route: "GET /s", file: "src/auth/index.ts" };
        // 已过期，但**仍指向**这条违规 ⇒ 属"过期"，不属"失效"
        expect(waiverMatch(w, v)).toBe(true);
        expect(waiverCovers([w], v, "2026-10-10")).toBe(false);
        // 路由不同 ⇒ 既不指向也不覆盖
        expect(waiverMatch({ ...w, route: "GET /other" }, v)).toBe(false);
    });

    it("失效豁免判定：台账里有但当前零违规与之对应 ⇒ 必须被点名（W-01 修完后删条目的机器判据）", () => {
        // 复现本轮的场景：删掉 SDK 的 getSamlRedirect 后，那条豁免不再对应任何违规
        const waivers = [
            {
                kind: "query-unknown-key",
                route: "GET /_matrix/client/v3/login/sso/redirect/saml",
                file: "src/auth/index.ts",
            },
        ];
        const violations: Array<{ kind: string; route: string; file: string }> = [];
        const unused = waivers.filter((w) => !violations.some((v) => waiverMatch(w, v)));
        expect(unused).toHaveLength(1);
        // 只要还有一条对应违规，就不算失效
        const stillThere = [
            {
                kind: "query-unknown-key",
                route: "GET /_matrix/client/v3/login/sso/redirect/saml",
                file: "src/auth/index.ts",
            },
        ];
        expect(waivers.filter((w) => !stillThere.some((v) => waiverMatch(w, v)))).toHaveLength(0);
    });
});
