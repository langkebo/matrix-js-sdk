#!/usr/bin/env node
/**
 * check-gate-reachability.mjs —— 死门禁门禁（"这个门禁到底会不会被执行"）
 *
 * 背景:
 *   本仓有大量脚本会在失败时 `process.exitCode = 1` / `process.exit(1)`，
 *   即它们**自称是判定门禁**。但"自称"不等于"会被执行"——2026-10-05 两轮体检
 *   实measure到过两类真实缺陷:
 *     1. 18 个 `check-*-granular-coverage.mjs` 有 npm script、却没有任何
 *        入口调用那些 script（"看起来有门禁、实际从不执行"）；
 *     2. `check-contract-freshness.mjs`（有单测、无入口）、
 *        `check-contract-provenance.mjs`（全仓零引用，却是已文档化 PR 策略的执行器）。
 *   本门禁把这次手工排查固化成自动化判定，防止同一类缺陷复发。
 *
 * 判定判据（**可达性**，不是"有没有出现在某个 script 里"）:
 *   根 = π(lint) ∪ { workflow `run:` 里出现的所有 `pnpm <script>` / `node <file>` }
 *   闭包 = 沿 npm script body 与脚本内的路径字面量展开
 *   动态派发 = 若某个可达脚本的正文带 `@discovers-gates: <glob>` 标记，
 *              则把匹配该 glob 的脚本一并视为可达（用于"按 package.json 自动发现"的聚合入口）
 *
 * 为什么必须建模动态派发:
 *   只做静态闭包会把聚合入口的成员全部误报为死门禁（实测误报 18 个）。
 *   让派发器**自描述**（写一行机器可读标记）比在检测脚本里硬编码清单更耐用。
 *
 * 为什么必须解析 `run: |` 多行块:
 *   .github/workflows 里有 24 处多行 run 块。只看单行 `run:` 会漏掉大量真实调用，
 *   把"其实有跑"的门禁误报成死门禁。
 *
 * 退出码:
 *   0 = 无死门禁；且 waiver 台账无腐烂
 *   1 = 存在不可达且未 waive 的门禁，或 waiver 已腐烂（文件不存在 / 已可达却仍挂着）
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");

/** 本脚本自身会含 `process.exitCode = 1` 字样，必须排除，否则自指 */
const SELF_REL = "scripts/quality/check-gate-reachability.mjs";

/** 自称门禁的判定：正文里出现这两者之一 */
const GATE_PATTERN = /process\.exitCode\s*=\s*1|process\.exit\(\s*1\s*\)/;

/**
 * "自称门禁" ≠ "真的是判定门禁"。
 * 大量 CLI 工具（用法错误、需要活后端的 runner、报告生成器）也会 exit 1，
 * 把它们全算进门禁会让 waiver 台账变成垃圾桶（实测 9 个不可达里有 7 个属于此类）。
 * 因此只有下面两类才算**受管辖的门禁**：
 *   1. 位于 `scripts/quality/` 之下 —— 该目录按约定只放门禁；
 *   2. 文件名以 check-/verify-/validate-/assert-/enforce- 开头（任意目录）。
 * 其余 exit-1 脚本作为 INFO 列出（保持可见，但不阻断），避免"看不到"。
 */
const GATE_LIKE = /^scripts\/quality\/|(^|\/)(?:check|verify|validate|assert|enforce)-[\w.-]*\.[cm]?js$/;

/** 动态派发标记：`@discovers-gates: <glob>` */
const DISCOVER_MARKER = /@discovers-gates:\s*(\S+)/g;

const WAIVERS_PATH = path.join(__dirname, "gate-reachability-waivers.json");

// ────────────────────────────── 工具 ──────────────────────────────

const toRel = (abs) => path.relative(rootDir, abs).split(path.sep).join("/");

/** 把简易 glob（* / **）编译为正则 */
function globToRegExp(glob) {
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "\u0000")
        .replace(/\*/g, "[^/]*")
        .replace(/\u0000/g, ".*");
    return new RegExp(`^${escaped}$`);
}

function readIfExists(file) {
    try {
        return fs.readFileSync(file, "utf8");
    } catch {
        return null;
    }
}

// ─────────────────── 1. 收集所有"自称门禁"的脚本 ───────────────────

/** 收集 scripts/ 下所有会在失败时 exit 1 的脚本（含工具类，后续再分类） */
function collectExitOneScripts() {
    const found = [];
    const walk = (dir) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(abs);
                continue;
            }
            if (!/\.(mjs|cjs|js)$/.test(entry.name)) continue;
            const rel = toRel(abs);
            if (rel === SELF_REL) continue;
            const text = readIfExists(abs);
            if (text !== null && GATE_PATTERN.test(text)) found.push(rel);
        }
    };
    walk(path.join(rootDir, "scripts"));
    return found.sort();
}

