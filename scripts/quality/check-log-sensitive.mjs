#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const srcDir = path.join(root, "src");
const stepSummary = process.env.GITHUB_STEP_SUMMARY;

const SENSITIVE_TERMS = ["token", "access_token", "authorization", "authz", "password", "secret", "bearer"];

const LOGGER_CALL_RE = /\b(logger|this\.logger)\s*\.\s*(debug|info|warn|error|log)\s*\(/;
const HAS_INTERPOLATION = /`[^`]*\$\{[^}]+\}[^`]*`/;
const HAS_CONCAT = /["'`][^"'`]*["'`]?\s*\+\s*[a-zA-Z_]/;
const WHITELIST_TAG = /@log-allow/;

function listFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listFiles(p));
        else if (entry.isFile() && p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
    }
    return out;
}

/**
 * 扫描一组源码行，找出"调了 logger 且把敏感值插进/拼进消息"的位置。
 *
 * 抽成纯函数（不再直接读盘）是为了让 spec 能钉住判据 —— 它同时要满足两件事：
 *   · 敏感值**没有**被拼进日志（`logger.info("ok")`）不能报（否则没人看报告）；
 *   · 敏感值**被**拼进日志（模板串 / 字符串拼接）必须报。
 * 判据一松，这条"警告型门禁"就会退化成噪音；一紧，就等于没检。
 *
 * @param rel 用于报错的仓库相对路径
 * @param lines 源码行
 */
function scanLines(rel, lines) {
    const findings = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (WHITELIST_TAG.test(line)) continue;
        if (!LOGGER_CALL_RE.test(line)) continue;
        const lower = line.toLowerCase();
        const mentionsSensitive = SENSITIVE_TERMS.some((t) => lower.includes(t));
        const likelyLeaking = HAS_INTERPOLATION.test(line) || HAS_CONCAT.test(line);
        if (mentionsSensitive && likelyLeaking) {
            const term = SENSITIVE_TERMS.find((t) => lower.includes(t)) || "unknown";
            findings.push({ rel, line: i + 1, term, snippet: line.trim() });
        }
    }
    return findings;
}

function scanFile(absPath) {
    const rel = path.relative(root, absPath).replaceAll("\\", "/");
    return scanLines(rel, fs.readFileSync(absPath, "utf8").split("\n"));
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

function main() {
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
    return 0;
}

// 纯函数导出给 spec 用；副作用式入口用 invokedDirectly 兜住（被 import 时不得执行）。
export { SENSITIVE_TERMS, scanLines };

const invokedDirectly =
    typeof process.argv[1] === "string" && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
    process.exit(main());
}
