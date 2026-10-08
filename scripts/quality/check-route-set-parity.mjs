#!/usr/bin/env node

/**
 * 路由集合对账门禁：**`src/**\/__generated__/route-table.ts` 里的每一条
 * `(method, path)` 都必须真实存在于后端 ledger**。
 *
 * ## 为什么需要这条门禁
 *
 * `route-table.ts` 由 `sdk-contract-codegen.mjs` 生成，而它是**三个来源的并集**：
 *
 *   1. 既有条目（向后兼容，不删除任何 manager 依赖的路径）；
 *   2. ledger 清单（**权威**路由源，后端启动时 `RouteLedger::validate` 校验过）；
 *   3. `docs/synapse-rust/ROUTE_CONTRACT.md`（人工文档，**已实测与 ledger 漂移**）。
 *
 * 于是「后端不服务的路径」也能进入 route-table ⇒ 由它生成的 `PathAssert<P, …>`
 * 会把那条路径当成合法类型。实测（§7.15-31 / §34.3）：
 *
 *   · `bu("/zzz/not-a-route")`              → tsx exit 2 / TS2345，类型断言**真生效**；
 *   · `bu("/background_updates/coun")`      → **exit 0 全绿**（契约里有 `{job_name}` 占位段）。
 *
 * `quality:path-contract` 只核对**源码里真正出现的调用点**；契约类型本身漂没漂，它看不见。
 * 本门禁补的正是这一格：**把「契约集合 ⊆ ledger 集合」钉死**。
 *
 * 反方向（ledger 有、契约没有）是良性的（不是每个后端路由都该被 SDK 封装），**不校验**。
 *
 * ## 例外必须登记
 *
 * 确实需要「契约里有、后端没有」的路径（如上游 Matrix 规范路由本后端尚未实现）时，
 * 登记进 `route-set-parity-waivers.json`，必须带 `reason` + `expires` —— 与
 * `path-contract-waivers.json` 同一套纪律。
 *
 * 用法：node scripts/quality/check-route-set-parity.mjs [--json]
 * 退出码：0 = 通过；1 = 发现未覆盖路径 / 豁免腐烂；2 = ledger 或台账缺失、无法解析。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

const WAIVERS_PATH = path.join(__dirname, "route-set-parity-waivers.json");
/**
 * ledger 的来源 = **`contract:codegen` 用的那一份**（`docs/api-contract/generated/modules/*.json`）。
 *
 * 这一点是刻意的：只有与生成器同源，"契约集合 ⊆ ledger 集合"才是在比同两个东西。
 * 实测（2026-10-08）仓内有两套后端路由集：
 *
 *   · `docs/api-contract/generated/modules/*.json`（= `route-manifest.all.json`）= **1159** 条 ← codegen 用它；
 *   · `../synapse-rust/tests/unit/fixtures/ledger_export_sdk/all.json` = **1082** 条 ← `quality:path-contract` 用它。
 *
 * 兄弟仓那份是它的**已提交 fixture**，落后于正在改的 `friend_room.rs` / `voice.rs` /
 * `burn_after_read.rs`（工作区里有未提交改动），因此少了 77 条。拿它当基准会把 fork 的
 * 新模块整片误报成"契约有、后端没有"（实测 70+ 条）。**本门禁不读兄弟仓。**
 */
const MODULES_DIR = path.join(PROJECT_ROOT, "docs", "api-contract", "generated", "modules");
const INDEX_PATH = path.join(PROJECT_ROOT, "docs", "api-contract", "generated", "index.json");

const EMIT_JSON = process.argv.includes("--json");
const TODAY = process.env.ROUTE_SET_PARITY_TODAY ?? new Date().toISOString().slice(0, 10);

