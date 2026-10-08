#!/usr/bin/env node
/**
 * check-contract-entrypoint.mjs —— 契约聚合出口门禁
 *
 * 背景:
 *   `pnpm run contract:codegen` 把后端 route ledger 生成为
 *   `src/<module>/__generated__/route-table.ts`（当前 39 张表）。这些常量此前
 *   没有任何公开入口，消费者只能用**相对路径**深度导入 SDK 源文件，
 *   例如 `matrix-js-sdk/src/room/__generated__/route-table`。
 *
 *   那种写法有两个真实危害:
 *     1. 把消费者绑死在 SDK 的**源码目录布局**上；`package.json#exports` 完全绕过，
 *        因此 SDK 也无法在不破坏下游的前提下调整目录。
 *     2. 相对路径解析到的是**另一个 SDK 检出**（工作区 sibling），与运行时从
 *        tarball/node_modules 解析到的 SDK 不是同一份产物 —— 同一构建里混入两个版本。
 *
 *   `src/contract/index.ts` 就是为消除上述写法而设的聚合出口（`matrix-js-sdk/contract`）。
 *   它是**手写文件**（不在 `__generated__/` 下），因此存在漂移风险: 新增一个模块的
 *   route-table 后忘记登记，消费者就看不到它。本门禁把这种漂移变成 CI 失败。
 *
 * 判定判据（双向严格一致）:
 *   · 磁盘上每个 `src/<mod>/__generated__/route-table.ts` 都必须在聚合表里出现
 *   · 聚合表里的每个模块都必须有对应的 route-table 文件（不能登记幽灵模块）
 *   · 聚合表的 import 集合与键集合必须完全一致（防止「登记了键却指向别的常量」）
 *   · 不得出现重复 `(method, path)`（重复说明后端契约或 codegen 有问题）
 *   · `package.json#exports["./contract"]` 必须指向聚合入口的 lib 产物
 *
 * 退出码:
 *   0 = 双向一致且无重复路由
 *   1 = 存在任一不一致
 */

import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();

const ENTRYPOINT_REL = "src/contract/index.ts";
const ENTRYPOINT_EXPORT_KEY = "./contract";
const EXPECTED_IMPORT_TARGET = "./lib/contract/index.js";
const EXPECTED_TYPES_TARGET = "./lib/contract/index.d.ts";

const REMEDIATION_TEXT = [
    "[contract-entrypoint] remediation hints:",
    "- 新增/删除模块的 route-table 后，同步更新 src/contract/index.ts 的 import 与 SDK_CONTRACT_ROUTE_TABLES 键",
    "- 聚合出口必须是 matrix-js-sdk/contract，不要让消费者深度导入 src/**/__generated__",
    "- 出现重复 (method, path) 时先查后端 ledger 与 codegen，不要在本门禁里加豁免",
    "- 重跑: pnpm quality:contract-entrypoint",
].join("\n");

// ---------------------------------------------------------------- pure helpers

/**
 * 解析聚合入口里 `SDK_CONTRACT_ROUTE_TABLES = { ... }` 的键集合。
 *
 * 键的引号是可选的：Prettier 会把合法标识符的键**去引号**（`"auth"` → `auth`），
 * 只对含 `-` 的键保留引号（`"account-data"`）。两种形态都必须接受 ——
 * 只认带引号的那种会在一次 `prettier --write` 之后静默丢掉大半模块
 * （实测：本项目 39 个模块里 28 个的键是合法标识符）。
 *
 * 只在对象字面量正文里匹配，因此文档注释中举例的
 * `SDK_CONTRACT_ROUTE_TABLES.room` 不会被误收。
 */
export function parseEntrypointModuleKeys(source) {
    const blockMatch = source.match(/SDK_CONTRACT_ROUTE_TABLES\s*=\s*\{(.*?)\n\}\s*as const/s);
    if (!blockMatch) return [];
    const body = blockMatch[1];
    const keys = [];
    const re = /^\s*"?([A-Za-z_$][\w$.-]*)"?\s*:\s*([A-Za-z_$][\w$]*)\s*,/gm;
    for (const match of body.matchAll(re)) {
        keys.push({ module: match[1], constant: match[2] });
    }
    return keys;
}

/**
 * 解析聚合入口里对 `../<module>/__generated__/route-table` 的命名导入。
 *
 * 返回 `{ module, constant, specifier }`；非 route-table 的导入一律忽略。
 */
