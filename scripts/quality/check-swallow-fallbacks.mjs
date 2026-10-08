#!/usr/bin/env node
/**
 * `quality:swallow-fallbacks` —— 抓「catch 吞错后静默返回兜底值」。
 *
 * ── 检测语义 ────────────────────────────────────────────────────────────────
 * 命中条件：某个 catch 的**语法块内**出现「返回兜底值」的 return。
 *   return null / undefined / [] / {} / false / "" / '' / 0
 * 块内没有 return 兜底值的 catch 一律不命中——哪怕它后面 240 个字符内有别人的
 * `return null`（那属于另一个语句/函数）。
 *
 * 裸 `return;` 不算兜底值：它只出现在 void 函数里，表示正常提前结束；错误往往已经
 * 被交给回调或 promise（`this.onFailed(e); return;`），不属于「静默吞掉」。
 *
 * ── 为什么不是一行正则（2026-10-06 重写） ───────────────────────────────────
 * 旧实现是一行正则：
 *   /catch\s*\([^)]*\)\s*\{[\s\S]{0,240}?return\s*(null|\[\]|false|\{\})\s*;/g
 * 它有两个致命问题，都会被当成「检出结果」写进 baseline：
 *
 *   1. `[\s\S]{0,240}?` 是**纯字符窗口**，不禁止跨过 `}`。于是一个 catch 可以匹配到
 *      它之外、甚至**另一个方法内部**的 `return null`。实测 64 个命中里有 6 个是
 *      这样跨块错配的：`rust-crypto/backup.ts:256`（catch 里是 `throw e`，属正当
 *      错误处理）被判成吞错，真正被匹配的 `return false` 在 catch 之外。
 *      ⇒ 假阳性入库 + 报告行号指向错误的 catch。
 *   2. `{0,240}` 长度上限让「块首到 return 距离 >240 字符」的真吞错漏检（实测 14 处）。
 *
 * 因此本版本改为**配平扫描**：先定位 catch 的 `{…}` 范围，只在块内判定。
 * 这同时消掉了跨块错配与长度上限两个缺陷。
 *
 * ── 指纹为什么不含行号、也不含白名单注解（同一轮修复） ──────────────────────
 * baseline 条目的 id 由 `lib/stable-id.mjs` 生成，**不含行号**：行号随无关改动漂移，
 * 一旦编进身份，上方插入任意一行（哪怕只是 prettier 重排）都会让整批条目 STALE，
 * 逼迫一次无审查的全量重记。行号仍保留在条目里，但只是展示字段。
 *
 * 同理，指纹输入里也**剔除 `@swallow-error` 注解**（见 WHITELIST_STRIP_RE）——注解是
 * 「关于这条命中的元数据」，不是身份。否则只改 `expires` 续期就会让指纹漂移、门禁变红。
 * 剔除后，「同一个吞错站点带注解 / 不带注解」得到同一个 id：去掉注解会被报成
 * 「NEW + 缺注解」（正是想要的），而不会同时报一条语义错误的 STALE。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────────
 *   node scripts/quality/check-swallow-fallbacks.mjs                    # 门禁
 *   node scripts/quality/check-swallow-fallbacks.mjs --update-baseline  # 重记行号（不接受新站点）
 *   node scripts/quality/check-swallow-fallbacks.mjs --update-baseline --accept-new  # 显式吸收新站点
 *   BASELINE_STRICT=true …                                              # 存量项缺少注释也阻断
 *
 * 已知边界（有意不覆盖，避免误以为「门禁全绿 = 全仓无吞错」）：
 *   - catch 块内没有 return、但 catch 之后紧接着 `return null` 的写法（错误被吞在
 *     块外，例如 `catch { logger.warn(e); } return null;`）不在检测面内。
 *   - 正则字面量（`/\{/`）里的花括号不参与配平，可能影响同一 catch 内的边界判定。
 */

import fs from "node:fs";
import path from "node:path";
import { stableId, nextOrdinal, normalizeSnippet } from "./lib/stable-id.mjs";
import { writeJsonFormatted } from "./lib/write-json.mjs";

