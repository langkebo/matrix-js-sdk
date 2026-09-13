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
const generatedIndexPath = path.join(rootDir, "docs", "api-contract", "generated", "index.json");
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

function main() {
    const index = JSON.parse(fs.readFileSync(generatedIndexPath, "utf8"));
    const registry = readRegistry();
    const today = new Date();

    const observed = [];
    const skippedNoTable = [];
    for (const moduleName of Object.keys(index.modules)) {
        if (moduleName === "assembly") continue;
        const sdkDir = findSdkDirForModule(moduleName);
        if (readRouteTable(sdkDir) === null) skippedNoTable.push(moduleName);
    }

    const ledgerModuleNames = Object.keys(index.modules).filter((name) => name !== "assembly");
    const sdkDirs = [...new Set(ledgerModuleNames.map((name) => findSdkDirForModule(name)))].sort();
    for (const sdkDir of sdkDirs) {
        const table = readRouteTable(sdkDir);
        if (table === null) continue;
        // 同一目录的兄弟 ledger 模块取并集（多对一映射，见文件头注释）
        const ledgerUnion = new Set();
        for (const moduleName of findLedgerModulesForSdkDir(sdkDir, ledgerModuleNames)) {
            for (const entry of readLedgerManifest(moduleName) ?? []) ledgerUnion.add(entry);
        }
        const { sdkOnly, ledgerOnly } = diffModule(sdkDir, ledgerUnion, table);
        for (const entry of sdkOnly) observed.push({ sdkDir, kind: "sdk-only", entry });
        for (const entry of ledgerOnly) observed.push({ sdkDir, kind: "ledger-only", entry });
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
            `  ${item.kind === "sdk-only" ? "SDK 表有、ledger 无" : "ledger 有、SDK 表无"}: ${item.moduleName} ${item.entry}`,
        );
    }

    const payload = {
        driftedModules: perModule.size,
        sdkOnly: observed.filter((item) => item.kind === "sdk-only").length,
        ledgerOnly: observed.filter((item) => item.kind === "ledger-only").length,
        registered: registry.entries.length,
        stale: staleEntries,
        modulesWithoutTable: skippedNoTable,
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
