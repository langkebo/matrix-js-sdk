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
 *
 * 导出给 spec 消费：断言跟着这张表走，就不会再出现"waiver 早已移除、spec 还硬写着模块名"
 * 那种长期红灯（`push_notification` 就是这么把 `codegen-coverage-gate.spec.ts` 挂了几天的，
 * 见审计文档 §7.11）。
 */
export const WAIVED_MODULES = {
    // 注（2026-10-15）：**本表已清空** —— 最后一个条目 `admin`（179 条）已收编：
    // 其 221 处 `this.adminRequest` 调用全部接入 `apu()` 编译期断言（7 张表 union + 6 种前缀剥离），
    // 见 `src/admin/admin-base-manager.ts` 的 `StripAdminModule` / `AdminScopedPath`。
    // 服务端面模块（federation）另见 `SERVER_ONLY_MODULES`（非 WAIVED）。
    // 注（2026-10-15）：此处原有 `app_service` 的 waiver。回源核对后发现它**不是**纯服务端面：
    // 39 条里 17 条是 `/_synapse/admin/v1/appservices*`（admin 面）、12 条 `/_matrix/app/v1/*`（AS 面）、
    // 10 条 `/_matrix/client/*`（客户端面，含 7 条 `proxy/{as_id}/{*path}` 通配代理）——
    // 而 `src/app-service/index.ts` 的 21 处路径与该模块的 admin/客户端面**逐条对应**
    // （4 处 thirdparty 路由另属 third-party 模块表）。故接入 route-table 后移除 waiver。
    // 注（2026-10-15）：`federation` 已从 WAIVED **移入 `SERVER_ONLY_MODULES`**（见文件上方该常量的注释）。
    // 依据：逐条实测其 55 条路径全为 server-to-server / key-server API，客户端 SDK 不承担
    // ⇒ 属"本口径不适用"，而非"有期限的欠账"。故不再挂 waiver。
    // 注（2026-10-15）：此处原有 `reactions` 的 waiver。该模块的 manager 是薄包装
    // （`src/reactions/index.ts` 委托 `client.reactToMessage` → `RoomEventsManager.sendReaction`），
    // 真正的路径字面量在 `src/room-events/index.ts` 的
    // `utils.encodeUri("/rooms/$roomId/send/m.reaction/$txnId", …)`，已在那里接入 `PathAssert`
    // 断言（借 reactions 模块的表），故移除 waiver。
    // 注（2026-10-15）：`dm` / `feature_flags` / `key_rotation` 的 waiver 已移除 —— 三者的 manager
    // 自持前缀与字面量相对路径（dm/key_rotation = VendorPrefix；feature_flags = AdminPrefix.V1，
    // 均与契约表前缀逐字一致），已接入生成的 route-table 并做 PathAssert 编译期断言。
    // 注（2026-10-06）：此处原有 `push_notification` 的 waiver，理由是「本表 10 条是 push 表 38 条的
    // **完全子集**」。实测该理由**不成立**：notifications 表 8 条与 push 表 17 条**交集为空**
    // （`/push/devices`、`/push/send` 只存在于 notifications 表；push 表只含 notifications/pushers/pushrules）。
    // 也就是说，这是把一条「有表没人读」用错误理由豁免掉了 —— 纸面 waiver。
    // 现已让 `src/notifications/index.ts` 真正消费本表（push/devices ×3 + push/send），故移除 waiver。
    // 注（2026-10-15）：此处原有 `delayed_events` 的 waiver，理由是「1 route; manager gates on
    // an unstable feature and needs no table」。该理由**已过期**：后端 2026-10-14 把该族补齐到
    // 7 条（列表 / 单条 / body 动作 / 3 条 action-in-PATH / 专用调度），且 SDK 有真实消费者
    // `DelayedEventsManager`（6 个公开方法）。造成"无表"的真因是**登记缺失**——模块既不在
    // `LEDGER_MODULE_ALIASES`，后端文档章节也未映射到 SDK 目录，于是两条 codegen 通道都取不到它。
    // 现已补 alias + 章节映射 + `StripMsc4140`，manager 路径改为编译期 segment 级断言，故移除 waiver。
    // 注（2026-10-15）：此处原有 `invite_blocklist` 的 waiver，理由是「codegen 按**后端**
    // ROUTE_CONTRACT.md 的章节枚举模块，而该文档按源文件分组、没有 invite 章节 ⇒ 无可生成的表」。
    // 该理由**不成立**：模块枚举源实际是**本仓** `CONTRACT_INDEX.md` 的文档链接，路由条目另走
    // ledger 通道（`LEDGER_MODULE_ALIASES` 早有 `invite-blocklist → invite_blocklist`）。
    // 建页 + manager 接 PathAssert 断言后即受管辖，故移除 waiver（与 `delayed_events` 同型订正）。
    // 注（2026-10-15）：此处原有 `cas` 的 waiver（"表 17 条有表没人读，因 CasManager 经 resolvePath
    // 运行时二元前缀拼接、从不 import route-table"）。该描述**与实际代码不符**：CasManager 的 11 处路径
    // 构造点都是「方法内局部常量 `const path = "…"`」或字面量，并未做运行时前缀拼接。现已在
    // `const path` 声明处与字面量处接入 `apu()`（`StripAdminV1`）与 `cpu()`（`StripCasProtocol`）断言，
    // 故移除 waiver。
};

