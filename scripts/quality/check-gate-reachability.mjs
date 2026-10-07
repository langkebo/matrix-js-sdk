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
 * 脚本盘点（2026-10-07 增）:
 *   枚举范围从"自称 exit-1 的门禁"扩到 **scripts/ 下全部脚本**（旧实现看不见
 *   不含 exit-1 的诊断/报告脚本 —— 那正是 §7.11-2 里 probe-contract-drift.mjs
 *   坏了半年没人知道的根因）。凡是进不了 lint/CI 链路的脚本都会被列出：
 *     · 有接线的人工工具 —— INFO（需活后端 / 报告生成器，允许不常跑）
 *     · 零引用孤岛     —— 记入 orphan-scripts-baseline.json；未登记即报错，
 *                          台账腐烂（条目已接线 / 文件已删 / 缺 reason）也报错。
 *   于是"全仓有多少脚本写完没人跑"变成一个**只能变小的数字**。
 *
 * 退出码:
 *   0 = 无死门禁；且 waiver / 孤岛台账均无腐烂，且无未登记孤岛
 *   1 = 存在不可达且未 waive 的门禁，或台账腐烂，或出现未登记的孤岛脚本
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
 * "受管辖门禁" 的判据 = **路径形状**，与它是否自称 exit-1 **无关**。
 *
 * 历史教训（两轮，同一类缺陷）：
 *   1. 旧实现用「正文含 `process.exitCode = 1`」**收集**脚本 ⇒ 不含 exit-1 的诊断脚本
 *      （`scripts/quality/probe-contract-drift.mjs`）对门禁完全隐形，坏了半年没人知道。
 *   2. 修完收集，仍用「自称 exit-1」**判定受管辖** ⇒ 把 18 个 `check-*-granular-coverage.mjs`
 *      的判定逻辑抽到共享库后，这 18 个文件正文不再有 exit-1，会集体**掉出强制范围**
 *      （44 → 26），门禁覆盖率凭空缩水。**抽库是好事，门禁却变松了**——不可接受。
 *
 * 结论：**是不是门禁由路径说了算**（`scripts/quality/` 下、或以 check-/verify-/validate-/
 * assert-/enforce- 开头）；正文里有没有 exit-1 只能用来**打 INFO 标签**，不能用来免检。
 *
 * 唯一例外：`lib/` 下的共享库按约定不是门禁（它们是被门禁 import 的实现），排除。
 */
const GATE_LIKE = /^scripts\/quality\/|(^|\/)(?:check|verify|validate|assert|enforce)-[\w.-]*\.[cm]?js$/;

/** 共享库目录：`scripts/**\/lib/*.mjs` 是被门禁 import 的实现，不是门禁本身 */
const SHARED_LIB = /(^|\/)lib\/[^/]+\.[cm]?js$/;

/**
 * 受管辖判据（纯函数，spec 直接测它）。
 *
 * 路径像门禁 **且** 不是共享库。**不看**正文有没有 exit-1 —— 理由见 GATE_LIKE 注释：
 * 用「自称 exit-1」当判据，会让把判定逻辑抽到共享库的门禁集体掉出管辖范围。
 *
 * @param rel 仓库根相对路径（POSIX 分隔符）
 */
export function isGoverned(rel) {
    return GATE_LIKE.test(rel) && !SHARED_LIB.test(rel);
}

/** 动态派发标记：`@discovers-gates: <glob>` */
const DISCOVER_MARKER = /@discovers-gates:\s*(\S+)/g;

const WAIVERS_PATH = path.join(__dirname, "gate-reachability-waivers.json");

/**
 * 孤岛脚本台账（`scripts/` 下**零引用**脚本的显式登记）。
 * 与 waiver 台账同一套纪律：登记要写 reason，且**腐烂即报错**——
 *   · 台账里有、但实际已接线 ⇒ 必须删条目（说明已修好）
 *   · 台账里有、但文件已不存在 ⇒ 必须删条目
 * 目的：把"全仓有多少脚本写完没人跑"变成一个**只能变小的数字**。
 */
