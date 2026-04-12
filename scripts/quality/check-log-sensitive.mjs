#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const srcDir = path.join(root, "src");
const stepSummary = process.env.GITHUB_STEP_SUMMARY;

const SENSITIVE_TERMS = ["token", "access_token", "authorization", "authz", "password", "secret", "bearer"];

function listFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listFiles(p));
        else if (entry.isFile() && p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
    }
    return out;
}

function scanFile(absPath) {
    const rel = path.relative(root, absPath).replaceAll("\\", "/");
    const lines = fs.readFileSync(absPath, "utf8").split("\n");
    const findings = [];

    const loggerCallRe = /\b(logger|this\.logger)\s*\.\s*(debug|info|warn|error|log)\s*\(/;
    const hasInterpolation = /`[^`]*\$\{[^}]+\}[^`]*`/;
    const hasConcat = /["'`][^"'`]*["'`]?\s*\+\s*[a-zA-Z_]/;
    const whitelistTag = /@log-allow/;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (whitelistTag.test(line)) continue;
        if (!loggerCallRe.test(line)) continue;
        const snippet = line;
        const lower = snippet.toLowerCase();
        const mentionsSensitive = SENSITIVE_TERMS.some((t) => lower.includes(t));
        const likelyLeaking = hasInterpolation.test(line) || hasConcat.test(line);
        if (mentionsSensitive && likelyLeaking) {
            const term = SENSITIVE_TERMS.find((t) => lower.includes(t)) || "unknown";
            findings.push({ rel, line: i + 1, term, snippet: snippet.trim() });
        }
    }
    return findings;
}

function writeSummary(findings) {
    if (!stepSummary) return;
    const rows = findings.map((f) => `- ${f.rel}:${f.line} term="${f.term}" -> ${f.snippet}`).join("\n");
    fs.appendFileSync(
        stepSummary,
        [
            "### Sensitive log scan (warning only)",
            findings.length === 0 ? "- No potential sensitive log lines found." : rows,
            "",
            "Guideline: avoid logging tokens/password/authorization; use explicit whitelisting and redaction.",
            "",
        ].join("\n"),
    );
}

const files = fs.existsSync(srcDir) ? listFiles(srcDir) : [];
let findings = [];
for (const f of files) {
    findings = findings.concat(scanFile(f));
}

const block = process.env.LOG_SENSITIVE_BLOCK === "true";
if (findings.length === 0) {
    console.log("[log-sensitive] no potential sensitive log lines found");
} else {
    console.warn("[log-sensitive] potential sensitive log lines detected:");
    for (const f of findings) {
        console.warn(`- ${f.rel}:${f.line} term="${f.term}" -> ${f.snippet}`);
    }
    if (block) {
        console.error(
            "[log-sensitive] blocking due to LOG_SENSITIVE_BLOCK=true; add // @log-allow to justified lines or redact logs.",
        );
        process.exit(1);
    }
}

writeSummary(findings);
process.exit(0);
