#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const srcDir = path.resolve(rootDir, "src");
const baselinePath = path.resolve(rootDir, "scripts/quality/technical-debt-baseline.json");
const outputJsonPath = path.resolve(rootDir, "scripts/quality/technical-debt-inventory.json");
const outputCsvPath = path.resolve(rootDir, "scripts/quality/technical-debt-inventory.csv");

const shouldUpdateBaseline = process.argv.includes("--update-baseline");
const strictMode = process.argv.includes("--strict");

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

function normalizePath(value) {
    return value.replaceAll("\\", "/");
}

function escapeCsvField(value) {
    const normalized = String(value ?? "");
    if (normalized.includes(",") || normalized.includes('"') || normalized.includes("\n")) {
        return `"${normalized.replaceAll('"', '""')}"`;
    }
    return normalized;
}

function fingerprintFor(filePath, markerType, snippet) {
    return crypto.createHash("sha1").update(`${filePath}|${markerType}|${snippet}`).digest("hex");
}

function inferSeverity(markerType) {
    if (markerType === "FIXME") return "Critical";
    if (markerType === "TODO") return "Major";
    if (markerType === "HACK") return "Major";
    return "Minor";
}

function inferPriority(markerType) {
    if (markerType === "FIXME") return "P0";
    if (markerType === "TODO") return "P1";
    if (markerType === "HACK") return "P2";
    return "P3";
}

function scoreFromPriority(priority) {
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
    fs.writeFileSync(baselinePath, `${JSON.stringify(payload, null, 4)}\n`, "utf8");
}

function parseMeta(rawText) {
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
    const payload = {
        generatedAt: new Date().toISOString(),
        summary: {
            total: items.length,
            todo: items.filter((item) => item.markerType === "TODO").length,
            fixme: items.filter((item) => item.markerType === "FIXME").length,
            hack: items.filter((item) => item.markerType === "HACK").length,
            xxx: items.filter((item) => item.markerType === "XXX").length,
        },
        items,
    };
    fs.writeFileSync(outputJsonPath, `${JSON.stringify(payload, null, 4)}\n`, "utf8");

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

const items = scanDebtItems();
writeInventory(items);

if (shouldUpdateBaseline) {
    writeBaseline(items);
    console.log(`[technical-debt] baseline updated with ${items.length} entries`);
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
