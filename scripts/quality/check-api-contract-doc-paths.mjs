#!/usr/bin/env node
/**
 * check-api-contract-doc-paths.mjs —— `docs/api-contract/*.md` 里**逐行列出的路由路径**
 * 是否仍存在于后端 ledger 镜像。
 *
 * ## 为什么需要它（DOC-12）
 *
 * `docs/api-contract/*.md` 是**手维护**的模块页：表格里逐行写着路径、方法、挂载版本、
 * 对应 SDK 方法。经过 M2/M3 的 vendor 迁移与多轮别名删除后，页面上的「挂载版本」列大面积
 * 停在 `/_matrix/client/{v1,v3}`，而 ledger 里那些路径早已搬到 `/_matrix/vendor/v1`
 * （或已删除）—— 实测 2026-10-10：**49 个模块页里 22 个、合计 373 行**引用了 ledger 中
 * 不存在的路径（后端登记见 `UNRESOLVED_ISSUES_SUMMARY.md` DOC-12）。
 *
 * 既有的 `quality:sdk-contracts`（`check-sdk-contract-alignment.mjs`）只校验**表格里声明的
 * 后端端点**能否在 `> 后端代码:` 指向的文件里找到，粒度是"模块页 ↔ 后端文件"，
 * 抓不到"这一行的路径已经不在 ledger 里"这种**逐行**腐烂。
 *
 * ## 判据与棘轮
 *
 * - 判据：`docs/api-contract/*.md` 每个 Markdown 表格行里反引号包起来的
 *   `/_matrix/...`、`/_synapse/...` 路径，必须出现在 ledger 镜像（默认
 *   `docs/api-contract/generated/route-manifest.all.json`）的路径集合里。
 *   两种写法都扫（D-04）：① 裸路径单反引号 `` `/path` ``；② **方法 + 路径同反引号**
 *   `` `GET /path` `` —— 后者是「后端端点」列的主写法，早期判据（只认反引号后紧跟 `/`）
 *   把它整列漏扫。比对前先剥 query（`` `/register?kind=guest` `` 的真身是 `/register`）；
 *   尾斜杠差异按"去尾斜杠后存在"放过（ledger 自身有 5 对尾斜杠孪生）。
 * - 豁免：SDK 侧**已登记**在 `path-contract-waivers.json` 里的路径（后端确实没有、属有意
 *   超前封装或兼容其他 homeserver）不算"陈旧引用"—— 它是**有主有期限的已知差距**，而非
 *   文档漂移。豁免的期限另由 `quality:waiver-expiry` 管辖。
 * - 棘轮：历史债已知且巨大，直接判失败等于门禁恒红（同 `quality:wire-format` 的处理）。
 *   因此对照 `api-contract-doc-paths-baseline.json`：**只降不升**；`--write-baseline`
 *   用于在真正刷新完页面后下调上限。
 * - 通配/模板路径（含 `{...}`、`*`）不参与判定 —— 它们不是可逐字比对的字面量。
 *
 * 退出码：0 = 未超过上限；1 = 超过上限（或有新页面进入名单）；2 = 环境问题。
 *
 * 用法：
 *   node scripts/quality/check-api-contract-doc-paths.mjs            # 校验（棘轮）
 *   node scripts/quality/check-api-contract-doc-paths.mjs --json     # 机器可读
 *   node scripts/quality/check-api-contract-doc-paths.mjs --write-baseline
 */

import fs from "node:fs";
import path from "node:path";

import { writeJsonFormatted } from "./lib/write-json.mjs";

const projectRoot = process.cwd();
const DOCS_DIR = path.join(projectRoot, "docs", "api-contract");
const MANIFEST = path.join(DOCS_DIR, "generated", "route-manifest.all.json");
const BASELINE = path.join(projectRoot, "scripts", "quality", "api-contract-doc-paths-baseline.json");
const WAIVERS = path.join(projectRoot, "scripts", "quality", "path-contract-waivers.json");

