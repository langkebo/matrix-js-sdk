#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const lcovFile = process.argv[2] ?? "coverage/lcov.info";

// Shared with quality-report.mjs so the two can never disagree about which modules
// are "critical" (they used to list 5 and 8 respectively).
const criticalConfig = JSON.parse(
    fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "critical-modules.json"), "utf8"),
);
const targetPercent = criticalConfig.targetPercent ?? 90;
/** Explicit env override (CI sets CRITICAL_COVERAGE_THRESHOLD); otherwise per-module ratchet floor. */
const thresholdOverride =
    process.env.CRITICAL_COVERAGE_THRESHOLD !== undefined ? Number(process.env.CRITICAL_COVERAGE_THRESHOLD) : null;
const requiredFor = (entry) => thresholdOverride ?? entry.floorPercent ?? targetPercent;
const criticalTargets = criticalConfig.modules;

function parseLcov(content) {
    const records = new Map();
    let currentFile = null;
    let linesFound = 0;
    let linesHit = 0;

    const flush = () => {
        if (!currentFile) return;
        records.set(currentFile, {
            linesFound,
            linesHit,
            ratio: linesFound === 0 ? 0 : (linesHit / linesFound) * 100,
        });
    };

    for (const line of content.split("\n")) {
        if (line.startsWith("SF:")) {
            flush();
            currentFile = line.slice(3).trim().replaceAll("\\", "/");
            linesFound = 0;
            linesHit = 0;
            continue;
        }
        if (line.startsWith("LF:")) {
            linesFound = Number(line.slice(3).trim());
            continue;
        }
        if (line.startsWith("LH:")) {
            linesHit = Number(line.slice(3).trim());
            continue;
        }
        if (line === "end_of_record") {
            flush();
            currentFile = null;
        }
    }
    flush();
    return records;
}

if (!fs.existsSync(lcovFile)) {
    console.error(`[critical-coverage] coverage file not found: ${lcovFile}`);
    process.exit(1);
}

const projectRoot = process.cwd().replaceAll("\\", "/");
const records = parseLcov(fs.readFileSync(lcovFile, "utf8"));

const failures = [];
for (const entry of criticalTargets) {
    const target = entry.path;
    // lcov `SF:` records are repo-relative (`src/...`). Looking up only the absolute
    // form made this gate unable to find ANY record — it was permanently red and was
    // misread as "stale coverage" during the 2026-09-13 review. Accept both forms.
    const relativeTarget = target.replaceAll("\\", "/");
    const absoluteTarget = path.resolve(projectRoot, target).replaceAll("\\", "/");
    const record = records.get(relativeTarget) ?? records.get(absoluteTarget);
    const required = requiredFor(entry);
    if (!record) {
        failures.push(`${target}: missing coverage record`);
        continue;
    }
    if (record.ratio < required) {
        failures.push(`${target}: ${record.ratio.toFixed(2)}% < ${required}%`);
    }
}

if (failures.length > 0) {
    console.error("[critical-coverage] check failed:");
    for (const failure of failures) {
        console.error(`- ${failure}`);
    }
    process.exit(1);
}

console.log(
    `[critical-coverage] ${criticalTargets.length} critical module(s) meet their ratchet floor (target ${targetPercent}%)`,
);
