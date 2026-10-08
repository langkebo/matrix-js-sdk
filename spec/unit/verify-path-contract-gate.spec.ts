/*
 * `scripts/quality/verify-path-contract.mjs` 的单元测试。
 *
 * 这个门禁把 SDK 里静态可求值的请求路径（method + prefix + path）与后端 ledger
 * 逐条比对，找出「拼错了、在真实后端上会 404」的路径。
 *
 * ⚠️ 本文件**取代**了原先那份 spec。原 spec 是**抄了一份常量副本自己测自己**——
 * 它文件头就写着「独立实现，避免 import ESM 脚本导致加载慢」——它连门禁都没 import。
 * 代价是副本一路漂移：`AdminPrefix.V1` 抄成 `/_matrix/admin/v1`（真值 `/_synapse/admin/v1`）、
 * `VendorPrefix` 抄成 `/_matrix/vendor`（真值 `/_matrix/vendor/v1`），还凭空多出
 * `Media` / `MediaV3` / `MediaUnstable` / `PushRulePrefix` 这些真表里没有的键。
 * **门禁改了它不红，抄错了它也不红——这就是"纸面 spec"。**
 *
 * 值得钉的口径：
 *
 *   · **前缀常量必须与 `src/http-api/prefix.ts` 一致**：门禁文件头的注释承诺了
 *     「改动 prefix.ts 时必须同步改这里 —— 单元测试会校验两者一致」，但那份抄副本的
 *     spec 根本兑现不了这个承诺。这里改为解析真源码来兑现。
 *   · **模板字面量前缀**（MSC4143 rtc/transports）：正则不能要求反引号，
 *     否则正确的 unstable 前缀会被误判成「用默认 v3 前缀」。
 *   · **三元的两条腿都要**：fallback 的两条路径都真会被发出去，只校验一条等于没校验。
 *   · **`wildcard` 只允许含点的字面量段顶占位符**：`send/m.room.message/{txn}` 该放过，
 *     但 `/notifications/deactivate` 绝不能被当成 `/notifications/{id}`
 *     —— 后者正是让真缺陷长期隐形的那条规则（已收紧）。
 */

import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { IdentityHelperInfo } from "../../scripts/quality/verify-path-contract.mjs";

import {
    DEFAULT_PREFIX,
    PREFIX_CONSTANTS,
    analyzeFunctionDeclarations,
    analyzeIdentityFunction,
    diffCoverage,
    extractWrapperCalls,
    findTopLevel,
    indexIdentityPathHelpers,
    matchAgainstLedger,
    matchBrace,
    normalizePath,
    parseStripPrefixAliases,
    resolvePrefix,
    resolvePrefixExpression,
    resolveLedgerPath,
    resolveStripPrefixFromType,
    resolveTemplateLiteral,
    splitTopLevelPlus,
    splitTopLevelTernary,
    unwrapIdentityPath,
    verifyIdentityHelperShape,
} from "../../scripts/quality/verify-path-contract.mjs";

/** `resolveStripPrefixFromType` 的测试用别名表（只放 spec 需要的三项）。 */
const ALIASES_FOR_TYPE = new Map([
    ["StripV3", "/_matrix/client/v3"],
    ["StripV1", "/_matrix/client/v1"],
    ["StripAdminV1", "/_synapse/admin/v1"],
]);

const GATE_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../scripts/quality/verify-path-contract.mjs");

/** 解析 `src/http-api/prefix.ts`，作为前缀常量的唯一真相源。 */
function parsePrefixSource(): Record<string, Record<string, string>> {
    const source = fs.readFileSync(join(process.cwd(), "src", "http-api", "prefix.ts"), "utf8");
    const parsed: Record<string, Record<string, string>> = {};

    for (const match of source.matchAll(/export enum (\w+)\s*\{([\s\S]*?)\n\}/g)) {
        const members: Record<string, string> = {};
        for (const kv of match[2].matchAll(/(\w+)\s*=\s*"([^"]+)"/g)) {
            members[kv[1]] = kv[2];
        }
        parsed[match[1]] = members;
    }

    const vendor = /export const VendorPrefix = "([^"]+)"/.exec(source);
    if (vendor) parsed.VendorPrefix = { "": vendor[1] };

    return parsed;
}

