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

/** 提取 `interface MatrixClientExtensionMethods` 里声明的方法（按括号配平找边界）。 */
export function collectDeclaredExtensionMethods(): string[] {
    const src = stripComments(fs.readFileSync(EXT_FILE, "utf8"));
    const anchor = src.indexOf("export interface MatrixClientExtensionMethods");
    expect(anchor, "类型表里找不到 interface MatrixClientExtensionMethods").toBeGreaterThan(0);

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

function readBaseline(): { pendingWiring: string[]; notOnMatrixClient: string[] } {
    const payload = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
    return {
        pendingWiring: [...payload.groups.pendingWiring.methods].sort(),
        notOnMatrixClient: [...payload.groups.notOnMatrixClient.methods].sort(),
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

    it("已知 4 处内部调用点仍在（改类型表删声明前必须先处理它们）", () => {
        // 这 4 处 Manager 内部直接调 `this.client.X(...)`，而 X 不在运行时。
        // 记录在此，是为了让「删掉类型声明」这个动作无法悄悄绕过它们。
        const internalCallers: Array<[string, string]> = [
            ["src/device-keys/index.ts", "getDevice"],
            ["src/push-rules/index.ts", "getPushRules"],
            ["src/push-rules/index.ts", "setPushRule"],
            ["src/push-rules/index.ts", "deletePushRule"],
        ];
        for (const [rel, method] of internalCallers) {
            const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
            expect(src, `${rel} 里应仍有 this.client.${method}(...) 调用`).toContain(`client.${method}(`);
        }
    });
});
