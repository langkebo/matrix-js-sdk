#!/usr/bin/env node
/**
 * route-wrapper-coverage.mjs —— 「SDK 已封装路由数」计算器。
 *
 * ## 它回答的问题
 *
 * `docs/api-contract/CONTRACT_INDEX.md` 有一列「SDK 覆盖率」，`admin.md` / `federation.md` 等页
 * 也有「已封装路由数 / 契约覆盖率」。这些数字**一直是手写的**，因此会腐烂 ——
 * 实测：该页的覆盖率在收编线跑了 9 个提交后仍停在 10-12 的核算值，而其中的 `auth`(146 应为 104)
 * 与 `rendezvous`(6 应为 10) 两行**本身就是错的**。本脚本把「已封装路由数」变成**可复算**的。
 *
 * ## 为什么不新写一个抽取器
 *
 * 路径调用点的抽取是本仓最容易写错的东西（见 `verify-path-contract.mjs` 的注释：
 * 对象形态 / 位置形态 / 恒等包装器 / 模板构造器 / 多候选前缀 …）。故本脚本**只做组合**：
 * 复用 `quality:path-contract` 那台**已被 CI 门禁锻炼过**的抽取机
 * （`indexIdentityPathHelpers` / `analyzeTemplateBuilders` / `extractWrapperCalls` / `normalizePath`），
 * 不重新实现任何解析逻辑。抽取器若失明，`quality:path-contract` 会先报。
 *
 * ## 口径（写清楚，因为它决定了数字的含义）
 *
 * 一条后端路由被记为**已封装**，当且仅当：存在一个调用点，其
 * `(HTTP method, 前缀解析后的完整路径)` 归一化后与**某张 route-table 里的某一条**逐字相等。
 * 归一化把动态段统一成 `{X}`（`/{user_id}` 与 `/${encodeURIComponent(x)}` 视为同一段）。
 *
 * 三点**必须知道的口径边界**：
 *
 *   1. **只统计「有 route-table 的模块」**（当前 47 张）。`federation` 被
 *      `SKIP_ROUTE_TABLE_MODULES` 有意跳过后不生成表，故它的调用点无法归属、落在
 *      `attributed: false` 桶里 —— 这是**口径不适用**，不是缺陷。
 *   2. **`(method, path)` 在 47 张表之间无重复**（由 `quality:contract-entrypoint` 强制），
 *      所以归属是唯一的、不存在「算到两个模块头上」的歧义。
 *   3. **解不出来的调用点单独计数**（`unchecked`：路径实参不是字面量，如经变量传入）。
 *      它们既不计入分子也不计入分母 —— 但它们**不会静默消失**，会打印在 `unresolved` 里，
 *      且 `quality:path-contract` 对同一批调用点有「只降不升」的棘轮。
 *
 * ## ⚠️ 本工具当前**只给下限**，不是判据（2026-10-15 实测合计 54.0%）
 *
 * 首版实现严重低估（33.9%）。已修两处失明后升到 **54.0%**（调用点 594 → 853）；
 * `admin` 单模块读 **176/179 = 98.3%**，与手工核算完全吻合 —— **方法对、覆盖面仍不够**。
 *
 * **已修**：
 *   - ② **对象形态 + 恒等助手**（`this.request({ method, path: dp("…") })`）：原先**两个抽取器都看不见**
 *     （`extractObjectCalls` 只认裸字面量，`extractWrapperCalls` 只扫位置形态）。已在抽取器里补
 *     `identityHelpers` 展开（默认关闭以保持向后兼容，门禁主流程已启用）。
 *     顺带修了它暴露的 **ES 简写 `prefix,`** 漏识别问题 —— 那个会让 `resolvePrefix(null)` **静默**
 *     按默认 v3 前缀处理，把 22 处正确调用点误报为"契约不符"。
 *
 * **仍存在**（故覆盖率仍只是下限）：
 *   1. **恒等助手名字跨文件复用**：`dp` 出现在 7 个文件、各带不同剥离前缀。`indexIdentityPathHelpers`
 *      按**名字**建索引，`resolvePrefix` 又要求「恰好一个别名命中」⇒ 多前缀的名字解不出，
 *      整批走该助手的调用点仍被丢弃。（`cpu` 只在一个文件 ⇒ 反而解得出。）
 *   3. **前缀静态求不出**：`prefix,` 简写、方法参数、以及**模块级常量**（`captchaPrefix`、
 *      `CAS_PROTOCOL_PREFIX`、`MSC3814_PREFIX` …）—— 实测 99 处。
 *   5. **抽取器仍不吐出的调用点**：**自检判据** —— 凡「表内 > 0 但已封装 = 0」的模块一律按
 *      "抽取器失明"处理、**不可读作真实零覆盖**（本次 8/47 命中：burn-after-read / cas /
 *      delayed-events / presence / reactions / relations / rendezvous）。
 *
 * ⇒ **在把上述补完之前，任何基于本脚本的覆盖率数字都只应作为下限，不得接入门禁。**
 * 本工具保留的价值在于：它把「抽取器盲区」量化并打印出来，而不是给出一个看起来权威的错误数字。
 * **它宁可说"我不知道"，也不猜。**
 *
 * 用法:
 *   node scripts/audit/route-wrapper-coverage.mjs            # 人读：逐模块下限 + 盲区诊断
 *   node scripts/audit/route-wrapper-coverage.mjs --json     # 机器读
 */

