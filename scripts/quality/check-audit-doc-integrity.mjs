#!/usr/bin/env node

/**
 * 审计文档「章节完整性」哨兵（2026-10-09）。
 *
 * ## 为什么需要它
 *
 * `artifacts/remaining-issues-and-optimization-plan-2026-10-08.md` 在 2026-10-09 一天内被
 * IDE/预览器的**陈旧缓冲区回写**打回旧版多次（实测两次：进入时丢了 §7.6 等 48 行；
 * `prettier --write` 通过后又被回写成"需要重排 224 行"的脏态，险些随提交进库）。
 *
 * 这类事故的特征是**静默丢内容**：文档仍是合法 markdown、`prettier --check` 照样能过、
 * `git status` 只是个 `M` —— 只有人眼逐节比对才会发现。已知的处置纪律（进目录先比
 * 磁盘 vs HEAD、改完同链 add+commit、进库后再校验 blob）都依赖"人记得做"。
 *
 * 已核实：**不存在**可配置的「预览/编辑器白名单」开关（`~/.workbuddy/settings.json`
 * 只有沙箱权限规则），所以只能从**结果侧**兜住 —— 把每份长期维护文档**承诺包含的章节标题**
 * 记成台账，**只增不减**；回写丢掉章节 ⇒ 立刻红。
 *
 * ## 判据（fail-closed）
 *
 * · 台账里每份文档的**章节标题集合**必须仍是当前文档章节标题集合的**子集**（丢失即逐条列出）；
 * · 台账里列出的文件**必须存在**（被删/改名 ⇒ 也要显式 `--refresh`，不许静默消失）；
 * · **新增**章节不算违规（正常演进），但要 `--refresh` 才写进台账。
 *
 * ## 取标题时为什么必须跳过围栏代码块
 *
 * 本仓审计文档里有大量 ```bash / ```rust 片段，其中 `# 注释` 行若被当成 `#` 标题，
 * 或计划片段里的 `## 步骤` 被当成章节 ⇒ 标题集合会随"示例内容改动"而漂移，
 * 于是哨兵要么假红要么假绿。**只认代码块之外的 `##` / `###` / `####`。**
 *
 * 用法：node scripts/quality/check-audit-doc-integrity.mjs [--refresh] [--json]
 * 退出码：0 = 通过（或 refresh 完成）；1 = 有章节丢失 / 文件缺失；2 = 环境问题（读不到台账等）
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeJsonFormatted } from "./lib/write-json.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASELINE_PATH = path.join(projectRoot, "scripts", "quality", "audit-doc-integrity-baseline.json");
const SCAN_DIR = path.join(projectRoot, "artifacts");

const NOTE =
    "审计文档「承诺章节」台账：每份长期维护文档必须仍包含这些章节标题（**只增不减**）。" +
    "IDE/预览器的陈旧缓冲区回写会静默丢章节 —— 丢失即报红；确实要删或改标题时，手工编辑本台账" +
    "（显式动作，会被审阅），`--refresh` 只会做**并集**（只增不减）。";

/**
 * 抽取 markdown 的章节标题（`##` ~ `####`），返回 `"## 标题"` 形式（保留层级）。
 *
 * **跳过围栏代码块**（``` / ~~~）：否则示例里的 `# 注释` / `## 步骤` 会被当成章节，
 * 标题集合随示例内容漂移（哨兵失去意义）。
 *
 * @param {string} markdown
 * @returns {string[]} 按出现顺序（含重复，便于按序比对）
 */
