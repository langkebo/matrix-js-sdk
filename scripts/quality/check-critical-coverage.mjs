#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const lcovFile = process.argv[2] ?? "coverage/lcov.info";
const threshold = Number(process.env.CRITICAL_COVERAGE_THRESHOLD ?? "90");

const criticalTargets = [
    "src/admin/index.ts",
    "src/dm/index.ts",
    "src/push/index.ts",
    "src/space/index.ts",
    "src/room-summary/index.ts",
];

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
for (const target of criticalTargets) {
    const absTarget = path.resolve(projectRoot, target).replaceAll("\\", "/");
    const record = records.get(absTarget);
    if (!record) {
        failures.push(`${target}: missing coverage record`);
        continue;
    }
    if (record.ratio < threshold) {
        failures.push(`${target}: ${record.ratio.toFixed(2)}% < ${threshold}%`);
    }
}

if (failures.length > 0) {
    console.error("[critical-coverage] check failed:");
    for (const failure of failures) {
        console.error(`- ${failure}`);
    }
    process.exit(1);
}

console.log(`[critical-coverage] all critical modules meet >= ${threshold}% line coverage`);
