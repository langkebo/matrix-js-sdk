/*
 * 「类型表声明的方法，运行时到底在不在」守卫。
 *
 * 为什么需要它：`src/matrix-client-extensions.ts` 的两个接口
 * （`MatrixClientExtensionMethods` / `MatrixClientInternalMethods`）会被 `declare module "./client"`
 * **合并进 `MatrixClient`**，于是这里的每一条声明都让「类型检查通过」成为既定事实 ——
 * 声明一个运行时并不存在的方法，症状是**调用即 TypeError、编译期毫无提示**。
 *
 * 本仓反复踩过这个坑，`knip.ts` 里 worker / room-alias 条目下记着原话：
 *
 *   「`client.getWorkerManager()` 在运行时是 undefined，调用即 TypeError」
 *
 * 静态扫描**查不出**它：源码里 `MatrixClient.prototype.getXxxManager = ...` 那行确实存在，
 * 只是那份代码从没被 `manager-extensions/index.ts` 动态 import 执行到。所以本 spec 有两个层次：
 *
 *   ① 静态：类型表声明的每个方法，全仓至少有一处「实现」（类成员或 prototype 挂载）；
 *   ② 运行时：真的把 `{ includeAll: true }` 初始化跑一遍，再逐个探 prototype。
 *
 * 2026-10-07 的目标态是**两个层次都归零**：69 条「声明了但全仓没实现」的残留声明已删除，
 * 最后 2 个未接线模块（device-keys / push-rules）已补进 MODULE_DEFS。
 * 台账 `scripts/quality/manager-accessor-wiring-baseline.json` 的三组均为空 —— 任何一组
 * 重新非空即红（不允许用「往台账里加一行」的方式换绿）。
 *
 * 跑法：npx vitest run --no-file-parallelism spec/unit/manager-accessor-wiring.spec.ts
 */

import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { MatrixClient } from "../../src/client";
import { extendMatrixClientWithManagers, resetManagerExtensions } from "../../src/manager-extensions";

const REPO_ROOT = path.join(__dirname, "..", "..");
const EXT_FILE = path.join(REPO_ROOT, "src", "matrix-client-extensions.ts");
const BASELINE_FILE = path.join(REPO_ROOT, "scripts", "quality", "manager-accessor-wiring-baseline.json");

/** 两个会被合并进 MatrixClient 的接口 —— 判据必须同时覆盖，只看前者会漏掉一半。 */
const INTERFACES = ["MatrixClientExtensionMethods", "MatrixClientInternalMethods"] as const;

/** 剥离注释：类型表里有示例代码块，里面的方法名会污染提取结果。 */
function stripComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** 提取某个 `export interface X { ... }` 里声明的方法名（按括号配平找边界）。 */
export function collectInterfaceMethods(rawSource: string, ifaceName: string): string[] {
    const src = stripComments(rawSource);
    const anchor = src.indexOf(`export interface ${ifaceName}`);
    // `>= 0` 而非 `> 0`：合成输入（如阴性对照用例）的接口可以出现在第 0 位；
    // 真正要拦的是 `-1`（找不到），那会让下面 `indexOf("{", -1)` 静默取到文件里第一个 `{`。
    expect(anchor, `类型表里找不到 interface ${ifaceName}`).toBeGreaterThanOrEqual(0);

    const braceStart = src.indexOf("{", anchor);
    let depth = 1;
    let i = braceStart + 1;
    while (depth > 0 && i < src.length) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") depth--;
        i++;
    }
    const body = src.slice(braceStart + 1, i - 1);

    const names = new Set<string>();
    for (const line of body.split("\n")) {
        const m = line.match(/^\s{4}([A-Za-z_]\w*)\s*[(<]/);
        if (m) names.add(m[1]);
    }
    return [...names].sort();
}

/** 两个接口声明的所有方法名（去重）。 */
export function collectDeclaredMethods(rawSource = fs.readFileSync(EXT_FILE, "utf8")): string[] {
    const names = new Set<string>();
    for (const iface of INTERFACES) for (const n of collectInterfaceMethods(rawSource, iface)) names.add(n);
    return [...names].sort();
}

/**
 * 纯判据：`declared` 里哪些不在 `available` 中。
 *
 * 单独抽成可注入的纯函数，是为了能写**阳性对照** —— 只有能对合成输入报出缺失，
 * 对真实文件返回 `[]` 才说明「真的没有缺失」，而不是「判据坏了」。
 */
export function diffMissing(declared: Iterable<string>, available: ReadonlySet<string>): string[] {
    return [...declared].filter((n) => !available.has(n)).sort();
}