// ─────────────────── 2. 从 workflow 里提取调用点 ───────────────────

/**
 * 解析 .github/workflows/*.y{a,}ml，返回所有 run 命令文本。
 * 同时支持单行 `run: cmd` 与多行 `run: |` / `run: >` 块。
 */
function collectWorkflowRunCommands() {
    const dir = path.join(rootDir, ".github", "workflows");
    const commands = [];
    let files;
    try {
        files = fs.readdirSync(dir);
    } catch {
        return commands;
    }
    for (const name of files) {
        if (!/\.ya?ml$/.test(name)) continue;
        const lines = (readIfExists(path.join(dir, name)) ?? "").split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i];
            const m = line.match(/^(\s*)(?:-\s*)?run:\s*([|>])?\s*(.*)$/);
            if (!m) continue;
            const [, indent, blockMarker, rest] = m;
            if (blockMarker) {
                // 多行块：收集缩进比 `run:` 这一行更深的后续行
                const keyIndent = indent.length;
                const body = [];
                for (let j = i + 1; j < lines.length; j += 1) {
                    const next = lines[j];
                    if (next.trim() === "") {
                        body.push("");
                        continue;
                    }
                    const nextIndent = next.match(/^\s*/)[0].length;
                    if (nextIndent <= keyIndent) break;
                    body.push(next);
                }
                commands.push(body.join("\n"));
            } else if (rest.trim() !== "") {
                commands.push(rest);
            }
        }
    }
    return commands;
}