describe("verify-path-contract: 前缀常量与源码一致", () => {
    it("src/http-api/prefix.ts 里声明的每一项都必须在门禁表里且同值", () => {
        const truth = parsePrefixSource();
        expect(Object.keys(truth).length).toBeGreaterThan(0);

        for (const [group, members] of Object.entries(truth)) {
            expect(PREFIX_CONSTANTS[group], `门禁缺了前缀组 ${group}`).toBeDefined();
            for (const [key, value] of Object.entries(members)) {
                expect(PREFIX_CONSTANTS[group][key], `${group}.${key} 与 prefix.ts 不一致`).toBe(value);
            }
        }
    });

    it("源码里已有的组，不得多出源码不存在的成员", () => {
        // 注意方向：门禁表**可以**比 prefix.ts 多出整组（ServerPrefix / FederationPrefix
        // 是后端 ledger 的命名空间，SDK 侧没有对应枚举）；要守的是「同一个组里抄出了
        // prefix.ts 没有的成员」—— 老 spec 的副本正是这样凭空多出
        // ClientPrefix.Media / MediaV3 / MediaUnstable 与 PushRulePrefix 的。
        const truth = parsePrefixSource();
        // 只遍历组名（原来是 `Object.entries` 解构出 `members` 却没用 —— eslint 报 unused-vars）
        for (const group of Object.keys(truth)) {
            for (const key of Object.keys(PREFIX_CONSTANTS[group] ?? {})) {
                expect(truth[group][key], `${group}.${key} 在 prefix.ts 里不存在`).toBeDefined();
            }
        }
    });

    it("默认前缀是 ClientPrefix.V3（与 base-manager 的 request 实现一致）", () => {
        expect(DEFAULT_PREFIX).toBe(PREFIX_CONSTANTS.ClientPrefix.V3);
    });
});

describe("verify-path-contract: 路径归一化", () => {
    it("四种占位写法归一成同一个形状", () => {
        expect(normalizePath("/rooms/{roomId}/state")).toBe("/rooms/{X}/state");
        expect(normalizePath("/rooms/$roomId/state")).toBe("/rooms/{X}/state");
        expect(normalizePath("/rooms/:roomId/state")).toBe("/rooms/{X}/state");
        expect(normalizePath("/rooms/${encodeURIComponent(id)}/state")).toBe("/rooms/{X}/state");
    });

    it("去 query、去尾斜杠；空串得到 /", () => {
        expect(normalizePath("/a/b?x=1")).toBe("/a/b");
        expect(normalizePath("/a/b/")).toBe("/a/b");
        expect(normalizePath("/")).toBe("/");
        expect(normalizePath("")).toBe("/");
    });

    it("版本段不参与归一 —— 否则 SDK/后端的版本差异会被悄悄抹平", () => {
        expect(normalizePath("/_matrix/client/v3/rooms/{roomId}")).toBe("/_matrix/client/v3/rooms/{X}");
        expect(normalizePath("/_matrix/client/v1/rooms/{roomId}")).toBe("/_matrix/client/v1/rooms/{X}");
    });
});

