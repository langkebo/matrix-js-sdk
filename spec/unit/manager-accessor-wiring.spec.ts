/*
 * 「类型表声明的方法，运行时到底在不在」守卫。
 *
 * 为什么需要它：`src/matrix-client-extensions.ts` 的 `interface MatrixClientExtensionMethods`
 * 会把方法合并进 `MatrixClient` 接口，于是 **类型检查通过**；但方法真正可用，取决于对应模块的
 * `extendMatrixClient()` 有没有被 `manager-extensions/index.ts` 动态 import 执行到。
 *
 * 这两件事不同步，就得到本仓反复踩过的那个坑：
 *
 *   「`client.getWorkerManager()` 在运行时是 undefined，调用即 TypeError」
 *      —— knip.ts 里 worker / room-alias 条目下的原话。
 *
 * 静态扫描**查不出**它：源码里 `MatrixClient.prototype.getXxxManager = ...` 那行确实存在，
 * 只是那份代码从没被执行到。所以本 spec **真的把初始化跑一遍**再逐个探。
 *
 * 台账 `scripts/quality/manager-accessor-wiring-baseline.json` 登记了当前的已知缺口
 * （两组、各有原因），**只能减少**：修好一个就必须同步下调台账，否则这里会红。
 *
 * 跑法：npx vitest run --no-file-parallelism spec/unit/manager-accessor-wiring.spec.ts
 */

import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { MatrixClient } from "../../src/client";
import { extendMatrixClientWithManagers, resetManagerExtensions } from "../../src/manager-extensions";

/* eslint-disable @typescript-eslint/no-explicit-any */

const REPO_ROOT = path.join(__dirname, "..", "..");
const EXT_FILE = path.join(REPO_ROOT, "src", "matrix-client-extensions.ts");
const BASELINE_FILE = path.join(REPO_ROOT, "scripts", "quality", "manager-accessor-wiring-baseline.json");

