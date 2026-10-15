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
 * 为什么还要「逐行自证」（2026-10-15 新增）:
 *   上面那套规则是**标量**断言，守的是「合计」这一行。而合计是**可抵消的**：
 *   实测过一次 `auth` 行多算 1、`external-service` 行少算 1 —— 两处都错，
 *   但「合计 == 行和」与「合计 == 后端全量」**两条规则同时通过**，门禁报 OK。
 *   根因：只守和式，等于只守一个线性方程，解不出逐行唯一性。
 *   补法是把每行与它的**权威来源**单独对上：一行端点数必须等于「该页承载的
 *   ledger 模块的 entry_count 之和」。页面承载哪些模块由**页面自己的 frontmatter
 *   `module:`**（与 `contract-sync.mjs` / `pin-module-docs.mjs` 同源）解析，
 *   再经 `findSdkDirForModule` 归一到 SDK 目录 —— 直接用文档页名当 SDK 目录名是
 *   错的（实测 `thirdparty.md` 对应 `src/third-party/`，`auth.md` 根本不在别名表里）。
 *   顺带钉住「partition」性质：每个 ledger 模块必须被**恰好一行**认领 ——
 *   否则「行和 == 全量」这条等式就失去了意义（漏一行会少算，重一行会多算）。
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

import { findSdkDirForModule } from "../contract-module-map.mjs";

const projectRoot = process.cwd();

const REMEDIATION_TEXT = [
    "[docs-counts] remediation hints:",
    "- 文档里的数字是从代码算出来的，改代码后请一并更新文档（或把规则表指向新句子）",
    "- 若确实要改写被锚定的句子，请同时更新本脚本 RULES 里的 pattern",
    "- 新增一个「文档声明可计算数字」的场景时，在 RULES 里加一条，不要放宽断言",
    "- CONTRACT_INDEX.md 逐行自证失败时：该行的端点数应对齐「该页 frontmatter module 承载的 ledger 模块 entry_count 之和」；",
    "  出现「无人认领 / 重复认领」说明索引页与 generated/index.json 的模块集合已经不一致（漏行或映射新增）",
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

/** 索引页路径（规则表与逐行自证共用，避免两处写死）。 */
const CONTRACT_INDEX_PATH = "docs/api-contract/CONTRACT_INDEX.md";

/**
 * 抽 `CONTRACT_INDEX.md` 的模块表行：``| 名称 | [x.md](x.md) | 端点数 | 覆盖率 | 状态 |``。
 *
 * 第 4 列限定为百分数或 `—`，以把它与文档内的**其它**表格区分开 ——
 * 「订正说明」表是 ``| `auth.md` | 146 | **104** | 依据 |``（第 2 列非 md 链接），
 * 「本轮变更」批次表是 ``| 001 | `delayed_events`(7) | ... |``（第 2 列无链接）。
 *
 * 正则**在函数内构造**（不提升为模块级常量）：带 `g` 的正则是有状态的，共享会让 `lastIndex` 互相污染。
 */
function readContractIndexRows(readFile) {
    const source = readFile(CONTRACT_INDEX_PATH);
    const row = /^\|\s*[^|\n]+\|\s*\[([^\]]+)\.md\]\([^)]*\)\s*\|\s*(\d+)\s*\|\s*(?:\d+%|—)\s*\|/gm;
    return [...source.matchAll(row)].map((match) => ({ page: match[1], claimed: Number(match[2]) }));
}

/** 只取端点数（规则表用）。与 `readContractIndexRows` 同源，避免两条正则各自漂移。 */
function readContractIndexEntries(readFile) {
    return readContractIndexRows(readFile).map((row) => row.claimed);
}

/**
 * 从页面 frontmatter 里取 `module:`（契约同步链路的**权威口径**）。
 *
 * 只认首部的 `---` 块，避免误吞正文里恰好出现的 `module:` 行；无 frontmatter 返回 `null`
 * （`auth.md` 就是这种：umbrella 页，承载后端 `assembly` 桶但自身不带 `module:`）。
 */
function readFrontmatterModule(source) {
    if (!source.startsWith("---\n")) return null;
    const end = source.indexOf("\n---", 4);
    if (end === -1) return null;
    const match = /^module:\s*(\S+)\s*$/m.exec(source.slice(4, end));
    return match ? match[1] : null;
}