const ORPHANS_PATH = path.join(__dirname, "orphan-scripts-baseline.json");

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

// ─────────────────── 1. 收集 scripts/ 下的全部脚本 ───────────────────

/**
 * 收集 `scripts/` 下**全部**可执行脚本，并标出哪些"自称门禁"（正文含 exit-1）。
 *
 * 为什么不能只收 exit-1 脚本（2026-10-07 修）:
 *   旧实现只把 `process.exitCode = 1` 的脚本放进视野。于是
 *   `scripts/quality/probe-contract-drift.mjs`（78 行、**不含** exit-1）对门禁
 *   **完全不可见** —— 它坏了半年也没人知道（审计 §7.11-2）。
 *   "自称门禁"只适合用来**分类**（是不是判定门禁），不适合用来**枚举**
 *   （仓里到底有哪些脚本）。枚举必须由目录决定：`scripts/` 下每个脚本都要被盘到，
 *   否则"写完再没人跑过"这一整类缺陷永远无法被检出。
 */
function collectScripts() {
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
            if (/\.d\.(mts|ts|mjs|cjs)$/.test(entry.name)) continue; // 类型声明不是脚本
            const rel = toRel(abs);
            const text = readIfExists(abs);
            if (text === null) continue;
            found.push({
                file: rel,
                text,
                code: stripComments(text), // 去注释后用于"谁调用了谁"，防注释自指假绿
                selfGate: rel !== SELF_REL && GATE_PATTERN.test(text),
            });
        }
    };
    walk(path.join(rootDir, "scripts"));
    return found.sort((a, b) => a.file.localeCompare(b.file));
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

/**
 * 去掉 `//` 行注释与 `/* *\/` 块注释，保留字符串字面量内容。
 *
 * 为什么必须去注释（2026-10-07 修）:
 *   可达性是"**谁调用了它**"，不是"**谁提到了它**"。若把注释也算进来，
 *   在任一个可达脚本的注释里写一句 `scripts/quality/xxx.mjs`，就能把 xxx
 *   伪造成"可达"——本门禁自己的文档注释里就写着 `probe-contract-drift.mjs`，
 *   于是那个**零引用**脚本被自己的说明文字"救活"了（实测复现）。
 *   这类自指假绿比漏报更危险：它让"没人跑"看起来像"有人跑"。
 */
