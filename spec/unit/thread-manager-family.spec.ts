/*
 * thread 域 manager 家族的自动化核对。
 *
 * 背景（2026-10-08 实测）：
 * `ThreadManager`（`src/thread/index.ts`，2026-07 新增）与
 * `ThreadingManager`（`src/threading/index.ts`，2026-03 新增）**覆盖同一批后端端点**，
 * 但方法名已经漂移 —— 例如同一个 `GET /rooms/{roomId}/threads`，
 * 旧类叫 `getRoomThreadList`，新类叫 `getRoomThreads`；`addThreadReply` vs `createThreadReply`。
 *
 * 这跟「同一个后端路由两套实现」是同一类缺陷：调用方无法判断该用哪个，
 * 修 bug 要改两处，而且**没有任何机制会发现两边又漂了**。
 *
 * 本 spec 把两侧的端点从源码里抽出来做**自动核对**，而不是硬编码一份名单：
 *
 *   1. 两边都服务同一路径的方法，旧类必须在对照表里登记（否则失败）
 *   2. 对照表里的每一行，方法必须真实存在于对应类（防止表腐烂）
 *   3. 对照表里两侧都有路径的行，路径必须相交；两侧都带显式 HTTP 动词时，动词也必须相交
 *   4. 旧类必须带 `@deprecated`（它是被取代的一侧）
 *
 * 为什么用「自动抽取 + 对照表双向核对」而不是直接断言重复：
 * `ThreadingManager` 不是纯粹的遗留副本 —— 它的本地模型桥接
 * （`getThreads` / `hasThread` / `getThreadTimeline` 等）在 `ThreadManager` 上没有对应实现，
 * 不能整体判定为「应删除」。所以正确的契约是「**REST 那一半必须登记映射**」。
 *
 * 抽取器为什么允许「没有显式动词」：
 * 部分方法走 `this.requestThreadV1(...)` / `requestThreadV3(...)` 包装器，动词内建在包装器里，
 * 方法体里没有 `Method.X`。这类方法动词记为「未知」，只按路径匹配 ——
 * 强行要求动词只会把正确代码判成失败。
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../..");
const OLD_FILE = "src/threading/index.ts"; // ThreadingManager
const NEW_FILE = "src/thread/index.ts"; // ThreadManager

/** 一个方法抽取到的端点信息。 */
interface MethodEndpoints {
    /** 归一化后的路径（`${encodeURIComponent(roomId)}` → `{}`）。 */
    paths: Set<string>;
    /** 显式出现的 HTTP 动词；走包装器时为空集。 */
    verbs: Set<string>;
}

/** 把模板字符串归一化：`${encodeURIComponent(roomId)}` → `{}`。 */
function normalizePathLiteral(literal: string): string {
    return literal.replace(/\$\{[^}]*\}/g, "{}");
}

/**
 * 抽取 `export class X` 类体内每个方法名 → 端点信息。
 *
 * 判定「方法边界」的方式是按 4 空格缩进的方法签名切分 —— 本仓类方法固定缩进 4 空格。
 */