/**
 * 抽出 route-table 里的 `(method, path)`。
 *
 * 抽成纯函数是为了让"抽不到"这件事可见：`route-table.ts` 是生成物，
 * 一旦生成器改了写法而这里没跟上，键集会**静默变空**，门禁就恒绿了。
 * 所以调用方必须检查 `entries.length === 0`（见 `collectEntries`）。
 *
 * @param source `route-table.ts` 全文
 * @returns `{ method, path }[]`（按出现顺序）
 */
export function parseRouteTableEntries(source) {
    const entries = [];
    const re = /\{\s*method:\s*"([A-Z]+)",\s*path:\s*"([^"]+)"\s*\}/g;
    let m;
    while ((m = re.exec(source)) !== null) {
        entries.push({ method: m[1], path: m[2] });
    }
    return entries;
}

/** `METHOD /path` —— 本门禁的比对键（**不做任何版本/命名空间归一**：要的就是逐字相等）。 */
export function routeKey(method, routePath) {
    return `${method.toUpperCase()} ${routePath}`;
}

/**
 * 对账判据（纯函数，spec 直接测）。
 *
 * @param {object} input
 * @param {Array<{ method: string; path: string; file: string }>} input.entries route-table 的条目
 * @param {Set<string>} input.ledgerKeys 后端 ledger 的键集
 * @param {Array<{ method: string; path: string; reason?: string; expires?: string }>} input.waivers
 * @param {string} input.today `YYYY-MM-DD`（显式入参：到期判定不该随机器时钟漂）
 * @returns {{ uncovered: object[]; expiredWaivers: object[]; unusedWaivers: object[] }}
 */
export function diffRouteSet({ entries, ledgerKeys, waivers, today }) {
    const waived = new Map();
    for (const w of waivers) waived.set(routeKey(w.method, w.path), w);

    const present = new Set(entries.map((e) => routeKey(e.method, e.path)));

    const uncovered = entries
        .filter((e) => !ledgerKeys.has(routeKey(e.method, e.path)) && !waived.has(routeKey(e.method, e.path)))
        .map((e) => ({ ...e, key: routeKey(e.method, e.path) }));

    const expiredWaivers = [];
    const unusedWaivers = [];
    for (const [key, w] of waived) {
        if (!w.expires || !/^\d{4}-\d{2}-\d{2}$/.test(w.expires)) {
            expiredWaivers.push({ key, ...w, detail: "缺 expires 或格式非法（应 YYYY-MM-DD）" });
        } else if (w.expires < today) {
            expiredWaivers.push({ key, ...w, detail: `豁免已于 ${w.expires} 过期` });
        } else if (!present.has(key)) {
            unusedWaivers.push({ key, ...w, detail: "该路径已不在任何 route-table 里 ⇒ 应删除这条豁免" });
        }
    }
    return { uncovered, expiredWaivers, unusedWaivers };
}

/** 读 ledger 键集 —— 走 `contract:codegen` 用的同一份模块清单。 */
function loadLedgerKeys() {
    if (!existsSync(INDEX_PATH)) {
        console.error(`[route-set-parity] ❌ 找不到 ${INDEX_PATH}（contract:sync 未跑过？）`);
        process.exit(2);
    }
    let moduleNames;
    try {
        moduleNames = Object.keys(JSON.parse(readFileSync(INDEX_PATH, "utf8")).modules ?? {});
    } catch (e) {
        console.error(`[route-set-parity] ❌ index.json 解析失败：${e.message}`);
        process.exit(2);
    }

    const keys = new Set();
    let moduleFiles = 0;
    for (const name of moduleNames) {
        const file = path.join(MODULES_DIR, `${name}.json`);
        if (!existsSync(file)) continue;
        moduleFiles += 1;
        let manifest;
        try {
            manifest = JSON.parse(readFileSync(file, "utf8"));
        } catch (e) {
            console.error(`[route-set-parity] ❌ ${name}.json 解析失败：${e.message}`);
            process.exit(2);
        }
        for (const entry of manifest.entries ?? []) {
            if (typeof entry.method === "string" && typeof entry.path === "string") {
                keys.add(routeKey(entry.method, entry.path));
            }
        }
    }
    if (keys.size === 0) {
        console.error(`[route-set-parity] ❌ 从 ${moduleFiles} 个模块清单里读到 0 条路由 —— 目录写错了？`);
        process.exit(2);
    }
    return { keys, source: `docs/api-contract/generated/modules/ (${moduleFiles} 个模块)` };
}

