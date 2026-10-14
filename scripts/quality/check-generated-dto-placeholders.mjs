#!/usr/bin/env node
/**
 * check-generated-dto-placeholders — 生成 DTO「空占位」的只降不升台账。
 *
 * 背景（2026-10-13 跨仓审计 §3 S4）：`scripts/quality/check-generated-dto-strictness.mjs`
 * 只覆盖 `any` / `Record<string, unknown>` / `unknown` 三类**类型放宽**，
 * 而 `export type XxxContractDtoPlaceholder = never;` 这种**空占位**没有任何台账 ——
 * 于是"15 个模块的 DTO 实际是空壳"这件事既不被告警、也不会被棘轮；
 * `Coverage rate: 100.0%` 那类输出更容易让人误以为"契约已全覆盖"。
 *
 * 本门禁给这批空占位建一份**只降不升**的台账：
 *   - 新增占位（新模块 / 新类型名）⇒ 红，要显式 `--update-baseline --accept-new`；
 *   - 占位减少（模块真被补上 DTO）⇒ 允许，并在输出里报"棘轮下降"；
 *   - 台账里的条目若已不复现 ⇒ 视为**待回收**（提示重跑 `--update-baseline` 收口）。
 *
 * 判据的边界（写清以免误读）：本门禁**不判**"该缺的 DTO 是否补齐"——补齐需要后端真源，
 * 属结构性工作（审计 §7 第 8 项后半）；这里只保证**债务不再增长**且**可见**。
 *
 * 用法：
 *   node scripts/quality/check-generated-dto-placeholders.mjs                     # 门禁
 *   node scripts/quality/check-generated-dto-placeholders.mjs --json              # 机器可读
 *   node scripts/quality/check-generated-dto-placeholders.mjs --update-baseline   # 重记（新增需 --accept-new）
 *   node scripts/quality/check-generated-dto-placeholders.mjs --update-baseline --accept-new
 *
 * 退出码：0 通过；1 违规/拒绝写入；2 扫描失败。
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonFormatted } from "./lib/write-json.mjs";

const rootDir = process.cwd();
const baselinePath = path.resolve(rootDir, "scripts/quality/generated-dto-placeholders-baseline.json");

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
const shouldUpdateBaseline = args.has("--update-baseline");
const acceptNew = args.has("--accept-new");

/** `export type Foo = never;`（占位体的唯一形态，见 codegen 输出）。 */
const PLACEHOLDER_RE = /^\s*export\s+type\s+([A-Za-z0-9_]+)\s*=\s*never\s*;?\s*$/;

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

/** 模块名 = `src/<module>/__generated__/dto.ts` 里的 `<module>`（支持多级目录）。 */
export function moduleFromDtoPath(relativePath) {
    const match = /^src\/(.+)\/__generated__\/dto\.ts$/.exec(normalizePath(relativePath));
    return match ? match[1] : null;
}

/**
 * 扫描所有生成 DTO 里的 `= never` 空占位。
 * 返回按 (filePath, typeName) 稳定排序的条目，外加总 DTO 文件数（用于报告占比）。
 */
export function scanDtoPlaceholders(scanRoot = rootDir) {
    const dtoFiles = listGeneratedDtoFiles(path.resolve(scanRoot, "src"));
    const entries = [];

    for (const absPath of dtoFiles) {
        const relativePath = normalizePath(path.relative(scanRoot, absPath));
        const moduleName = moduleFromDtoPath(relativePath);
        const lines = fs.readFileSync(absPath, "utf8").split(/\r?\n/);
        lines.forEach((lineText, index) => {
            const match = PLACEHOLDER_RE.exec(lineText);
            if (!match) return;
            entries.push({
                module: moduleName,
                filePath: relativePath,
                typeName: match[1],
                line: index + 1,
            });
        });
    }

    entries.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.typeName.localeCompare(b.typeName));
    return { entries, dtoFileCount: dtoFiles.length };
}

export function placeholderId(entry) {
    return `${entry.filePath}::${entry.typeName}`;
}

export function readPlaceholderBaseline(filePath = baselinePath) {
    if (!fs.existsSync(filePath)) return { count: 0, entries: [] };
    try {
        const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return {
            count: typeof payload.count === "number" ? payload.count : (payload.entries ?? []).length,
            entries: Array.isArray(payload.entries) ? payload.entries : [],
        };
    } catch {
        return { count: 0, entries: [], parseError: true };
    }
}

function writeStdout(line = "") {
    process.stdout.write(`${line}\n`);
}

function writeStderr(line = "") {
    process.stderr.write(`${line}\n`);
}

