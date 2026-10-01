#!/usr/bin/env node
/*
 * 契约差集门禁（阶段 3 · SDK-2）。
 *
 * 背景（见 docs/sdk-optimization/CONTRACT_ROUTE_TABLE_MAPPING_REVIEW_2026-09-13.md）：
 * SDK 有两个**互不同源**的契约镜像 ——
 *   - `docs/api-contract/generated/modules/<module>.json`：后端 ledger（启动时校验过）的镜像；
 *   - `src/<dir>/__generated__/route-table.ts`：由后端 `ROUTE_CONTRACT.md`（人工文档）
 *     + 该目录既有条目渲染。
 * 两者已漂移到 24/49 个模块：`room` 表多 53 条（甚至混进 friend 的路由）、`push` 表多 10 条、
 * `rendezvous` 出现路径族漂移、`friend` 表少 5 条写方法（而模块正在调它们）。
 *
 * 本门禁的作用不是立刻消灭漂移，而是**让每一处漂移都有人做过判断**：
 *   - `sdk-only`  —— 表里有、ledger 里没有（历史遗留条目 / 人工补充），必须登记 reason + 到期日；
 *   - `ledger-only` —— ledger 里有、表里没有（文档漏了、路径族变了），同样必须登记；
 *   - 已修好的条目要**随手删掉登记**，否则算 stale（和定时器门禁同款机制）。
 *   - **孤立表**：目录已不对应任何 ledger 模块（后端整模块被删），且表内条目在全局
 *     ledger 也查不到 → 按 `sdk-only` 记账。2026-10-01 之前只从 ledger 模块反查目录，
 *     这种情形会被整目录静默跳过（`verification_routes` 被删后 12 条死路由长期全绿）。
 *     umbrella 聚合页（auth/README）显式豁免。
 *
 * 只检查**有 route-table 的目录**：没有表的模块（admin/voice/… 9 个 SKIP 模块）由
 * `check-manager-codegen-coverage.mjs` 的白名单负责，不在这里重复记账。
 *
 * 比对单位是 **SDK 目录**，不是 ledger 模块：映射是多对一的（`rendezvous` 目录同时承载
 * ledger 的 `msc4108_rendezvous` 与 `rendezvous`，`push` 目录同时承载 `push` 与
 * `push_notification`），按模块比会把"同目录兄弟模块的路由"误报成漂移。因此一个表条目
 * 只要被**任一**映射到该目录的 ledger 模块声明过，就算有 ledger 背书。
 *
 * 用法：
 *   node scripts/quality/check-contract-drift.mjs           # 门禁
 *   node scripts/quality/check-contract-drift.mjs --json    # 供 quality-report.mjs 消费
 *   node scripts/quality/check-contract-drift.mjs --list    # 列出全部差集与处置
 */

import fs from "node:fs";
import path from "node:path";

// 映射必须与"生成 route-table 的模块→目录映射"完全一致，因此直接复用覆盖门禁的实现
import { findLedgerModulesForSdkDir, findSdkDirForModule } from "../contract-module-map.mjs";

const rootDir = process.cwd();
const registryPath = path.join(rootDir, "scripts", "quality", "contract-drift-registry.json");
const modulesDir = path.join(rootDir, "docs", "api-contract", "generated", "modules");
const codegenPath = path.join(rootDir, "scripts", "sdk-contract-codegen.mjs");

const shouldList = process.argv.includes("--list");
const shouldEmitJson = process.argv.includes("--json");

function writeStdout(line = "") {
    process.stdout.write(`${line}\n`);
}

function writeStderr(line = "") {
    process.stderr.write(`${line}\n`);
}

/** 从一个 route-table.ts 里抽出 `METHOD path` 集合。 */
export function readRouteTable(sdkDir, root = rootDir) {
    const file = path.join(root, "src", sdkDir, "__generated__", "route-table.ts");
    if (!fs.existsSync(file)) return null;
    const content = fs.readFileSync(file, "utf8");
    return new Set(
        [...content.matchAll(/\{\s*method:\s*"([A-Z]+)",\s*path:\s*"([^"]+)"\s*\}/g)].map(
            (match) => `${match[1]} ${match[2]}`,
        ),
    );
}

/** 从一个 ledger 模块镜像里抽出 `METHOD path` 集合。 */
export function readLedgerManifest(moduleName, root = rootDir) {
    const file = path.join(root, "docs", "api-contract", "generated", "modules", `${moduleName}.json`);
    if (!fs.existsSync(file)) return null;
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    return new Set(entries.map((entry) => `${String(entry.method).toUpperCase()} ${entry.path}`));
}