const rootDir = process.cwd();
const targetDir = path.resolve(rootDir, "src");
const baselinePath = path.resolve(rootDir, "scripts/quality/swallow-fallback-baseline.json");
const shouldUpdateBaseline = process.argv.includes("--update-baseline");
const acceptNew = process.argv.includes("--accept-new");
const baselineStrict = process.env.BASELINE_STRICT === "true" || process.argv.includes("--strict-baseline");

/** baseline 条目里 snippet 的展示长度（不影响指纹——指纹用完整片段）。 */
const SNIPPET_DISPLAY_LIMIT = 240;

/** 一次 `--update-baseline` 最多逐条打印多少条 [ADDED]，避免刷屏。 */
const ADDED_PRINT_LIMIT = 40;

/**
 * 「返回兜底值」的语法族。非全局正则，`.test()` 无 lastIndex 状态。
 *
 * 刻意**不含裸 `return;`**：它只出现在 void 函数里，表示正常提前结束。把它算作吞错会把
 * 「调用失败回调后 return」（`catch (e) { this.onFailed(e); return; }`）、
 * 「reject 掉 promise 后 return」（`catch (e) { deferred.reject(e); return; }`）这类
 * **已经把错误传播出去**的正常写法一并误报——实测会多出 30+ 条噪音。
 */
const FALLBACK_RETURN_RE = /\breturn\s*(?:null|undefined|\[\]|false|\{\s*\}|""|''|0)\s*;/;

/** `// @swallow-error { owner: "xxx", expires: "2026-01-01" }` */
const WHITELIST_RE = /\/\/\s*@swallow-error\s*\{\s*owner:\s*"([^"]+)",\s*expires:\s*"([^"]+)"\s*\}/;

/**
 * 计算指纹前要从片段里剔除的白名单注解。
 *
 * 白名单是**关于**这条命中的元数据，不是这条命中的身份。若把它算进指纹，则
 * `// @swallow-error { owner: "x", expires: "2026-12-31" }` **只改续期日期**就会让指纹漂移：
 * 旧条目判 STALE、新条目判 NEW —— 门禁在纯元数据变更（续期、改 owner、把注解从 catch 前挪进块内）
 * 上变红。那正是本次要根治的「无关改动逼迫重记基线」，所以必须剔除。
 */
const WHITELIST_STRIP_RE = /\/\/\s*@swallow-error\s*\{[^}]*\}/g;

function listTsFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const absPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listTsFiles(absPath));
            continue;
        }
        if (entry.isFile() && absPath.endsWith(".ts") && !absPath.endsWith(".d.ts")) {
            files.push(absPath);
        }
    }
    return files;
}

function toLineNumber(source, index) {
    return source.slice(0, index).split("\n").length;
}

/**
 * 把注释与字符串字面量的**内容**替换成空格，保留一切换行与字符偏移。
 *
 * 目的：让 `{` / `}` / `return` / `throw` 的配对与判定不被注释文案和字符串内容干扰，
 * 同时保证 mask 前后的下标一一对应（行号与 snippet 仍从原始 source 取）。
 *
 * 导出以便单测直接验证「注释/字符串不会干扰配平」。
 */
export function maskNonCode(source) {
    const out = source.split("");
    const n = source.length;
    let i = 0;
    while (i < n) {
        const ch = source[i];
        const next = source[i + 1];
        if (ch === "/" && next === "/") {
            let j = source.indexOf("\n", i);
            if (j === -1) j = n;
            for (let k = i; k < j; k++) out[k] = " ";
            i = j;
            continue;
        }
        if (ch === "/" && next === "*") {
            const end = source.indexOf("*/", i + 2);
            const j = end === -1 ? n : end + 2;
            for (let k = i; k < j; k++) {
                if (out[k] !== "\n") out[k] = " ";
            }
            i = j;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
            const quote = ch;
            let j = i + 1;
            while (j < n) {
                if (source[j] === "\\") {
                    j += 2;
                    continue;
                }
                if (source[j] === quote) {
                    j += 1;
                    break;
                }
                j += 1;
            }
            for (let k = i + 1; k < j - 1; k++) {
                if (out[k] !== "\n") out[k] = " ";
            }
            i = j;
            continue;
        }
        i += 1;
    }
    return out.join("");
}