function summarize(entries) {
    const byModule = new Map();
    for (const entry of entries) {
        const key = entry.module ?? "(unknown)";
        byModule.set(key, (byModule.get(key) ?? 0) + 1);
    }
    return [...byModule.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function main() {
    const { entries, dtoFileCount } = scanDtoPlaceholders(rootDir);
    const baseline = readPlaceholderBaseline();
    const baselineIds = new Set(baseline.entries.map((entry) => `${entry.filePath}::${entry.typeName}`));

    const newEntries = entries.filter((entry) => !baselineIds.has(placeholderId(entry)));
    const currentIds = new Set(entries.map(placeholderId));
    const staleEntries = baseline.entries.filter((entry) => !currentIds.has(`${entry.filePath}::${entry.typeName}`));

    const summary = {
        dtoFileCount,
        placeholderCount: entries.length,
        placeholderModules: summarize(entries).length,
        newCount: newEntries.length,
        staleCount: staleEntries.length,
        baselineCount: baseline.count,
    };

    if (jsonOutput) {
        writeStdout(JSON.stringify({ ...summary, entries, newEntries, staleEntries }, null, 2));
    }

    if (shouldUpdateBaseline) {
        writeStdout("[generated-dto-placeholders] baseline 变更摘要");
        writeStdout(`  指纹保持   : ${entries.length - newEntries.length}`);
        writeStdout(`  退役(stale): ${staleEntries.length}`);
        writeStdout(`  新增(added): ${newEntries.length}`);
        if (newEntries.length > 0) {
            writeStdout("\n  [ADDED] 当前扫到、baseline 没有（**需要逐条确认**）：");
            for (const entry of newEntries) {
                writeStdout(`    ${entry.filePath}:${entry.line} -> ${entry.typeName}`);
            }
        }
        if (staleEntries.length > 0) {
            writeStdout("\n  [REMOVED] baseline 有、当前扫不到（棘轮下降）：");
            for (const entry of staleEntries) {
                writeStdout(`    ${entry.filePath} -> ${entry.typeName}`);
            }
        }
        if (newEntries.length > 0 && !acceptNew) {
            writeStderr(
                `\n[generated-dto-placeholders] --update-baseline 拒绝写入：有 ${newEntries.length} 条新占位不在台账中。\n` +
                    "  「重记」与「接受新债务」必须分开——确认 [ADDED] 无误后加 --accept-new 重跑。",
            );
            return 1;
        }

        writeJsonFormatted(baselinePath, {
            generatedAt: new Date().toISOString(),
            note:
                "生成 DTO 的 `= never` 空占位台账（只降不升）。新增占位必须显式 --accept-new；" +
                "条目消失（模块补上真 DTO）属棘轮下降，请重跑 --update-baseline 回收。",
            detector: "scripts/quality/check-generated-dto-placeholders.mjs",
            count: entries.length,
            dtoFileCount,
            modules: summarize(entries).map(([moduleName, count]) => ({ module: moduleName, count })),
            entries,
        });
        writeStdout(`\n[generated-dto-placeholders] baseline updated with ${entries.length} entries`);
        return 0;
    }

    if (newEntries.length > 0) {
        writeStderr(
            `[generated-dto-placeholders] quality gate failed: ${newEntries.length} new \`= never\` placeholder(s) detected.`,
        );
        for (const entry of newEntries) {
            writeStderr(`- ${entry.filePath}:${entry.line} -> ${entry.typeName}`);
        }
        writeStderr(
            "[generated-dto-placeholders] 占位是「契约未落地」的可见债；确属新增请跑：\n" +
                "  node scripts/quality/check-generated-dto-placeholders.mjs --update-baseline --accept-new",
        );
        return 1;
    }

    if (!jsonOutput) {
        const modules = summarize(entries);
        writeStdout(
            `[generated-dto-placeholders] ${entries.length} 个空占位 / ${dtoFileCount} 个生成 DTO 文件` +
                `（${modules.length} 个模块；台账 ${baseline.count}）`,
        );
        if (entries.length > 0) {
            writeStdout(
                `  ↳ 只降不升：这批模块的 DTO 仍是空壳 ⇒ 契约文档里的字段未落地为可导入类型：${modules
                    .map(([moduleName, count]) => `${moduleName}(${count})`)
                    .join(", ")}`,
            );
        }
        if (staleEntries.length > 0) {
            writeStdout(`  ↳ 台账有 ${staleEntries.length} 条已不复现（棘轮下降）——请跑 --update-baseline 回收。`);
        }
    }

    return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    try {
        process.exitCode = main();
    } catch (error) {
        writeStderr(`[generated-dto-placeholders] ${error.message}`);
        if (process.env.DTO_PLACEHOLDERS_TRACE) writeStderr(`${error.stack}`);
        process.exitCode = 2;
    }
}
