#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const indexPath = path.join(repoRoot, "docs", "api-contract", "generated", "index.json");
const zeroSha = "0".repeat(40);
const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;

function parseArgs(argv) {
    const out = {
        help: false,
        baseRef: process.env.GITHUB_BASE_SHA || "origin/develop",
        headRef: "HEAD",
        renderDrafts: false,
    };

    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") {
            out.help = true;
        } else if (arg === "--render-drafts") {
            out.renderDrafts = true;
        } else if (arg === "--base") {
            const next = argv[i + 1];
            if (!next) throw new Error("--base requires a ref");
            out.baseRef = next;
            i += 1;
        } else if (arg.startsWith("--base=")) {
            out.baseRef = arg.slice("--base=".length);
        } else if (arg === "--head") {
            const next = argv[i + 1];
            if (!next) throw new Error("--head requires a ref");
            out.headRef = next;
            i += 1;
        } else if (arg.startsWith("--head=")) {
            out.headRef = arg.slice("--head=".length);
        } else {
            throw new Error(`unknown argument: ${arg}`);
        }
    }

    return out;
}

function printHelp() {
    process.stdout.write(
        `contract-diff — compare committed SDK contract mirror against a base git ref\n\n` +
            `Usage:\n` +
            `  node scripts/contract-diff.mjs [--base=REF] [--head=REF] [--render-drafts]\n` +
            `  node scripts/contract-diff.mjs --help\n\n` +
            `Flags:\n` +
            `  --base=REF        base git ref to compare against (default: GITHUB_BASE_SHA or origin/develop)\n` +
            `  --head=REF        head git ref to inspect for changed files (default: HEAD)\n` +
            `  --render-drafts   also render Phase-E LLM prompt drafts under docs/api-contract/drafts/<timestamp>/\n` +
            `  --help, -h        show this message\n`,
    );
}

function runGit(args) {
    try {
        return execFileSync("git", args, {
            cwd: repoRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        }).trim();
    } catch (error) {
        const stderr = error.stderr?.toString()?.trim();
        throw new Error(stderr || `git ${args.join(" ")} failed`);
    }
}

function gitFileExists(ref, file) {
    try {
        runGit(["cat-file", "-e", `${ref}:${file}`]);
        return true;
    } catch {
        return false;
    }
}

function readJsonFromGit(ref, relativeFile) {
    if (!gitFileExists(ref, relativeFile)) return null;
    const raw = runGit(["show", `${ref}:${relativeFile}`]);
    return JSON.parse(raw);
}

function readCurrentIndex() {
    if (!fs.existsSync(indexPath)) {
        throw new Error(`generated index not found: ${indexPath}`);
    }
    return JSON.parse(fs.readFileSync(indexPath, "utf8"));
}

function relativeGeneratedPath(...parts) {
    return path.posix.join("docs", "api-contract", "generated", ...parts);
}

function shortSha(value) {
    if (!value || value === zeroSha) return "(unpinned)";
    return value.slice(0, 12);
}

function listChangedFiles(baseRef, headRef) {
    const output = runGit(["diff", "--name-only", `${baseRef}..${headRef}`]);
    return output ? output.split("\n").filter(Boolean) : [];
}

function collectProfileDiffs(baseIndex, currentIndex) {
    const profiles = new Set([...Object.keys(baseIndex?.profiles ?? {}), ...Object.keys(currentIndex?.profiles ?? {})]);
    const diffs = [];

    for (const profile of [...profiles].sort()) {
        const before = baseIndex?.profiles?.[profile] ?? null;
        const after = currentIndex?.profiles?.[profile] ?? null;
        if (!before && after) {
            diffs.push({
                profile,
                kind: "added",
                beforeCount: 0,
                afterCount: after.entry_count,
            });
            continue;
        }
        if (before && !after) {
            diffs.push({
                profile,
                kind: "removed",
                beforeCount: before.entry_count,
                afterCount: 0,
            });
            continue;
        }
        if (before.sha256 !== after.sha256 || before.entry_count !== after.entry_count) {
            diffs.push({
                profile,
                kind: "changed",
                beforeCount: before.entry_count,
                afterCount: after.entry_count,
            });
        }
    }

    return diffs;
}

function collectModuleDiffs(baseIndex, currentIndex) {
    const modules = new Set([...Object.keys(baseIndex?.modules ?? {}), ...Object.keys(currentIndex?.modules ?? {})]);
    const diffs = [];

    for (const moduleName of [...modules].sort()) {
        const before = baseIndex?.modules?.[moduleName] ?? null;
        const after = currentIndex?.modules?.[moduleName] ?? null;
        if (!before && after) {
            diffs.push({
                moduleName,
                kind: "added",
                beforeCount: 0,
                afterCount: after.entry_count,
            });
            continue;
        }
        if (before && !after) {
            diffs.push({
                moduleName,
                kind: "removed",
                beforeCount: before.entry_count,
                afterCount: 0,
            });
            continue;
        }
        if (before.sha256 !== after.sha256 || before.entry_count !== after.entry_count) {
            diffs.push({
                moduleName,
                kind: "changed",
                beforeCount: before.entry_count,
                afterCount: after.entry_count,
            });
        }
    }

    return diffs;
}

