#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonFormatted } from "./lib/write-json.mjs";
import { planBaselineWrite } from "./lib/baseline-update.mjs";

const rootDir = process.cwd();
const srcDir = path.resolve(rootDir, "src");
const baselinePath = path.resolve(rootDir, "scripts/quality/technical-debt-baseline.json");
const outputJsonPath = path.resolve(rootDir, "scripts/quality/technical-debt-inventory.json");
const outputCsvPath = path.resolve(rootDir, "scripts/quality/technical-debt-inventory.csv");

const shouldUpdateBaseline = process.argv.includes("--update-baseline");
const strictMode = process.argv.includes("--strict");
/**
 * `--update-baseline` 在出现**新**债务标记时默认拒绝写入，要显式加这个开关。
 * 「重记」与「赦免新增债务」必须分开 —— 后者不该由一条命令默默完成。
 */
const acceptNew = process.argv.includes("--accept-new");
/** 一次 `--update-baseline` 最多逐条打印多少条 [ADDED]，避免刷屏。 */
const ADDED_PRINT_LIMIT = 40;

const markerPattern = /\b(TODO|FIXME|HACK|XXX)\b[:]?\s*(.*)$/;
const isoDatePattern = /\b(20\d{2}-\d{2}-\d{2})\b/;
const ownerPattern = /\b(?:owner|assignee)\s*[:=]\s*([a-zA-Z0-9_.-]+)/i;
const mentionOwnerPattern = /@([a-zA-Z0-9_.-]+)/;
const dueDatePattern = /\b(?:due|deadline|eta)\s*[:=]\s*(20\d{2}-\d{2}-\d{2})/i;
const jiraPattern = /\b([A-Z][A-Z0-9]+-\d+)\b/;
const statusPattern = /\b(Open|Scheduled|InProgress|Verified|Closed)\b/i;

function listSourceFiles(dir) {
    const files = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const absPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listSourceFiles(absPath));
            continue;
        }
        if (!entry.isFile()) continue;
        if (absPath.endsWith(".d.ts")) continue;
        if (
            absPath.endsWith(".ts") ||
            absPath.endsWith(".tsx") ||
            absPath.endsWith(".js") ||
            absPath.endsWith(".mjs")
        ) {
            files.push(absPath);
        }
    }
    return files;
}

/** 统一成 `/` 分隔（Windows 路径会让同一条债在不同机器上算出不同指纹）。 */
export function normalizePath(value) {
    return value.replaceAll("\\", "/");
}

/**
 * CSV 字段转义：含 `,` `"` 或换行时整体加引号，内部 `"` 翻倍。
 * 不做转义的话，一条含逗号的 TODO 会把一行拆成两列，整份清单错位。
 */
export function escapeCsvField(value) {
    const normalized = String(value ?? "");
    if (normalized.includes(",") || normalized.includes('"') || normalized.includes("\n")) {
        return `"${normalized.replaceAll('"', '""')}"`;
    }
    return normalized;
}

/** 指纹 = sha1(路径|类型|片段)：片段变了就算一条新债（避免改动后被旧基线豁免）。 */
export function fingerprintFor(filePath, markerType, snippet) {
    return crypto.createHash("sha1").update(`${filePath}|${markerType}|${snippet}`).digest("hex");
}

export function inferSeverity(markerType) {
    if (markerType === "FIXME") return "Critical";
    if (markerType === "TODO") return "Major";
    if (markerType === "HACK") return "Major";
    return "Minor";
}

export function inferPriority(markerType) {
    if (markerType === "FIXME") return "P0";
    if (markerType === "TODO") return "P1";
    if (markerType === "HACK") return "P2";
    return "P3";
}

export function scoreFromPriority(priority) {
    if (priority === "P0") return 4.6;
    if (priority === "P1") return 3.8;
    if (priority === "P2") return 3.2;
    return 2.6;
}

function readBaseline() {
    if (!fs.existsSync(baselinePath)) {
        return { ids: [] };
    }
    const payload = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    return { ids: payload.ids ?? [] };
}

function writeBaseline(items) {
    const payload = {
        generatedAt: new Date().toISOString(),
        ids: items.map((item) => item.id),
    };
    writeJsonFormatted(baselinePath, payload);
}

/** 从注释文本里提取 owner / 日期 / jira / 状态；取不到就用空串或 "Open"。 */
export function parseMeta(rawText) {
    const owner = rawText.match(ownerPattern)?.[1] ?? rawText.match(mentionOwnerPattern)?.[1] ?? "";
    const createdAt = rawText.match(isoDatePattern)?.[1] ?? "";
    const dueDate = rawText.match(dueDatePattern)?.[1] ?? "";
    const jiraKey = rawText.match(jiraPattern)?.[1] ?? "";
    const status = rawText.match(statusPattern)?.[1] ?? "Open";
    return { owner, createdAt, dueDate, jiraKey, status };
}

function parseGitBlame(filePath, line) {
    try {
        const output = execFileSync("git", ["blame", "--line-porcelain", "-L", `${line},${line}`, filePath], {
            cwd: rootDir,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });
        const owner = output.match(/^author (.+)$/m)?.[1] ?? "";
        const authorTime = output.match(/^author-time (\d+)$/m)?.[1] ?? "";
        const createdAt = authorTime ? new Date(Number(authorTime) * 1000).toISOString().slice(0, 10) : "";
        return { owner, createdAt };
    } catch {
        return { owner: "", createdAt: "" };
    }
}