/** 从 `{` 出发配平找到配对 `}` 的下标；找不到返回 -1。 */
function findMatchingBrace(masked, openIndex) {
    let depth = 0;
    for (let i = openIndex; i < masked.length; i++) {
        const ch = masked[i];
        if (ch === "{") depth += 1;
        else if (ch === "}") {
            depth -= 1;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/**
 * 扫描全部 catch 块。
 *
 * 故意**不**跳过已匹配块的尾部：嵌套 catch（catch 里再 try/catch）也要各自被发现。
 *
 * @returns {Array<{ catchStart: number, bodyStart: number, bodyEnd: number }>}
 */
export function findCatchBlocks(masked) {
    const blocks = [];
    const catchRe = /\bcatch\s*\([^)]*\)\s*\{/g;
    let match;
    while ((match = catchRe.exec(masked)) !== null) {
        const bodyStart = match.index + match[0].length - 1;
        const bodyEnd = findMatchingBrace(masked, bodyStart);
        if (bodyEnd === -1) continue;
        blocks.push({ catchStart: match.index, bodyStart, bodyEnd });
    }
    return blocks;
}

/**
 * 判断该 catch **自身**块体里有没有兜底 return。
 *
 * 关键是要先把**嵌套的 catch 块**挖掉：外层
 * `catch (e) { try { … } catch (inner) { return null; } }` 的块体里确实"含有"
 * `return null`，但那笔吞错属于内层 catch，外层不该被连带记一笔——内层会作为独立
 * 条目被扫描到，否则同一个吞错会被记两次，且外层那条的语义是错的。
 */
function bodyHasFallbackReturn(masked, block, allBlocks) {
    const body = masked.slice(block.bodyStart, block.bodyEnd + 1).split("");
    for (const nested of allBlocks) {
        if (nested.catchStart <= block.catchStart || nested.bodyEnd > block.bodyEnd) continue;
        for (let i = nested.catchStart - block.bodyStart; i <= nested.bodyEnd - block.bodyStart; i++) {
            if (body[i] !== "\n") body[i] = " ";
        }
    }
    return FALLBACK_RETURN_RE.test(body.join(""));
}

/**
 * 定位 `@swallow-error` 注释。按优先级依次尝试三处：
 *   1. catch **前面两行**（惯用写法）；
 *   2. catch **同一行尾**，即 `catch (e) { // @swallow-error { … }`；
 *   3. catch **块内**——实际代码里大量注释是紧贴「兜底 return」那一行写的
 *      （例如 `if (err instanceof NotFoundError) {` / `// @swallow-error {…}` / `return null;`），
 *      而不是挂在 catch 前面。不把块内纳入范围就认不出这些声明。
 *
 * 只在**本 catch 块范围内**查找，不外溢到相邻块。
 */
export function findWhitelist(source, catchStart, bodyEnd) {
    const toEntry = (match) => (match ? { owner: match[1], expires: match[2] } : null);

    const preCatch = source.slice(0, catchStart);
    const lines = preCatch.split("\n");
    const lastLine = lines[lines.length - 1].trim();
    const secondLastLine = lines.length > 1 ? lines[lines.length - 2].trim() : "";
    const newlineAfterCatch = source.indexOf("\n", catchStart);
    const catchLine = source.slice(catchStart, newlineAfterCatch === -1 ? source.length : newlineAfterCatch);
    const body = source.slice(catchStart, bodyEnd + 1);

    return (
        toEntry(lastLine.match(WHITELIST_RE)) ??
        toEntry(secondLastLine.match(WHITELIST_RE)) ??
        toEntry(catchLine.match(WHITELIST_RE)) ??
        toEntry(body.match(WHITELIST_RE))
    );
}

/**
 * 对**一段源码**做检测，返回该文件的全部命中项。
 *
 * 抽成不依赖文件系统的纯函数，便于单测直接喂合成源码
 * （见 `spec/unit/swallow-fallbacks-gate.spec.ts`）。
 *
 * @param {string} source TS 源码
 * @param {string} relPath 仓库相对路径（参与指纹计算）
 */
export function collectFindingsFromSource(source, relPath) {
    const findings = [];
    const masked = maskNonCode(source);
    const blocks = findCatchBlocks(masked);
    const ordinalCounter = new Map();

    for (const block of blocks) {
        if (!bodyHasFallbackReturn(masked, block, blocks)) continue;

        // 指纹输入 = 块内源码 **剔除白名单注解**（注解是元数据，见 WHITELIST_STRIP_RE 的说明）
        const identitySlice = source.slice(block.catchStart, block.bodyEnd + 1).replace(WHITELIST_STRIP_RE, "");
        const fullSnippet = normalizeSnippet(identitySlice);
        const ordinal = nextOrdinal(ordinalCounter, `${relPath}\u0000${fullSnippet}`);

        findings.push({
            id: stableId(relPath, [fullSnippet, ordinal]),
            file: relPath,
            line: toLineNumber(source, block.catchStart),
            ordinal,
            snippet: fullSnippet.slice(0, SNIPPET_DISPLAY_LIMIT),
            whitelist: findWhitelist(source, block.catchStart, block.bodyEnd),
        });
    }
    return findings;
}

function collectFindings() {
    const findings = [];
    for (const absPath of listTsFiles(targetDir)) {
        const source = fs.readFileSync(absPath, "utf8");
        const relPath = path.relative(rootDir, absPath).replaceAll("\\", "/");
        findings.push(...collectFindingsFromSource(source, relPath));
    }
    findings.sort((a, b) => a.id.localeCompare(b.id));
    return findings;
}

export function validateWhitelist(finding) {
    if (!finding.whitelist) return false;
    const { owner, expires } = finding.whitelist;
    if (!owner || !expires) return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) return false;

    const expiryDate = new Date(expires);
    const today = new Date();
    if (expiryDate < today) {
        return "expired";
    }
    return "valid";
}

function readBaseline() {
    if (!fs.existsSync(baselinePath)) {
        return { generatedAt: null, findings: [] };
    }
    return JSON.parse(fs.readFileSync(baselinePath, "utf8"));
}

function writeBaseline(findings) {
    const payload = {
        generatedAt: new Date().toISOString(),
        findings,
    };
    writeJsonFormatted(baselinePath, payload);
}

function printLine(text) {
    process.stdout.write(`${text}\n`);
}

/**
 * `--update-baseline` 的写入路径。
 *
 * 「重记行号」与「赦免新站点」必须分开：前者是安全的（指纹没变，只是行号字段变了），
 * 后者必须有人看过——否则一次手滑就能把一批新吞错静默洗白。所以 `added` 非空时
 * 默认拒绝写入，要显式 `--accept-new`。
 */
function runUpdateBaseline(findings) {
    const previous = readBaseline().findings ?? [];
    const prevById = new Map(previous.map((item) => [item.id, item]));
    const currentIds = new Set(findings.map((item) => item.id));

    const added = findings.filter((item) => !prevById.has(item.id));
    const removed = previous.filter((item) => !currentIds.has(item.id));
    const moved = findings.filter((item) => {
        const prev = prevById.get(item.id);
        return prev !== undefined && prev.line !== item.line;
    });

    printLine(`[swallow-fallback] baseline 变更摘要`);
    printLine(`  指纹保持   : ${findings.length - added.length}`);
    printLine(`  行号重记   : ${moved.length}`);
    printLine(`  退役(stale): ${removed.length}`);
    printLine(`  新增(added): ${added.length}`);

    if (moved.length > 0) {
        printLine(`\n  [MOVED] 仅行号变化（指纹未变，安全重记）：`);
        for (const item of moved.slice(0, ADDED_PRINT_LIMIT)) {
            printLine(`    ${item.file}:${item.line}  (原 ${prevById.get(item.id).line})`);
        }
    }
    if (removed.length > 0) {
        printLine(`\n  [REMOVED] baseline 有、当前扫不到（站点已消失或被改写）：`);
        for (const item of removed.slice(0, ADDED_PRINT_LIMIT)) {
            printLine(`    ${item.file}:${item.line}  ${item.snippet.slice(0, 80)}`);
        }
    }
    if (added.length > 0) {
        printLine(`\n  [ADDED] 当前扫到、baseline 没有（**需要逐条确认**）：`);
        for (const item of added.slice(0, ADDED_PRINT_LIMIT)) {
            printLine(`    ${item.file}:${item.line}  ${item.snippet.slice(0, 80)}`);
        }
        if (added.length > ADDED_PRINT_LIMIT) {
            printLine(`    …还有 ${added.length - ADDED_PRINT_LIMIT} 条`);
        }
    }

    if (added.length > 0 && !acceptNew) {
        process.stderr.write(
            `\n[swallow-fallback] --update-baseline 拒绝写入：有 ${added.length} 条指纹不在 baseline 中。\n` +
                `  「重记行号」与「赦免新站点」必须分开——前者可以安全重记，后者要人看过。\n` +
                `  确认上面 [ADDED] 列表无误后，加 --accept-new 重跑：\n` +
                `    node scripts/quality/check-swallow-fallbacks.mjs --update-baseline --accept-new\n`,
        );
        process.exit(1);
    }

    writeBaseline(findings);
    printLine(
        `\n[swallow-fallback] baseline updated: ${findings.length} entries` +
            (added.length > 0 ? ` (含 ${added.length} 条新吸收)` : ""),
    );
    process.exit(0);
}

/** 门禁判定路径。 */
function runGate(findings) {
    const baseline = readBaseline();
    const baselineEntries = baseline.findings ?? [];
    const baselineIds = new Set(baselineEntries.map((item) => item.id));
    const baselineById = new Map(baselineEntries.map((item) => [item.id, item]));

    const currentIds = new Set(findings.map((item) => item.id));
    const matchedBaselineIds = [...baselineIds].filter((id) => currentIds.has(id));
    // 指纹不含行号，所以「baseline 有、当前扫不到」现在**恰好**等价于「该吞错站点真的没了」，
    // 不再被行号漂移污染。这一条是本次修复带来的直接收益。
    const staleBaselineIds = [...baselineIds].filter((id) => !currentIds.has(id));
    const newFindings = findings.filter((item) => !baselineIds.has(item.id));

    const errors = [];

    for (const id of staleBaselineIds) {
        const entry = baselineById.get(id);
        errors.push(
            `- [STALE] ${entry?.file ?? id}:${entry?.line ?? "?"}: baseline entry no longer matches any finding. ` +
                `Retire it with \`node scripts/quality/check-swallow-fallbacks.mjs --update-baseline\` after confirming the swallow site is really gone.`,
        );
    }

    for (const finding of newFindings) {
        const whitelistStatus = validateWhitelist(finding);

        if (!whitelistStatus) {
            errors.push(
                `- [NEW] ${finding.file}:${finding.line}: Missing or invalid @swallow-error comment.\n  Snippet: ${finding.snippet}`,
            );
        } else if (whitelistStatus === "expired") {
            errors.push(
                `- [NEW] ${finding.file}:${finding.line}: @swallow-error whitelist has expired (${finding.whitelist.expires}).\n  Snippet: ${finding.snippet}`,
            );
        }
    }

    for (const finding of findings) {
        if (!baselineIds.has(finding.id)) continue;

        // 对于 baseline 中的存量项：默认仅告警；若 --strict-baseline 或 BASELINE_STRICT=true 则阻断
        const whitelistStatus = validateWhitelist(finding);
        if (!whitelistStatus) {
            const msg = `- [BASELINE] ${finding.file}:${finding.line}: Mandatory @swallow-error comment missing.\n  Snippet: ${finding.snippet}`;
            if (baselineStrict) {
                errors.push(msg);
            } else {
                console.warn(`[swallow-fallback] Warning: ${msg}`);
            }
        } else if (whitelistStatus === "expired") {
            console.warn(
                `[swallow-fallback] Warning: Baseline entry ${finding.file}:${finding.line} has expired whitelist (${finding.whitelist.expires})`,
            );
        }
    }

    if (errors.length > 0) {
        console.error("[swallow-fallback] quality gate failed:");
        errors.forEach((err) => console.error(err));
        console.error("\n[swallow-fallback] All swallowing patterns must have a valid whitelist comment:");
        console.error('// @swallow-error { owner: "your-name", expires: "YYYY-MM-DD" }');
        process.exit(1);
    }

    console.log(
        `[swallow-fallback] quality gate passed (current: ${findings.length}, baseline: ${baselineEntries.length} ` +
            `[matched: ${matchedBaselineIds.length}, stale: ${staleBaselineIds.length}], new: ${newFindings.length})`,
    );
}

function main() {
    const findings = collectFindings();
    if (shouldUpdateBaseline) {
        runUpdateBaseline(findings);
        return;
    }
    runGate(findings);
}

// 只在「被当作脚本直接执行」时跑门禁；被 spec `import` 时只暴露函数。
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