function renderDiffLine(item) {
    const delta = item.afterCount - item.beforeCount;
    const deltaText = delta === 0 ? "0" : `${delta > 0 ? "+" : ""}${delta}`;
    const name = item.profile ?? item.moduleName;
    return `- ${name}: ${item.kind} (${item.beforeCount} -> ${item.afterCount}, delta ${deltaText})`;
}

// ==================== Phase E — draft prompt rendering ====================

const TEMPLATE_PATH = path.join(repoRoot, "docs", "api-contract", "governance", "SDK_CODEGEN_PROMPT_TEMPLATE.md");
const DRAFTS_DIR = path.join(repoRoot, "docs", "api-contract", "drafts");
const DIFF_ENTRIES_HARD_CAP = 25;
const SDK_SNIPPET_LINE_CAP = 400;

/**
 * Keep in sync with `MODULE_TO_SDK_DIR` in scripts/sdk-contract-codegen.mjs.
 * Modules not listed here still get a draft, but the `current_sdk_snippet`
 * block is replaced with a stub explaining the missing mapping so the
 * reviewer can add it.
 */
/**
 * Keep in sync with `MODULE_TO_SDK_DIR` in scripts/sdk-contract-codegen.mjs.
 * Modules not listed here still get a draft, but the `current_sdk_snippet`
 * block is replaced with a stub explaining the missing mapping so the
 * reviewer can add it.
 *
 * Updated 2026-06-09: expanded to cover all SDK API modules for Phase 1
 * synapse-rust v10 alignment.
 */
const MODULE_TO_SDK_DIR = {
    auth: "auth",
    device: "device",
    e2ee: "e2ee",
    federation: "federation",
    key_backup: "key-backup",
    key_rotation: "key-rotation",
    friend_room: "friend",
    dm: "dm",
    push: "push",
    presence: "presence",
    media: "media",
    search: "search",
    room: "room",
    sync: "sync",
    admin: "admin",
    typing: "typing",
    account_data: "account-data",
    guest: "guest",
    moderation: "moderation",
    notifications: "notifications",
    profile: "profile",
    reactions: "reactions",
    relations: "relations",
    room_alias: "room-alias",
    room_member: "room-member",
    room_upgrades: "room-upgrades",
    room_summary: "room-summary",
    thirdparty: "third-party",
    thread: "thread",
    voip: "voip",
    widget: "widget",
};

function entryKey(entry) {
    return `${entry.method} ${entry.path}`;
}

function diffEntriesForModule(beforeEntries, afterEntries) {
    const beforeMap = new Map();
    for (const e of beforeEntries ?? []) beforeMap.set(entryKey(e), e);
    const afterMap = new Map();
    for (const e of afterEntries ?? []) afterMap.set(entryKey(e), e);
    const added = [];
    const removed = [];
    const changed = [];
    for (const [k, e] of afterMap) {
        if (!beforeMap.has(k)) {
            added.push(e);
        } else {
            const prev = beforeMap.get(k);
            if (
                prev.registered_by !== e.registered_by ||
                JSON.stringify(prev.path_params ?? []) !== JSON.stringify(e.path_params ?? [])
            ) {
                changed.push({ before: prev, after: e });
            }
        }
    }
    for (const [k, e] of beforeMap) {
        if (!afterMap.has(k)) removed.push(e);
    }
    return { added, removed, changed };
}

function readModuleAtRef(ref, moduleName) {
    return readJsonFromGit(ref, relativeGeneratedPath("modules", `${moduleName}.json`));
}