/** 逐页读 frontmatter `module:`，得到 `page → 模块名 | null`。页面读不到直接抛出（死链不该静默）。 */
export function readContractIndexPageModules(readFile, rows) {
    const pageModules = {};
    for (const { page } of rows) {
        pageModules[page] = readFrontmatterModule(readFile(`docs/api-contract/${page}.md`));
    }
    return pageModules;
}

/**
 * 逐行自证：每行端点数 == 该页承载的 ledger 模块 `entry_count` 之和；且模块被**恰好一行**认领。
 *
 * 纯函数：`resolveSdkDir` 注入（生产传 `findSdkDirForModule`），因此本函数不依赖映射表内容，
 * 单测可以直接用一个人造映射构造「页名 ≠ 目录名」这类真实情形。
 *
 * @param rows `[{ page, claimed }]`
 * @param pageModules `page → frontmatter 里的 module 名 | null`
 * @param moduleNames ledger 模块名清单（`generated/index.json` 的 `modules` 键）
 * @param entryCountByModule 模块名 → `entry_count`
 * @param resolveSdkDir `(moduleName) => sdkDir`
 */
export function evaluateContractIndexRows({ rows, pageModules, moduleNames, entryCountByModule, resolveSdkDir }) {
    const mismatches = [];
    const owner = new Map();

    for (const { page, claimed } of rows) {
        // 页名与 SDK 目录名**不保证同名**（`thirdparty.md` → `src/third-party/`），
        // 故先走 frontmatter，缺省才退回页名。
        const declared = pageModules ? pageModules[page] : null;
        const sdkDir = resolveSdkDir(declared ?? page);
        const modules = moduleNames.filter((name) => resolveSdkDir(name) === sdkDir);

        if (modules.length === 0) {
            mismatches.push({
                page,
                claimed,
                expected: null,
                modules: [],
                reason: `页名 "${page}" 与其 frontmatter module "${declared ?? "-"}" 都解析不到任何 ledger 模块`,
            });
            continue;
        }

        for (const name of modules) owner.set(name, [...(owner.get(name) ?? []), page]);

        const expected = modules.reduce((sum, name) => sum + (entryCountByModule[name] ?? 0), 0);
        if (expected !== claimed) {
            mismatches.push({
                page,
                claimed,
                expected,
                modules,
                reason: "行端点数 ≠ 该页承载的 ledger 模块 entry_count 之和",
            });
        }
    }

    const orphanModules = moduleNames.filter((name) => !owner.has(name));
    const duplicateModules = [...owner.entries()]
        .filter(([, pages]) => pages.length > 1)
        .map(([module, pages]) => ({ module, pages }));

    return { mismatches, orphanModules, duplicateModules, checked: rows.length };
}

/** 逐行自证的任一判据命中即为失败（含 partition 破坏）。 */
export function hasContractIndexRowFailure(result) {
    return result.mismatches.length > 0 || result.orphanModules.length > 0 || result.duplicateModules.length > 0;
}