describe("verify-path-contract: 前缀求值", () => {
    it("没写 prefix 时用默认前缀（不是「无法判断」）", () => {
        expect(resolvePrefix(null)).toEqual({ prefix: DEFAULT_PREFIX, known: true });
        expect(resolvePrefix("")).toEqual({ prefix: DEFAULT_PREFIX, known: true });
    });

    it("解析常量成员，AdminPrefix 走 /_synapse 而非 /_matrix", () => {
        expect(resolvePrefix("ClientPrefix.V3").prefix).toBe("/_matrix/client/v3");
        expect(resolvePrefix("ClientPrefix.R0").prefix).toBe("/_matrix/client/r0");
        expect(resolvePrefix("AdminPrefix.V1").prefix).toBe("/_synapse/admin/v1");
        expect(resolvePrefix("MediaPrefix.V1").prefix).toBe("/_matrix/media/v1");
    });

    it("VendorPrefix 是 const 字符串，加不加引号都要认", () => {
        expect(resolvePrefix("VendorPrefix").prefix).toBe("/_matrix/vendor/v1");
        expect(resolvePrefix('"VendorPrefix"').prefix).toBe("/_matrix/vendor/v1");
    });

    it("模板字面量前缀（MSC4143 rtc/transports 修复点）", () => {
        expect(resolvePrefix("`${ClientPrefix.Unstable}/org.matrix.msc4143`")).toEqual({
            prefix: "/_matrix/client/unstable/org.matrix.msc4143",
            known: true,
        });
        expect(resolveTemplateLiteral("${ClientPrefix.Unstable}/org.matrix.msc4143")).toBe(
            "/_matrix/client/unstable/org.matrix.msc4143",
        );
    });

    it("裸字符串前缀原样采用", () => {
        expect(resolvePrefix("/_matrix/custom")).toEqual({ prefix: "/_matrix/custom", known: true });
    });

    it("认不出的表达式返回 known=false，而不是假装解析成功", () => {
        expect(resolvePrefix("ClientPrefix.Unknown")).toEqual({ prefix: null, known: false });
        expect(resolvePrefix("NotAPrefix.V1")).toEqual({ prefix: null, known: false });
    });
});

describe("verify-path-contract: 多候选求值", () => {
    it("普通表达式只有一个候选", () => {
        expect(resolvePrefixExpression("ClientPrefix.V3")).toEqual({
            candidates: ["/_matrix/client/v3"],
            known: true,
        });
    });

    it("三元的两条腿都要 —— fallback 的两条路径都真会被发出去", () => {
        expect(resolvePrefixExpression("cond ? ClientPrefix.V1 : ClientPrefix.V3")).toEqual({
            candidates: ["/_matrix/client/v1", "/_matrix/client/v3"],
            known: true,
        });
    });

    it("任一条腿求不出值就整体 known=false", () => {
        expect(resolvePrefixExpression("cond ? ClientPrefix.V1 : unknownVar").known).toBe(false);
    });

    it("+ 拼接按笛卡尔积展开", () => {
        expect(resolvePrefixExpression('ClientPrefix.V3 + "/suffix"')).toEqual({
            candidates: ["/_matrix/client/v3/suffix"],
            known: true,
        });
    });

    it("无法静态求值时 known=false（调用点计入动态跳过，不当成匹配成功）", () => {
        expect(resolvePrefixExpression("unknownVar")).toEqual({ candidates: [], known: false });
    });
});

describe("verify-path-contract: 词法", () => {
    it("splitTopLevelTernary 跳过可选链与空值合并", () => {
        expect(splitTopLevelTernary("a ? B : C")).toEqual({ whenTrue: "B", whenFalse: "C" });
        expect(splitTopLevelTernary("a?.b ?? c")).toBeNull();
        expect(splitTopLevelTernary("plain")).toBeNull();
    });

    it("splitTopLevelPlus 不切字符串内的 +", () => {
        expect(splitTopLevelPlus("A + B + C")).toEqual(["A", "B", "C"]);
        expect(splitTopLevelPlus('"A+B" + C')).toEqual(['"A+B"', "C"]);
    });

    it("findTopLevel 不把引号内的字符算作顶层", () => {
        expect(findTopLevel('f("x,y", z)', (c) => c === ",")).toBe(-1);
        expect(findTopLevel("f(a, b)", (c) => c === ",")).toBe(-1);
        expect(findTopLevel("a, b", (c) => c === ",")).toBe(1);
    });

    it("matchBrace 找到配对闭合括号", () => {
        expect(matchBrace("{ a { b } }", 0)).toBe(10);
    });
});