function readCurrentModule(moduleName) {
    const file = path.join(repoRoot, "docs", "api-contract", "generated", "modules", `${moduleName}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function extractCanonicalPrompt(templateText) {
    const section = templateText.split("## 1. Canonical prompt")[1];
    if (!section) throw new Error("template missing '## 1. Canonical prompt' section");
    const m = section.match(/```\n([\s\S]*?)```/);
    if (!m) throw new Error("template missing fenced prompt body in §1");
    return m[1];
}

function renderSnippetForModule(moduleName) {
    const sdkDir = MODULE_TO_SDK_DIR[moduleName];
    if (!sdkDir) {
        return `(no src/<module>/index.ts mapping for '${moduleName}' — add it to MODULE_TO_SDK_DIR in scripts/contract-diff.mjs)`;
    }
    const managerFile = path.join(repoRoot, "src", sdkDir, "index.ts");
    if (!fs.existsSync(managerFile)) {
        return `(manager file not found: src/${sdkDir}/index.ts)`;
    }
    const lines = fs.readFileSync(managerFile, "utf8").split("\n");
    const trimmed = lines.slice(0, SDK_SNIPPET_LINE_CAP).join("\n");
    const suffix =
        lines.length > SDK_SNIPPET_LINE_CAP
            ? `\n// ... ${lines.length - SDK_SNIPPET_LINE_CAP} more lines elided (see src/${sdkDir}/index.ts)`
            : "";
    return `// src/${sdkDir}/index.ts\n${trimmed}${suffix}`;
}

function renderPrompt(template, { changeType, diffEntries, sdkSnippet }) {
    return template
        .replace(/{{\s*change_type\s*}}/g, changeType)
        .replace(/{{\s*endpoint_diff_json\s*}}/g, JSON.stringify(diffEntries, null, 2))
        .replace(/{{\s*current_sdk_snippet\s*}}/g, sdkSnippet);
}

function isoStampForFilename(now = new Date()) {
    return now
        .toISOString()
        .replace(/\.\d+Z$/, "Z")
        .replace(/:/g, "-");
}

function renderDraftsForModules({ baseRef, moduleDiffs, notes }) {
    if (moduleDiffs.length === 0) {
        process.stdout.write("contract-diff: no module diffs — skipping draft rendering.\n");
        return 0;
    }
    if (!fs.existsSync(TEMPLATE_PATH)) {
        process.stderr.write(`error: template not found at ${TEMPLATE_PATH}\n`);
        return 1;
    }
    const templateText = fs.readFileSync(TEMPLATE_PATH, "utf8");
    const canonical = extractCanonicalPrompt(templateText);
    const timestamp = isoStampForFilename();
    const draftRoot = path.join(DRAFTS_DIR, timestamp);
    fs.mkdirSync(draftRoot, { recursive: true });

    let emitted = 0;
    for (const item of moduleDiffs) {
        const moduleName = item.moduleName;
        const before = readModuleAtRef(baseRef, moduleName);
        const after = readCurrentModule(moduleName);
        const { added, removed, changed } = diffEntriesForModule(before?.entries ?? [], after?.entries ?? []);
        const sdkSnippet = renderSnippetForModule(moduleName);
        const groups = [
            { kind: "added", entries: added },
            { kind: "deprecated", entries: removed },
            {
                kind: "modified",
                entries: changed.map((c) => ({
                    ...c.after,
                    _diff_kind: "modified",
                    _before: c.before,
                })),
            },
        ];
        for (const g of groups) {
            if (g.entries.length === 0) continue;
            const overflow = g.entries.length > DIFF_ENTRIES_HARD_CAP;
            const slice = overflow ? g.entries.slice(0, DIFF_ENTRIES_HARD_CAP) : g.entries;
            const rendered = renderPrompt(canonical, {
                changeType: g.kind,
                diffEntries: slice,
                sdkSnippet,
            });
            const body =
                `<!-- auto-generated by scripts/contract-diff.mjs --render-drafts — DO NOT EDIT -->\n` +
                `<!-- module: ${moduleName}   change_type: ${g.kind}   entries: ${slice.length}` +
                (overflow ? ` (truncated from ${g.entries.length})` : "") +
                ` -->\n\n` +
                "```\n" +
                rendered +
                "\n```\n" +
                (overflow
                    ? `\n> **OVERFLOW** — ${g.entries.length - DIFF_ENTRIES_HARD_CAP} entries omitted; split into multiple prompts per template §4.\n`
                    : "");
            const outFile = path.join(draftRoot, `${moduleName}--${g.kind}.md`);
            fs.writeFileSync(outFile, body);
            emitted += 1;
        }
    }
    process.stdout.write(
        `contract-diff: rendered ${emitted} draft file(s) under ${path.relative(repoRoot, draftRoot)}/\n`,
    );
    notes.push(`rendered ${emitted} draft prompt file(s) under docs/api-contract/drafts/${timestamp}/`);
    return 0;
}

function writeSummary(result) {
    if (!stepSummaryPath) return;

    const lines = [];
    lines.push("## Contract Diff");
    lines.push("");
    lines.push(`- Base ref: \`${result.baseRef}\``);
    lines.push(`- Head ref: \`${result.headRef}\``);
    lines.push(`- Base synapse commit: \`${shortSha(result.baseCommit)}\``);
    lines.push(`- Current synapse commit: \`${shortSha(result.currentCommit)}\``);
    lines.push(`- Relevant files changed in git diff: ${result.relevantChangedFiles.length}`);
    lines.push(`- Profile diffs: ${result.profileDiffs.length}`);
    lines.push(`- Module diffs: ${result.moduleDiffs.length}`);
    lines.push("");

    if (result.profileDiffs.length) {
        lines.push("### Profiles");
        lines.push("");
        lines.push(...result.profileDiffs.map(renderDiffLine));
        lines.push("");
    }

    if (result.moduleDiffs.length) {
        lines.push("### Modules");
        lines.push("");
        lines.push(...result.moduleDiffs.slice(0, 20).map(renderDiffLine));
        if (result.moduleDiffs.length > 20) {
            lines.push(`- ... ${result.moduleDiffs.length - 20} more module diff(s) omitted`);
        }
        lines.push("");
    }

    if (result.notes.length) {
        lines.push("### Notes");
        lines.push("");
        lines.push(...result.notes.map((note) => `- ${note}`));
        lines.push("");
    }

    fs.appendFileSync(stepSummaryPath, `${lines.join("\n")}\n`);
}

function run(argv) {
    let args;
    try {
        args = parseArgs(argv);
    } catch (error) {
        process.stderr.write(`error: ${error.message}\n\n`);
        printHelp();
        return 2;
    }

    if (args.help) {
        printHelp();
        return 0;
    }

    const baseRef = args.baseRef;
    const headRef = args.headRef;
    const currentIndex = readCurrentIndex();
    const baseIndex = readJsonFromGit(baseRef, relativeGeneratedPath("index.json"));
    const changedFiles = listChangedFiles(baseRef, headRef);
    const relevantChangedFiles = changedFiles.filter(
        (file) => file.startsWith("src/") || file.startsWith("docs/api-contract/"),
    );

    const notes = [];
    if (!baseIndex) {
        notes.push(
            `base ref '${baseRef}' does not contain docs/api-contract/generated/index.json; treating all current entries as new`,
        );
    }

    const profileDiffs = collectProfileDiffs(baseIndex, currentIndex);
    const moduleDiffs = collectModuleDiffs(baseIndex, currentIndex);
    const currentCommit = currentIndex.synapse_rust_commit ?? null;
    const baseCommit = baseIndex?.synapse_rust_commit ?? null;

    const generatedChangedInGit = changedFiles.some((file) => file.startsWith("docs/api-contract/generated/"));
    if (generatedChangedInGit && (!currentCommit || currentCommit === zeroSha)) {
        process.stderr.write(
            "contract-diff: docs/api-contract/generated/ changed, but current index.json still carries an unpinned synapse_rust_commit.\n",
        );
        process.stderr.write(
            "Regenerate from a real ledger artifact (for example via the D8 sync workflow) so the backend provenance is recorded.\n",
        );
        return 1;
    }

    if (relevantChangedFiles.length === 0) {
        notes.push("no src/ or docs/api-contract/ changes detected between the selected refs");
    }
    if (!generatedChangedInGit) {
        notes.push("git diff does not include docs/api-contract/generated/ changes");
    }
    if (baseCommit !== currentCommit) {
        notes.push(`recorded synapse_rust_commit changed from ${shortSha(baseCommit)} to ${shortSha(currentCommit)}`);
    }

    process.stdout.write(
        `contract-diff: base=${baseRef} head=${headRef}\n` +
            `  relevant changed files: ${relevantChangedFiles.length}\n` +
            `  profile diffs: ${profileDiffs.length}\n` +
            `  module diffs: ${moduleDiffs.length}\n`,
    );

    if (profileDiffs.length) {
        process.stdout.write("  profiles:\n");
        for (const item of profileDiffs) {
            process.stdout.write(`    ${renderDiffLine(item).slice(2)}\n`);
        }
    }

    if (moduleDiffs.length) {
        process.stdout.write("  modules:\n");
        for (const item of moduleDiffs.slice(0, 20)) {
            process.stdout.write(`    ${renderDiffLine(item).slice(2)}\n`);
        }
        if (moduleDiffs.length > 20) {
            process.stdout.write(`    ... ${moduleDiffs.length - 20} more module diff(s)\n`);
        }
    }

    if (notes.length) {
        process.stdout.write("  notes:\n");
        for (const note of notes) {
            process.stdout.write(`    - ${note}\n`);
        }
    }

    writeSummary({
        baseRef,
        headRef,
        baseCommit,
        currentCommit,
        relevantChangedFiles,
        profileDiffs,
        moduleDiffs,
        notes,
    });

    if (args.renderDrafts) {
        const rc = renderDraftsForModules({ baseRef, moduleDiffs, notes });
        if (rc !== 0) return rc;
    }

    return 0;
}

try {
    process.exitCode = run(process.argv);
} catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    if (process.env.CONTRACT_DIFF_TRACE) {
        process.stderr.write(`${error.stack}\n`);
    }
    process.exitCode = 1;
}
