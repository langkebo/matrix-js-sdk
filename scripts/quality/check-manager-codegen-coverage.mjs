#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

// 映射的唯一真相源（codegen 也要用同一份）
import { findSdkDirForModule } from "../contract-module-map.mjs";

export { findSdkDirForModule };

const projectRoot = process.cwd();
/** `--json`：把判定结果交给下游（quality-report.mjs）复用，避免两处各算一遍。 */
const shouldEmitJson = process.argv.includes("--json");
const srcDir = path.join(projectRoot, "src");
const generatedIndexPath = path.join(projectRoot, "docs", "api-contract", "generated", "index.json");

/**
 * Modules that intentionally have no generated route table.
 *
 * These managers do not consume one (verified: no `__generated__/route-table` import
 * and their HTTP paths are built by hand), so generating a table would only add dead
 * code — that is why codegen lists most of them in `SKIP_ROUTE_TABLE_MODULES`. They are
 * recorded here so the gate reports "known non-consumer" instead of silently inflating
 * the gap, and so an *unexpected* new gap still fails the build. Every entry needs a
 * reason and an expiry date.
 */
const WAIVED_MODULES = {
    admin: { reason: "no route-table consumer; codegen intentionally skips it", expires: "2026-12-31" },
    app_service: { reason: "no route-table consumer; codegen intentionally skips it", expires: "2026-12-31" },
    dm: { reason: "no route-table consumer; codegen intentionally skips it", expires: "2026-12-31" },
    feature_flags: { reason: "no route-table consumer; codegen intentionally skips it", expires: "2026-12-31" },
    federation: { reason: "no route-table consumer; codegen intentionally skips it", expires: "2026-12-31" },
    key_rotation: { reason: "no route-table consumer; codegen intentionally skips it", expires: "2026-12-31" },
    moderation: { reason: "no route-table consumer; codegen intentionally skips it", expires: "2026-12-31" },
    reactions: { reason: "no route-table consumer; codegen intentionally skips it", expires: "2026-12-31" },
    voice: { reason: "no route-table consumer; codegen intentionally skips it", expires: "2026-12-31" },
    delayed_events: {
        reason: "1 route; manager gates on an unstable feature and needs no table",
        expires: "2026-12-31",
    },
    vendor: {
        // 更正（2026-09-13 复核，见 docs/sdk-optimization/CONTRACT_ROUTE_TABLE_MAPPING_REVIEW_2026-09-13.md）：
        // 这 3 条是 assembly.rs:296-308 里迁移遗留的分组注册器，具体是 my_rooms / search_rooms /
        // search_recipients，分别由 room 与 search 侧调用；SDK 没有 src/vendor/ 目录，
        // 所以它们没有类型归属（RoomManager.ts:1221 的 /my_rooms 就是手写未约束的）。
        reason:
            "后端 vendor_route_manifest() 是迁移遗留的跨模块分组（my_rooms / search_rooms / search_recipients），" +
            "SDK 无对应目录；建议后端按功能模块改归属（复核报告 B-1）",
        expires: "2026-12-31",
    },
    // 下面两条是 C-1 排查（2026-09-13）的结论：它们不是"名字没对上"，而是**真的没人消费自己的表**，
    // 且原因可核验（命令见 reason）。不要用"再加一个别名"的方式把它们凑成 covered。
    friend_room: {
        // 更正：初版写的"表里只有旧路由、与 vendor 前缀不相交"是错的 —— 表里其实有 24 条
        // /_matrix/vendor/v1/friends/*（正是 src/friend 在调的族）。真实情况是"表比 ledger 少 5 条
        // 写方法（POST/PUT）"，且模块没 import 本表。修数据源 + 接线后再删本条，见复核报告 §2 / SDK-1。
        reason:
            "src/friend 手写 /_matrix/vendor/v1/friends/* 路径、未 import 本表；且表比 ledger 少 5 条写方法" +
            "（后端 ROUTE_CONTRACT.md 未列这些方法形态，复核报告 §2）—— 修数据源后应改为接线而非豁免",
        expires: "2026-12-31",
    },
    push_notification: {
        reason:
            "本表 10 条路由是 push 表（38 条）的**完全子集**（comm -23 无差集），" +
            "src/notifications 消费的是 push 表（PushPathPattern，见 notifications/index.ts:27），无人 import 本表；" +
            "要不要把 ledger 的 push_notification 也映射到 push 目录需要后端侧一起定",
        expires: "2026-12-31",
    },
};