describe("verify-path-contract: 与后端 ledger 比对", () => {
    const routes = new Map([
        ["POST /_matrix/client/v3/rooms/{X}/send/{X}", "/_matrix/client/v3/rooms/{roomId}/send/{eventType}"],
        ["DELETE /_matrix/client/v3/notifications/{X}", "/_matrix/client/v3/notifications/{notification_id}"],
        ["PUT /_matrix/client/v3/notifications/{X}/deactivate", "/_matrix/client/v3/notifications/{id}/deactivate"],
    ]);

    it("逐段完全一致记 exact", () => {
        expect(matchAgainstLedger("POST", "/_matrix/client/v3/rooms/{X}/send/{X}", routes)).toBe("exact");
    });

    it("含点的字面量段顶占位符记 wildcard，且要显式暴露给人复核", () => {
        expect(matchAgainstLedger("POST", "/_matrix/client/v3/rooms/{X}/send/m.room.message", routes)).toBe("wildcard");
    });

    it("不含点的字面量段不能顶占位符 —— /notifications/deactivate 的历史回归", () => {
        // 早期版本允许「任意字面量段顶任意 {占位符} 段」，于是这条被误判成
        // DELETE /notifications/{notification_id} 而长期隐形；真实后端只有
        // PUT /notifications/{id}/deactivate。收紧后必须报不出来（null）。
        expect(matchAgainstLedger("DELETE", "/_matrix/client/v3/notifications/deactivate", routes)).toBeNull();
    });

    it("段数不同就是不同路径", () => {
        expect(matchAgainstLedger("DELETE", "/_matrix/client/v3/notifications/{X}/deactivate", routes)).toBeNull();
    });

    it("method 不同不算命中", () => {
        expect(matchAgainstLedger("GET", "/_matrix/client/v3/rooms/{X}/send/{X}", routes)).toBeNull();
    });

    it("ledger 里没有的记 null", () => {
        expect(matchAgainstLedger("GET", "/_matrix/client/v3/nope", routes)).toBeNull();
    });
});