/**
 * **服务端面模块**：其路由由 homeserver（server-to-server / key-server）消费，客户端 SDK 天然
 * 不承担 ⇒ 不属于本门禁「应有消费点」的口径。**与 WAIVED 的区别**：WAIVED 隐含"本应覆盖、
 * 目前暂缺"（是有期限的欠账）；SERVER_ONLY 是"本口径不适用"（不是欠账）。
 *
 * 与 `UMBRELLA`（assembly）并列：单列一类、不计入 WAIVED，也不进"未受 route-table 约束的路由"计数。
 * 每条必须带**实测证据**——不得凭印象归类（这是本仓反复踩过的坑：豁免理由常与事实不符）。
 */
export const SERVER_ONLY_MODULES = {
    federation: {
        reason: "server-to-server / key-server API：由 homeserver 之间与 key server 调用，客户端 SDK 不承担",
        evidence:
            "2026-10-15 逐条实测全部 55 条路径前缀：_matrix/federation/v1 36 + v2 7 + unstable 1、" +
            "_synapse/federation/* 7、_matrix/key/v2 4 —— **无**任何 /_matrix/client/* 或 /_synapse/admin/* 混入",
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

/** `from "<...>__generated__/route-table"`（可选 `.ts` 后缀）—— 只取说明符，落点稍后解析。 */
const ROUTE_TABLE_IMPORT_RE = /from\s+"([^"]*__generated__\/route-table)(?:\.ts)?"/g;

/**
 * `srcRoot` → 「route-table 导入索引」：`Map<文件相对路径, 该文件解析后的落点[]>`，
 * 插入顺序即 walk 顺序（保证命中顺序与逐模块扫描时一致）。
 *
 * **为什么要先建索引**：`main()` 会为**每一个** ledger 模块调用一次 `findStrongConsumers()`。
 * 早先的实现每次都重走 `src/` 全量文件、逐个 `readFileSync` ⇒ **O(模块 × 文件)**
 * （49 个模块 × 625 个 `.ts` ≈ **3 万次读取**）。在 file-broker 沙箱里每次读都是一次 IPC，
 * 实测单项门禁要 **≈28 分钟**：前台直跑会被 SIGKILL（exit 137），后台挂到 15 分钟看不出进展，
 * **极易被误判成 hang 或回归**（见审计文档 §7.8）。索引把读盘降到 **O(文件)**——
 * 扫一次、按解析后的落点归并，判定口径一字未改。
 *
 * 缓存按 `srcRoot` 分键：spec 用临时目录建树，各 root 互不串味；`--json` 的下游
 * （`quality-report.mjs`）是**另起进程**调用的，不共享本进程的索引。
 *
 * 实测（2026-10-07）：`src/` 下 `__generated__` 目录里的 **163 个** `.ts` 文件没有任何一个
 * 导入 route-table，对判定零贡献；但**仍然照读**——原实现的"排除"只针对被查模块自己的
 * `__generated__/`，若在这里一刀切掉全部生成文件，就是顺手改了判定口径。读盘量从 3 万降到 625
 * 已经把主要成本消掉了，不再为 20% 的边际收益动语义。
 */
const routeTableImportIndex = new Map();