export function parseEntrypointImports(source) {
    const imports = [];
    const re =
        /^\s*import\s*\{\s*([A-Za-z_$][\w$]*)\s*\}\s*from\s*"(\.\.\/([^"/]+)\/__generated__\/route-table)";\s*$/gm;
    for (const match of source.matchAll(re)) {
        imports.push({ constant: match[1], specifier: match[2], module: match[3] });
    }
    return imports;
}

/**
 * 枚举磁盘上拥有 route-table 的模块。
 *
 * 只扫 `src/<mod>/__generated__/route-table.ts` 一层，不做递归 ——
 * codegen 的输出布局就是固定的一层，递归只会把测试夹具误收进来。
 */
export function discoverRouteTableModules(srcDir) {
    const modules = [];
    if (!fs.existsSync(srcDir)) return modules;
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const tablePath = path.join(srcDir, entry.name, "__generated__", "route-table.ts");
        if (fs.existsSync(tablePath) && fs.statSync(tablePath).isFile()) {
            modules.push({ module: entry.name, tablePath });
        }
    }
    return modules.sort((a, b) => a.module.localeCompare(b.module));
}

/** 抽取 route-table 里形如 `{ method: "GET", path: "/x" }` 的路由条目。 */
export function collectRoutesFromTable(tablePath) {
    const source = fs.readFileSync(tablePath, "utf8");
    const routes = [];
    const re = /\{\s*method:\s*"([A-Z]+)",\s*path:\s*"([^"]+)"\s*\}/g;
    for (const match of source.matchAll(re)) {
        routes.push({ method: match[1], path: match[2] });
    }
    return routes;
}

/**
 * 找出重复的 `(method, path)`，并给出出现次数与来源模块。
 *
 * 判定的是**任何**重复，不区分是否跨模块：codegen 头注释承诺按 `(method, path)`
 * 去重，因此模块内重复同样说明 codegen 或后端 ledger 出了问题，没有理由放过。
 * `owners` 按首次出现顺序去重，便于人读；`count` 是实际出现次数。
 */
export function findDuplicateRoutes(moduleRoutes) {
    const occurrences = new Map();
    for (const { module, routes } of moduleRoutes) {
        for (const route of routes) {
            const key = `${route.method} ${route.path}`;
            const entry = occurrences.get(key) ?? { key, count: 0, owners: [] };
            entry.count += 1;
            if (!entry.owners.includes(module)) entry.owners.push(module);
            occurrences.set(key, entry);
        }
    }
    return [...occurrences.values()].filter((entry) => entry.count > 1);
}

/**
 * 核心判定。纯函数：不读文件、不写文件、不 exit，便于用夹具构造真实用例。
 */
export function evaluateContractEntrypoint(params) {
    const { entrypointSource, diskModules, moduleRoutes, pkgExports } = params;

    const declared = parseEntrypointModuleKeys(entrypointSource);
    const imports = parseEntrypointImports(entrypointSource);

    const diskNames = diskModules.map((m) => m.module).sort();
    const declaredNames = declared.map((d) => d.module).sort();
    const importNames = imports.map((i) => i.module).sort();

    const diskSet = new Set(diskNames);
    const declaredSet = new Set(declaredNames);

    const missingInEntrypoint = diskNames.filter((name) => !declaredSet.has(name));
    const extraInEntrypoint = declaredNames.filter((name) => !diskSet.has(name));

    // 键 → 常量 与 import 常量 必须一一对应，防止「键指向了别的模块的常量」。
    const importByModule = new Map(imports.map((i) => [i.module, i.constant]));
    const constantMismatches = [];
    for (const { module, constant } of declared) {
        if (!importByModule.has(module)) {
            constantMismatches.push({ module, reason: "key present in SDK_CONTRACT_ROUTE_TABLES but not imported" });
            continue;
        }
        const imported = importByModule.get(module);
        if (imported !== constant) {
            constantMismatches.push({
                module,
                reason: `key maps to ${constant} but import binds ${imported}`,
            });
        }
    }

    const duplicateRoutes = findDuplicateRoutes(moduleRoutes);

    const contractExport = pkgExports?.[ENTRYPOINT_EXPORT_KEY];
    const exportIssues = [];
    if (!contractExport || typeof contractExport !== "object") {
        exportIssues.push(`package.json#exports["${ENTRYPOINT_EXPORT_KEY}"] is missing`);
    } else {
        if (contractExport.import !== EXPECTED_IMPORT_TARGET) {
            exportIssues.push(
                `exports["${ENTRYPOINT_EXPORT_KEY}"].import is ${String(contractExport.import)}, expected ${EXPECTED_IMPORT_TARGET}`,
            );
        }
        if (contractExport.types !== EXPECTED_TYPES_TARGET) {
            exportIssues.push(
                `exports["${ENTRYPOINT_EXPORT_KEY}"].types is ${String(contractExport.types)}, expected ${EXPECTED_TYPES_TARGET}`,
            );
        }
    }

    return {
        diskModuleCount: diskNames.length,
        declaredModuleCount: declaredNames.length,
        importModuleCount: importNames.length,
        routeCount: moduleRoutes.reduce((sum, entry) => sum + entry.routes.length, 0),
        missingInEntrypoint,
        extraInEntrypoint,
        constantMismatches,
        duplicateRoutes,
        exportIssues,
    };
}

