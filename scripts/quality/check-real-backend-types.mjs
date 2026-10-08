#!/usr/bin/env node
/**
 * Ratchet for the real-backend TypeScript project (`tsconfig.real-backend.json`).
 *
 * That project (src + spec/integ/real-backend) has ~85 pre-existing type errors, which is
 * exactly why its CI job carried `continue-on-error: true` — a job that may not fail is not
 * a gate, it is a dashboard nobody reads. Blanket-fixing 85 errors across live-server specs
 * is its own project, so instead this freezes the current error set and fails on any NEW
 * fingerprint, turning the job blocking while the debt can only shrink.
 *
 * Fingerprint = file + TS code + message (NOT the line number): inserting a line above an
 * existing error must not fabricate a "new" error, and two identical diagnostics in one file
 * intentionally collapse into one id.
 *
 * Usage:
 *   node scripts/quality/check-real-backend-types.mjs                  # gate
 *   node scripts/quality/check-real-backend-types.mjs --update-baseline # re-freeze (explain in the PR)
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonFormatted } from "./lib/write-json.mjs";

const rootDir = process.cwd();
const baselinePath = path.resolve(rootDir, "scripts/quality/real-backend-types-baseline.json");
const tsconfigPath = "tsconfig.real-backend.json";
const shouldUpdateBaseline = process.argv.includes("--update-baseline");

/** `src/foo.ts(12,34): error TS2339: Property 'x' does not exist on type 'Y'.` */
const DIAGNOSTIC_RE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

function normalizePath(value) {
    return value.replaceAll("\\", "/");
}

function writeStdout(line = "") {
    process.stdout.write(`${line}\n`);
}

function writeStderr(line = "") {
    process.stderr.write(`${line}\n`);
}

/**
 * Parse `tsc --pretty false` output into diagnostics.
 *
 * Exported for the negative tests: a gate whose parser silently returns `[]` would pass
 * forever, so the spec pins the format it must understand.
 */
export function parseDiagnostics(output) {
    const items = [];

    for (const rawLine of output.split(/\r?\n/)) {
        const match = DIAGNOSTIC_RE.exec(rawLine.trim());
        if (!match) continue;

        const [, filePath, line, column, code, message] = match;
        items.push({
            filePath: normalizePath(filePath),
            line: Number(line),
            column: Number(column),
            code,
            message: message.trim(),
        });
    }

    return items;
}

/**
 * Stable identity for one diagnostic, independent of its line number.
 *
 * Exported so the spec can assert that a line shift keeps the same id (no false "new
 * error") while a changed message produces a different one.
 */
export function diagnosticId(diagnostic) {
    const messageHash = crypto
        .createHash("sha1")
        .update(`${diagnostic.filePath}|${diagnostic.code}|${diagnostic.message}`)
        .digest("hex")
        .slice(0, 16);
    return `${diagnostic.filePath}:${diagnostic.code}:${messageHash}`;
}

/** Ids present now but not in the baseline — the only thing that fails the gate. */
export function selectNewIds(currentIds, baselineIds) {
    const baseline = new Set(baselineIds);
    return [...new Set(currentIds)].filter((id) => !baseline.has(id)).sort();
}

/** Ids that the baseline still lists but the project no longer reports (debt paid down). */
export function selectResolvedIds(currentIds, baselineIds) {
    const current = new Set(currentIds);
    return [...new Set(baselineIds)].filter((id) => !current.has(id)).sort();
}

export function readBaseline(filePath = baselinePath) {
    if (!fs.existsSync(filePath)) return { generatedAt: null, total: 0, ids: [] };
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
        generatedAt: payload.generatedAt ?? null,
        total: typeof payload.total === "number" ? payload.total : 0,
        ids: Array.isArray(payload.ids) ? payload.ids : [],
    };
}

function writeBaseline(diagnostics, ids, filePath = baselinePath) {
    const payload = {
        generatedAt: new Date().toISOString(),
        total: diagnostics.length,
        ids: [...ids].sort(),
    };
    writeJsonFormatted(filePath, payload);
}

/**
 * Run the real-backend typecheck.
 *
 * A non-zero exit that yields parseable diagnostics is the expected steady state here (tsc
 * reports "errors present" as exit 1 via execFileSync and 2 through some wrappers, so the
 * code is NOT hardcoded). Anything else — no diagnostics at all, a config error, a crash —
 * is surfaced to the caller, which fails loudly rather than passing on an empty parse.
 */
function runTypecheck() {
    const tscPath = path.join(rootDir, "node_modules", "typescript", "bin", "tsc");
    if (!fs.existsSync(tscPath)) {
        writeStderr(`[real-backend-types] cannot find tsc at ${tscPath}; run pnpm install`);
        process.exit(1);
    }

    const args = [tscPath, "-p", tsconfigPath, "--noEmit", "--pretty", "false"];
    const options = {
        cwd: rootDir,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
    };

    try {
        return { status: 0, output: execFileSync(process.execPath, args, options) ?? "" };
    } catch (error) {
        if (typeof error?.status !== "number") {
            writeStderr("[real-backend-types] failed to run tsc:");
            writeStderr(error?.stderr || error?.stdout || String(error));
            process.exit(1);
        }
        return { status: error.status, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { status, output } = runTypecheck();
    const diagnostics = parseDiagnostics(output);

    // tsc failed without emitting a single diagnostic we understand: the parser or the
    // project config is broken, and passing here would be a silent false green.
    if (diagnostics.length === 0 && status !== 0) {
        writeStderr(`[real-backend-types] tsc exited ${status} but printed no parseable diagnostics:`);
        writeStderr(output.trim() || "(empty output)");
        process.exit(1);
    }

    const ids = diagnostics.map(diagnosticId);

    if (shouldUpdateBaseline) {
        writeBaseline(diagnostics, ids);
        writeStdout(`[real-backend-types] baseline updated with ${diagnostics.length} diagnostics`);
        process.exit(0);
    }

    const baseline = readBaseline();
    const newIds = selectNewIds(ids, baseline.ids);
    const resolvedIds = selectResolvedIds(ids, baseline.ids);

    if (newIds.length > 0) {
        writeStderr(
            `[real-backend-types] quality gate failed: ${newIds.length} new type error(s) in the real-backend project`,
        );
        for (const id of newIds) writeStderr(`- ${id}`);
        writeStderr(
            "[real-backend-types] Fix the new errors. Re-freezing the baseline only to hide them: " +
                "node scripts/quality/check-real-backend-types.mjs --update-baseline",
        );
        process.exit(1);
    }

    writeStdout(
        `[real-backend-types] quality gate passed (current: ${diagnostics.length}, ` +
            `baseline: ${baseline.total}, new: 0, resolved since baseline: ${resolvedIds.length})`,
    );
}