function getRouteTableImportIndex(srcRoot) {
    const cached = routeTableImportIndex.get(srcRoot);
    if (cached) return cached;

    const index = new Map();
    for (const filePath of listAllSources(srcRoot)) {
        const relativePath = normalizePath(path.relative(srcRoot, filePath));
        const dir = path.posix.dirname(relativePath);
        const targets = new Set();
        for (const match of fs.readFileSync(filePath, "utf8").matchAll(ROUTE_TABLE_IMPORT_RE)) {
            targets.add(path.posix.normalize(path.posix.join(dir, match[1])));
        }
        // 不含 route-table 导入的文件永远不可能是命中项，不必进索引。
        if (targets.size > 0) index.set(relativePath, [...targets]);
    }

    routeTableImportIndex.set(srcRoot, index);
    return index;
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
 *
 * 判定口径本身不变；变的是**取数方式**——导入索引按 `srcRoot` 缓存，同一进程内重复查询不再读盘。
 */
/**
 * 聚合契约出口：**对「本模块有没有真实消费者」零证据**，必须排除在强证据之外。
 *
 * `src/contract/index.ts` 把全部 39 张 route-table 统一再导出，供 `matrix-js-sdk/contract`
 * 这个公开入口使用。它的 import 与任何单个模块是否被真正使用**无关** ——
 * 若把它算作强证据，等于给**每一个**有表的模块凭空发一张 covered 通行证，
 * 把 `cas` 这类「有表没人读」的豁免静默洗白成 covered。
 *
 * 而 `cas` 的豁免注释明确写着「勿用『凑一个别名导入』的方式洗白成 covered」
 * （见本文件 WAIVED_MODULES.cas 上方的说明）—— 聚合出口正是那种别名导入的极端形式
 * （一个文件导入了全部表）。所以这里必须显式排除，否则新增公开入口会悄悄
 * 让整张豁免清单失效。
 *
 * 判定口径不变：真正消费某张表的 manager 仍会被 `findStrongConsumers` 认出来；
 * 变的只是「统一再导出全部表的文件不算消费者」。
 */
const AGGREGATE_CONTRACT_SOURCES = new Set(["contract/index.ts"]);

export function findStrongConsumers(sdkDir, srcRoot = srcDir) {
    const target = `${sdkDir}/__generated__/route-table`;
    const ownGeneratedPrefix = `${sdkDir}/__generated__/`;
    const hits = [];

    for (const [relativePath, targets] of getRouteTableImportIndex(srcRoot)) {
        // 本模块自己的生成文件不算消费者（它们就在 target 旁边）。
        if (relativePath.startsWith(ownGeneratedPrefix)) continue;
        // 聚合再导出文件不算消费者（对「本模块是否被使用」零证据）。
        if (AGGREGATE_CONTRACT_SOURCES.has(relativePath)) continue;
        if (targets.includes(target)) hits.push(relativePath);
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
        serverOnly: [],
        // 「未受 route-table 约束的路由条数」—— 口径见输出段注释（2026-10-13 新增）。
        waivedRoutes: 0,
        umbrellaRoutes: 0,
        serverOnlyRoutes: 0,
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
            summary.umbrellaRoutes += moduleInfo.entry_count;
            log(
                `  UMBRELLA: ${moduleName} (${moduleInfo.entry_count} routes) -> governed by umbrella docs/manager mapping`,
            );
            continue;
        }

        const serverOnly = SERVER_ONLY_MODULES[moduleName];
        if (serverOnly) {
            summary.serverOnly.push({ moduleName, routes: moduleInfo.entry_count, reason: serverOnly.reason });
            summary.serverOnlyRoutes += moduleInfo.entry_count;
            log(`  SERVER_ONLY: ${moduleName} (${moduleInfo.entry_count} routes) -> ${serverOnly.reason}`);
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
            summary.waivedRoutes += moduleInfo.entry_count;
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
        // 路由维度：WAIVED 模块多少条路由**没有** route-table 约束（模块维度之外的第二个视角）
        waivedRoutes: summary.waivedRoutes,
        umbrellaRoutes: summary.umbrellaRoutes,
        serverOnly: summary.serverOnly,
        serverOnlyRoutes: summary.serverOnlyRoutes,
        // 含 WAIVED 的模块维度覆盖率 —— 与 coverageRate（剔除 WAIVED）并列，防止单看 100.0% 被误导
        moduleCoverageRateWithWaivers:
            summary.covered + summary.waived === 0
                ? 100
                : Number(((summary.covered / (summary.covered + summary.waived)) * 100).toFixed(1)),
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
    // 2026-10-13：把「模块维度覆盖率」与「路由维度受约束率」分开打印。
    //
    // 原输出只有 `Coverage rate: 100.0% (38/38 ...)` —— 分母**排除了 WAIVED**，于是
    // 10 个 WAIVED 模块（共 92 条路由）的"零类型约束"被一个孤零零的 100.0% 完全掩盖，
    // 极易被读成"路径契约已全覆盖"。现在三档并列 + 明确给出未受约束路由条数。
    const coveredPlusWaived = summary.covered + summary.waived;
    const moduleCoverage = coveredPlusWaived === 0 ? "100.0" : ((summary.covered / coveredPlusWaived) * 100).toFixed(1);
    console.log(
        `Coverage rate: ${coverageRate}% (${summary.covered}/${effectiveTotal} modules consume codegen; ` +
            `${summary.waived} documented non-consumer(s))`,
    );
    console.log(
        `  ↳ 含 WAIVED 的模块维度: ${moduleCoverage}% (${summary.covered}/${coveredPlusWaived}); ` +
            `**无 route-table 约束的路由 ${summary.waivedRoutes} 条**（WAIVED ${summary.waived} 个模块）` +
            `${summary.umbrellaRoutes > 0 ? `；另有 umbrella ${summary.umbrellaRoutes} 条由文档/管理器映射治理` : ""}` +
            `${summary.serverOnlyRoutes > 0 ? `；server-only ${summary.serverOnlyRoutes} 条属服务端面（SDK 不承担，本口径不适用）` : ""}`,
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
