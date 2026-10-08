#!/usr/bin/env node
/**
 * check-docs-counts.mjs —— 文档数值一致性门禁
 *
 * 背景:
 *   本仓多处文档会写死「有多少个 manager / 多少个 export / 多少条路由」这类**可计算**的数字。
 *   2026-10-08 实测到同一个「manager 数量」在四个地方各不相同:
 *     `MANAGER_EXTENSION_MODULES` 98 / `DEFAULT_CORE_EXTENSIONS` 98 /
 *     `ManagerName` 联合 100 / `CLAUDE.md` 写 101 / `frontend-usage-matrix.md` 写 114。
 *   人工同步这类数字是不可持续的 —— 代码一改，文档就悄悄变成错的，
 *   而错的方向往往是「让人以为某个能力不存在」或「让人以为某个模块被覆盖了」。
 *
 * 做法:
 *   把「文档里的哪个句子声明了哪个指标」写成一张**声明式规则表**（RULES）。
 *   每个指标都由代码/生成物实时计算（METRICS），不与规则表耦合。
 *   任一条规则：句子匹配不到（文档被改写）或数字对不上（文档腐烂）→ 失败。
 *
 * 为什么让「匹配不到」也失败:
 *   如果只在匹配到时才校验，那么把句子删掉/改写就能**静默绕过**门禁 ——
 *   这正是这类守卫最常见的失效方式。让锚点本身成为契约，改写句子就必须改规则表，
 *   而改规则表是显式动作，会在 review 里被看见。
 *
 * 为什么不守 `frontend-usage-matrix.md`:
 *   那是 2026-07-21 的**历史快照**，文件内已标注过期并列出漂移对照表。
 *   守一份「故意保留旧值」的文档只会制造噪声；它的过期状态由文件头声明，
 *   不作为 CI 契约。
 *
 * 退出码:
 *   0 = 全部规则匹配且数值一致
 *   1 = 存在锚点失配或数值不一致
 */

import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();

const REMEDIATION_TEXT = [
    "[docs-counts] remediation hints:",
    "- 文档里的数字是从代码算出来的，改代码后请一并更新文档（或把规则表指向新句子）",
    "- 若确实要改写被锚定的句子，请同时更新本脚本 RULES 里的 pattern",
    "- 新增一个「文档声明可计算数字」的场景时，在 RULES 里加一条，不要放宽断言",
    "- 重跑: pnpm quality:docs-counts",
].join("\n");

/** 读取文件，缺失即抛（文档被删/改名时不应静默跳过）。 */
function readFileOrThrow(relPath) {
    const abs = path.join(projectRoot, relPath);
    if (!fs.existsSync(abs)) {
        throw new Error(`missing file: ${relPath}`);
    }
    return fs.readFileSync(abs, "utf8");
}

/** 数一个 glob 式目录匹配数量：只支持 `src/<name>/__generated__` 与 `src/client-*.ts` 两种形态。 */
function countGeneratedDirs(predicate) {
    const srcDir = path.join(projectRoot, "src");
    if (!fs.existsSync(srcDir)) return 0;
    return fs
        .readdirSync(srcDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(srcDir, entry.name, "__generated__")))
        .filter((entry) => predicate(path.join(srcDir, entry.name, "__generated__"))).length;
}

/** 抽取 route-table 里的字面量路由条目数。 */
function countRouteTableEntries() {
    const srcDir = path.join(projectRoot, "src");
    let total = 0;
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const tablePath = path.join(srcDir, entry.name, "__generated__", "route-table.ts");
        if (!fs.existsSync(tablePath)) continue;
        const source = fs.readFileSync(tablePath, "utf8");
        total += (source.match(/\{\s*method:\s*"[A-Z]+",\s*path:/g) ?? []).length;
    }
    return total;
}

/**
 * 全部指标：从代码/生成物实时计算。
 *
 * 每个指标是一个 `(readFile) => number`，`readFile` 由调用方注入，
 * 便于测试替换为夹具；目录枚举类指标走模块级 `projectRoot`（测这类指标用集成测试，
 * 不塞进纯函数单测）。规则表只引用指标**名字**，避免把计算逻辑复制到多条规则里。
 */
