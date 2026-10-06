#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { stableId, nextOrdinal } from "./lib/stable-id.mjs";

const rootDir = process.cwd();
const baselinePath = path.resolve(rootDir, "scripts/quality/generated-dto-strictness-baseline.json");

const shouldUpdateBaseline = process.argv.includes("--update-baseline");
const acceptNew = process.argv.includes("--accept-new");

/** `--update-baseline` 摘要里最多逐条打印多少条 [ADDED]，避免刷屏。 */
const ADDED_PRINT_LIMIT = 40;

const riskPatterns = [
    { code: "explicit-any", regex: /\bany\b/g },
    { code: "record-unknown", regex: /Record<string,\s*unknown>/g },
    { code: "bare-unknown", regex: /\bunknown\b/g },
];

/**
 * Blank out string literals before pattern matching.
 *
 * The type `unknown` and the *word* "unknown" are not the same thing: a union member like
 * `trust_level: "verified" | "cross_signed" | "unverified" | "unknown"` is a perfectly
 * narrow string-literal type, but `\bunknown\b` matched the literal and added it to the
 * baseline as if it were a type widening. Stripping literals keeps the baseline honest
 * (it is the number that decides whether the gate is green) at no cost to the real checks:
 * `any` / `Record<string, unknown>` / `unknown` as types never appear inside a literal.
 */
export function stripStringLiterals(lineText) {
    return lineText
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

function writeStdout(line = "") {
    process.stdout.write(`${line}\n`);
}

function writeStderr(line = "") {
    process.stderr.write(`${line}\n`);
}

function normalizePath(value) {
    return value.replaceAll("\\", "/");
}

function listGeneratedDtoFiles(dir) {
    const files = [];
    if (!fs.existsSync(dir)) return files;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const absPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listGeneratedDtoFiles(absPath));
            continue;
        }
        if (
            entry.isFile() &&
            absPath.endsWith(`${path.sep}dto.ts`) &&
            absPath.includes(`${path.sep}__generated__${path.sep}`)
        ) {
            files.push(absPath);
        }
    }

    return files;
}

/**
 * 扫描所有生成 DTO 文件里的风险标记。
 *
 * 指纹由 `lib/stable-id.mjs` 生成，**不含行号**：生成文件往往整段重排，把行号编进身份
 * 会让 baseline 每次重新生成都整批 STALE。行号仍写在条目里，但只是展示字段。
 * 同一文件内**完全相同的行 + 同一个风险码**（例如连续两行 `prop: unknown;`）用 ordinal 区分。
 */
export function scanGeneratedDtoRisks(scanRoot = rootDir) {
    const effectiveSrcDir = path.resolve(scanRoot, "src");
    const items = [];

    for (const absPath of listGeneratedDtoFiles(effectiveSrcDir)) {
        const relativePath = normalizePath(path.relative(scanRoot, absPath));
        const lines = fs.readFileSync(absPath, "utf8").split(/\r?\n/);
        const ordinalCounter = new Map();

        lines.forEach((lineText, index) => {
            const searchable = stripStringLiterals(lineText);
            for (const risk of riskPatterns) {
                risk.regex.lastIndex = 0;
                if (!risk.regex.test(searchable)) continue;

                const snippet = lineText.trim();
                const ordinal = nextOrdinal(ordinalCounter, `${relativePath}\u0000${risk.code}\u0000${snippet}`);

                items.push({
                    id: stableId(relativePath, [risk.code, snippet, ordinal]),
                    filePath: relativePath,
                    line: index + 1,
                    code: risk.code,
                    snippet,
                });
            }
        });
    }

    return items.sort((a, b) => {
        if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
        if (a.line !== b.line) return a.line - b.line;
        return a.code.localeCompare(b.code);
    });
}

export function readBaselineIds(filePath = baselinePath) {
    if (!fs.existsSync(filePath)) return [];
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(payload.ids) ? payload.ids : [];
}

function writeBaseline(items, filePath = baselinePath) {
    const payload = {
        generatedAt: new Date().toISOString(),
        ids: items.map((item) => item.id),
    };
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 4)}\n`, "utf8");
}

/**
 * `--update-baseline` 的写入路径。
 *
 * 与 `check-swallow-fallbacks.mjs` 采用同一约定：「重记」与「赦免新增」必须分开。
 * `added` 非空时默认拒绝写入，要显式 `--accept-new`——否则一次手滑就能把一批新风险
 * 静默洗白。
 */
function runUpdateBaseline(items) {
    const previousIds = new Set(readBaselineIds());
    const currentIds = new Set(items.map((item) => item.id));

    const added = items.filter((item) => !previousIds.has(item.id));
    const removed = [...previousIds].filter((id) => !currentIds.has(id));

    writeStdout(`[generated-dto-strictness] baseline 变更摘要`);
    writeStdout(`  指纹保持   : ${items.length - added.length}`);
    writeStdout(`  退役(stale): ${removed.length}`);
    writeStdout(`  新增(added): ${added.length}`);

    if (added.length > 0) {
        writeStdout(`\n  [ADDED] 当前扫到、baseline 没有（**需要逐条确认**）：`);
        for (const item of added.slice(0, ADDED_PRINT_LIMIT)) {
            writeStdout(`    ${item.code} ${item.filePath}:${item.line} -> ${item.snippet.slice(0, 80)}`);
        }
        if (added.length > ADDED_PRINT_LIMIT) {
            writeStdout(`    …还有 ${added.length - ADDED_PRINT_LIMIT} 条`);
        }
    }
    if (removed.length > 0) {
        writeStdout(`\n  [REMOVED] baseline 有、当前扫不到：`);
        for (const id of removed.slice(0, ADDED_PRINT_LIMIT)) {
            writeStdout(`    ${id}`);
        }
    }

    if (added.length > 0 && !acceptNew) {
        writeStderr(
            `\n[generated-dto-strictness] --update-baseline 拒绝写入：有 ${added.length} 条指纹不在 baseline 中。\n` +
                `  「重记」与「赦免新站点」必须分开——确认上面 [ADDED] 列表无误后，加 --accept-new 重跑。`,
        );
        process.exit(1);
    }

    writeBaseline(items);
    writeStdout(`\n[generated-dto-strictness] baseline updated with ${items.length} entries`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const items = scanGeneratedDtoRisks(rootDir);

    if (shouldUpdateBaseline) {
        runUpdateBaseline(items);
        process.exit(0);
    }

    const baselineIds = new Set(readBaselineIds());
    const newItems = items.filter((item) => !baselineIds.has(item.id));

    if (newItems.length > 0) {
        writeStderr("[generated-dto-strictness] quality gate failed: new generated DTO risk markers detected");
        for (const item of newItems) {
            writeStderr(`- ${item.code} ${item.filePath}:${item.line} -> ${item.snippet}`);
        }
        writeStderr(
            "[generated-dto-strictness] Run: node scripts/quality/check-generated-dto-strictness.mjs --update-baseline",
        );
        process.exit(1);
    }

    writeStdout(`[generated-dto-strictness] quality gate passed (current: ${items.length}, new: ${newItems.length})`);
}