describe("verify-path-contract: 模块入口", () => {
    it("import 时不跑 main —— 顶层裸跑会去读兄弟仓 ledger，读不到就 process.exit(2)", () => {
        const source = fs.readFileSync(GATE_PATH, "utf8");
        expect(source).toMatch(/if \(import\.meta\.url === `file:\/\/\$\{process\.argv\[1\]\}`\)/);
        // ledger 加载必须已移出顶层：import 就 exit 的话 spec 连加载都做不到
        expect(source).toMatch(/export function loadBackendRoutes\(/);
        expect(source).not.toMatch(/^if \(!existsSync\(ledgerFile\)\)/m);
    });
});

describe("verify-path-contract: 恒等路径包装器（2026-10-08）", () => {
    // 本仓真实的形态：泛型参数 + `PathAssert` + 返回类型注解
    const GUARDED = `function bu<const P extends string>(path: P & PathAssert<P, StripAdminV1<BackgroundUpdatePath>>): P {
    return path;
}`;
    const PLAIN = `export function apu(path: string): string {
    return path;
}`;

    describe("analyzeFunctionDeclarations —— 识别 `return <参数>;`", () => {
        it("泛型参数 + 返回类型注解的恒等函数必须识别（第一版漏在这里）", () => {
            const decls = analyzeFunctionDeclarations(GUARDED);
            expect(decls).toHaveLength(1);
            expect(decls[0]).toMatchObject({ name: "bu", ok: true, param: "path" });
            expect(decls[0].typeText).toContain("PathAssert");
        });

        it("阴性对照：参数表里的泛型逗号不能被切成两个参数（`PathAssert<P, StripAdminV1<X>>`）", () => {
            // 少了泛型深度跟踪 ⇒ 2 个参数 ⇒ "恒等包装器必须恰好 1 个参数" 判据失败 ⇒
            // 50 个类型化包装器一个都识别不出来（报告只会说"已校验的恒等包装器: 1"）。
            const v = analyzeIdentityFunction(GUARDED, GUARDED.indexOf("bu") + 2);
            expect(v.ok).toBe(true);
            if (v.ok) expect(v.param).toBe("path");
        });

        it("函数体不是恒等 / 多参数 / 无函数体 / 名字后不是参数表 ⇒ 一律判不符", () => {
            expect(analyzeFunctionDeclarations('function f(x: string): string {\n    return x + "!";\n}')[0].ok).toBe(
                false,
            );
            expect(
                analyzeFunctionDeclarations("function f(a: string, b: string): string {\n    return a;\n}")[0].ok,
            ).toBe(false);
            expect(analyzeFunctionDeclarations("declare function f(x: string): string;")[0].ok).toBe(false);
            expect(
                analyzeFunctionDeclarations("const f = 1; function g(x: string) { return x; }").map((d) => d.name),
            ).toEqual(["g"]);
        });

        it("同名多处定义：只要有**一处**不是恒等，整名作废（不能在同名不同义之间猜）", () => {
            const src = `${PLAIN}\nfunction apu(path: string): string {\n    return path + "?";\n}`;
            expect(verifyIdentityHelperShape({ source: src, name: "apu" }).ok).toBe(false);
            expect(analyzeFunctionDeclarations(src).filter((d) => d.name === "apu")).toHaveLength(2);
        });

        it("函数体里的注释不影响判定", () => {
            const src = `function apu(path: string): string {
    // 无类型断言的 admin 路径函数
    return path; /* 恒等 */
}`;
            expect(verifyIdentityHelperShape({ source: src, name: "apu" })).toMatchObject({ ok: true, param: "path" });
        });
    });

    describe("indexIdentityPathHelpers —— 分类与前缀", () => {
        const ALIASES = new Map([
            ["StripV3", "/_matrix/client/v3"],
            ["StripV1", "/_matrix/client/v1"],
            ["StripAdminV1", "/_synapse/admin/v1"],
        ]);

        it("`PathAssert` ⇒ guarded；裸 `string` ⇒ plain", () => {
            const { helpers } = indexIdentityPathHelpers(
                new Map([
                    ["a.ts", GUARDED],
                    ["b.ts", PLAIN],
                ]),
                { stripAliases: ALIASES },
            );
            expect(helpers.get("bu")).toMatchObject({ kind: "guarded", stripPrefix: "/_synapse/admin/v1" });
            expect(helpers.get("apu")).toMatchObject({ kind: "plain", stripPrefix: null });
        });

        it("阴性对照：同名定义里有一处非恒等 ⇒ 整名不进索引（否则解包就是猜）", () => {
            const { helpers } = indexIdentityPathHelpers(
                new Map([
                    ["a.ts", `function bu(p: string): string {\n    return p;\n}`],
                    ["b.ts", `function bu(p: string): string {\n    return p.toUpperCase();\n}`],
                ]),
                { stripAliases: ALIASES },
            );
            expect(helpers.has("bu")).toBe(false);
        });

        it("阴性对照：同名定义前缀不一致 / 前缀判不出来 ⇒ stripPrefix 为 null（退回 byDir）", () => {
            const mixed = indexIdentityPathHelpers(
                new Map([
                    ["a.ts", `function x(p: P & PathAssert<P, StripV3<A>>): P {\n    return p;\n}`],
                    ["b.ts", `function x(p: P & PathAssert<P, StripV1<B>>): P {\n    return p;\n}`],
                ]),
                { stripAliases: ALIASES },
            );
            expect(mixed.helpers.get("x")?.stripPrefix).toBeNull();
            const unknown = indexIdentityPathHelpers(
                new Map([["a.ts", `function y(p: P & PathAssert<P, NoSuchAlias<A>>): P {\n    return p;\n}`]]),
                { stripAliases: ALIASES },
            );
            expect(unknown.helpers.get("y")?.stripPrefix).toBeNull();
        });
    });

    describe("parseStripPrefixAliases / resolveStripPrefixFromType", () => {
        it("只认单前缀形态；多前缀的条件类型别名不进来（解析它们要写类型求值器）", () => {
            const src = `export type StripV3<P extends string> = StripPrefix<P, "/_matrix/client/v3">;
export type StripAuthPrefix<P extends string> = StripPrefix<
    P,
    "/_matrix/client/v3",
    StripPrefix<P, "/_matrix/client/r0", P>
>;`;
            const aliases = parseStripPrefixAliases(src);
            expect(aliases.get("StripV3")).toBe("/_matrix/client/v3");
            expect(aliases.has("StripAuthPrefix")).toBe(false);
        });

        it("类型里出现**两个**已知别名 ⇒ 判不出来（不取第一个）", () => {
            expect(
                resolveStripPrefixFromType("P & PathAssert<P, StripV3<A> | StripV1<B>>", ALIASES_FOR_TYPE),
            ).toBeNull();
            expect(resolveStripPrefixFromType("P & PathAssert<P, StripV3<A>>", ALIASES_FOR_TYPE)).toBe(
                "/_matrix/client/v3",
            );
            expect(resolveStripPrefixFromType("string", ALIASES_FOR_TYPE)).toBeNull();
        });
    });

    describe("unwrapIdentityPath —— 只解整段就是一个调用的形态", () => {
        const helpers: Map<string, IdentityHelperInfo> = new Map([
            ["apu", { kind: "plain", files: ["a.ts"], stripPrefix: null }],
            ["bu", { kind: "guarded", files: ["b.ts"], stripPrefix: "/_synapse/admin/v1" }],
        ]);

        it("解到字面量：单层与嵌套多跳", () => {
            expect(unwrapIdentityPath('apu("/x")', helpers)).toBe('"/x"');
            expect(unwrapIdentityPath("bu(`/a/${id}`)", helpers)).toBe("`/a/${id}`");
            expect(unwrapIdentityPath('apu(bu("/x"))', helpers)).toBe('"/x"');
        });

        it("阴性对照：拼接/方法链/非恒等名/多参数 ⇒ null（展开一半比不解更糟）", () => {
            expect(unwrapIdentityPath('apu("/x") + y', helpers)).toBeNull();
            expect(unwrapIdentityPath('apu("/x").trim()', helpers)).toBeNull();
            expect(unwrapIdentityPath('other("/x")', helpers)).toBeNull();
            expect(unwrapIdentityPath('apu("a", "b")', helpers)).toBeNull();
            expect(unwrapIdentityPath("path", helpers)).toBeNull();
            expect(unwrapIdentityPath('apu("x")', null)).toBeNull();
        });

        it("解出来不是字面量时返回原表达式（`apu(path)` ⇒ `path`），由调用方判未校验", () => {
            expect(unwrapIdentityPath("apu(path)", helpers)).toBe("path");
        });
    });

    describe("extractWrapperCalls —— 未校验桶与包装器自带前缀", () => {
        const helpers: Map<string, IdentityHelperInfo> = new Map([
            ["bu", { kind: "guarded", files: ["b.ts"], stripPrefix: "/_synapse/admin/v1" }],
        ]);

        it("非字面量路径必须落进 unchecked（上一版是静默 `continue`，调用点在报告里根本不存在）", () => {
            const { calls, unchecked } = extractWrapperCalls(
                "const a = this.doRequest(Method.Get, jobPath(id));",
                "src/x.ts",
                { identityHelpers: helpers },
            );
            expect(calls).toHaveLength(0);
            expect(unchecked).toHaveLength(1);
            expect(unchecked[0]).toMatchObject({ file: "src/x.ts", wrapper: "doRequest" });
        });

        it("guarded 包装器的前缀来自参数类型（不是 byDir）——否则 background-update 整片假不匹配", () => {
            const { calls } = extractWrapperCalls(
                'const a = this.doRequest(Method.Get, bu("/background_updates/count"));',
                "src/background-update/index.ts",
                { identityHelpers: helpers },
            );
            expect(calls).toHaveLength(1);
            expect(calls[0]).toMatchObject({
                pathRaw: '"/background_updates/count"',
                prefixCandidates: ["/_synapse/admin/v1"],
                guard: "guarded",
                prefixFromHelper: true,
            });
        });

        it("阴性对照：解不出来的包装器调用（内层仍是表达式）照样是未校验", () => {
            const { calls, unchecked } = extractWrapperCalls(
                "const a = this.doRequest(Method.Get, bu(computePath(id)));",
                "src/x.ts",
                { identityHelpers: helpers },
            );
            expect(calls).toHaveLength(0);
            expect(unchecked).toHaveLength(1);
        });
    });

    describe("diffCoverage —— 覆盖率棘轮只准降", () => {
        const base = { uncheckedPathArg: 10, byFile: { "a.ts": 6, "b.ts": 4 } };

        it("持平/下降 ⇒ 无 issue", () => {
            expect(diffCoverage(base, { uncheckedPathArg: 10, byFile: { "a.ts": 6, "b.ts": 4 } })).toEqual([]);
            expect(diffCoverage(base, { uncheckedPathArg: 7, byFile: { "a.ts": 3, "b.ts": 4 } })).toEqual([]);
        });

        it("总量变多 / 某文件变多 / 新文件出现未校验 ⇒ 各报一条", () => {
            expect(
                diffCoverage(base, { uncheckedPathArg: 11, byFile: { "a.ts": 6, "b.ts": 4 } }).map((i) => i.kind),
            ).toEqual(["coverage-total-grown"]);
            const issues = diffCoverage(base, { uncheckedPathArg: 11, byFile: { "a.ts": 7, "b.ts": 4 } });
            expect(issues.map((i) => i.kind)).toEqual(["coverage-total-grown", "coverage-file-grown"]);
            expect(diffCoverage(base, { uncheckedPathArg: 11, byFile: { "c.ts": 1 } }).map((i) => i.kind)).toContain(
                "coverage-file-grown",
            );
        });

        it("阴性对照：总量不变但**换位**（一个文件减、另一个增）也要报", () => {
            const issues = diffCoverage(base, { uncheckedPathArg: 10, byFile: { "a.ts": 5, "b.ts": 5 } });
            expect(issues.map((i) => i.kind)).toEqual(["coverage-file-grown"]);
            expect(issues[0].detail).toContain("b.ts");
        });
    });
});

describe("resolveLedgerPath（ledger 来源解析）", () => {
    /*
     * 背景：门禁原来只认兄弟仓 `../synapse-rust/...`，读不到就 `process.exit(2)`；
     * 而 CI 的 `systemic_refactor_quality_gate.yml` 只 checkout 本仓 ⇒
     * `quality:contracts` 在 CI 上必然卡在这一步。
     * 回退到仓内镜像（`docs/api-contract/generated/route-manifest.all.json`）后，
     * 实测两者判定逐项一致，所以**回退必须是保判定的**。
     */
    it("显式 LEDGER_PATH 优先（连兄弟仓存在也要让位）", () => {
        expect(resolveLedgerPath({ explicitPath: "/tmp/x.json", siblingExists: true, mirrorExists: true })).toEqual({
            path: "/tmp/x.json",
            source: "env",
        });
    });

    it("兄弟仓在场 ⇒ 用实时导出", () => {
        const r = resolveLedgerPath({ explicitPath: null, siblingExists: true, mirrorExists: true });
        expect(r.source).toBe("sibling");
        expect(r.path).toContain("synapse-rust");
    });

    it("兄弟仓不在场但镜像在 ⇒ 回退到仓内镜像（CI 的情形）", () => {
        const r = resolveLedgerPath({ explicitPath: null, siblingExists: false, mirrorExists: true });
        expect(r.source).toBe("mirror");
        expect(r.path).toBe("docs/api-contract/generated/route-manifest.all.json");
    });

    it("两者都没有 ⇒ 仍返回兄弟仓路径，让下游打出「请先拉取」而不是静默用空表", () => {
        const r = resolveLedgerPath({ explicitPath: null, siblingExists: false, mirrorExists: false });
        expect(r.source).toBe("none");
        expect(r.path).toContain("synapse-rust");
    });
});