import fs from "node:fs";
import path from "node:path";

import {
    analyzeTemplateBuilders,
    extractObjectCalls,
    extractWrapperCalls,
    indexIdentityPathHelpers,
    normalizePath,
    parseStripPrefixAliases,
    resolvePrefix,
} from "../quality/verify-path-contract.mjs";

const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, "src");
const modulesDir = path.join(projectRoot, "docs", "api-contract", "generated", "modules");

/** 完整 URL 形态（自带前缀，不再拼 `prefix`）—— 与 `verify-path-contract.mjs` 同判据。 */
const FULL_URL_RE = /^\/_matrix\/(client|admin|vendor|identity|media|federation|server)/;

/**
 * 枚举 `src/**` 下参与抽取的源码。
 *
 * 排除两类：`__generated__/`（生成物里也有 `path:` 字面量，但那是契约表不是调用点）
 * 与 `*.d.ts`（无实现）。返回 `Map<相对路径, 源码>` —— 正是抽取机要的形态。
 */
export function listSourceFiles(root = srcRoot) {
    const files = new Map();
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "__generated__") continue;
                walk(full);
                continue;
            }
            if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
            files.set(path.relative(root, full).split(path.sep).join("/"), fs.readFileSync(full, "utf8"));
        }
    };
    walk(root);
    return files;
}

/**
 * 载入每张 route-table 的条目。
 *
 * 返回 `{ byModule, index }`：
 *   - `byModule`: `Map<模块目录名, Set<"METHOD 归一化完整路径">>`
 *   - `index`   : `Map<"METHOD 归一化完整路径", 模块目录名>` —— 供调用点归属用。
 */
export function loadRouteTables(dir = modulesDir, src = srcRoot) {
    const byModule = new Map();
    const index = new Map();
    const collisions = [];

    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const tablePath = path.join(src, entry.name, "__generated__", "route-table.ts");
        if (!fs.existsSync(tablePath)) continue;

        const source = fs.readFileSync(tablePath, "utf8");
        const keys = new Set();
        for (const m of source.matchAll(/\{\s*method:\s*"([A-Z]+)",\s*path:\s*"([^"]*)"\s*\}/g)) {
            const key = `${m[1]} ${normalizePath(m[2])}`;
            keys.add(key);
            if (index.has(key) && index.get(key) !== entry.name) {
                collisions.push({ key, a: index.get(key), b: entry.name });
            }
            index.set(key, entry.name);
        }
        if (keys.size > 0) byModule.set(entry.name, keys);
    }

    return { byModule, index, collisions, moduleCount: byModule.size };
}

/**
 * 核心：把调用点归属到模块，统计各模块「表内条目 / 被调用条目」。
 *
 * 纯函数（输入两个 Map，不碰磁盘），便于用夹具单测。
 */