/** The pre-existing heuristic for "this file talks to the server". */
const RUNTIME_CALL_RE = /withRetry\(|\.authedRequest\(|\.requestOtherUrl\(|\.request\(|http\.|this\.client\.\w+\(/;

function walk(dir, predicate = () => true, acc = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath, predicate, acc);
        } else if (predicate(fullPath)) {
            acc.push(fullPath);
        }
    }
    return acc;
}

function moduleSourceFiles(sdkDir, srcRoot) {
    const files = [];
    const dir = path.join(srcRoot, sdkDir);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        files.push(
            ...walk(
                dir,
                (filePath) =>
                    filePath.endsWith(".ts") &&
                    !filePath.endsWith(".d.ts") &&
                    !filePath.includes(`${path.sep}__generated__${path.sep}`),
            ),
        );
    }
    // Flat modules keep their implementation as a sibling FILE (`src/sliding-sync.ts`),
    // not a directory — the route table still lives in `src/sliding-sync/__generated__/`.
    for (const flat of [`${sdkDir}.ts`, `${sdkDir}.tsx`]) {
        const flatPath = path.join(srcRoot, flat);
        if (fs.existsSync(flatPath)) files.push(flatPath);
    }
    return files;
}

function listAllSources(srcRoot) {
    return walk(srcRoot, (filePath) => filePath.endsWith(".ts") && !filePath.endsWith(".d.ts"));
}

/**
 * 强证据（P3 / C-1 修正）：**src 下任何文件** import 了本模块的
 * `<sdkDir>/__generated__/route-table`。
 *
 * 前一版只在"模块自己的目录"里找导入，于是把**跨模块消费**误判成弱证据：
 *   - `sync` 的表被 `client-batch-requests.ts` / `client-secure-backup-requests.ts` 导入；
 *   - `account_data` 的表被 `client-batch-requests.ts` 导入；
 *   - `search` 的表被 `client-crypto-requests.ts` / `client-secure-backup-requests.ts` 导入；
 *   - `sliding_sync` 的表被 `room/RoomManager.ts` 导入（用它约束 simplified_msc3575 的 /sync）。
 * 这些 import 都真的用于 `StripV3<XPathPattern>` 式的路径断言，不是装饰。判定改为按
 * **import 说明符解析后的落点**比对（而不是文件名相似），指向别处的导入不算。
 */
export function findStrongConsumers(sdkDir, srcRoot = srcDir) {
    const target = `${sdkDir}/__generated__/route-table`;
    const hits = [];

    for (const filePath of listAllSources(srcRoot)) {
        const relativePath = normalizePath(path.relative(srcRoot, filePath));
        if (relativePath.startsWith(`${sdkDir}/__generated__/`)) continue;

        const content = fs.readFileSync(filePath, "utf8");
        const specifiers = content.matchAll(/from\s+"([^"]*__generated__\/route-table)(?:\.ts)?"/g);
        for (const match of specifiers) {
            const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), match[1]));
            if (resolved === target) {
                hits.push(relativePath);
                break;
            }
        }
    }

    return hits;
}

function normalizePath(value) {
    return value.replaceAll("\\", "/");
}

/** 该文件是否含运行时 HTTP 调用（弱证据的判据，沿用既有启发式）。 */
export function fileMakesHttpCalls(content) {
    return RUNTIME_CALL_RE.test(content);
}

/**
 * Collect consumer evidence for one module.
 *
 * 判定完全基于证据，不看类名（旧规则用 `needle.includes(bareManagerName)`，让
 * `SyncManager` 因 `"slidingsync".includes("sync")` 给 `sliding_sync` 授权 —— 一个
 * 位于别的模块、与 sliding sync 无关的 manager）：
 *
 *   strong — src 下任何文件导入本模块的 `__generated__/route-table`（跨模块也算）；
 *   weak   — 只有模块自己的文件在发 HTTP 请求，没有任何地方导入它的表。
 */