/** 扫 `src/*\/__generated__/route-table.ts`，带"抽空即失败"保护。 */
function collectEntries() {
    const srcDir = path.join(PROJECT_ROOT, "src");
    const entries = [];
    const files = [];
    for (const dir of readdirSync(srcDir, { withFileTypes: true })) {
        if (!dir.isDirectory()) continue;
        const file = path.join(srcDir, dir.name, "__generated__", "route-table.ts");
        if (!existsSync(file)) continue;
        files.push(path.relative(PROJECT_ROOT, file));
        const rel = path.relative(PROJECT_ROOT, file);
        for (const e of parseRouteTableEntries(readFileSync(file, "utf8"))) {
            entries.push({ ...e, file: rel, module: dir.name });
        }
    }
    if (files.length === 0) {
        console.error("[route-set-parity] ❌ 一个 route-table.ts 都没找到 —— 路径写错了？");
        process.exit(2);
    }
    if (entries.length === 0) {
        console.error(`[route-set-parity] ❌ 从 ${files.length} 个 route-table.ts 里抽到 0 条 —— 生成物写法变了？`);
        process.exit(2);
    }
    return { entries, files };
}

function main() {
    if (!existsSync(WAIVERS_PATH)) {
        console.error(`[route-set-parity] ❌ 豁免台账缺失：${WAIVERS_PATH}`);
        process.exit(2);
    }
    let waivers;
    try {
        waivers = JSON.parse(readFileSync(WAIVERS_PATH, "utf8")).waivers ?? [];
    } catch (e) {
        console.error(`[route-set-parity] ❌ 豁免台账解析失败：${e.message}`);
        process.exit(2);
    }

    const { keys: ledgerKeys, source } = loadLedgerKeys();
    const { entries, files } = collectEntries();
    const { uncovered, expiredWaivers, unusedWaivers } = diffRouteSet({
        entries,
        ledgerKeys,
        waivers,
        today: TODAY,
    });

    if (EMIT_JSON) {
        console.log(
            JSON.stringify(
                {
                    ledger: source,
                    ledgerSource: source,
                    routeTableFiles: files.length,
                    entries: entries.length,
                    uncovered,
                    expiredWaivers,
                    unusedWaivers,
                },
                null,
                2,
            ),
        );
    } else {
        console.log(`[route-set-parity] route-table ${files.length} 个文件 / ${entries.length} 条`);
        console.log(`[route-set-parity] ledger=${source}，${ledgerKeys.size} 条`);
    }

    const problems = uncovered.length + expiredWaivers.length + unusedWaivers.length;
    if (problems > 0) {
        if (!EMIT_JSON) {
            for (const u of uncovered) {
                console.error(`[route-set-parity] ❌ 契约有、后端没有：${u.key}  （${u.file}）`);
            }
            for (const w of expiredWaivers) {
                console.error(`[route-set-parity] ❌ 豁免失效：${w.key} —— ${w.detail}`);
            }
            for (const w of unusedWaivers) {
                console.error(`[route-set-parity] ❌ 豁免未被引用：${w.key} —— ${w.detail}`);
            }
        }
        process.exit(1);
    }

    if (!EMIT_JSON) {
        console.log(`[route-set-parity] ✅ 契约路由集合全部命中 ledger（豁免 ${waivers.length} 条，均在期且在引用中）`);
    }
}

const invokedDirectly =
    typeof process.argv[1] === "string" && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
