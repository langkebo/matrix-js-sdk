#!/usr/bin/env node
/**
 * Freshness gate for the contract mirror.
 *
 * Ensures the committed generated/ mirror reflects a recent enough backend
 * ledger export. It does this by:
 *
 * 1. Reading the committed index.json freshness metadata (written by
 *    contract-sync.mjs when it last ingested a ledger).
 * 2. Checking whether the mirror's backend commit date is older than a
 *    configurable threshold (default: 30 days).
 * 3. Optionally comparing against an external ledger export (--source) by
 *    delegating to contract-sync's semantic check.
 *
 * Exit codes:
 *   0 — mirror is fresh (within threshold, no entry-level drift).
 *   1 — mirror is stale or has entry-level drift.
 *   2 — usage error.
 *
 * Usage:
 *   node scripts/quality/check-contract-freshness.mjs                  # gate (age only)
 *   node scripts/quality/check-contract-freshness.mjs --source=<dir>   # age + entry-level drift
 *   node scripts/quality/check-contract-freshness.mjs --days=30        # override staleness threshold
 *   node scripts/quality/check-contract-freshness.mjs --now=2026-01-01 # override reference date
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const GENERATED_DIR = path.join(rootDir, "docs", "api-contract", "generated");
const INDEX_PATH = path.join(GENERATED_DIR, "index.json");
const CONTRACT_SYNC = path.join(rootDir, "scripts", "contract-sync.mjs");
const DEFAULT_THRESHOLD_DAYS = 30;

function parseArgs(argv) {
    const out = { sourceDir: null, thresholdDays: DEFAULT_THRESHOLD_DAYS, now: new Date() };
    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--source" || arg === "-s") {
            const next = argv[i + 1];
            if (!next) throw new Error("--source requires a path");
            out.sourceDir = path.resolve(next);
            i += 1;
        } else if (arg.startsWith("--source=")) {
            out.sourceDir = path.resolve(arg.slice("--source=".length));
        } else if (arg.startsWith("--days=")) {
            const n = parseInt(arg.slice("--days=".length), 10);
            if (isNaN(n) || n < 0) throw new Error("--days must be a non-negative integer");
            out.thresholdDays = n;
        } else if (arg.startsWith("--now=")) {
            const d = new Date(arg.slice("--now=".length));
            if (isNaN(d.getTime())) throw new Error("--now requires a valid ISO date");
            out.now = d;
        } else {
            throw new Error(`unknown argument: ${arg}`);
        }
    }
    return out;
}

function readIndex() {
    if (!fs.existsSync(INDEX_PATH)) {
        throw new Error(`index.json not found at ${INDEX_PATH}; run contract-sync first`);
    }
    const raw = fs.readFileSync(INDEX_PATH, "utf8");
    try {
        return JSON.parse(raw);
    } catch {
        throw new Error(`index.json is not valid JSON`);
    }
}

function formatRelativeAge(dateStr, now) {
    if (!dateStr) return "unknown";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return "in the future";
    if (diffDays === 0) return "today";
    if (diffDays === 1) return "yesterday";
    return `${diffDays} day(s) ago`;
}

function printHelp() {
    process.stdout.write(
        `check-contract-freshness — ensure the contract mirror is within the staleness threshold\n\n` +
            `Usage:\n` +
            `  node scripts/quality/check-contract-freshness.mjs [options]\n` +
            `\nOptions:\n` +
            `  --source=<dir>   compare against external ledger export (entry-level drift)\n` +
            `  --days=<n>       staleness threshold in days (default: ${DEFAULT_THRESHOLD_DAYS})\n` +
            `  --now=<date>     reference date for age calc (default: now, ISO 8601)\n` +
            `  --help, -h       show this message\n`,
    );
}

function main(argv) {
    let args;
    try {
        args = parseArgs(argv);
    } catch (err) {
        process.stderr.write(`error: ${err.message}\n\n`);
        printHelp();
        return 2;
    }

    const index = readIndex();
    const mirrorCommit = index.synapse_rust_commit;
    const mirrorGeneratedAt = index.generated_at;
    const mirrorEntries = index.ledger_entry_count;
    const freshness = index.freshness;

    const lines = [];
    lines.push(`contract-freshness: checking mirror against ${args.thresholdDays}-day threshold`);

    // 1. Structural check: freshness metadata present
    if (!freshness) {
        lines.push("  FAIL: index.json missing 'freshness' metadata (mirror pre-dates freshness feature)");
        lines.push("  TIP: run `node scripts/contract-sync.mjs` to refresh generated/");
        process.stderr.write(lines.join("\n") + "\n");
        return 1;
    }

    // 2. Source timestamp
    if (freshness.source_timestamp) {
        lines.push(`  source_timestamp: ${freshness.source_timestamp}`);
    } else {
        lines.push("  WARN: freshness.source_timestamp is missing");
    }

    // 3. Backend commit SHA
    if (freshness.backend_commit_sha) {
        lines.push(`  backend_commit_sha: ${freshness.backend_commit_sha}`);
    } else {
        lines.push("  WARN: backend_commit_sha is null (mirror not stamped from backend)");
    }

    // 5. Entry count
    if (mirrorEntries) {
        lines.push(`  ledger_entry_count: ${mirrorEntries}`);
    }

    // 6. Profiles
    if (freshness.mirror_profiles) {
        lines.push(`  mirror_profiles: ${freshness.mirror_profiles.join(", ")}`);
    }

    // 7. Staleness check
    // Primary signal: freshness.source_timestamp (when mirror was last regenerated).
    // Fallback: generated_at (when backend ledger was produced) — often stale for fixtures.
    // The entry-level drift check (--source) is the more reliable "is mirror behind?"
    // signal; age-based staleness is a soft guard against mirrors going untouched for months.
    let stale = false;
    let ageDate = null;
    let ageSource = null;

    if (freshness && freshness.source_timestamp) {
        ageDate = freshness.source_timestamp;
        ageSource = "mirror refresh";
    } else if (mirrorGeneratedAt) {
        ageDate = mirrorGeneratedAt;
        ageSource = "backend ledger date (may be stale for fixtures)";
    }

    if (ageDate) {
        const ageD = new Date(ageDate);
        if (!isNaN(ageD.getTime())) {
            const diffMs = args.now.getTime() - ageD.getTime();
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            lines.push(`  age source: ${ageSource}`);
            lines.push(`  age date: ${ageDate}`);
            lines.push(`  mirror age: ${formatRelativeAge(ageDate, args.now)}`);
            if (diffDays > args.thresholdDays) {
                lines.push(
                    `  STALE: mirror is ${diffDays} days old (threshold: ${args.thresholdDays} days)`,
                );
                stale = true;
            }
        }
    }

    // 8. Optional: entry-level drift check by delegating to contract-sync
    let driftDetected = false;
    if (args.sourceDir) {
        if (!fs.existsSync(args.sourceDir)) {
            lines.push(`  FAIL: source dir not found: ${args.sourceDir}`);
            driftDetected = true;
        } else {
            try {
                execFileSync(
                    process.execPath,
                    [CONTRACT_SYNC, "--check", `--source=${args.sourceDir}`],
                    { cwd: rootDir, stdio: ["pipe", "pipe", "pipe"] },
                );
                lines.push(`  semantic-check: mirror entries match the backend source`);
            } catch (err) {
                const stderr = err.stderr || err.message || "";
                const driftLines = stderr.split("\n").filter((l) => l.trim().length > 0);
                lines.push(`  DRIFT DETECTED:`);
                for (const line of driftLines.slice(0, 20)) {
                    lines.push(`    ${line}`);
                }
                driftDetected = true;
            }
        }
    }

    // 9. Summary
    if (stale) {
        lines.push("  TIP: run `node scripts/contract-sync.mjs` to refresh generated/");
        process.stderr.write(lines.join("\n") + "\n");
        return 1;
    }
    if (driftDetected) {
        lines.push("  TIP: run `node scripts/contract-sync.mjs --source=" + args.sourceDir + "` to refresh");
        process.stderr.write(lines.join("\n") + "\n");
        return 1;
    }
    lines.push(`  RESULT: fresh (mirror age within ${args.thresholdDays}-day threshold)`);
    process.stdout.write(lines.join("\n") + "\n");
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.exitCode = main(process.argv);
    } catch (err) {
        process.stderr.write(`error: ${err.message}\n`);
        process.exitCode = 1;
    }
}
