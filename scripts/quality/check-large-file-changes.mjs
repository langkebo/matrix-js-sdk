#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const threshold = Number(process.env.LARGE_FILE_THRESHOLD ?? "1500");
const allowBypass = process.env.ARCH_REVIEW_APPROVED === "true";

function run(cmd) {
    return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] })
        .toString()
        .trim();
}

function resolveDiffRange() {
    const base = process.env.GITHUB_BASE_SHA;
    const head = process.env.GITHUB_SHA;
    if (base && head) return `${base}...${head}`;
    return "HEAD~1...HEAD";
}

const diffRange = resolveDiffRange();
const changedRaw = run(`git diff --name-only ${diffRange}`);
const changedFiles = changedRaw
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);

const oversizedTouched = [];
for (const relPath of changedFiles) {
    const absPath = path.resolve(process.cwd(), relPath);
    if (!fs.existsSync(absPath)) continue;
    if (!absPath.endsWith(".ts")) continue;
    const lines = fs.readFileSync(absPath, "utf8").split("\n").length;
    if (lines > threshold) {
        oversizedTouched.push({ relPath, lines });
    }
}

if (oversizedTouched.length === 0) {
    console.log(`[large-file-check] no modified TypeScript file exceeds ${threshold} lines`);
    process.exit(0);
}

console.warn("[large-file-check] oversized files were modified:");
for (const item of oversizedTouched) {
    console.warn(`- ${item.relPath}: ${item.lines} lines`);
}

if (allowBypass) {
    console.warn("[large-file-check] bypassed by ARCH_REVIEW_APPROVED=true");
    process.exit(0);
}

console.error(
    "[large-file-check] architecture review required. Set ARCH_REVIEW_APPROVED=true only after ADR/risk review is approved.",
);
process.exit(1);