/** 把逐行自证结果渲染成人读的失败说明。 */
export function renderContractIndexRowFailure(result) {
    const lines = [];
    if (result.mismatches.length) {
        lines.push(`- 逐行端点数与 ledger 不符 (${result.mismatches.length}):`);
        for (const item of result.mismatches) {
            const got = item.expected === null ? "—" : item.expected;
            lines.push(
                `    · ${item.page} [${item.modules.join(",") || "-"}]: 文档写 ${item.claimed}，实际 ${got} —— ${item.reason}`,
            );
        }
    }
    if (result.orphanModules.length) {
        lines.push(`- ledger 模块无人认领 (${result.orphanModules.length}) —— 索引页漏了行，或映射表新增了模块:`);
        for (const name of result.orphanModules) lines.push(`    · ${name}`);
    }
    if (result.duplicateModules.length) {
        lines.push(`- ledger 模块被多行重复认领 (${result.duplicateModules.length}) —— 合计因此虚高:`);
        for (const { module, pages } of result.duplicateModules) lines.push(`    · ${module} ← ${pages.join(", ")}`);
    }
    return lines.join("\n");
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
    /** 47 张 route-table 的条目总数。 */
    contractRouteTableEntries: countRouteTableEntries,
    /**
     * `CONTRACT_INDEX.md` 各模块行「端点数」之和。
     *
     * 不变式：逐行求和必须等于「索引表端点数合计」自己声明的那一行（由规则 1a 校验），
     * 且等于后端 `all` profile 全量（由规则 1b 校验）。两条合起来封住两种漂移方向：
     * 改错某一行但不改合计 → 1a 红；连合计一起改 → 1b 红。
     * 2026-10-15 实测该行和曾为 **1070**（`auth` 写 146 应为 104、`rendezvous` 写 6 应为 10）。
     */
    contractIndexEntrySum: (readFile) => readContractIndexEntries(readFile).reduce((sum, n) => sum + n, 0),
    /** `CONTRACT_INDEX.md` 的模块表行数 —— 该页自称的「模块文档页数」应与之一致。 */
    contractIndexModuleRows: (readFile) => readContractIndexEntries(readFile).length,
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
    // ---- CONTRACT_INDEX.md（2026-10-15 新增）----
    // 该页的「页数 / 合计 / 覆盖率 / 逐模块端点数」此前**完全没有门禁覆盖**
    // （本脚本原先只守 contract-artifacts.md 与 CLAUDE/AGENTS），于是收编线跑了 9 个提交、
    // 改了 47 张表的口径，该页却一直停在 10-12 的状态，且 `auth`(146) / `rendezvous`(6)
    // 两行端点数本身就是错的（实测应为 104 / 10）。现按「同句多文件逐条登记」的既有原则补上。
    {
        file: "docs/api-contract/CONTRACT_INDEX.md",
        anchor: "索引表端点数合计 = 表内各行端点数之和",
        metric: "contractIndexEntrySum",
        pattern: /索引表端点数合计\*\*:\s*\*\*(\d+)\*\*/,
    },
    {
        file: "docs/api-contract/CONTRACT_INDEX.md",
        anchor: "索引表端点数合计 = 后端 ledger 全量（all profile）",
        metric: "contractManifestEntries",
        pattern: /索引表端点数合计\*\*:\s*\*\*(\d+)\*\*/,
    },
    {
        file: "docs/api-contract/CONTRACT_INDEX.md",
        anchor: "模块文档页数（应等于模块表行数）",
        metric: "contractIndexModuleRows",
        pattern: /模块文档页数\*\*:\s*(\d+)/,
    },
    {
        file: "docs/api-contract/CONTRACT_INDEX.md",
        anchor: "生成物模块数",
        metric: "contractModuleManifests",
        pattern: /生成物模块数\*\*:\s*(\d+)/,
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

/** ledger 模块名清单与各自的 `entry_count`（权威来源 = `generated/` 镜像）。 */
function loadLedgerModuleEntryCounts() {
    const modulesDir = path.join(projectRoot, "docs/api-contract/generated/modules");
    const entryCountByModule = {};
    for (const name of fs.readdirSync(modulesDir)) {
        if (!name.endsWith(".json")) continue;
        const parsed = JSON.parse(fs.readFileSync(path.join(modulesDir, name), "utf8"));
        entryCountByModule[name.replace(/\.json$/, "")] = parsed.entry_count;
    }
    const index = JSON.parse(readFileOrThrow("docs/api-contract/generated/index.json"));
    return { moduleNames: Object.keys(index.modules), entryCountByModule };
}

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

        // 逐行自证：标量规则守「合计」，这里守「每一行都各自成立」。
        const rows = readContractIndexRows(readFileOrThrow);
        const { moduleNames, entryCountByModule } = loadLedgerModuleEntryCounts();
        const rowResult = evaluateContractIndexRows({
            rows,
            pageModules: readContractIndexPageModules(readFileOrThrow, rows),
            moduleNames,
            entryCountByModule,
            resolveSdkDir: findSdkDirForModule,
        });

        if (hasDocsCountsFailure(result) || hasContractIndexRowFailure(rowResult)) {
            console.error("[docs-counts] FAILED");
            if (hasDocsCountsFailure(result)) console.error(renderDocsCountsFailure(result));
            if (hasContractIndexRowFailure(rowResult)) console.error(renderContractIndexRowFailure(rowResult));
            console.error(REMEDIATION_TEXT);
            process.exitCode = 1;
            return;
        }

        const summary = Object.entries(metricValues)
            .map(([name, value]) => `${name}=${value}`)
            .join(" ");
        console.log(`[docs-counts] OK — ${result.checked} rules consistent`);
        console.log(
            `[docs-counts] CONTRACT_INDEX 逐行自证: ${rowResult.checked} 行 / ${moduleNames.length} 个 ledger 模块，全部一一对上`,
        );
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