/** 剥离注释：类型表里有示例代码块，里面的方法名会污染提取结果。 */
function stripComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** 提取某个 `export interface X { ... }` 里声明的方法名（按括号配平找边界）。 */
export function collectInterfaceMethods(rawSource: string, ifaceName: string): string[] {
    const src = stripComments(rawSource);
    const anchor = src.indexOf(`export interface ${ifaceName}`);
    expect(anchor, `类型表里找不到 interface ${ifaceName}`).toBeGreaterThan(0);

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

/** 提取 `interface MatrixClientExtensionMethods` 里声明的方法。 */
export function collectDeclaredExtensionMethods(): string[] {
    return collectInterfaceMethods(fs.readFileSync(EXT_FILE, "utf8"), "MatrixClientExtensionMethods");
}

function readBaseline(): {
    pendingWiring: string[];
    notOnMatrixClient: string[];
    emptyShellModules: string[];
} {
    const payload = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
    return {
        pendingWiring: [...payload.groups.pendingWiring.methods].sort(),
        notOnMatrixClient: [...payload.groups.notOnMatrixClient.methods].sort(),
        emptyShellModules: [...payload.groups.emptyShellModules.modules].sort(),
    };
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
 * 类型表**声明过、但运行时并不存在**的方法名。
 *
 * 两个接口都要查：`MatrixClientExtensionMethods`（extendMatrixClient 挂的）与
 * `MatrixClientInternalMethods`（注释自称"类中已实现"，实际也有一批没实现）。
 * 只看前者会漏掉 74 个 —— 这正是本 spec 第二版犯过的错。
 */
export function collectMissingClientMethods(): string[] {
    const raw = fs.readFileSync(EXT_FILE, "utf8");
    const declared = new Set<string>([
        ...collectInterfaceMethods(raw, "MatrixClientExtensionMethods"),
        ...collectInterfaceMethods(raw, "MatrixClientInternalMethods"),
    ]);

    // 运行时可用：MatrixClient 类成员 + 全仓 MatrixClient.prototype.X = 挂载
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

    return [...declared].filter((n) => !available.has(n)).sort();
}

/**
 * 空壳模块：模块的 `index.ts` 里存在 `client.X(...)` 形式的转发，而 X 属于
 * 「类型表声明过、运行时不存在」的方法。
 */
export function findEmptyShellModules(missing: string[]): string[] {
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
    declared = collectDeclaredExtensionMethods();
});

describe("类型表声明 vs 运行时挂载", () => {
    it("类型表能解析出方法（自检，防止正则/边界失效导致「零断言通过」）", () => {
        expect(declared.length).toBeGreaterThan(100);
        expect(declared).toContain("getAdminManager");
    });

    it("manager 类访问器：缺失集合必须与台账完全一致（只能减少）", () => {
        const baseline = readBaseline();
        const declaredManagers = declared.filter((n) => /^get[A-Z]\w*Manager$/.test(n));
        const missing = declaredManagers.filter((n) => !runtimeHas(n)).sort();

        expect(
            missing,
            "缺的与台账不一致。\n" +
                "· 若这里多出了新的名字 ⇒ 新模块忘记登记进 manager-extensions 的 MODULE_DEFS。\n" +
                "· 若台账里有、这里没有 ⇒ 已修好，请下调 manager-accessor-wiring-baseline.json。",
        ).toEqual(baseline.pendingWiring);
    });

    it("非 manager 的历史残留声明：缺失集合必须与台账完全一致", () => {
        const baseline = readBaseline();
        const declaredOthers = declared.filter((n) => !/^get[A-Z]\w*Manager$/.test(n));
        const missing = declaredOthers.filter((n) => !runtimeHas(n)).sort();

        expect(
            missing,
            "非 manager 声明的缺失集合与台账不一致。这些是上游 API 残留声明（实现已移到 Manager），" +
                "应以「从类型表删除」或「补一层委托挂载」二选一收口，并同步台账。",
        ).toEqual(baseline.notOnMatrixClient);
    });

    it("台账不得登记运行时其实存在的方法（防注水）", () => {
        const baseline = readBaseline();
        const all = [...baseline.pendingWiring, ...baseline.notOnMatrixClient];
        const actuallyAlive = all.filter((n) => runtimeHas(n));
        expect(actuallyAlive, "这些方法运行时其实存在，却还留在台账里").toEqual([]);
    });

    it("已收口的内部调用点不得回退（原先 4 处已改走 Manager）", () => {
        // 这 4 处曾直接 `this.client.X(...)` 调运行时不存在的方法，2026-10-07 已改走 Manager：
        //   device-keys:470 → this.client.getDeviceManager().getDevice(...)
        //   push-rules      → this.client.getPushManager().getPushRules/setPushRule/deletePushRule
        // 反向断言，防止回退到"类型检查通过、运行时 TypeError"。
        // ⚠️ 必须先剥注释：说明性注释里会引用原来的写法（`` `this.client.getPushRules()` ``），
        // 直接在原文里搜 needle 会被注释命中 —— 这与「注释里写路径即算可达」是同一个坑的镜像。
        const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
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

    it("判据自检：确实存在一批「声明过但运行时没有」的方法（防判据失效导致下一条恒真）", () => {
        // 如果 collectMissingClientMethods 因为正则/边界失效而返回空数组，
        // 下一条断言会在空集合上空转、永远通过 —— 这条专门拦那种情况。
        expect(collectMissingClientMethods().length).toBeGreaterThan(50);
    });

    it("空壳模块集合必须与台账一致（内部转发给不存在方法的模块，只能减少）", () => {
        // 层次与上面几组不同：那些查「模块能不能被加载」，这条查「加载后方法能不能用」。
        // 接线治不了空壳 —— prototype 上多一个函数，函数体第一行转发就 TypeError。
        const baseline = readBaseline();
        const actual = findEmptyShellModules(collectMissingClientMethods());

        expect(
            actual,
            "空壳模块集合与台账不一致。\n" +
                "· 多了 ⇒ 新模块在转发一个「类型表声明过、运行时不存在」的 client 方法；\n" +
                "  接线治不了它，请改走已接线的 Manager（如 this.client.getPushManager().getPushRules()）。\n" +
                "· 少了 ⇒ 已修好，请下调台账 groups.emptyShellModules.modules。",
        ).toEqual(baseline.emptyShellModules);
    });
});
