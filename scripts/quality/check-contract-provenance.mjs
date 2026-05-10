#!/usr/bin/env node

import fs from "node:fs";
import { execFileSync } from "node:child_process";

const projectRoot = process.cwd();
const eventPath = process.env.GITHUB_EVENT_PATH;
const baseRef = process.env.GITHUB_BASE_SHA || "origin/develop";
const generatedPrefix = "docs/api-contract/generated/";

function runGit(args) {
    return execFileSync("git", args, {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

function getChangedFiles() {
    const raw = runGit(["diff", "--name-only", `${baseRef}...HEAD`]);
    return raw ? raw.split(/\r?\n/).filter(Boolean) : [];
}

function readPullRequestBody() {
    if (!eventPath || !fs.existsSync(eventPath)) return null;
    const payload = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    return payload.pull_request?.body ?? null;
}

function hasMatch(body, pattern) {
    return pattern.test(body);
}

function main() {
    const changedFiles = getChangedFiles();
    const relevantChanged = changedFiles.some((file) => file.startsWith(generatedPrefix));
    if (!relevantChanged) {
        process.stdout.write(
            "contract-provenance: skipping, docs/api-contract/generated/ did not change vs base ref.\n",
        );
        return 0;
    }

    const body = readPullRequestBody();
    if (body === null) {
        process.stdout.write("contract-provenance: skipping, no pull_request body is available for this event.\n");
        return 0;
    }

    const requiredPatterns = [
        {
            label: "contract-prompt",
            pattern: /^\s*contract-prompt:\s+(docs\/api-contract\/drafts\/\S+|artifact:\/\/contract-drafts-\S+)\s*$/m,
        },
        {
            label: "ledger-commit",
            pattern: /^\s*ledger-commit:\s+synapse-rust@\S+\s*$/m,
        },
        {
            label: "ledger-profile",
            pattern: /^\s*ledger-profile:\s+\S+\s*$/m,
        },
        {
            label: "change-type",
            pattern: /^\s*change-type:\s+\S.*$/m,
        },
        {
            label: "module",
            pattern: /^\s*module:\s+\S.*$/m,
        },
    ];

    const missing = requiredPatterns.filter(({ pattern }) => !hasMatch(body, pattern)).map(({ label }) => label);
    if (missing.length > 0) {
        process.stderr.write(
            `contract-provenance: PR body is missing required provenance field(s): ${missing.join(", ")}.\n`,
        );
        process.stderr.write(
            "Expected a provenance block for ledger-driven generated/ changes, for example:\n" +
                "contract-prompt: artifact://contract-drafts-<sha>\n" +
                "ledger-commit:   synapse-rust@<sha>\n" +
                "ledger-profile:  all\n" +
                "change-type:     added,modified\n" +
                "module:          dm,key_backup\n",
        );
        return 1;
    }

    process.stdout.write(
        `contract-provenance: PR body carries provenance for ${changedFiles.filter((file) => file.startsWith(generatedPrefix)).length} generated file(s).\n`,
    );
    return 0;
}

try {
    process.exitCode = main();
} catch (error) {
    process.stderr.write(`contract-provenance: ${error.message}\n`);
    if (process.env.CONTRACT_PROVENANCE_TRACE) {
        process.stderr.write(`${error.stack}\n`);
    }
    process.exitCode = 1;
}