function stripComments(text) {
    let out = "";
    // null | 字符串引号(') | line | block | regex | regexClass
    let state = null;
    // 最近一个"非空白且有语法意义"的字符 —— 用来判断 `/` 是除号还是正则起始
    let prev = "";
    for (let i = 0; i < text.length; i += 1) {
        const c = text[i];
        const d = text[i + 1];
        if (state === null) {
            if (c === "/" && d === "/") {
                state = "line";
                continue;
            }
            if (c === "/" && d === "*") {
                state = "block";
                i += 1;
                continue;
            }
            if (c === '"' || c === "'" || c === "`") {
                state = c;
                out += c;
                prev = c;
                continue;
            }
            // 正则字面量：`/` 出现在"期待表达式"的位置（赋值/分隔/左括号之后）
            if (c === "/" && /[=(,:;[!&|?{}\n]|^$/.test(prev)) {
                state = "regex";
                out += c;
                prev = c;
                continue;
            }
            out += c;
            if (!/\s/.test(c)) prev = c;
            continue;
        }
        if (state === "line") {
            if (c === "\n") {
                state = null;
                out += c;
                prev = "";
            }
            continue;
        }
        if (state === "block") {
            if (c === "*" && d === "/") {
                state = null;
                i += 1;
                prev = "";
            }
            continue;
        }
        // 正则体内：整段保留，遇到未被转义的 `/` 才结束（`[...]` 内的 `/` 不算）
        if (state === "regex" || state === "regexClass") {
            out += c;
            if (c === "\\") {
                out += d ?? "";
                i += 1;
                continue;
            }
            if (state === "regex" && c === "[") state = "regexClass";
            else if (state === "regexClass" && c === "]") state = "regex";
            else if (state === "regex" && c === "/") {
                state = null;
                prev = "/";
            }
            continue;
        }
        // 字符串内：整段保留（`node scripts/x.mjs` 常写在模板串/参数里）
        out += c;
        if (c === "\\") {
            out += d ?? "";
            i += 1;
        } else if (c === state) {
            state = null;
            prev = c;
        }
    }
    return out;
}

/**
 * 从一段文本里抽出被引用的 npm script 名与脚本文件路径。
 *
 * `baseDir` = 这段文本所属文件所在的目录（仓库根相对，posix 分隔）。
 * 相对引用（`./x.mjs` / `../lib/y.mjs`）必须**相对引用者**解析：旧实现把它们当成
 * 仓库根相对，于是 `scripts/quality/check-*.mjs` 里的 `import "./lib/stable-id.mjs"`
 * 会被解析成根下的 `lib/stable-id.mjs`（不存在）⇒ 整张 import 图断开，
 * 共享库会被误判成孤岛。CI 的 `run:` 文本没有所属文件，baseDir 传空串即"根相对"。
 */
function extractReferences(text, baseDir = "") {
    const scripts = new Set();
    const files = new Set();
    for (const m of text.matchAll(/pnpm(?:\s+run)?\s+([A-Za-z0-9:_-]+)/g)) scripts.add(m[1]);
    for (const m of text.matchAll(
        /(?:^|[\s"'`([])((?:\.{1,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.(?:mjs|cjs|js|ts|sh))(?=[\s"'`\]|&;)]|$)/gm,
    )) {
        const raw = m[1];
        if (!raw.includes("/")) continue; // 裸文件名不是路径
        if (raw.startsWith("./") || raw.startsWith("../")) {
            files.add(path.posix.normalize(path.posix.join(baseDir, raw)));
        } else {
            files.add(raw); // 仓库根相对（如 `scripts/quality/x.mjs`）
        }
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
    const queue = [{ kind: "script", value: "lint", base: "" }];

    for (const cmd of workflowCommands) {
        const { scripts: s, files: f } = extractReferences(cmd, "");
        for (const name of s) queue.push({ kind: "script", value: name, base: "" });
        for (const file of f) queue.push({ kind: "file", value: file, base: "" });
        // 直接写在 run 里的 `pnpm lint` 之类已被上面覆盖
    }
    // 兜底：CI 直接 `node scripts/...` 的调用已在 files 里

    const seen = new Set();
    while (queue.length > 0) {
        const node = queue.pop();
        const key = `${node.kind}:${node.value}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // raw = 原文（注释也要，因为 @discovers-gates 标记按约定写在注释里）
        // code = 去注释后的正文（只有它才代表"真的调用了谁"）
        let raw = null;
        let code = null;
        let base = "";
        if (node.kind === "script") {
            reachableScripts.add(node.value);
            const body = scripts[node.value];
            if (body === undefined) continue; // 未知 script，忽略
            raw = body;
            code = body; // shell 正文，不做 JS 注释处理
        } else {
            const abs = path.join(rootDir, node.value);
            if (!fs.existsSync(abs)) continue;
            reachableFiles.add(node.value);
            raw = readIfExists(abs) ?? "";
            code = stripComments(raw); // 注释不算"调用"
            // 该文件内的相对引用，要相对它自己的目录解析
            base = path.posix.dirname(node.value);
        }

        const { scripts: nextScripts, files: nextFiles } = extractReferences(code, base);
        for (const name of nextScripts) queue.push({ kind: "script", value: name, base: "" });
        for (const file of nextFiles) queue.push({ kind: "file", value: file, base: "" });

        // 动态派发：可达脚本自描述它按什么 glob 发现成员（标记在注释里 ⇒ 用 raw）
        for (const m of raw.matchAll(DISCOVER_MARKER)) {
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

/**
 * 收集 spec/ 下**真正引用到的脚本路径**（去注释后按 spec 文件自身目录解析）。
 *
 * 只认"路径级"引用（`new URL("../../scripts/x.cjs", import.meta.url)` / `import ... from`），
 * 不认"文本里出现过脚本名"：`expect(GATE_LIKE.test("scripts/audit/compare-routes.mjs")).toBe(false)`
 * 这类**反例夹具**若被当成接线，会把真孤岛从台账里抹掉（实测发生过）。
 */
function collectSpecReferences() {
    const refs = new Set();
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
            if (!/\.(ts|tsx|mts|cts)$/.test(entry.name)) continue;
            const text = readIfExists(abs);
            if (text === null) continue;
            const baseDir = toRel(dir);
            const { files } = extractReferences(stripComments(text), baseDir);
            for (const f of files) refs.add(f);
        }
    };
    walk(path.join(rootDir, "spec"));
    return refs;
}

/** 读取孤岛台账；缺文件视为"尚未建档"（只 INFO，不阻断） */
function loadOrphansBaseline() {
    const text = readIfExists(ORPHANS_PATH);
    if (text === null) return { entries: [], exists: false };
    try {
        const parsed = JSON.parse(text);
        return { entries: Array.isArray(parsed.orphans) ? parsed.orphans : [], exists: true };
    } catch (error) {
        console.error(`[gate-reachability] ✗ 孤岛台账无法解析: ${error.message}`);
        process.exitCode = 1;
        return { entries: [], exists: false };
    }
}

// ─────────────────── 主流程 ───────────────────

function main() {
    const pkgPath = path.join(rootDir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

    const all = collectScripts();
    const gates = all.filter((s) => isGoverned(s.file)).map((s) => s.file);
    // 其余一切脚本（人工工具 / 报告器 / 共享库…）：不入门禁判定，但**必须被盘出来**
    const nonGates = all.filter((s) => !isGoverned(s.file)).map((s) => s.file);
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
        `[gate-reachability] scripts/ 下脚本 ${all.length} 个：受管辖门禁 ${gates.length} 个` +
            `（其中 ${gates.filter((f) => all.find((s) => s.file === f)?.selfGate).length} 个自称 exit-1，其余靠路径认定）` +
            `，非门禁脚本 ${nonGates.length} 个`,
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

    // ── 脚本盘点：把"哪些脚本不在 lint/CI 链路内"完整盘出来 ───────────────────
    //   旧实现只看 exit-1 脚本 ⇒ `probe-contract-drift.mjs` 这类**不含 exit-1** 的
    //   诊断/报告脚本完全隐身（审计 §7.11-2 的根因）。现在按目录枚举，一个不漏。
    const npmBodies = Object.values(pkg.scripts ?? {});
    const specRefs = collectSpecReferences();
    const stemOf = (rel) => path.basename(rel).replace(/\.(mjs|cjs|js|ts|sh)$/, "");

    /**
     * 是否有任一"接线点"提到它：npm script 正文 / 其它脚本正文（去注释）/ spec 里的路径引用。
     *
     * 孤岛的定义要的是**执行**，不是**提及** —— 所以：
     *   · 脚本正文要先 `stripComments`（注释里的路径不算调用）；
     *   · spec 只认**解析得到的路径**，不认文本里出现的名字（反例夹具会制造假接线）。
     */
    const wiredSomewhere = (rel) => {
        const stem = stemOf(rel);
        if (npmBodies.some((body) => body.includes(rel) || body.includes(stem))) return true;
        if (specRefs.has(rel)) return true;
        return all.some((s) => s.file !== rel && s.code.includes(stem));
    };

    const unreachableNonGates = nonGates.filter((rel) => !isReachable(rel));
    const wiredTools = unreachableNonGates.filter((rel) => wiredSomewhere(rel));
    const orphans = unreachableNonGates.filter((rel) => !wiredSomewhere(rel)).sort();

    console.log(
        `[gate-reachability] 未接入 lint/CI 链路: ${unreachableNonGates.length} 个` +
            `（有接线的人工工具 ${wiredTools.length} / 零引用孤岛 ${orphans.length}）`,
    );
    if (wiredTools.length > 0) {
        console.log("[gate-reachability] INFO: 有接线、但不在 lint/CI 链路（人工工具，不阻断）:");
        for (const tool of wiredTools) console.log(`  · ${tool}`);
    }

    // ── 孤岛台账（只能变小的数字）────────────────────────────────────────────
    const { entries: orphanEntries, exists: orphansExists } = loadOrphansBaseline();
    const orphanLedger = new Map(orphanEntries.map((e) => [e.file, e]));
    const unexplainedOrphans = orphans.filter((rel) => !orphanLedger.has(rel));
    const staleOrphans = [];
    for (const [file, entry] of orphanLedger) {
        if (!fs.existsSync(path.join(rootDir, file))) {
            staleOrphans.push({ file, why: "文件已不存在" });
            continue;
        }
        if (!orphans.includes(file)) {
            staleOrphans.push({ file, why: "已接线（或被测试引用），台账条目应删除" });
            continue;
        }
        if (!entry.reason || String(entry.reason).trim() === "") {
            staleOrphans.push({ file, why: "缺 reason 字段" });
        }
    }

    if (orphans.length > 0) {
        console.log(`[gate-reachability] 孤岛脚本（零引用，写完再没人跑）${orphans.length} 个:`);
        for (const rel of orphans) {
            const e = orphanLedger.get(rel);
            console.log(`  · ${rel}${e ? `  [已登记] ${e.reason}` : "  ⚠️ 未登记"}`);
        }
    }

    if (unexplainedOrphans.length > 0 && orphansExists) {
        console.error("");
        console.error("[gate-reachability] ✗ 出现未登记的孤岛脚本（零引用 ⇒ 写完再没人跑）:");
        for (const rel of unexplainedOrphans) console.error(`  · ${rel}`);
        console.error("  修法二选一：");
        console.error("    (a) 接进入口（npm script + lint / CI 步骤）；");
        console.error(`    (b) 确认它是有意保留的人工工具，在 ${toRel(ORPHANS_PATH)} 登记并写明 reason。`);
    }
    if (staleOrphans.length > 0) {
        console.error("");
        console.error("[gate-reachability] ✗ 孤岛台账腐烂:");
        for (const w of staleOrphans) console.error(`  · ${w.file} —— ${w.why}`);
        console.error("  腐烂的条目必须删除（修一条删一条），否则台账会变成假账。");
    }
    if (!orphansExists && orphans.length > 0) {
        console.log(
            `[gate-reachability] 提示: 未找到 ${toRel(ORPHANS_PATH)}，孤岛仅 INFO 不阻断（建议建档以钉住数量）。`,
        );
    }

    if (dead.length > 0) {
        console.error("");
        console.error("[gate-reachability] ✗ 以下受管辖门禁（按路径认定，不要求自称 exit-1）无法从 lint/CI 到达:");
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

    const orphansBlocked = orphansExists && unexplainedOrphans.length > 0;
    if (dead.length === 0 && staleWaivers.length === 0 && staleOrphans.length === 0 && !orphansBlocked) {
        console.log(
            `[gate-reachability] ✅ 无死门禁（可达 ${gates.length - waivedCount} 个 / 豁免 ${waivedCount} 个）；` +
                `孤岛脚本 ${orphans.length} 个（均已登记）。`,
        );
        return 0;
    }
    process.exitCode = 1;
    return 1;
}

// 纯函数导出给 spec 用（P6：门禁自己也要被测）。副作用式入口在下面用 invokedDirectly 兜住。
export { GATE_LIKE, GATE_PATTERN, SHARED_LIB, extractReferences, globToRegExp, stripComments };

// 只有"被直接执行"时才跑 main —— 被 spec import 时不得有副作用（否则会污染退出码）。
const invokedDirectly =
    typeof process.argv[1] === "string" && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
    try {
        process.exitCode = main();
    } catch (error) {
        console.error(`[gate-reachability] ✗ 执行失败: ${error.message}`);
        if (process.env.GATE_REACHABILITY_TRACE) console.error(error.stack);
        process.exitCode = 1;
    }
}