/**
 * 该目录的模块文档是否声明 `umbrella: true`。
 *
 * umbrella 页（`auth.md`、`README.md`）显式声明不参与 1:1 ledger pin，其路由表是
 * 多个 ledger 模块的聚合 + 人工补充，因此孤立表检查对它们不适用（否则 `auth`
 * 的 MSC3814/MSC4108 等 SDK-only 条目会被误报）。
 */
export function isUmbrellaDoc(sdkDir, root = rootDir) {
    const docBase = sdkDir === "third-party" ? "thirdparty" : sdkDir;
    const docPath = path.join(root, "docs", "api-contract", `${docBase}.md`);
    if (!fs.existsSync(docPath)) return false;
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(fs.readFileSync(docPath, "utf8"));
    return frontmatter ? /^umbrella:\s*true\s*$/m.test(frontmatter[1]) : false;
}

/**
 * 计算一个模块的双向差集。
 *
 * 导出以便负向测试：一个"永远返回空差集"的实现等于没有门禁。
 */
export function diffModule(sdkDir, ledgerEntries, tableEntries) {
    const sdkOnly = [...tableEntries].filter((entry) => !ledgerEntries.has(entry)).sort();
    const ledgerOnly = [...ledgerEntries].filter((entry) => !tableEntries.has(entry)).sort();
    return { sdkOnly, ledgerOnly };
}

export function driftKey(moduleName, kind, entry) {
    return `${moduleName}:${kind}:${entry}`;
}

export function readRegistry(filePath = registryPath) {
    if (!fs.existsSync(filePath)) return { entries: [], generatedAt: null };
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return { entries: Array.isArray(payload.entries) ? payload.entries : [], generatedAt: payload.generatedAt ?? null };
}

/**
 * 判定一条差集；`ok === false` 会让门禁失败。
 *
 * 登记表里出现、但差集里已经没有的条目 → `stale`（说明漂移被修好了，登记该删）。
 */
export function evaluateDrift(key, registry, today = new Date()) {
    const entry = registry.entries.find((candidate) => candidate.key === key);
    if (entry === undefined) {
        return { ok: false, key, detail: "未登记" };
    }
    if (typeof entry.reason !== "string" || entry.reason.length === 0) {
        return { ok: false, key, detail: "登记项缺少 reason" };
    }
    if (entry.expires !== undefined && new Date(entry.expires) < today) {
        return { ok: false, key, detail: `登记项已过期（${entry.expires}）` };
    }
    return { ok: true, key, detail: entry.reason };
}

/**
 * 收集仓库当前的全部差集（含孤立表），供门禁与负向测试共用一份实现。
 *
 * 从**磁盘上存在的 route-table 目录**出发，而不是只从 ledger 模块反查：后者在
 * "后端整模块被删除"时会静默跳过该目录（2026-10-01 实测：后端删
 * `verification_routes` 后，`src/verification/__generated__/route-table.ts` 的
 * 12 条死路由从未进入差集，门禁长期全绿）。孤立表若含全局 ledger（含 assembly）
 * 里查不到的条目，就按 `sdk-only` 记账、必须登记处置。
 */
