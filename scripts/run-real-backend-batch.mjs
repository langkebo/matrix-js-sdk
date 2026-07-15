#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, extname, relative, resolve } from "node:path";
import process from "node:process";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const realBackendDir = resolve(repoRoot, "spec/integ/real-backend");
const caWrapper = resolve(repoRoot, "scripts/run-real-backend-with-ca.mjs");
const vitestConfig = resolve(repoRoot, "vitest.real-backend.config.ts");
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const interCommandDelayMs = 5000;
const retryDelayMs = 5000;
const maxCommandAttempts = 3;

function quoteArg(arg) {
    return /\s/.test(arg) ? JSON.stringify(arg) : arg;
}

function isRealBackendTestFile(filePath) {
    return filePath.endsWith(".spec.ts") || filePath.endsWith(".test.ts");
}

function listDirectoryTargets(directoryPath) {
    return readdirSync(directoryPath, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => resolve(directoryPath, entry.name))
        .filter(isRealBackendTestFile);
}

function normalizeTargets(rawTargets) {
    if (rawTargets.length === 0) {
        return listDirectoryTargets(realBackendDir).filter((filePath) => basename(filePath) !== "smoke.spec.ts");
    }

    const resolvedTargets = [];

    for (const rawTarget of rawTargets) {
        const targetPath = resolve(process.cwd(), rawTarget);
        const targetStat = statSync(targetPath, { throwIfNoEntry: false });

        if (!targetStat) {
            throw new Error(`Target does not exist: ${rawTarget}`);
        }

        if (targetStat.isDirectory()) {
            resolvedTargets.push(...listDirectoryTargets(targetPath));
            continue;
        }

        if (targetStat.isFile() && isRealBackendTestFile(targetPath)) {
            resolvedTargets.push(targetPath);
            continue;
        }

        throw new Error(`Unsupported target: ${rawTarget}`);
    }

    return resolvedTargets;
}

function deduplicateAndSort(files) {
    return [...new Set(files)].sort((left, right) => collator.compare(left, right));
}

function isVitestSuite(filePath) {
    const source = readFileSync(filePath, "utf8");
    return /from\s+["']vitest["']/.test(source);
}

async function sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCommand(label, command, args) {
    for (let attempt = 1; attempt <= maxCommandAttempts; attempt++) {
        console.log(`\n== ${label} ==`);
        if (attempt > 1) {
            console.log(`Retry attempt ${attempt}/${maxCommandAttempts}`);
        }
        console.log(`$ ${[command, ...args].map(quoteArg).join(" ")}`);

        const result = spawnSync(command, args, {
            cwd: repoRoot,
            stdio: "inherit",
            env: process.env,
        });

        if (result.status === 0) {
            await sleep(interCommandDelayMs);
            return;
        }

        if (attempt === maxCommandAttempts) {
            process.exit(result.status ?? 1);
        }

        console.log(`Command failed with exit code ${result.status ?? 1}; retrying in ${retryDelayMs}ms...`);
        await sleep(retryDelayMs);
    }
}

function toRepoRelative(filePath) {
    return relative(repoRoot, filePath);
}

function formatFileList(files) {
    return files.map((filePath) => `- ${toRepoRelative(filePath)}`).join("\n");
}

async function main() {
    const rawArgs = process.argv.slice(2).filter((arg) => arg !== "--");
    const targets = deduplicateAndSort(normalizeTargets(rawArgs));
    if (targets.length === 0) {
        throw new Error(`No real-backend test files found under ${relative(repoRoot, realBackendDir)}`);
    }

    const vitestFiles = [];
    const tsxFiles = [];

    for (const filePath of targets) {
        if (isVitestSuite(filePath)) {
            vitestFiles.push(filePath);
        } else {
            tsxFiles.push(filePath);
        }
    }

    console.log("Real-backend batch classification:");
    if (vitestFiles.length > 0) {
        console.log(`Vitest suites (${vitestFiles.length}):\n${formatFileList(vitestFiles)}`);
    }
    if (tsxFiles.length > 0) {
        console.log(`TSX scripts (${tsxFiles.length}):\n${formatFileList(tsxFiles)}`);
    }

    if (vitestFiles.length > 0) {
        await runCommand("Vitest real-backend suites", process.execPath, [
            caWrapper,
            "pnpm",
            "exec",
            "vitest",
            "run",
            "--no-file-parallelism",
            "--config",
            vitestConfig,
            ...vitestFiles.map(toRepoRelative),
        ]);
    }

    for (const filePath of tsxFiles) {
        await runCommand(`TSX real-backend script: ${basename(filePath, extname(filePath))}`, process.execPath, [
            caWrapper,
            "npx",
            "tsx",
            toRepoRelative(filePath),
        ]);
    }

    console.log(
        `\nCompleted real-backend batch: ${vitestFiles.length} vitest suite(s), ${tsxFiles.length} tsx script(s).`,
    );
}

try {
    await main();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