export const METRICS = {
    /** `package.json#exports` 的子路径条数。 */
    exports: (readFile) => Object.keys(JSON.parse(readFile("package.json")).exports).length,
    /** `src/client-infra/manager-registry.ts` 里 `ManagerName` 联合类型的成员数。 */
    managerNames: (readFile) => {
        const source = readFile("src/client-infra/manager-registry.ts");
        const union = source.match(/ManagerName\s*=(.*?);/s);
        if (!union) throw new Error("cannot locate ManagerName union in manager-registry.ts");
        return (union[1].match(/"[a-zA-Z][a-zA-Z0-9-]*"/g) ?? []).length;
    },
    /** `src/manager-extensions/index.ts` 里 `MANAGER_EXTENSION_MODULES` 的条目数。 */
    managerExtensionModules: (readFile) => {
        const source = readFile("src/manager-extensions/index.ts");
        return (source.match(/\{\s*option:\s*"include\w+",\s*module:\s*"[a-z0-9-]+"\s*\}/g) ?? []).length;
    },
    /** `src/client-*.ts` 的文件数。 */
    clientModules: () => {
        const srcDir = path.join(projectRoot, "src");
        return fs.readdirSync(srcDir).filter((name) => /^client-.*\.ts$/.test(name)).length;
    },
    /** 后端 ledger 全量清单的 `entry_count`。 */
    contractManifestEntries: (readFile) => {
        return JSON.parse(readFile("docs/api-contract/generated/route-manifest.all.json")).entry_count;
    },
    /** `docs/api-contract/generated/modules/*.json` 的文件数。 */
    contractModuleManifests: () => {
        const dir = path.join(projectRoot, "docs/api-contract/generated/modules");
        return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).length;
    },
    /** `src/<mod>/__generated__` 目录数。 */
    contractGeneratedDirs: () => countGeneratedDirs(() => true),
    /** 其中真正有 `route-table.ts` 的模块数。 */
    contractRouteTables: () => countGeneratedDirs((dir) => fs.existsSync(path.join(dir, "route-table.ts"))),
    /** 39 张 route-table 的条目总数。 */
    contractRouteTableEntries: countRouteTableEntries,
};

/**
 * 声明式规则表。
 *
 * `anchor` 是给人看的说明；`pattern` 必须**恰好一个捕获组**，捕获数字。
 * 同一个句子在多个文件里出现时（CLAUDE.md / AGENTS.md 是姊妹文件），逐条登记 ——
 * 只守其中一个会让另一个继续腐烂。
 */
export const RULES = [
    {
        file: "CLAUDE.md",
        anchor: "ManagerName 联合类型键数",
        metric: "managerNames",
        pattern: /authoritative key list: (\d+) keys/,
    },
    {
        file: "AGENTS.md",
        anchor: "ManagerName 联合类型键数",
        metric: "managerNames",
        pattern: /authoritative key list: (\d+) keys/,
    },
    {
        file: "CLAUDE.md",
        anchor: "异步挂载的 manager 扩展模块数",
        metric: "managerExtensionModules",
        pattern: /createClient` returns synchronously; (\d+) manager-extension modules/,
    },
    {
        file: "AGENTS.md",
        anchor: "异步挂载的 manager 扩展模块数",
        metric: "managerExtensionModules",
        pattern: /createClient` returns synchronously; (\d+) manager-extension modules/,
    },
    {
        file: "CLAUDE.md",
        anchor: "client-*.ts 模块数",
        metric: "clientModules",
        pattern: /decomposed into ~(\d+) focused modules/,
    },
    {
        file: "AGENTS.md",
        anchor: "client-*.ts 模块数",
        metric: "clientModules",
        pattern: /decomposed into ~(\d+) focused modules/,
    },
    {
        file: "docs/api-contract/contract-artifacts.md",
        anchor: "后端 ledger 全量路由数",
        metric: "contractManifestEntries",
        pattern: /route-manifest\.all\.json` 的 `entry_count`[^\n]*?\|\s*(\d+)\s*\|/,
    },
    {
        file: "docs/api-contract/contract-artifacts.md",
        anchor: "逐模块镜像文件数",
        metric: "contractModuleManifests",
        pattern: /modules\/\*\.json` 文件数[^\n]*?\|\s*(\d+)\s*\|/,
    },
    {
        file: "docs/api-contract/contract-artifacts.md",
        anchor: "有生成产物的 SDK 模块数",
        metric: "contractGeneratedDirs",
        pattern: /src\/\*\/__generated__\/` 目录数[^\n]*?\|\s*(\d+)\s*\|/,
    },
    {
        file: "docs/api-contract/contract-artifacts.md",
        anchor: "生成 route-table 的模块数",
        metric: "contractRouteTables",
        pattern: /route-table\.ts` 文件数[^\n]*?\|\s*(\d+)\s*\|/,
    },
    {
        file: "docs/api-contract/contract-artifacts.md",
        anchor: "route-table 条目总数",
        metric: "contractRouteTableEntries",
        pattern: /字面量路由条目[^\n]*?\|\s*(\d+)\s*\|/,
    },
];