export function computeWrapperCoverage({ sourcesByFile, byModule, index }) {
    // ⚠️ `stripAliases` **必须传**：`dp` / `apu` / `cpu` 这些恒等助手的参数类型写的是**别名**
    // （`StripAdminV1` / `StripVendor` / `StripCasProtocol`…），别名→字面前缀的映射表来自
    // `src/http-api/strip-prefix.ts`。不传的后果是助手的 `stripPrefix` 解不出 ⇒ 走助手的调用点
    // **整批被丢弃**（实测合计从 ~96% 掉到 33.9%，且恰好是"刚包过断言"的那一批模块读成 0%）。
    const stripAliases = parseStripPrefixAliases(sourcesByFile.get("http-api/strip-prefix.ts") ?? "");
    const { helpers } = indexIdentityPathHelpers(sourcesByFile, { stripAliases });
    const templateBuilders = analyzeTemplateBuilders(sourcesByFile);

    const wrapped = new Map(); // module -> Set<key>
    const seen = new Set(); // 调用点去重（同文件同行的重复命中）
    // ── 四个「没能归属」的桶。它们必须**各自可见**，否则"覆盖率低"这件事无法归因。 ──
    const unresolved = []; // 抽取器自己报的：路径实参非字面量
    const nonLiteral = []; // 本脚本判的：pathRaw 既无模板段又不以 / 开头
    const unknownPrefix = []; // 前缀静态求不出（首版曾静默丢弃 ⇒ 读成 0% 的模块无法解释）
    const unattributed = new Map(); // 解得出但没有表承接（id 前缀、或该模块被 SKIP）

    for (const [relFile, source] of sourcesByFile) {
        const { calls: wrapperCalls, unchecked } = extractWrapperCalls(source, relFile, {
            identityHelpers: helpers,
            templateBuilders,
        });

        for (const item of unchecked) {
            unresolved.push({ file: item.file, line: item.line, wrapper: item.wrapper, expr: item.expr });
        }

        // ⚠️ **两个抽取器都要跑**，且**都要拿到助手表**：
        //   · 位置形态（`request(Method.X, apu("…"), …)`）→ `extractWrapperCalls`
        //   · 对象形态（`request({ method, path: apu("…"), prefix })`）→ `extractObjectCalls`
        //     —— 后者在**不传 `identityHelpers` 时会把这类调用点整批丢弃**（2026-10-15 修），
        //     实测全仓约 287 处；本脚本早期版本因此把 23/47 个模块读成 0%。
        // 同一调用可能被两者各命中一次，靠去重键合并。
        const merged = [...extractObjectCalls(source, { identityHelpers: helpers }), ...wrapperCalls];

        for (const call of merged) {
            // 统一成「候选前缀集」：对象形态 → 单候选（`resolvePrefix`）；
            // 位置形态 → 可能多候选（三元 fallback 的两条腿）。任一候选命中即算已封装。
            let candidates;
            let known;
            if (call.prefixCandidates) {
                candidates = call.prefixCandidates;
                known = call.prefixKnown;
            } else {
                const r = resolvePrefix(call.prefixExpr);
                candidates = r.known ? [r.prefix] : [];
                known = r.known;
            }

            const dedupKey = `${relFile}|${call.method}|${call.pathRaw}|${candidates.join("\u0001")}|${call.line}`;
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);

            const pathOnly = call.pathRaw.replace(/^["'`]|["'`]$/g, "");
            // 非字面量（不含 `${` 又不以 `/` 开头）——与参考实现同判据
            if (!pathOnly.includes("${") && !pathOnly.startsWith("/")) {
                nonLiteral.push({ file: relFile, line: call.line, pathRaw: call.pathRaw });
                continue;
            }
            if (!known) {
                // ⚠️ 这里**必须计数**。首版直接 `continue` 且不记账，导致"分母看起来小"而无从归因。
                unknownPrefix.push({
                    file: relFile,
                    line: call.line,
                    method: call.method,
                    pathRaw: call.pathRaw,
                    prefixExpr: call.prefixExpr ?? null,
                    wrapper: call.wrapper ?? "(object)",
                });
                continue;
            }

            const isFullUrl = FULL_URL_RE.test(pathOnly);
            let owner = null;
            let ownerPath = null;
            for (const prefix of candidates) {
                const fullPath = normalizePath(isFullUrl ? pathOnly : (prefix ?? "") + pathOnly);
                const key = `${call.method} ${fullPath}`;
                if (index.has(key)) {
                    owner = index.get(key);
                    ownerPath = key;
                    break;
                }
            }

            if (owner === null) {
                const probe = normalizePath(isFullUrl ? pathOnly : (candidates[0] ?? "") + pathOnly);
                const key = `${call.method} ${probe}`;
                if (!unattributed.has(key)) unattributed.set(key, []);
                unattributed.get(key).push(`${relFile}:${call.line}`);
                continue;
            }

            if (!wrapped.has(owner)) wrapped.set(owner, new Set());
            wrapped.get(owner).add(ownerPath);
        }
    }

    const modules = [];
    for (const [moduleName, keys] of byModule) {
        const hit = wrapped.get(moduleName) ?? new Set();
        modules.push({
            module: moduleName,
            entries: keys.size,
            wrapped: hit.size,
            unwrapped: [...keys].filter((k) => !hit.has(k)).sort(),
            coverage: keys.size > 0 ? (hit.size / keys.size) * 100 : 0,
        });
    }
    modules.sort((a, b) => a.coverage - b.coverage || a.module.localeCompare(b.module));

    const totalEntries = modules.reduce((sum, m) => sum + m.entries, 0);
    const totalWrapped = modules.reduce((sum, m) => sum + m.wrapped, 0);
    const totalCoverage = totalEntries > 0 ? (totalWrapped / totalEntries) * 100 : 0;

    const blindSpots = {
        /** 抽取器自己报的「路径实参非字面量」。 */
        nonLiteralArg: unresolved,
        /** 本脚本判的「pathRaw 既无模板段又不以 / 开头」。 */
        nonLiteralPath: nonLiteral,
        /** 前缀静态求不出 —— 首版曾静默丢弃，正是「整批模块读成 0%」的主因。 */
        unknownPrefix,
        /** 解得出、但没有任何 route-table 承接（id 命名空间，或该模块被 SKIP 不生成表）。 */
        noTable: [...unattributed.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    };
    const blindCount = Object.values(blindSpots).reduce((n, v) => n + v.length, 0);

    return { modules, totalEntries, totalWrapped, totalCoverage, blindSpots, blindCount, callCount: seen.size };
}

// ---------------------------------------------------------------------- main

function main() {
    const { byModule, index, collisions, moduleCount } = loadRouteTables();
    const sourcesByFile = listSourceFiles();
    const result = computeWrapperCoverage({ sourcesByFile, byModule, index });

    if (process.argv.includes("--json")) {
        console.log(
            JSON.stringify(
                {
                    schemaVersion: 1,
                    scope: {
                        modulesWithRouteTable: moduleCount,
                        sourceFiles: sourcesByFile.size,
                        note:
                            "⚠️ 覆盖率目前**只是下限**，不得作为判据（见文件头「4 处失明」）。" +
                            "`(method, path)` 在各表间无重复，故归属唯一。" +
                            "`blindSpots` 四个桶非 0 即说明结果不可信。",
                    },
                    totalEntries: result.totalEntries,
                    totalWrapped: result.totalWrapped,
                    totalCoverageLowerBound: Number(result.totalCoverage.toFixed(1)),
                    callCount: result.callCount,
                    blindCount: result.blindCount,
                    blindSpots: {
                        nonLiteralArg: result.blindSpots.nonLiteralArg.length,
                        nonLiteralPath: result.blindSpots.nonLiteralPath.length,
                        unknownPrefix: result.blindSpots.unknownPrefix.length,
                        noTable: result.blindSpots.noTable.length,
                    },
                    modules: result.modules,
                },
                null,
                4,
            ),
        );
        return;
    }

    const pad = (s, n) => String(s).padEnd(n);
    console.log("");
    console.log("SDK 已封装路由数（按 route-table 口径）—— ⚠️ 目前只是【下限】，不是判据");
    console.log("=".repeat(74));
    console.log(`${pad("模块", 18)}${pad("表内", 8)}${pad("已封装", 9)}覆盖率下限`);
    console.log("-".repeat(74));
    for (const m of result.modules) {
        console.log(`  ${pad(m.module, 18)}${pad(m.entries, 8)}${pad(m.wrapped, 9)}${m.coverage.toFixed(1)}%`);
    }
    console.log("-".repeat(74));
    console.log(
        `  ${pad("合计（" + result.modules.length + " 张表）", 18)}${pad(result.totalEntries, 8)}${pad(
            result.totalWrapped,
            9,
        )}${result.totalCoverage.toFixed(1)}%`,
    );
    console.log("");
    console.log("── 抽取盲区：下列调用点【没有】被统计，故上面的覆盖率只可能是下限 ──");
    console.log(`  调用点总数（去重后）    : ${result.callCount}`);
    console.log(`  ① 路径实参非字面量      : ${result.blindSpots.nonLiteralArg.length}`);
    console.log(`  ② pathRaw 非字面量      : ${result.blindSpots.nonLiteralPath.length}`);
    console.log(`  ③ 前缀静态求不出        : ${result.blindSpots.unknownPrefix.length}`);
    console.log(`  ④ 解得出但无表承接      : ${result.blindSpots.noTable.length}   ← 口径外（federation 被 SKIP 等）`);
    console.log(`  盲区合计                : ${result.blindCount}`);
    if (result.blindSpots.unknownPrefix.length > 0) {
        console.log("");
        console.log("  ③ 的样例 —— 这是「整批模块读成 0%」的主因，修它收益最大:");
        for (const x of result.blindSpots.unknownPrefix.slice(0, 8)) {
            console.log(
                `    ${pad(x.method, 7)}${pad(x.pathRaw.slice(0, 34), 36)}wrapper=${pad(x.wrapper, 16)}prefix=${x.prefixExpr ?? "∅"}`,
            );
        }
    }
    if (collisions.length > 0) {
        console.log("");
        console.log(
            `  注：${collisions.length} 处「跨表重复」疑似**本脚本归一化引入的假阳性**（如 \`…/pushrules/\` 与 \`…/pushrules\`），`,
        );
        console.log("      未经复核不要当作仓库缺陷。");
    }
    console.log("");
    console.log("⇒ 补齐文件头那 4 处失明之前，不要用这些数字更新文档、也不要建门禁。");
    console.log("");
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