function extractMethodEndpoints(relPath: string): Map<string, MethodEndpoints> {
    const source = fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
    const classIndex = source.search(/export class \w+/);
    if (classIndex < 0) throw new Error(`cannot locate exported class in ${relPath}`);
    const body = source.slice(classIndex);

    const signature =
        /^\s{4}(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:async\s+)?([a-zA-Z_$][\w$]*)\s*[<(]/gm;
    const hits: Array<{ name: string; start: number }> = [];
    for (const match of body.matchAll(signature)) {
        hits.push({ name: match[1], start: match.index ?? 0 });
    }

    const result = new Map<string, MethodEndpoints>();
    for (let i = 0; i < hits.length; i++) {
        const end = i + 1 < hits.length ? hits[i + 1].start : body.length;
        const slice = body.slice(hits[i].start, end);

        const verbs = new Set<string>();
        for (const verb of slice.matchAll(/Method\.(Get|Post|Put|Delete|Patch|Head|Options)\b/g)) {
            verbs.add(verb[1].toUpperCase());
        }

        const paths = new Set<string>();
        for (const literal of slice.matchAll(/[`"]([^`"]*)[`"]/g)) {
            const value = normalizePathLiteral(literal[1]);
            if (value.startsWith("/rooms/") || value.startsWith("/user/") || value.includes("/threads")) {
                paths.add(value);
            }
        }

        if (paths.size > 0) result.set(hits[i].name, { paths, verbs });
    }
    return result;
}

/**
 * 从旧类 JSDoc 的对照表里抽出 `| 旧方法 | 新方法 |` 两列。
 *
 * 两种行形态都要支持：
 *   · 单方法行：`` | `getRoomThreadList` | `getRoomThreads` | ... | ``
 *   · 同义行：  `` | `freezeThread` / `unfreezeThread` / ... | 同名 | ... | ``
 *     —— 右侧是字面量「同名」，此时逐一映射到自身。忽略这种行会让
 *     这些真实存在的重复端点被误判成「未登记」。
 */
function extractMappingTable(relPath: string): Array<{ old: string; new: string }> {
    const source = fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
    const rows: Array<{ old: string; new: string }> = [];
    for (const line of source.split("\n")) {
        const match = line.match(/^\s*\*\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|/);
        if (!match) continue;
        const left = match[1];
        const right = match[2];
        if (!left.includes("`")) continue;

        const names = (cell: string): string[] =>
            [...cell.matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((m) => m[1]).filter((n) => n !== "ThreadManager");
        const oldNames = names(left);
        if (oldNames.length === 0) continue;

        if (right.trim() === "同名") {
            for (const oldName of oldNames) rows.push({ old: oldName, new: oldName });
            continue;
        }

        const newNames = names(right);
        if (newNames.length === 0) continue;

        if (oldNames.length === newNames.length && newNames.length > 1) {
            for (let i = 0; i < oldNames.length; i++) rows.push({ old: oldNames[i], new: newNames[i] });
        } else {
            for (const oldName of oldNames) {
                for (const newName of newNames) rows.push({ old: oldName, new: newName });
            }
        }
    }
    return rows;
}

/** 类 JSDoc 是否带 `@deprecated`。 */
function classJSDocHasDeprecated(relPath: string): boolean {
    const source = fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
    const classIndex = source.search(/export class \w+/);
    const before = source.slice(0, classIndex);
    const lastDocStart = before.lastIndexOf("/**");
    if (lastDocStart < 0) return false;
    return before.slice(lastDocStart).includes("@deprecated");
}

describe("thread manager family / 源码端点抽取", () => {
    it("两侧都抽得到方法→端点映射（抽取器没有静默失效）", () => {
        const oldEndpoints = extractMethodEndpoints(OLD_FILE);
        const newEndpoints = extractMethodEndpoints(NEW_FILE);
        expect(oldEndpoints.size).toBeGreaterThan(10);
        expect(newEndpoints.size).toBeGreaterThan(10);
        expect(oldEndpoints.get("getRoomThreadList")?.paths).toContain("/rooms/{}/threads");
        expect(newEndpoints.get("getRoomThreads")?.paths).toContain("/rooms/{}/threads");
    });

    it("走包装器的方法：路径与显式动词都被抽到", () => {
        const legacy = extractMethodEndpoints(OLD_FILE).get("getLegacyRoomThreadList");
        expect(legacy?.paths).toContain("/user/{}/rooms/{}/threads");
        // 2026-10-09：该调用点从 `requestThreadV3`（包装器内部硬编码 GET，因此抽取器看不到动词）
        // 改为 `requestThreadVendor("...", Method.Get, ...)` —— 动词变成显式参数，抽取器能取到。
        expect(legacy?.verbs.has("GET")).toBe(true);
    });

    it("对照表解析支持用 / 分隔的同义行", () => {
        const mapping = extractMappingTable(OLD_FILE);
        expect(mapping).toContainEqual({ old: "freezeThread", new: "freezeThread" });
        expect(mapping).toContainEqual({ old: "getThreadReplies", new: "getThreadReplies" });
        expect(mapping).toContainEqual({ old: "getRoomThreadList", new: "getRoomThreads" });
    });
});

describe("thread manager family / 重复面必须登记", () => {
    it("旧类的 REST 半边被标注为 @deprecated", () => {
        expect(classJSDocHasDeprecated(OLD_FILE)).toBe(true);
    });

    it("两边共用同一路径的方法，旧类侧必须出现在对照表里", () => {
        const oldEndpoints = extractMethodEndpoints(OLD_FILE);
        const newEndpoints = extractMethodEndpoints(NEW_FILE);

        const newByPath = new Map<string, Set<string>>();
        for (const [name, info] of newEndpoints) {
            for (const p of info.paths) {
                if (!newByPath.has(p)) newByPath.set(p, new Set());
                newByPath.get(p)?.add(name);
            }
        }

        const mappedOldMethods = new Set(extractMappingTable(OLD_FILE).map((row) => row.old));

        const unregistered: string[] = [];
        for (const [oldName, info] of oldEndpoints) {
            for (const p of info.paths) {
                const counterparts = newByPath.get(p);
                if (!counterparts || counterparts.size === 0) continue;
                if (mappedOldMethods.has(oldName)) continue;
                unregistered.push(`${oldName} (${p}) ↔ ${[...counterparts].join(", ")}`);
            }
        }

        expect(unregistered, `未登记在 ThreadingManager 对照表里的重复端点:\n${unregistered.join("\n")}`).toEqual([]);
    });

    it("对照表每一行的方法都真实存在（防止表腐烂）", () => {
        const oldEndpoints = extractMethodEndpoints(OLD_FILE);
        const newEndpoints = extractMethodEndpoints(NEW_FILE);
        const mapping = extractMappingTable(OLD_FILE);

        expect(mapping.length).toBeGreaterThanOrEqual(20);

        const stale: string[] = [];
        for (const row of mapping) {
            if (!oldEndpoints.has(row.old)) stale.push(`旧类缺 ${row.old}`);
            if (!newEndpoints.has(row.new)) stale.push(`新类缺 ${row.new}`);
        }
        expect(stale, `对照表指向了不存在的方法:\n${stale.join("\n")}`).toEqual([]);
    });

    it("对照表两侧都有路径时路径必须相交；都有显式动词时动词也必须相交", () => {
        const oldEndpoints = extractMethodEndpoints(OLD_FILE);
        const newEndpoints = extractMethodEndpoints(NEW_FILE);
        const mapping = extractMappingTable(OLD_FILE);

        const problems: string[] = [];
        for (const row of mapping) {
            const oldInfo = oldEndpoints.get(row.old);
            const newInfo = newEndpoints.get(row.new);
            if (!oldInfo || !newInfo) continue;

            const sharedPaths = [...oldInfo.paths].filter((p) => newInfo.paths.has(p));
            if (sharedPaths.length === 0) {
                problems.push(
                    `${row.old} ↔ ${row.new}: 无公共路径（旧 ${[...oldInfo.paths].join(",")} / 新 ${[...newInfo.paths].join(",")}）`,
                );
                continue;
            }
            if (oldInfo.verbs.size > 0 && newInfo.verbs.size > 0) {
                const sharedVerbs = [...oldInfo.verbs].filter((v) => newInfo.verbs.has(v));
                if (sharedVerbs.length === 0) {
                    problems.push(
                        `${row.old} ↔ ${row.new}: 路径相同但动词不同（旧 ${[...oldInfo.verbs].join(",")} / 新 ${[...newInfo.verbs].join(",")}）`,
                    );
                }
            }
        }
        expect(problems, `对照表把不同端点配成了一对:\n${problems.join("\n")}`).toEqual([]);
    });

    it("本地模型桥接方法没有 REST 端点，因此不参与登记（新类确实不提供）", () => {
        const oldEndpoints = extractMethodEndpoints(OLD_FILE);
        const newEndpoints = extractMethodEndpoints(NEW_FILE);
        for (const localOnly of ["getThreads", "hasThread", "getThreadList"]) {
            expect(oldEndpoints.has(localOnly)).toBe(false);
            expect(newEndpoints.has(localOnly)).toBe(false);
        }
    });
});
