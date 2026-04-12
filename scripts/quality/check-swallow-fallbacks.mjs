#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const targetDir = path.resolve(rootDir, "src");
const baselinePath = path.resolve(rootDir, "scripts/quality/swallow-fallback-baseline.json");
const shouldUpdateBaseline = process.argv.includes("--update-baseline");
const baselineStrict = process.env.BASELINE_STRICT === "true" || process.argv.includes("--strict-baseline");

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

function normalizeSnippet(snippet) {
    return snippet.replace(/\s+/g, " ").trim();
}

function buildId(relPath, line, normalizedSnippet) {
    const digest = crypto.createHash("sha1").update(`${relPath}|${line}|${normalizedSnippet}`).digest("hex");
    return `${relPath}:${line}:${digest}`;
}

function collectFindings() {
    const findings = [];
    const files = listTsFiles(targetDir);
    // 匹配 catch 吞错模式
    const pattern = /catch\s*\([^)]*\)\s*\{[\s\S]{0,240}?return\s*(null|\[\]|false|\{\})\s*;/g;
    // 匹配白名单注释: // @swallow-error { owner: "xxx", expires: "2026-01-01" }
    const whitelistPattern = /\/\/\s*@swallow-error\s*\{\s*owner:\s*"([^"]+)",\s*expires:\s*"([^"]+)"\s*\}/;

    for (const absPath of files) {
        const source = fs.readFileSync(absPath, "utf8");
        let match;
        while ((match = pattern.exec(source)) !== null) {
            const relPath = path.relative(rootDir, absPath).replaceAll("\\", "/");
            const line = toLineNumber(source, match.index);
            const normalizedSnippet = normalizeSnippet(match[0]).slice(0, 240);

            // 向上查找注释 (查找 catch 前面几行)
            const preCatchSource = source.slice(0, match.index);
            const lines = preCatchSource.split("\n");
            const lastLine = lines[lines.length - 1].trim();
            const secondLastLine = lines.length > 1 ? lines[lines.length - 2].trim() : "";

            let whitelistInfo = null;
            const commentMatch = lastLine.match(whitelistPattern) || secondLastLine.match(whitelistPattern);

            if (commentMatch) {
                whitelistInfo = {
                    owner: commentMatch[1],
                    expires: commentMatch[2],
                };
            }

            findings.push({
                id: buildId(relPath, line, normalizedSnippet),
                file: relPath,
                line,
                snippet: normalizedSnippet,
                whitelist: whitelistInfo,
            });
        }
    }
    findings.sort((a, b) => a.id.localeCompare(b.id));
    return findings;
}

function validateWhitelist(finding) {
    if (!finding.whitelist) return false;
    const { owner, expires } = finding.whitelist;
    if (!owner || !expires) return false;

    // 校验日期格式 YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) return false;

    // 校验是否过期
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
    fs.writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

const findings = collectFindings();

if (shouldUpdateBaseline) {
    writeBaseline(findings);
    console.log(`[swallow-fallback] baseline updated: ${findings.length} entries`);
    process.exit(0);
}

const baseline = readBaseline();
const baselineIds = new Set((baseline.findings ?? []).map((it) => it.id));

const errors = [];
for (const finding of findings) {
    const isNew = !baselineIds.has(finding.id);
    const whitelistStatus = validateWhitelist(finding);

    if (isNew) {
        if (!whitelistStatus) {
            errors.push(
                `- [NEW] ${finding.file}:${finding.line}: Missing or invalid @swallow-error comment.\n  Snippet: ${finding.snippet}`,
            );
        } else if (whitelistStatus === "expired") {
            errors.push(
                `- [NEW] ${finding.file}:${finding.line}: @swallow-error whitelist has expired (${finding.whitelist.expires}).\n  Snippet: ${finding.snippet}`,
            );
        }
    } else {
        // 对于 baseline 中的存量项：默认仅告警；若 --strict-baseline 或 BASELINE_STRICT=true 则阻断
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
}

if (errors.length > 0) {
    console.error("[swallow-fallback] quality gate failed:");
    errors.forEach((err) => console.error(err));
    console.error("\n[swallow-fallback] All swallowing patterns must have a valid whitelist comment:");
    console.error('// @swallow-error { owner: "your-name", expires: "YYYY-MM-DD" }');
    process.exit(1);
}

console.log(
    `[swallow-fallback] quality gate passed (current: ${findings.length}, baseline: ${(baseline.findings ?? []).length})`,
);