export function collectCodegenConsumers(sdkDir, srcRoot = srcDir) {
    const strong = findStrongConsumers(sdkDir, srcRoot);
    if (strong.length > 0) {
        return { strong, weak: [] };
    }

    const weak = [];
    for (const filePath of moduleSourceFiles(sdkDir, srcRoot)) {
        const content = fs.readFileSync(filePath, "utf8");
        if (fileMakesHttpCalls(content)) weak.push(normalizePath(path.relative(srcRoot, filePath)));
    }

    return { strong: [], weak };
}

/** Route count of a module's generated table (0 = no table generated). */
export function countRouteTableEntries(sdkDir, srcRoot = srcDir) {
    const routeTablePath = path.join(srcRoot, sdkDir, "__generated__", "route-table.ts");
    if (!fs.existsSync(routeTablePath)) return 0;
    return (fs.readFileSync(routeTablePath, "utf8").match(/\{\s*method:\s*"/g) || []).length;
}

/**
 * Classify one ledger module's codegen coverage.
 *
 * 判定口径（C-1 修正后）：
 *   - `hasCodegen > 0 && strong` → covered（src 下**任何**文件导入了本模块的 route-table）；
 *   - 只有弱证据（本模块自己在发 HTTP、但没人导入它的表）→ **不算覆盖**：生成表没有任何
 *     消费者，要么迁移成显式 import，要么进白名单写清原因。旧版把弱证据也算 covered，
 *     于是"100% 覆盖"里混着 `friend_room`（表里是 /_matrix/client/{r0,v1,v3}/friends/... 旧路由，
 *     代码走 /_matrix/vendor/v1，两者不相交）这种完全没人读的表；
 *   - `waived` 需要未过期的 reason；过期即红。
 */
export function classifyModuleCoverage(
    moduleName,
    { hasCodegen, consumers = { strong: [], weak: [] }, today = new Date() },
) {
    const waiver = WAIVED_MODULES[moduleName];
    // 区分两件不同的事：`table-without-consumer` = 生成了表但 src 下无人导入（friend_room /
    // push_notification 就是这种）；`no-table` = codegen 本来就不给这个模块生成表
    // （9 个 SKIP 模块，原因写在白名单里）。把两者混为一谈会让"弱证据"这栏失去信息量。
    const evidence =
        hasCodegen === 0 ? "no-table" : consumers.weak.length > 0 ? "table-without-consumer" : "no-consumer";

    if (hasCodegen > 0 && consumers.strong.length > 0) {
        return { status: "covered", evidence: "route-table-import" };
    }

    if (waiver) {
        if (new Date(waiver.expires) >= today) return { status: "waived", waiver, evidence };
        return { status: "missing", reason: "EXPIRED_WAIVER", waiver, evidence };
    }

    if (hasCodegen === 0) {
        return { status: "missing", reason: "NO_CODEGEN" };
    }
    return { status: "missing", reason: "NO_CONSUMER" };
}

function main() {
    const generatedIndex = JSON.parse(fs.readFileSync(generatedIndexPath, "utf8"));

    const summary = {
        codegenModules: 0,
        covered: 0,
        strong: [],
        weak: [],
        waived: 0,
        missing: 0,
        umbrella: [],
        missingModules: [],
        coveredModules: [],
        waivedModules: [],
    };

    const logLines = [];
    const log = (line) => logLines.push(line);
    log("");
    log("=== Module Coverage Analysis ===");

    const today = new Date();
    const usedWaivers = new Set();

    for (const [moduleName, moduleInfo] of Object.entries(generatedIndex.modules)) {
        const sdkDir = findSdkDirForModule(moduleName);
        const hasCodegen = countRouteTableEntries(sdkDir);
        if (hasCodegen > 0) summary.codegenModules += 1;

        if (moduleName === "assembly") {
            summary.umbrella.push({ moduleName, routes: moduleInfo.entry_count });
            log(
                `  UMBRELLA: ${moduleName} (${moduleInfo.entry_count} routes) -> governed by umbrella docs/manager mapping`,
            );
            continue;
        }

        const consumers = collectCodegenConsumers(sdkDir);
        const verdict = classifyModuleCoverage(moduleName, { hasCodegen, consumers, today });

        if (verdict.status === "covered") {
            summary.covered += 1;
            summary.coveredModules.push(moduleName);
            summary.strong.push(moduleName);
            continue;
        }

        if (verdict.status === "waived") {
            summary.waived += 1;
            summary.waivedModules.push(moduleName);
            usedWaivers.add(moduleName);
            // 弱证据（本模块自己在发 HTTP、但没人 import 它的表）单独记一栏：
            // "覆盖率 100%" 不该掩盖"这张表没人读"。
            if (verdict.evidence === "table-without-consumer") summary.weak.push(moduleName);
            log(
                `  WAIVED: ${moduleName} (${moduleInfo.entry_count} routes) -> ${verdict.waiver.reason}; expires ${verdict.waiver.expires}`,
            );
            continue;
        }

        summary.missing += 1;
        summary.missingModules.push({
            moduleName,
            routes: moduleInfo.entry_count,
            reason: verdict.reason,
            sdkDir,
            codegenRoutes: hasCodegen,
        });
        if (verdict.reason === "EXPIRED_WAIVER") {
            log(
                `  EXPIRED_WAIVER: ${moduleName} (${moduleInfo.entry_count} routes) -> expired ${verdict.waiver.expires} (${verdict.waiver.reason})`,
            );
        } else if (verdict.reason === "NO_CONSUMER") {
            log(
                `  NO_CONSUMER: ${moduleName} (${moduleInfo.entry_count} routes) -> generated ${sdkDir}/__generated__/route-table.ts (${hasCodegen} endpoints) has no consumer`,
            );
        } else {
            log(`  NO_CODEGEN: ${moduleName} (${moduleInfo.entry_count} routes)`);
        }
    }

    // A waiver that is no longer needed is debt of its own: the module either gained real
    // coverage (delete the entry) or was renamed (the waiver now protects nothing).
    const unusedWaivers = Object.keys(WAIVED_MODULES).filter((name) => !usedWaivers.has(name));

    const effectiveTotal = summary.covered + summary.missing;
    const coverageRate = effectiveTotal === 0 ? "100.0" : ((summary.covered / effectiveTotal) * 100).toFixed(1);

    const payload = {
        codegenModules: summary.codegenModules,
        covered: summary.covered,
        coverageRate: Number(coverageRate),
        strong: summary.strong,
        weak: summary.weak,
        waived: summary.waived,
        waivedModules: summary.waivedModules,
        missing: summary.missing,
        missingModules: summary.missingModules,
        unusedWaivers,
        umbrella: summary.umbrella,
    };

    // 供 quality-report.mjs 等消费方复用同一份判定，避免"报告里的数字"和"门禁的判定"漂移
    if (shouldEmitJson) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        if (summary.missing > 0 || unusedWaivers.length > 0) process.exitCode = 1;
        return;
    }

    for (const line of logLines) console.log(line);

    console.log(`\nCOVERED (route-table import, ${summary.strong.length}): ${summary.strong.join(", ")}`);
    console.log(
        `WAIVED 且**有表没人读**（弱证据，${summary.weak.length}）: ` + `${summary.weak.join(", ") || "（无）"}`,
    );
    console.log(`Covered: ${summary.covered}, Waived: ${summary.waived}, Missing: ${summary.missing}`);
    console.log(
        `Coverage rate: ${coverageRate}% (${summary.covered}/${effectiveTotal} modules consume codegen; ` +
            `${summary.waived} documented non-consumer(s))`,
    );

    if (unusedWaivers.length > 0) {
        console.error(`\nUnused waiver(s) in WAIVED_MODULES — delete them: ${unusedWaivers.join(", ")}`);
    }

    if (summary.missing > 0 || unusedWaivers.length > 0) {
        process.exitCode = 1;
    }
}

// Guarded so the module can be imported by tests (which exercise the exported helpers)
// without running the gate and mutating `process.exitCode`.
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