/** 从一段命令文本里抽出被引用的 npm script 名与脚本文件路径 */
function extractReferences(text) {
    const scripts = new Set();
    const files = new Set();
    for (const m of text.matchAll(/pnpm(?:\s+run)?\s+([A-Za-z0-9:_-]+)/g)) scripts.add(m[1]);
    for (const m of text.matchAll(
        /(?:^|[\s"'[])((?:\.\.?\/)?[\w@.-]+(?:\/[\w@.-]+)*\.(?:mjs|cjs|js|ts|sh))(?=[\s"'\]|&;)]|$)/gm,
    )) {
        const p = m[1].replace(/^\.\//, "");
        if (!p.includes("/")) continue; // 忽略裸文件名
        files.add(p);
    }
    return { scripts, files };
}

// ─────────────────── 3. 可达性闭包 ───────────────────

function computeReachable(pkg) {
    const scripts = pkg.scripts ?? {};
    const workflowCommands = collectWorkflowRunCommands();

    const reachableScripts = new Set();
    const reachableFiles = new Set();
    /** 根节点：lint 是所有开发/CI 共同入口 */
    const queue = [{ kind: "script", value: "lint" }];

    for (const cmd of workflowCommands) {
        const { scripts: s, files: f } = extractReferences(cmd);
        for (const name of s) queue.push({ kind: "script", value: name });
        for (const file of f) queue.push({ kind: "file", value: file });
        // 直接写在 run 里的 `pnpm lint` 之类已被上面覆盖
    }
    // 兜底：CI 直接 `node scripts/...` 的调用已在 files 里

    const seen = new Set();
    while (queue.length > 0) {
        const node = queue.pop();
        const key = `${node.kind}:${node.value}`;
        if (seen.has(key)) continue;
        seen.add(key);

        let text = null;
        if (node.kind === "script") {
            reachableScripts.add(node.value);
            const body = scripts[node.value];
            if (body === undefined) continue; // 未知 script，忽略
            text = body;
        } else {
            const abs = path.join(rootDir, node.value);
            if (!fs.existsSync(abs)) continue;
            reachableFiles.add(node.value);
            text = readIfExists(abs) ?? "";
        }

        const { scripts: nextScripts, files: nextFiles } = extractReferences(text);
        for (const name of nextScripts) queue.push({ kind: "script", value: name });
        for (const file of nextFiles) queue.push({ kind: "file", value: file });

        // 动态派发：可达脚本自描述它按什么 glob 发现成员
        for (const m of text.matchAll(DISCOVER_MARKER)) {
            const re = globToRegExp(m[1]);
            const walk = (dir) => {
                let entries;
                try {
                    entries = fs.readdirSync(dir, { withFileTypes: true });
                } catch {
                    return;
                }
                for (const entry of entries) {
                    const abs = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        walk(abs);
                        continue;
                    }
                    const rel = toRel(abs);
                    if (re.test(rel)) reachableFiles.add(rel);
                }
            };
            walk(path.join(rootDir, "scripts"));
        }
    }

    return { reachableScripts, reachableFiles, workflowCommands };
}

// ─────────────────── 4. waiver 台账 ───────────────────

function loadWaivers() {
    const text = readIfExists(WAIVERS_PATH);
    if (text === null) return { waivers: [], missingFile: true };
    try {
        const parsed = JSON.parse(text);
        return { waivers: Array.isArray(parsed.waivers) ? parsed.waivers : [], missingFile: false };
    } catch (error) {
        console.error(`[gate-reachability] ✗ waiver 台账无法解析: ${error.message}`);
        process.exitCode = 1;
        return { waivers: [], missingFile: false };
    }
}

// ─────────────────── 主流程 ───────────────────

function main() {
    const pkgPath = path.join(rootDir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

    const exitOne = collectExitOneScripts();
    const gates = exitOne.filter((rel) => GATE_LIKE.test(rel));
    const tools = exitOne.filter((rel) => !GATE_LIKE.test(rel));
    const { reachableScripts, reachableFiles, workflowCommands } = computeReachable(pkg);

    const isReachable = (rel) => {
        if (reachableFiles.has(rel)) return true;
        // 也被 npm script 引用且该 script 可达 => 可达
        const owners = Object.entries(pkg.scripts ?? {}).filter(([, body]) => body.includes(rel));
        return owners.some(([name]) => reachableScripts.has(name));
    };

    const { waivers, missingFile } = loadWaivers();
    const waived = new Map(waivers.map((w) => [w.file, w]));

    console.log("=".repeat(72));
    console.log(
        `[gate-reachability] scripts/ 下 exit-1 脚本 ${exitOne.length} 个 → 受管辖门禁 ${gates.length} 个 / 工具类 ${tools.length} 个`,
    );
    console.log(`[gate-reachability] 入口根: lint + ${workflowCommands.length} 段 workflow run 命令`);
    console.log(`[gate-reachability] 可达 npm script ${reachableScripts.size} 个`);
    console.log("=".repeat(72));

    const dead = [];
    let waivedCount = 0;
    for (const gate of gates) {
        if (isReachable(gate)) continue;
        if (waived.has(gate)) {
            waivedCount += 1;
            continue;
        }
        dead.push(gate);
    }

    // waiver 腐烂检测：文件不存在 / 已可达却仍挂着 / 缺 reason
    const staleWaivers = [];
    for (const [file, entry] of waived) {
        if (!fs.existsSync(path.join(rootDir, file))) {
            staleWaivers.push({ file, why: "文件已不存在" });
            continue;
        }
        if (isReachable(file)) {
            staleWaivers.push({ file, why: "已可从 lint/CI 到达，waiver 应删除" });
            continue;
        }
        if (!entry.reason || String(entry.reason).trim() === "") {
            staleWaivers.push({ file, why: "缺 reason 字段" });
        }
    }

    // 工具类：仅 INFO（保持可见，不阻断）
    const unreachableTools = tools.filter((rel) => !isReachable(rel));
    if (unreachableTools.length > 0) {
        console.log(
            `[gate-reachability] INFO: ${unreachableTools.length} 个 exit-1 工具类脚本不在 lint/CI 链路内` +
                `（需活后端的 dev 工具 / 报告生成器，非判定门禁，不阻断）:`,
        );
        for (const tool of unreachableTools) console.log(`  · ${tool}`);
    }

    if (dead.length > 0) {
        console.error("");
        console.error("[gate-reachability] ✗ 以下脚本自称门禁（会 exit 1），但无法从 lint/CI 到达:");
        for (const gate of dead) console.error(`  · ${gate}`);
        console.error("");
        console.error("  修法二选一：");
        console.error("    (a) 接进入口（npm script + lint / CI workflow 步骤）；");
        console.error("    (b) 若它只是需活后端的开发工具或报告生成器，");
        console.error(`        在 ${toRel(WAIVERS_PATH)} 里登记豁免并写明 reason。`);
    }

    if (staleWaivers.length > 0) {
        console.error("");
        console.error("[gate-reachability] ✗ waiver 台账腐烂:");
        for (const w of staleWaivers) console.error(`  · ${w.file} —— ${w.why}`);
        console.error("  腐烂的 waiver 必须删除（修一条删一条），否则台账会变成假账。");
    }

    if (missingFile) {
        console.log(`[gate-reachability] 提示: 未找到 ${toRel(WAIVERS_PATH)}，视为无豁免。`);
    }

    if (dead.length === 0 && staleWaivers.length === 0) {
        console.log(
            `[gate-reachability] ✅ 无死门禁（可达 ${gates.length - waivedCount} 个 / 豁免 ${waivedCount} 个）。`,
        );
        return 0;
    }
    process.exitCode = 1;
    return 1;
}

try {
    process.exitCode = main();
} catch (error) {
    console.error(`[gate-reachability] ✗ 执行失败: ${error.message}`);
    if (process.env.GATE_REACHABILITY_TRACE) console.error(error.stack);
    process.exitCode = 1;
}
