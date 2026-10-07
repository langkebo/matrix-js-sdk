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

import {
    DEFAULT_PREFIX,
    PREFIX_CONSTANTS,
    findTopLevel,
    matchAgainstLedger,
    matchBrace,
    normalizePath,
    resolvePrefix,
    resolvePrefixExpression,
    resolveTemplateLiteral,
    splitTopLevelPlus,
    splitTopLevelTernary,
} from "../../scripts/quality/verify-path-contract.mjs";

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
        for (const [group, members] of Object.entries(truth)) {
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
