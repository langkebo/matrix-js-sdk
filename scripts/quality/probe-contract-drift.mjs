#!/usr/bin/env node
/*
 * 诊断脚本（**不是门禁**，未接入 pnpm lint）：列出每个 ledger 模块的
 * 「SDK 生成 route-table ↔ 后端 ledger 清单」双向差集。
 *
 * 为什么需要它：`src/<module>/__generated__/route-table.ts` 是从后端 `ROUTE_CONTRACT.md`
 * （人工维护的文档）+ 既有条目渲染出来的，而 `docs/api-contract/generated/modules/*.json`
 * 才是 ledger（启动时校验过的那份）的镜像 —— 两个来源会漂移。本脚本把漂移量出来，
 * 是 `docs/sdk-optimization/CONTRACT_ROUTE_TABLE_MAPPING_REVIEW_2026-09-13.md`
 * 里结论的取证工具，也是把"差集门禁"（SDK-2）产品化时的起点。
 *
 * 用法：node scripts/quality/probe-contract-drift.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findSdkDirForModule } from "../contract-module-map.mjs";

/*
 * 曾经这里用正则从 `check-manager-codegen-coverage.mjs` 的**源码**里抓
 * `LEDGER_MODULE_ALIASES` / `LEDGER_MODULE_TO_SDK_DIR` 两个常量再用 `new Function` 求值。
 * 那两个常量搬到 `contract-module-map.mjs` 之后正则再也匹配不上，`grab()` 对 null 取 `[0]`
 * ⇒ 本脚本**崩在启动阶段**（因为它不在 `pnpm lint` 里，坏了很久没被发现）。
 * 现改为正规 import：`findSdkDirForModule()` 就是同一套映射的唯一真相源，
 * 从机制上不可能再与门禁漂移。
 */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const resolveFromRoot = (...parts) => path.join(projectRoot, ...parts);

const tableEntries = (sdkDir) => {
    const file = resolveFromRoot("src", sdkDir, "__generated__", "route-table.ts");
    if (!fs.existsSync(file)) return null;
    const content = fs.readFileSync(file, "utf8");
    return new Set([...content.matchAll(/\{ method: "([A-Z]+)", path: "([^"]+)" \}/g)].map((m) => `${m[1]} ${m[2]}`));
};

const index = JSON.parse(fs.readFileSync(resolveFromRoot("docs", "api-contract", "generated", "index.json"), "utf8"));
const rows = [];
for (const moduleName of Object.keys(index.modules)) {
    if (moduleName === "assembly") continue;
    const manifestPath = resolveFromRoot("docs", "api-contract", "generated", "modules", `${moduleName}.json`);
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const ledger = new Set(manifest.entries.map((e) => `${e.method} ${e.path}`));
    const sdkDir = findSdkDirForModule(moduleName);
    const table = tableEntries(sdkDir);
    if (table === null) {
        rows.push({ moduleName, sdkDir, table: "-", sdkOnly: 0, ledgerOnly: ledger.size, note: "无表" });
        continue;
    }
    const sdkOnly = [...table].filter((e) => !ledger.has(e));
    const ledgerOnly = [...ledger].filter((e) => !table.has(e));
    rows.push({
        moduleName,
        sdkDir,
        table: table.size,
        sdkOnly: sdkOnly.length,
        ledgerOnly: ledgerOnly.length,
        sdkOnlySample: sdkOnly.slice(0, 4),
        ledgerOnlySample: ledgerOnly.slice(0, 4),
    });
}

const interesting = rows.filter((r) => r.sdkOnly > 0 || r.ledgerOnly > 0);
console.log(`有漂移的模块: ${interesting.length} / ${rows.length}\n`);
for (const r of interesting) {
    console.log(
        `## ${r.moduleName} -> src/${r.sdkDir}  (表 ${r.table} 条, SDK 多 ${r.sdkOnly}, ledger 多 ${r.ledgerOnly})`,
    );
    if (r.sdkOnly > 0) console.log(`   SDK 表有、ledger 无: ${(r.sdkOnlySample || []).join(" | ")}`);
    // 无表模块的整条 ledger 都算"差集"，逐条列出来没有信息量；但**留空行会读成"没有差异"**，
    // 所以显式说明，别让 184 条的差集看起来像 0 条。
    if (r.ledgerOnly > 0)
        console.log(
            `   ledger 有、SDK 表无: ${(r.ledgerOnlySample || []).join(" | ") || "（本模块没有生成表，无从逐条比对）"}`,
        );
}