const SKIP_PAGES = new Set(["README.md", "CHANGELOG.md", "AUDIT_INDEX.md", "CONTRACT_INDEX.md"]);
/**
 * 两种写法都要扫：
 * - ① 裸路径单反引号：`` `/_matrix/client/v3/sync` ``
 * - ② 方法 + 路径同反引号：`` `GET /_matrix/client/v3/sync` ``（「后端端点」列的主写法）
 * 旧判据只有 ①，而 ① 要求反引号后紧跟 `/` ⇒ ② 整列漏扫（D-04）。
 */
const PATH_RE = /`(\/(?:_matrix|_synapse)[^`\s|]*)`/g;
const METHOD_PATH_RE = /`(?:GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s+(\/(?:_matrix|_synapse)[^`\s|]*)`/g;
const PATH_PATTERNS = [PATH_RE, METHOD_PATH_RE];
/**
 * 「纯前缀提及」不是端点引用，不参与判定：
 * 表格里的 `/_matrix/client/v3` / `/_matrix/client/r0` / `/_matrix/vendor/v1` /
 * `/_synapse/admin` 这类只是**命名空间**（列标题、模块归属说明）。
 * 注意不能只看"ledger 里是否有后代" —— r0 家族已被整族删除，`/_matrix/client/r0`
 * 恰恰没有后代，用后代判断反而会把它算成陈旧端点（2026-10-10 实测 32+8 处）。
 */
const BARE_PREFIX_RE =
    /^\/(?:_matrix\/(?:client(?:\/(?:r0|v1|v3|unstable[^/]*|unstable\/[^/]+))?|vendor\/v1|federation\/v[12]|app\/v1|media\/(?:r0|r1|v1|v3))|_synapse\/(?:admin(?:\/v1)?|room_summary\/v1))$/;

function isBarePrefix(p) {
    return BARE_PREFIX_RE.test(p.replace(/\/$/, ""));
}

function ledgerPaths(manifestPath = MANIFEST) {
    if (!fs.existsSync(manifestPath)) {
        console.error(`[api-contract-doc-paths] 环境问题：读不到 ${manifestPath}`);
        process.exit(2);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const entries = manifest.entries ?? manifest.routes ?? [];
    const paths = new Set();
    for (const e of entries) {
        if (typeof e?.path !== "string") continue;
        paths.add(e.path);
        paths.add(e.path.replace(/\/$/, ""));
    }
    return paths;
}

/**
 * SDK 侧**已登记豁免**的路径集合（`path-contract-waivers.json` 的 `sdkCall` 去掉 method）。
 * 这些路径后端确实没有，但属"有主有期限的已知差距"，不是文档漂移 ⇒ 门禁放过。
 * 缺文件时按"无豁免"处理（严格），并在下方提示。
 */
function waivedPaths(waiversPath = WAIVERS) {
    if (!fs.existsSync(waiversPath)) {
        console.warn(`[api-contract-doc-paths] 提示：读不到 ${waiversPath}，按无豁免处理`);
        return new Set();
    }
    const payload = JSON.parse(fs.readFileSync(waiversPath, "utf8"));
    const set = new Set();
    for (const w of payload.waivers ?? []) {
        const call = typeof w?.sdkCall === "string" ? w.sdkCall.trim() : "";
        if (!call) continue;
        const sp = call.indexOf(" ");
        const p = sp === -1 ? call : call.slice(sp + 1);
        set.add(p);
        set.add(p.replace(/\/$/, ""));
    }
    return set;
}

/**
 * 扫描 `docs/api-contract/*.md` 里逐行列出的路由路径，返回引用了 ledger 中不存在路径
 * 的行。可传入夹具目录用于单测（见 `spec/unit/api-contract-doc-paths-gate.spec.ts`）；
 * 默认全部走仓内真实路径。
 *
 * @param {{docsDir?: string, manifest?: string, waivers?: string, skipPages?: Set<string>}} [options]
 * @returns {{byPage: Record<string, {line: number, path: string}[]>, total: number}}
 */
export function scan(options = {}) {
    const docsDir = options.docsDir ?? DOCS_DIR;
    const skipPages = options.skipPages ?? SKIP_PAGES;
    const paths = ledgerPaths(options.manifest);
    const waived = waivedPaths(options.waivers);
    /** @type {Record<string, {line: number, path: string}[]>} */
    const byPage = {};
    let total = 0;
    for (const name of fs.readdirSync(docsDir)) {
        if (!name.endsWith(".md") || skipPages.has(name)) continue;
        const file = path.join(docsDir, name);
        if (!fs.statSync(file).isFile()) continue;
        const lines = fs.readFileSync(file, "utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim().startsWith("|")) continue;
            for (const re of PATH_PATTERNS) {
                for (const m of line.matchAll(re)) {
                    const p = m[1];
                    // 通配/模板路径不参与逐字比对
                    if (p.includes("{") || p.includes("*") || p.includes("...")) continue;
                    if (isBarePrefix(p)) continue;
                    // 剥 query：`/register?kind=guest` 的真身是 `/register`（否则查 ledger 必然落空、造假缺陷）
                    const bare = p.split("?")[0].replace(/\/$/, "");
                    if (paths.has(bare) || paths.has(`${bare}/`)) continue;
                    // 已登记豁免的后端缺失端点不算陈旧
                    if (waived.has(bare) || waived.has(`${bare}/`)) continue;
                    (byPage[name] ??= []).push({ line: i + 1, path: p });
                    total += 1;
                }
            }
        }
    }
    return { byPage, total };
}

function main() {
    const argv = process.argv.slice(2);
    const { byPage, total } = scan();
    const pages = Object.keys(byPage).sort();

    if (argv.includes("--write-baseline")) {
        const baseline = {
            schemaVersion: 1,
            note:
                "`docs/api-contract/*.md` 中引用「ledger 里不存在的路径」的行数上限（只降不升）。" +
                "刷新页面后用 --write-baseline 下调。后端登记：UNRESOLVED_ISSUES_SUMMARY.md DOC-12。",
            capturedAt: new Date().toISOString().slice(0, 10),
            total,
            byPage: Object.fromEntries(pages.map((p) => [p, byPage[p].length])),
        };
        writeJsonFormatted(BASELINE, baseline);
        console.log(`[api-contract-doc-paths] 已写入上限：total=${total}，页面 ${pages.length} 个`);
        return 0;
    }

    if (!fs.existsSync(BASELINE)) {
        console.error("[api-contract-doc-paths] 环境问题：缺少 baseline，先跑 --write-baseline");
        return 2;
    }
    const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));

    if (argv.includes("--json")) {
        process.stdout.write(`${JSON.stringify({ total, pages: pages.length, byPage })}\n`);
        return 0;
    }

    const violations = [];
    if (total > baseline.total) {
        violations.push(`陈旧行总数由 ${baseline.total} 增至 ${total}`);
    }
    for (const page of pages) {
        const allowed = baseline.byPage?.[page];
        if (allowed === undefined) {
            violations.push(`新页面进入名单：${page}（${byPage[page].length} 行）`);
        } else if (byPage[page].length > allowed) {
            violations.push(`${page}: ${allowed} → ${byPage[page].length}`);
        }
    }

    if (violations.length > 0) {
        console.error("[api-contract-doc-paths] ❌ 文档页里的陈旧路由行增加了（棘轮只降不升）：");
        for (const v of violations) console.error(`  · ${v}`);
        console.error("  修：把该行的路径改成 ledger 里的真实挂载点（多为 /_matrix/vendor/v1），或删掉该行；");
        console.error("  然后 node scripts/quality/check-api-contract-doc-paths.mjs --write-baseline");
        return 1;
    }

    console.log(
        `[api-contract-doc-paths] ✅ 未超过上限：${total} 行 / ${pages.length} 个页面（上限 ${baseline.total}，抓取于 ${baseline.capturedAt}）`,
    );
    console.log("[api-contract-doc-paths] 分页（前 8，全量见 baseline）：");
    for (const [page, n] of Object.entries(baseline.byPage ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)) {
        console.log(`    ${page.padEnd(24)} ${n}`);
    }
    return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    process.exit(main());
}
