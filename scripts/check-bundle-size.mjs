#!/usr/bin/env node
/*
 * check-bundle-size.mjs — published-payload size gate.
 *
 * `package.json#prepublishOnly` referenced this script but it did not exist, so
 * the step silently failed the whole publish chain (see the 2026-09-13 SDK
 * maturity review, P0-3). This is the minimal real implementation: it measures
 * the payload that actually ships (the `files` allow-list in package.json) and
 * compares it against a committed budget.
 *
 * Why the `files` allow-list and not the packed tarball? Measuring on disk is
 * deterministic, needs no second `prepare` build, and covers the same content
 * that `pnpm pack` includes. The numbers below are therefore *unpacked* bytes;
 * the compressed tarball is smaller.
 *
 * Usage:
 *   node scripts/check-bundle-size.mjs                 # gate (default)
 *   node scripts/check-bundle-size.mjs --update-baseline
 *
 * Exit codes:
 *   0  within budget (or baseline updated)
 *   1  budget exceeded
 */

import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const packageJsonPath = path.join(projectRoot, "package.json");
const baselinePath = path.join(projectRoot, "scripts", "quality", "bundle-size-baseline.json");

/** Headroom applied when (re)writing the baseline: 2% growth is tolerated. */
const GROWTH_TOLERANCE = 0.02;

/** Recursively sum the byte size of a file or directory. */
export function measurePath(absPath) {
    if (!fs.existsSync(absPath)) return 0;
    const stat = fs.statSync(absPath);
    if (!stat.isDirectory()) return stat.size;

    let total = 0;
    for (const entry of fs.readdirSync(absPath, { withFileTypes: true })) {
        total += measurePath(path.join(absPath, entry.name));
    }
    return total;
}

/** Measure every entry of the `files` allow-list that exists on disk. */
export function measurePayload(rootDir = projectRoot) {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
    const entries = [];
    let totalBytes = 0;

    for (const entry of pkg.files ?? []) {
        const absPath = path.join(rootDir, entry);
        if (!fs.existsSync(absPath)) {
            // Declared but absent (upstream leftovers such as `release.sh`); skip, do not fail.
            entries.push({ entry, bytes: 0, missing: true });
            continue;
        }
        const bytes = measurePath(absPath);
        entries.push({ entry, bytes, missing: false });
        totalBytes += bytes;
    }

    const libEntry = entries.find((e) => e.entry === "lib");
    return { entries, totalBytes, libBytes: libEntry?.bytes ?? 0 };
}

function formatMb(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function readBaseline(filePath = baselinePath) {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeBaseline(payload, filePath = baselinePath) {
    const round = (bytes) => Math.ceil((bytes * (1 + GROWTH_TOLERANCE)) / 1024) * 1024;
    const baseline = {
        generatedAt: new Date().toISOString(),
        note: "Budget = measured payload + 2% headroom. Raise deliberately via --update-baseline and explain the growth in the commit message.",
        maxTotalBytes: round(payload.totalBytes),
        maxLibBytes: round(payload.libBytes),
    };
    fs.writeFileSync(filePath, `${JSON.stringify(baseline, null, 4)}\n`, "utf8");
    return baseline;
}

function main() {
    const shouldUpdate = process.argv.includes("--update-baseline");
    const payload = measurePayload();

    if (shouldUpdate) {
        const baseline = writeBaseline(payload);
        process.stdout.write(
            `[bundle-size] baseline updated: total ${formatMb(baseline.maxTotalBytes)}, lib ${formatMb(baseline.maxLibBytes)}\n`,
        );
        return 0;
    }

    const baseline = readBaseline();
    if (!baseline) {
        process.stderr.write(
            "[bundle-size] no baseline found; run: node scripts/check-bundle-size.mjs --update-baseline\n",
        );
        return 1;
    }

    const failures = [];
    if (payload.totalBytes > baseline.maxTotalBytes) {
        failures.push(`total: ${formatMb(payload.totalBytes)} > budget ${formatMb(baseline.maxTotalBytes)}`);
    }
    if (baseline.maxLibBytes && payload.libBytes > baseline.maxLibBytes) {
        failures.push(`lib:   ${formatMb(payload.libBytes)} > budget ${formatMb(baseline.maxLibBytes)}`);
    }

    if (failures.length > 0) {
        process.stderr.write("[bundle-size] published payload exceeds its budget:\n");
        for (const failure of failures) process.stderr.write(`- ${failure}\n`);
        process.stderr.write(
            "[bundle-size] If the growth is intended, run: node scripts/check-bundle-size.mjs --update-baseline\n",
        );
        return 1;
    }

    process.stdout.write(
        `[bundle-size] ok (total ${formatMb(payload.totalBytes)} / ${formatMb(baseline.maxTotalBytes)}, ` +
            `lib ${formatMb(payload.libBytes)} / ${formatMb(baseline.maxLibBytes)})\n`,
    );
    return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    process.exit(main());
}
