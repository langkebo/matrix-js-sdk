#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const baselinePath = path.resolve(rootDir, "scripts/quality/generated-dto-strictness-baseline.json");

const shouldUpdateBaseline = process.argv.includes("--update-baseline");

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

function makeId(filePath, line, code, snippet) {
    const hash = crypto.createHash("sha1").update(`${filePath}|${line}|${code}|${snippet}`).digest("hex");
    return `${filePath}:${line}:${code}:${hash}`;
}

export function scanGeneratedDtoRisks(scanRoot = rootDir) {
    const effectiveSrcDir = path.resolve(scanRoot, "src");
    const items = [];

    for (const absPath of listGeneratedDtoFiles(effectiveSrcDir)) {
        const relativePath = normalizePath(path.relative(scanRoot, absPath));
        const lines = fs.readFileSync(absPath, "utf8").split(/\r?\n/);

        lines.forEach((lineText, index) => {
            const searchable = stripStringLiterals(lineText);
            for (const risk of riskPatterns) {
                risk.regex.lastIndex = 0;
                if (!risk.regex.test(searchable)) continue;

                items.push({
                    id: makeId(relativePath, index + 1, risk.code, lineText.trim()),
                    filePath: relativePath,
                    line: index + 1,
                    code: risk.code,
                    snippet: lineText.trim(),
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

if (import.meta.url === `file://${process.argv[1]}`) {
    const items = scanGeneratedDtoRisks(rootDir);

    if (shouldUpdateBaseline) {
        writeBaseline(items);
        writeStdout(`[generated-dto-strictness] baseline updated with ${items.length} entries`);
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