export function collectObservedDrift(root = rootDir) {
    const index = JSON.parse(
        fs.readFileSync(path.join(root, "docs", "api-contract", "generated", "index.json"), "utf8"),
    );
    const ledgerModuleNames = Object.keys(index.modules).filter((name) => name !== "assembly");
    // 全局 ledger 键集必须包含 `assembly`——它是 ledger 的兜底分组，
    // profile/dehydrated-device 等大量路由都归在它名下。
    const globalLedger = new Set();
    for (const moduleName of Object.keys(index.modules)) {
        for (const entry of readLedgerManifest(moduleName, root) ?? []) globalLedger.add(entry);
    }

    const tableDirs = fs
        .readdirSync(path.join(root, "src"), { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
        .filter((sdkDir) => readRouteTable(sdkDir, root) !== null)
        .sort();

    const observed = [];
    const orphanTables = [];
    for (const sdkDir of tableDirs) {
        const table = readRouteTable(sdkDir, root);
        const mappedModules = findLedgerModulesForSdkDir(sdkDir, ledgerModuleNames);
        if (mappedModules.length === 0) {
            // umbrella 聚合页（auth/README）显式不参与 1:1 pin，其表是跨模块聚合，
            // 孤立表检查对它们不适用。
            if (isUmbrellaDoc(sdkDir, root)) continue;
            const sdkOnly = [...table].filter((entry) => !globalLedger.has(entry)).sort();
            if (sdkOnly.length > 0) orphanTables.push({ sdkDir, unbacked: sdkOnly.length });
            for (const entry of sdkOnly) observed.push({ sdkDir, kind: "sdk-only", entry });
            continue;
        }
        // 同一目录的兄弟 ledger 模块取并集（多对一映射，见文件头注释）
        const ledgerUnion = new Set();
        for (const moduleName of mappedModules) {
            for (const entry of readLedgerManifest(moduleName, root) ?? []) ledgerUnion.add(entry);
        }
        const { sdkOnly, ledgerOnly } = diffModule(sdkDir, ledgerUnion, table);
        for (const entry of sdkOnly) observed.push({ sdkDir, kind: "sdk-only", entry });
        for (const entry of ledgerOnly) observed.push({ sdkDir, kind: "ledger-only", entry });
    }
    return { observed, orphanTables, ledgerModuleNames };
}

function main() {
    const registry = readRegistry();
    const today = new Date();

    const { observed, orphanTables, ledgerModuleNames } = collectObservedDrift();
    const skippedNoTable = [];
    for (const moduleName of ledgerModuleNames) {
        const sdkDir = findSdkDirForModule(moduleName);
        if (readRouteTable(sdkDir) === null) skippedNoTable.push(moduleName);
    }

    const logLines = [];
    const log = (line) => logLines.push(line);
    const failures = [];
    for (const item of observed) {
        const key = driftKey(item.sdkDir, item.kind, item.entry);
        const verdict = evaluateDrift(key, registry, today);
        if (shouldList) log(`${verdict.ok ? "ok " : "RED"} ${key} -> ${verdict.detail}`);
        if (!verdict.ok) failures.push({ key, verdict });
    }

    const observedKeys = new Set(observed.map((item) => driftKey(item.sdkDir, item.kind, item.entry)));
    const staleEntries = registry.entries.filter((entry) => !observedKeys.has(entry.key)).map((entry) => entry.key);

    const perModule = new Map();
    for (const item of observed) {
        const bucket = perModule.get(item.sdkDir) ?? { sdkOnly: 0, ledgerOnly: 0 };
        bucket[item.kind === "sdk-only" ? "sdkOnly" : "ledgerOnly"] += 1;
        perModule.set(item.sdkDir, bucket);
    }
    for (const item of observed) {
        log(
            `  ${item.kind === "sdk-only" ? "SDK 表有、ledger 无" : "ledger 有、SDK 表无"}: ${item.sdkDir} ${item.entry}`,
        );
    }

    const payload = {
        driftedModules: perModule.size,
        sdkOnly: observed.filter((item) => item.kind === "sdk-only").length,
        ledgerOnly: observed.filter((item) => item.kind === "ledger-only").length,
        registered: registry.entries.length,
        stale: staleEntries,
        modulesWithoutTable: skippedNoTable,
        orphanTables,
        perModule: Object.fromEntries(perModule),
    };

    if (shouldEmitJson) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        if (failures.length > 0 || staleEntries.length > 0) process.exitCode = 1;
        return;
    }

    for (const line of logLines) writeStdout(line);
    writeStdout(
        `\n[contract-drift] ${payload.driftedModules} 个模块有差集：` +
            `SDK 表多 ${payload.sdkOnly} 条、ledger 多 ${payload.ledgerOnly} 条；已登记 ${payload.registered} 条`,
    );
    if (orphanTables.length > 0) {
        writeStdout(
            `[contract-drift] 孤立路由表（目录已无任何 ledger 模块映射）：` +
                orphanTables.map((table) => `${table.sdkDir}(${table.unbacked} 条无背书)`).join("、"),
        );
    }

    if (failures.length > 0) {
        writeStderr(`[contract-drift] 门禁失败：${failures.length} 处差集没有有效登记`);
        for (const { key, verdict } of failures) writeStderr(`- ${key} -> ${verdict.detail}`);
        writeStderr("[contract-drift] 见 scripts/quality/contract-drift-registry.json");
        process.exitCode = 1;
    }
    if (staleEntries.length > 0) {
        writeStderr(`[contract-drift] 有 ${staleEntries.length} 条登记已不再对应任何差集（说明漂移已修好），请删除：`);
        for (const key of staleEntries.slice(0, 40)) writeStderr(`- ${key}`);
        if (staleEntries.length > 40) writeStderr(`- …（共 ${staleEntries.length} 条）`);
        process.exitCode = 1;
    }
    if (failures.length === 0 && staleEntries.length === 0) {
        writeStdout(`[contract-drift] 门禁通过（${observed.length} 处差集全部有处置说明）`);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