export function extractHeadings(markdown) {
    const text = String(markdown ?? "");
    // 去围栏：成对的 ``` 或 ~~~ 之间的内容整段剔除（非贪婪，按行锚定）
    const withoutFences = text.replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm, "");
    return [...withoutFences.matchAll(/^(#{2,4})[ \t]+(.+?)[ \t]*$/gm)].map((m) => `${m[1]} ${m[2]}`);
}

/**
 * 比较台账与当前文档的标题集合。
 *
 * 纯函数（spec 直接测）。`missing` 用**台账的元素**列出（保持台账顺序、去重），
 * 这样报错信息与台账可逐条对照。
 *
 * @param {{ baseline: string[], current: string[] }} input
 * @returns {{ missing: string[], added: string[], ok: boolean }}
 */
export function diffHeadingSets({ baseline, current }) {
    const cur = new Set(current);
    const base = new Set(baseline);
    const missing = [...new Set(baseline)].filter((h) => !cur.has(h));
    const added = [...new Set(current)].filter((h) => !base.has(h));
    return { missing, added, ok: missing.length === 0 };
}

/** `artifacts/**\/*.md` → 仓库相对路径（排序）。 */
function listAuditDocs(dir = SCAN_DIR) {
    const out = [];
    const walk = (d) => {
        if (!existsSync(d)) return;
        for (const e of readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith(".md")) out.push(path.relative(projectRoot, p).split(path.sep).join("/"));
        }
    };
    walk(dir);
    return out.sort();
}

function readBaseline() {
    if (!existsSync(BASELINE_PATH)) return null;
    const raw = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    return {
        schema_version: raw.schema_version ?? 1,
        note: raw.note ?? NOTE,
        docs: Array.isArray(raw.docs) ? raw.docs : [],
    };
}

function headingsOf(relPath) {
    const abs = path.join(projectRoot, relPath);
    return existsSync(abs) ? extractHeadings(readFileSync(abs, "utf8")) : null;
}

/** 落盘必须走 `writeJsonFormatted`（同步过 prettier）—— 裸 `JSON.stringify` 会把 `lint:js` 弄红。 */
function writeBaseline(baseline) {
    writeJsonFormatted(BASELINE_PATH, baseline);
}

/**
 * `--refresh`：**并集**写回（旧 ∪ 新）—— 棘轮只增不减，与其它台账一致。
 * 新增文档会被收录；已删除的章节标题**不会被移除**（要移除得手工改台账）。
 */
function refresh() {
    const previous = readBaseline();
    const prevByFile = new Map((previous?.docs ?? []).map((d) => [d.file, d.headings ?? []]));
    const docs = [];
    for (const file of listAuditDocs()) {
        const current = headingsOf(file) ?? [];
        const merged = [...new Set([...(prevByFile.get(file) ?? []), ...current])];
        docs.push({ file, headings: merged });
    }
    // 台账里有、但 artifacts/ 下已不存在的文档：**保留**（否则等于静默接受删除）
    for (const [file, headings] of prevByFile) {
        if (!docs.some((d) => d.file === file)) docs.push({ file, headings });
    }
    writeBaseline({ schema_version: 1, note: NOTE, docs });
    const total = docs.reduce((n, d) => n + d.headings.length, 0);
    console.log(`[audit-doc-integrity] 台账已更新：${docs.length} 份文档 / ${total} 条承诺章节`);
    return 0;
}

function check(emitJson) {
    const baseline = readBaseline();
    if (!baseline) {
        console.error(`[audit-doc-integrity] ❌ 台账不存在：${path.relative(projectRoot, BASELINE_PATH)}`);
        console.error(
            "[audit-doc-integrity]    先跑 `node scripts/quality/check-audit-doc-integrity.mjs --refresh` 生成。",
        );
        return 2;
    }
    const missingFiles = [];
    const violations = [];
    for (const doc of baseline.docs) {
        const current = headingsOf(doc.file);
        if (current === null) {
            missingFiles.push(doc.file);
            continue;
        }
        const { missing } = diffHeadingSets({ baseline: doc.headings ?? [], current });
        if (missing.length > 0) violations.push({ file: doc.file, missing });
    }
    if (emitJson) {
        process.stdout.write(`${JSON.stringify({ docs: baseline.docs.length, missingFiles, violations })}\n`);
    }
    if (missingFiles.length === 0 && violations.length === 0) {
        if (!emitJson) {
            console.log(`[audit-doc-integrity] ✅ ${baseline.docs.length} 份审计文档的承诺章节都在（只增不减）`);
        }
        return 0;
    }
    if (missingFiles.length > 0) {
        console.error("[audit-doc-integrity] ❌ 台账里的文档不存在（被删/改名？要接受就手工改台账）：");
        for (const f of missingFiles) console.error(`  · ${f}`);
    }
    for (const v of violations) {
        console.error(`[audit-doc-integrity] ❌ 章节丢失（疑似陈旧缓冲区回写，或误删）：${v.file}`);
        for (const h of v.missing) console.error(`  · ${h}`);
    }
    console.error("[audit-doc-integrity] 提示：先用 `git diff <file>` / `git show HEAD:<file>` 确认是不是回写；");
    console.error("[audit-doc-integrity]      若确实要删章节，手工编辑 audit-doc-integrity-baseline.json。");
    return 1;
}

function main() {
    const argv = process.argv.slice(2);
    if (argv.includes("--refresh")) return refresh();
    return check(argv.includes("--json"));
}

export { BASELINE_PATH, NOTE, listAuditDocs, SCAN_DIR };

const invokedDirectly =
    typeof process.argv[1] === "string" && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
    process.exitCode = main();
}