/**
 * 核心判定。纯函数：不读文件、不写文件、不 exit，便于用夹具构造真实用例。
 *
 * 指标值以 **name → number** 的形式注入，而不是注入计算函数 ——
 * 这样本函数完全不依赖目录布局，spec 只需给文档文本与一组数字。
 *
 * @param rules 规则表（每条含 file / metric / pattern / anchor）
 * @param metricValues 指标名 → 实际数值
 * @param readFile 注入的文件读取器 `(relPath) => string`
 */
export function evaluateDocsCounts({ rules, metricValues, readFile }) {
    const anchorMisses = [];
    const mismatches = [];

    for (const rule of rules) {
        const { file, anchor, metric } = rule;

        if (!(metric in metricValues)) {
            anchorMisses.push({ file, anchor, metric, reason: `unknown metric: ${metric}` });
            continue;
        }

        let source;
        try {
            source = readFile(file);
        } catch (error) {
            anchorMisses.push({ file, anchor, metric, reason: `cannot read file (${error.message})` });
            continue;
        }

        const match = source.match(rule.pattern);
        if (!match) {
            anchorMisses.push({ file, anchor, metric, reason: "anchor sentence not found (doc reworded or removed?)" });
            continue;
        }

        const claimed = Number(match[1]);
        const real = metricValues[metric];
        if (claimed !== real) {
            mismatches.push({ file, anchor, metric, claimed, actual: real });
        }
    }

    return { anchorMisses, mismatches, checked: rules.length };
}

/** 任一判据命中即为失败。 */
export function hasDocsCountsFailure(result) {
    return result.anchorMisses.length > 0 || result.mismatches.length > 0;
}

/** 把判定结果渲染成人读的失败说明。 */
export function renderDocsCountsFailure(result) {
    const lines = [];
    if (result.mismatches.length) {
        lines.push(`- 数值不一致 (${result.mismatches.length}):`);
        for (const item of result.mismatches) {
            lines.push(
                `    · ${item.file} — ${item.anchor} [${item.metric}]: 文档写 ${item.claimed}，实际 ${item.actual}`,
            );
        }
    }
    if (result.anchorMisses.length) {
        lines.push(`- 锚点失配 (${result.anchorMisses.length}) —— 句子被改写或删除，规则表未同步:`);
        for (const item of result.anchorMisses) {
            lines.push(`    · ${item.file} — ${item.anchor} [${item.metric}]: ${item.reason}`);
        }
    }
    return lines.join("\n");
}

// ---------------------------------------------------------------------- main

function main() {
    try {
        const metricValues = Object.fromEntries(
            Object.entries(METRICS).map(([name, compute]) => [name, compute(readFileOrThrow)]),
        );

        const result = evaluateDocsCounts({
            rules: RULES,
            metricValues,
            readFile: readFileOrThrow,
        });

        if (hasDocsCountsFailure(result)) {
            console.error("[docs-counts] FAILED");
            console.error(renderDocsCountsFailure(result));
            console.error(REMEDIATION_TEXT);
            process.exitCode = 1;
            return;
        }

        const summary = Object.entries(metricValues)
            .map(([name, value]) => `${name}=${value}`)
            .join(" ");
        console.log(`[docs-counts] OK — ${result.checked} rules consistent`);
        console.log(`[docs-counts] metrics: ${summary}`);
    } catch (error) {
        console.error(`[docs-counts] ${error instanceof Error ? error.message : String(error)}`);
        console.error(REMEDIATION_TEXT);
        process.exitCode = 1;
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