/** 递归收集 src 下的 .ts（排除 __generated__ 与 .d.ts）。 */
function walkSrc(dir: string, acc: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name !== "__generated__") walkSrc(full, acc);
        } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
            acc.push(full);
        }
    }
    return acc;
}

/**
 * 静态采集「运行时可用」的方法名：MatrixClient 类成员 + 全仓 `MatrixClient.prototype.X =` 挂载。
 *
 * ⚠️ 这是**静态**判据，只能回答「有没有实现」，不能回答「那份实现有没有被执行到」。
 * 后者交给下面的运行时探针。
 */
export function collectAvailableClientMethods(): Set<string> {
    const available = new Set<string>();
    for (const f of [path.join(REPO_ROOT, "src", "client.ts"), path.join(REPO_ROOT, "src", "matrix.ts")]) {
        const src = stripComments(fs.readFileSync(f, "utf8"));
        const start = src.indexOf("export class MatrixClient");
        if (start < 0) continue;
        for (const m of src
            .slice(start)
            .matchAll(/\n\s{4}(?:(?:public|private|protected|async|static|readonly)\s+)*([A-Za-z_]\w*)\s*[(<]/g)) {
            available.add(m[1]);
        }
        for (const m of src.matchAll(/\n\s{4}(?:get|set)\s+([A-Za-z_]\w*)\s*\(/g)) {
            available.add(m[1]);
        }
    }
    for (const f of walkSrc(path.join(REPO_ROOT, "src"))) {
        const src = stripComments(fs.readFileSync(f, "utf8"));
        for (const m of src.matchAll(/MatrixClient\.prototype\.(\w+)\s*=/g)) {
            available.add(m[1]);
        }
    }
    return available;
}

/** 类型表声明过、但**全仓没有任何实现**的方法名。目标态：空数组。 */
export function collectMissingClientMethods(rawSource?: string): string[] {
    return diffMissing(collectDeclaredMethods(rawSource), collectAvailableClientMethods());
}

/**
 * 空壳模块：模块的 `index.ts` 里存在 `client.X(...)` 形式的转发，而 X 属于
 * 「类型表声明过、运行时不存在」的方法。
 */
export function findEmptyShellModules(missing: string[]): string[] {
    // 缺失集合为空时直接返回，避免空 alternation 的正则退化成 `client.(` 这种误匹配。
    if (missing.length === 0) return [];
    const pattern = new RegExp(
        `\\bclient\\s*\\.\\s*(${missing.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*\\(`,
    );
    const out: string[] = [];
    for (const f of walkSrc(path.join(REPO_ROOT, "src"))) {
        if (f.endsWith("matrix-client-extensions.ts")) continue;
        const src = stripComments(fs.readFileSync(f, "utf8"));
        if (pattern.test(src)) out.push(path.relative(REPO_ROOT, f));
    }
    return out.sort();
}

/** 读台账：三组必须都是空的。 */
export function readBaselineGroups(): Record<string, string[]> {
    const payload = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
    return {
        pendingWiring: [...payload.groups.pendingWiring.methods].sort(),
        notOnMatrixClient: [...payload.groups.notOnMatrixClient.methods].sort(),
        emptyShellModules: [...payload.groups.emptyShellModules.modules].sort(),
    };
}

/** 真实初始化后，记录 prototype 上真正是函数的方法名。 */
let runtimeHas: (name: string) => boolean;
let declared: string[];

beforeAll(async () => {
    // ⚠️ 必须先 reset。`spec/setupTests.ts` 的全局 beforeAll 已经用
    // `{ includeDm: false }`（即默认核心集合）初始化过一次，而
    // `extendMatrixClientWithManagers` 是**幂等**的：
    //     if (isInitialized) return;              // ← 后续任何 options 都被静默忽略
    // 不 reset 就在这里调 `{ includeAll: true }`，等于什么都没做 ——
    // 本 spec 的第一版正是这样测的，于是把「不在默认集合里的模块」误判成
    // 「模块没接线」，一口气报了 25 个假缺失。reset 之后 `includeAll` 才真正生效。
    resetManagerExtensions();
    await extendMatrixClientWithManagers({ includeAll: true });

    const proto = MatrixClient.prototype as unknown as Record<string, unknown>;
    runtimeHas = (name) => typeof proto[name] === "function";
    declared = collectDeclaredMethods();
});

describe("类型表声明 vs 运行时挂载", () => {
    it("判据自检（阴性对照）：只认 4 空格缩进的声明，忽略注释与更深缩进", () => {
        const sample = [
            "export interface Demo {",
            "    // commentedOut(a: string): void;",
            "    realMethod(a: string): void;",
            "    overloaded(x: number): void;",
            "    overloaded(x: string): void;",
            "        deeperIndent(): void;",
            "    prop: string;",
            "}",
        ].join("\n");
        // 注释里的 `commentedOut`、5 空格缩进的 `deeperIndent`、无括号的 `prop` 都不算；
        // 重载只记一次。
        expect(collectInterfaceMethods(sample, "Demo")).toEqual(["overloaded", "realMethod"]);
    });

    it("判据自检（阳性对照）：diffMissing 对合成输入确实能报出缺失", () => {
        // 若这条不成立，下面那条 `toEqual([])` 就是恒真的空转。
        expect(diffMissing(["getUserId", "notARealMethod"], new Set(["getUserId"]))).toEqual(["notARealMethod"]);
    });

    it("类型表本身能被解析出足够多的声明（防正则/边界失效导致下面的断言空转）", () => {
        expect(declared.length).toBeGreaterThan(150);
        expect(declared).toContain("getAdminManager"); // 来自 MatrixClientExtensionMethods
        expect(declared).toContain("getAccessToken"); // 来自 MatrixClientInternalMethods
    });

    it("静态判据：类型表不得声明「全仓都没有实现」的方法（目标态：0 条）", () => {
        expect(
            collectMissingClientMethods(),
            "类型表里又出现了没有实现的方法 —— 这些声明会被合并进 MatrixClient，" +
                "让 `client.X(...)` 类型检查通过、运行时 TypeError。\n" +
                "· 新加声明 ⇒ 先实现（类成员 / prototype 挂载），或改成 `client.getXxxManager()` 的形状；\n" +
                "· 删了实现 ⇒ 同步删声明。\n" +
                "（台账 manager-accessor-wiring-baseline.json 不接受新增登记。）",
        ).toEqual([]);
    });

    it("运行时判据：初始化后，类型表声明的每个方法都真的挂在 MatrixClient.prototype 上", () => {
        // 这一条是静态判据查不到的那一半：源码里有挂载代码 ≠ 那段代码被执行到。
        const missingAtRuntime = declared.filter((n) => !runtimeHas(n));
        expect(
            missingAtRuntime,
            "这些方法类型表声明了、`{ includeAll: true }` 初始化后 prototype 上却没有 —— " +
                "检查对应模块有没有登记进 scripts/generate-manager-extensions.mjs 的 MODULE_DEFS。",
        ).toEqual([]);
    });

    it("空壳模块：没有模块还在转发「运行时不存在的方法」（2026-10-07 起为 0）", () => {
        // 层次与上面不同：上面查「模块能不能被加载」，这条查「加载后方法能不能用」。
        // 接线治不了空壳 —— prototype 上多一个函数，函数体第一行转发就 TypeError。
        expect(
            findEmptyShellModules(collectMissingClientMethods()),
            "有模块在转发一个「类型表声明过、运行时不存在」的 client 方法；" +
                "接线治不了它，请改走已接线的 Manager（如 this.client.getPushManager().getPushRules()）。",
        ).toEqual([]);
    });

    it("台账三组必须为空（不允许用「加一行 waiver」换绿）", () => {
        const groups = readBaselineGroups();
        expect(groups.pendingWiring, "pendingWiring 台账必须为空").toEqual([]);
        expect(groups.notOnMatrixClient, "notOnMatrixClient 台账必须为空").toEqual([]);
        expect(groups.emptyShellModules, "emptyShellModules 台账必须为空").toEqual([]);
    });

    it("已收口的内部调用点不得回退（原先 4 处已改走 Manager）", () => {
        // 这 4 处曾直接 `this.client.X(...)` 调运行时不存在的方法，2026-10-07 已改走 Manager：
        //   device-keys:470 → this.client.getDeviceManager().getDevice(...)
        //   push-rules      → this.client.getPushManager().getPushRules/setPushRule/deletePushRule
        // 反向断言，防止回退到"类型检查通过、运行时 TypeError"。
        // ⚠️ 必须先剥注释：说明性注释里会引用原来的写法（`` `this.client.getPushRules()` ``），
        // 直接在原文里搜 needle 会被注释命中 —— 这与「注释里写路径即算可达」是同一个坑的镜像。
        const fixed: Array<[string, string]> = [
            ["src/device-keys/index.ts", "this.client.getDevice("],
            ["src/push-rules/index.ts", "this.client.getPushRules("],
            ["src/push-rules/index.ts", "this.client.setPushRule("],
            ["src/push-rules/index.ts", "this.client.deletePushRule("],
        ];
        for (const [rel, needle] of fixed) {
            const src = stripComments(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
            expect(src, `${rel} 不应再出现 ${needle}`).not.toContain(needle);
        }
    });
});