/** 任一判据命中即为失败。 */
export function hasContractEntrypointFailure(result) {
    return (
        result.missingInEntrypoint.length > 0 ||
        result.extraInEntrypoint.length > 0 ||
        result.constantMismatches.length > 0 ||
        result.duplicateRoutes.length > 0 ||
        result.exportIssues.length > 0
    );
}

/** 把判定结果渲染成人读的失败说明。 */
export function renderContractEntrypointFailure(result) {
    const lines = [];
    if (result.missingInEntrypoint.length) {
        lines.push(`- 磁盘有 route-table 但聚合出口未登记 (${result.missingInEntrypoint.length}):`);
        for (const name of result.missingInEntrypoint) lines.push(`    · ${name}`);
    }
    if (result.extraInEntrypoint.length) {
        lines.push(`- 聚合出口登记了但没有 route-table 文件 (${result.extraInEntrypoint.length}):`);
        for (const name of result.extraInEntrypoint) lines.push(`    · ${name}`);
    }
    if (result.constantMismatches.length) {
        lines.push(`- 键与 import 常量不匹配 (${result.constantMismatches.length}):`);
        for (const item of result.constantMismatches) lines.push(`    · ${item.module}: ${item.reason}`);
    }
    if (result.duplicateRoutes.length) {
        lines.push(`- 重复路由 (${result.duplicateRoutes.length}):`);
        for (const item of result.duplicateRoutes) {
            lines.push(`    · ${item.key} — 出现 ${item.count} 次，来自 ${item.owners.join(", ")}`);
        }
    }
    if (result.exportIssues.length) {
        lines.push("- package.json#exports 配置问题:");
        for (const issue of result.exportIssues) lines.push(`    · ${issue}`);
    }
    return lines.join("\n");
}

// ---------------------------------------------------------------------- main

function main() {
    try {
        const entrypointPath = path.join(projectRoot, ENTRYPOINT_REL);
        if (!fs.existsSync(entrypointPath)) {
            throw new Error(`[contract-entrypoint] missing entrypoint: ${ENTRYPOINT_REL}`);
        }

        const entrypointSource = fs.readFileSync(entrypointPath, "utf8");
        const diskModules = discoverRouteTableModules(path.join(projectRoot, "src"));
        const moduleRoutes = diskModules.map((entry) => ({
            module: entry.module,
            routes: collectRoutesFromTable(entry.tablePath),
        }));

        const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

        const result = evaluateContractEntrypoint({
            entrypointSource,
            diskModules,
            moduleRoutes,
            pkgExports: pkg.exports,
        });

        if (hasContractEntrypointFailure(result)) {
            console.error("[contract-entrypoint] FAILED");
            console.error(renderContractEntrypointFailure(result));
            console.error(REMEDIATION_TEXT);
            process.exitCode = 1;
            return;
        }

        console.log(
            `[contract-entrypoint] OK — ${result.diskModuleCount} modules / ${result.routeCount} routes aggregated in ${ENTRYPOINT_REL}`,
        );
    } catch (error) {
        console.error(`[contract-entrypoint] ${error instanceof Error ? error.message : String(error)}`);
        console.error(REMEDIATION_TEXT);
        process.exitCode = 1;
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