function scanDebtItems() {
    const files = listSourceFiles(srcDir);
    const items = [];
    for (const absPath of files) {
        const source = fs.readFileSync(absPath, "utf8");
        const lines = source.split("\n");
        for (let index = 0; index < lines.length; index += 1) {
            const lineText = lines[index];
            const commentIndex = lineText.indexOf("//");
            if (commentIndex < 0) continue;
            const commentText = lineText.slice(commentIndex + 2).trim();
            const markerMatch = commentText.match(markerPattern);
            if (!markerMatch) continue;

            const markerType = markerMatch[1];
            const rawSnippet = markerMatch[2] ?? "";
            const snippet = rawSnippet.trim().slice(0, 240);
            const relativePath = normalizePath(path.relative(rootDir, absPath));
            const line = index + 1;
            const fingerprint = fingerprintFor(relativePath, markerType, snippet);
            const id = `${relativePath}:${markerType}:${fingerprint}`;
            const parsed = parseMeta(commentText);
            const fallback =
                !parsed.owner || !parsed.createdAt ? parseGitBlame(relativePath, line) : { owner: "", createdAt: "" };
            const owner = parsed.owner || fallback.owner || "unassigned";
            const createdAt = parsed.createdAt || fallback.createdAt || "";
            const priority = inferPriority(markerType);

            items.push({
                id,
                filePath: relativePath,
                line,
                markerType,
                snippet,
                owner,
                createdAt,
                severity: inferSeverity(markerType),
                score: scoreFromPriority(priority),
                priority,
                jiraKey: parsed.jiraKey || "",
                status: parsed.status,
                dueDate: parsed.dueDate || "",
            });
        }
    }
    return items.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority.localeCompare(b.priority);
        if (b.score !== a.score) return b.score - a.score;
        if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
        return a.line - b.line;
    });
}

function writeInventory(items) {
    const summary = {
        total: items.length,
        todo: items.filter((item) => item.markerType === "TODO").length,
        fixme: items.filter((item) => item.markerType === "FIXME").length,
        hack: items.filter((item) => item.markerType === "HACK").length,
        xxx: items.filter((item) => item.markerType === "XXX").length,
    };

    // This gate runs as part of `pnpm lint`, and rewriting `generatedAt` on every run
    // left the tracked inventory dirty after every lint (plus merge noise on every PR)
    // even when the scan found the same items. Keep the previous timestamp when only
    // the clock changed, so the file is byte-identical for an identical scan.
    let previous = null;
    try {
        previous = JSON.parse(fs.readFileSync(outputJsonPath, "utf8"));
    } catch {
        previous = null;
    }
    const unchanged =
        previous !== null &&
        JSON.stringify(previous.summary) === JSON.stringify(summary) &&
        JSON.stringify(previous.items) === JSON.stringify(items);

    const payload = {
        generatedAt: unchanged ? previous.generatedAt : new Date().toISOString(),
        summary,
        items,
    };
    writeJsonFormatted(outputJsonPath, payload);

    const headers = [
        "filePath",
        "line",
        "markerType",
        "snippet",
        "owner",
        "createdAt",
        "severity",
        "score",
        "priority",
        "jiraKey",
        "status",
        "dueDate",
    ];
    const lines = [headers.join(",")];
    for (const item of items) {
        const row = headers.map((key) => escapeCsvField(item[key]));
        lines.push(row.join(","));
    }
    fs.writeFileSync(outputCsvPath, `${lines.join("\n")}\n`, "utf8");
}

function main() {
    const items = scanDebtItems();
    writeInventory(items);

    if (shouldUpdateBaseline) {
        const plan = planBaselineWrite({
            previousIds: readBaseline().ids,
            currentIds: items.map((item) => item.id),
            acceptNew,
        });
        if (plan.refuse) {
            console.error(
                `[technical-debt] --update-baseline 拒绝写入：有 ${plan.added.length} 条债务标记不在 baseline 中。` +
                    "「重记」与「赦免新增债务」必须分开 —— 后者要人看过。",
            );
            for (const id of plan.added.slice(0, ADDED_PRINT_LIMIT)) console.error(`  [ADDED] ${id}`);
            if (plan.added.length > ADDED_PRINT_LIMIT) {
                console.error(`  …还有 ${plan.added.length - ADDED_PRINT_LIMIT} 条`);
            }
            console.error("  确认上面无误后加 --accept-new 重跑：");
            console.error("    node scripts/quality/scan-technical-debt.mjs --update-baseline --accept-new");
            process.exit(1);
        }
        writeBaseline(items);
        console.log(
            `[technical-debt] baseline updated with ${items.length} entries` +
                (plan.added.length > 0 ? ` (含 ${plan.added.length} 条新吸收)` : ""),
        );
        process.exit(0);
    }

    const baseline = readBaseline();
    const baselineIds = new Set(baseline.ids);
    const newItems = items.filter((item) => !baselineIds.has(item.id));
    const blockingItems = strictMode
        ? newItems
        : newItems.filter((item) => item.markerType === "FIXME" || item.markerType === "HACK");

    if (blockingItems.length > 0) {
        console.error("[technical-debt] quality gate failed: new high-risk debt markers detected");
        for (const item of blockingItems) {
            console.error(
                `- ${item.priority} ${item.markerType} ${item.filePath}:${item.line} owner=${item.owner} snippet=${item.snippet}`,
            );
        }
        console.error("[technical-debt] Run: node scripts/quality/scan-technical-debt.mjs --update-baseline");
        process.exit(1);
    }

    console.log(
        `[technical-debt] quality gate passed (current: ${items.length}, new: ${newItems.length}, strict=${strictMode})`,
    );
}

// 仅在被直接执行时跑 main（原为顶层裸跑：import 会扫全仓、写 inventory，
// 并在有新增高风险债时 process.exit(1)）
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
