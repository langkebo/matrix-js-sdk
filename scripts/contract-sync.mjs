#!/usr/bin/env node
/*
 * Ledger-driven SDK contract synchroniser.
 *
 * Consumes the deterministic JSON artefacts produced by the
 * `synapse_ledger_export` binary (one per profile: default / worker /
 * openclaw / all) and materialises them into
 * `docs/api-contract/generated/` as the SDK's machine-readable mirror.
 *
 * Layout written:
 *   generated/index.json                              aggregate + per-module hashes
 *   generated/route-manifest.<profile>.json           verbatim copy of each profile artefact
 *   generated/modules/<module>.json                   per first-segment(registered_by) split of the `all` profile
 *
 * Mode selection:
 *   contract-sync.mjs                     → ingest from default fixture dir, write generated/
 *   contract-sync.mjs --source=<dir>      → ingest from custom dir
 *   contract-sync.mjs --check             → recompute in memory, fail if disk drifts
 *
 * Referenced as D3 in
 *   docs/api-contract/LEDGER_DRIVEN_SDK_PLAN_2026-05-02.md
 *
 * Schema kept in lockstep with
 *   synapse-rust/docs/synapse-rust/LEDGER_EXPORT_SCHEMA.md (v1).
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const entryFilePath = fileURLToPath(import.meta.url);
const __dirname = path.dirname(entryFilePath);
const repoRoot = path.resolve(__dirname, "..");

const GENERATED_DIR = path.join(repoRoot, "docs", "api-contract", "generated");
const DRAFTS_DIR = path.join(repoRoot, "docs", "api-contract", "drafts");
const PROMPT_TEMPLATE_PATH = path.join(
    repoRoot,
    "docs",
    "api-contract",
    "governance",
    "SDK_CODEGEN_PROMPT_TEMPLATE.md",
);
const DEFAULT_INGEST_SOURCE_DIR = path.resolve(
    repoRoot,
    "..",
    "synapse-rust",
    "tests",
    "unit",
    "fixtures",
    "ledger_export_sdk",
);
/**
 * In `--check` mode the generated/ tree is itself the source of truth: we
 * recompute the derived outputs (modules/*.json, index.json) from whichever
 * route-manifest.<profile>.json files are currently committed and verify they
 * match what is on disk. This lets CI run the guard without needing a
 * synapse-rust checkout next to the SDK repo.
 */
const DEFAULT_CHECK_SOURCE_DIR = GENERATED_DIR;
const PROFILES = ["default", "worker", "openclaw", "all"];
const GENERATED_SCHEMA_VERSION = "1";
const LEDGER_SCHEMA_VERSION = "1";
const DRAFT_ENTRY_SOFT_CAP = 10;
const DRAFT_ENTRY_HARD_CAP = 25;
const DRAFT_SNIPPET_TARGET_LINES = 400;
const DRAFT_SNIPPET_HARD_CAP = 500;
const DRAFT_TOKEN_SOFT_CAP = 6000;
const DRAFT_TOKEN_HARD_CAP = 10000;

function parseArgs(argv) {
    const out = { mode: "ingest", sourceDir: null, help: false, renderDrafts: false };
    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") {
            out.help = true;
        } else if (arg === "--check") {
            out.mode = "check";
        } else if (arg === "--render-drafts") {
            out.renderDrafts = true;
        } else if (arg === "--source" || arg === "-s") {
            const next = argv[i + 1];
            if (!next) throw new Error("--source requires a path");
            out.sourceDir = path.resolve(next);
            i += 1;
        } else if (arg.startsWith("--source=")) {
            out.sourceDir = path.resolve(arg.slice("--source=".length));
        } else {
            throw new Error(`unknown argument: ${arg}`);
        }
    }
    if (out.sourceDir === null) {
        out.sourceDir = out.mode === "check" ? DEFAULT_CHECK_SOURCE_DIR : DEFAULT_INGEST_SOURCE_DIR;
    }
    return out;
}

function printHelp() {
    process.stdout.write(
        `contract-sync — materialise synapse-rust ledger artefacts into docs/api-contract/generated/\n\n` +
            `Usage:\n` +
            `  node scripts/contract-sync.mjs [--source=DIR]    # ingest + write\n` +
            `  node scripts/contract-sync.mjs --render-drafts   # ingest + write + render prompt drafts\n` +
            `  node scripts/contract-sync.mjs --check           # recompute, fail on drift\n` +
            `\nFlags:\n` +
            `  --source=DIR   directory containing the four profile manifests. Accepts either\n` +
            `                   <profile>.json (synapse-rust fixture naming) or\n` +
            `                   route-manifest.<profile>.json (SDK generated/ naming).\n` +
            `                 Default for ingest: ../synapse-rust/tests/unit/fixtures/ledger_export_sdk\n` +
            `                 Default for --check: docs/api-contract/generated/\n` +
            `  --render-drafts compare the incoming manifests against the currently committed\n` +
            `                 generated/ tree and emit prompt drafts under docs/api-contract/drafts/\n` +
            `  --check        dry-run; exit 1 if anything on disk would change\n` +
            `  --help, -h     show this message\n`,
    );
}

function readProfile(sourceDir, profile) {
    const candidates = [
        path.join(sourceDir, `route-manifest.${profile}.json`),
        path.join(sourceDir, `${profile}.json`),
    ];
    const file = candidates.find((p) => fs.existsSync(p));
    if (!file) {
        throw new Error(
            `missing ledger artefact for profile '${profile}' in ${sourceDir}; tried:\n  ${candidates.join("\n  ")}`,
        );
    }
    const raw = fs.readFileSync(file, "utf8");
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new Error(`failed to parse ${file}: ${err.message}`);
    }
    if (parsed.schema_version !== LEDGER_SCHEMA_VERSION) {
        throw new Error(
            `${file}: schema_version ${parsed.schema_version} is not compatible with SDK pin ${LEDGER_SCHEMA_VERSION}`,
        );
    }
    if (parsed.state_profile !== profile) {
        throw new Error(`${file}: state_profile "${parsed.state_profile}" does not match expected "${profile}"`);
    }
    if (!Array.isArray(parsed.entries)) {
        throw new Error(`${file}: missing entries array`);
    }
    if (parsed.entry_count !== parsed.entries.length) {
        throw new Error(
            `${file}: entry_count ${parsed.entry_count} does not match entries.length ${parsed.entries.length}`,
        );
    }
    return { raw, parsed, file };
}

function moduleKeyFor(registeredBy) {
    if (typeof registeredBy !== "string" || registeredBy.length === 0) {
        return "_unknown";
    }
    const idx = registeredBy.indexOf("::");
    return idx >= 0 ? registeredBy.slice(0, idx) : registeredBy;
}

function compareEntries(a, b) {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    if (a.method !== b.method) return a.method < b.method ? -1 : 1;
    if (a.registered_by !== b.registered_by) {
        return a.registered_by < b.registered_by ? -1 : 1;
    }
    return 0;
}

function buildModules(allProfile) {
    const buckets = new Map();
    for (const entry of allProfile.parsed.entries) {
        const key = moduleKeyFor(entry.registered_by);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(entry);
    }
    const modules = [];
    for (const [moduleName, entries] of [...buckets.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        entries.sort(compareEntries);
        modules.push({
            module: moduleName,
            payload: {
                schema_version: GENERATED_SCHEMA_VERSION,
                ledger_schema: LEDGER_SCHEMA_VERSION,
                module: moduleName,
                synapse_rust_commit: allProfile.parsed.synapse_rust_commit ?? null,
                generated_at: allProfile.parsed.generated_at ?? null,
                source_profile: allProfile.parsed.state_profile,
                entry_count: entries.length,
                entries,
            },
        });
    }
    return modules;
}

function renderJson(value) {
    // Two-space indent + trailing newline — byte-stable diffs.
    return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256Hex(buf) {
    const hash = crypto.createHash("sha256");
    hash.update(buf);
    return `sha256-${hash.digest("hex")}`;
}

function buildIndex(profiles, modules, profileFiles, moduleFiles) {
    const index = {
        schema_version: GENERATED_SCHEMA_VERSION,
        ledger_schema: LEDGER_SCHEMA_VERSION,
        generated_at: profiles.default.parsed.generated_at ?? null,
        synapse_rust_commit: profiles.default.parsed.synapse_rust_commit ?? null,
        ledger_entry_count: profiles.default.parsed.entry_count,
        profiles: {},
        modules: {},
    };
    for (const name of PROFILES) {
        const p = profiles[name];
        index.profiles[name] = {
            entry_count: p.parsed.entry_count,
            file: `route-manifest.${name}.json`,
            sha256: sha256Hex(profileFiles[name]),
        };
    }
    for (const m of modules) {
        index.modules[m.module] = {
            entry_count: m.payload.entry_count,
            file: `modules/${m.module}.json`,
            sha256: sha256Hex(moduleFiles[m.module]),
        };
    }
    return index;
}

function buildOutputs(profiles) {
    const profileFiles = {};
    for (const name of PROFILES) {
        // Re-render from parsed form (not raw) to guarantee byte-stable output
        // even if the upstream tweaks whitespace. This is what downstream
        // consumers will see.
        profileFiles[name] = Buffer.from(renderJson(profiles[name].parsed), "utf8");
    }
    const modules = buildModules(profiles.all);
    const moduleFiles = {};
    for (const m of modules) {
        moduleFiles[m.module] = Buffer.from(renderJson(m.payload), "utf8");
    }
    const index = buildIndex(profiles, modules, profileFiles, moduleFiles);
    const indexFile = Buffer.from(renderJson(index), "utf8");
    return { profileFiles, moduleFiles, indexFile, moduleNames: modules.map((m) => m.module) };
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function writeOutputs(outputs) {
    ensureDir(GENERATED_DIR);
    ensureDir(path.join(GENERATED_DIR, "modules"));
    for (const name of PROFILES) {
        fs.writeFileSync(path.join(GENERATED_DIR, `route-manifest.${name}.json`), outputs.profileFiles[name]);
    }
    // Remove stale module files before rewriting so renamed modules don't linger.
    const modulesDir = path.join(GENERATED_DIR, "modules");
    for (const existing of fs.readdirSync(modulesDir)) {
        if (existing.endsWith(".json") && !outputs.moduleNames.includes(existing.replace(/\.json$/, ""))) {
            fs.unlinkSync(path.join(modulesDir, existing));
        }
    }
    for (const moduleName of outputs.moduleNames) {
        fs.writeFileSync(path.join(modulesDir, `${moduleName}.json`), outputs.moduleFiles[moduleName]);
    }
    fs.writeFileSync(path.join(GENERATED_DIR, "index.json"), outputs.indexFile);
}

function readIfExists(filePath) {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
}

/**
 * Opt-in frontmatter validation for module `.md` pages.
 *
 * A module doc page MAY include a YAML-style frontmatter block at the very
 * top:
 *
 *   ---
 *   module: key_backup
 *   generated_from: docs/api-contract/generated/modules/key_backup.json
 *   generated_hash: sha256-<hex>
 *   ledger_schema: 1
 *   ---
 *
 * If the block is present, we verify:
 *   - `generated_from` resolves to an existing file
 *   - `generated_hash` matches sha256 of that file
 *   - `module` matches what `generated_from`'s `module` field claims
 *   - `ledger_schema` matches our pinned version
 *
 * Cross-domain umbrella pages (e.g. `auth.md`, `README.md`) opt out of the
 * 1:1 module-pin by declaring `umbrella: true` in their frontmatter, in
 * which case `generated_from`/`generated_hash` are not required and the
 * page is counted under the umbrella governance bucket instead. An
 * umbrella page MUST still pin `ledger_schema` so the schema-version
 * guard still applies.
 *
 * Pages without a frontmatter block are ignored — the backfill across the
 * existing ~50 md files is tracked as D5 in the plan and is deliberately
 * incremental. This way opting a module in is a single edit that
 * immediately starts being guarded.
 */
function parseFrontmatter(text) {
    if (!text.startsWith("---\n")) return null;
    const end = text.indexOf("\n---\n", 4);
    if (end < 0) return null;
    const body = text.slice(4, end);
    const fm = {};
    const lines = body.split("\n");
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
        if (!m) continue;
        const key = m[1];
        let value = m[2];
        if (value === "") {
            const items = [];
            while (i + 1 < lines.length) {
                const nextRaw = lines[i + 1];
                const nextItem = nextRaw.match(/^\s+-\s+(.*?)\s*$/);
                if (!nextItem) break;
                let raw = nextItem[1];
                if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
                    raw = raw.slice(1, -1);
                }
                items.push(raw);
                i++;
            }
            fm[key] = items;
            continue;
        }
        if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
            value = value.slice(1, -1);
        } else if (value.startsWith("[") && value.endsWith("]")) {
            const inner = value.slice(1, -1).trim();
            value =
                inner.length === 0
                    ? []
                    : inner
                          .split(",")
                          .map((part) => part.trim())
                          .map((part) =>
                              part.startsWith('"') && part.endsWith('"') && part.length >= 2 ? part.slice(1, -1) : part,
                          );
        } else if (value === "true") {
            value = true;
        } else if (value === "false") {
            value = false;
        }
        fm[key] = value;
    }
    return fm;
}

function collectModuleDocs() {
    const docsDir = path.join(repoRoot, "docs", "api-contract");
    const out = [];
    for (const entry of fs.readdirSync(docsDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(".md")) continue;
        const filePath = path.join(docsDir, entry.name);
        const text = fs.readFileSync(filePath, "utf8");
        const fm = parseFrontmatter(text);
        if (fm) out.push({ name: entry.name, path: filePath, frontmatter: fm });
    }
    return out;
}

function validateFrontmatter(docs) {
    const errors = [];
    for (const doc of docs) {
        const fm = doc.frontmatter;
        if (fm.umbrella === true) {
            if (fm.ledger_schema && String(fm.ledger_schema) !== LEDGER_SCHEMA_VERSION) {
                errors.push(
                    `  ${doc.name}: ledger_schema '${fm.ledger_schema}' does not match pin '${LEDGER_SCHEMA_VERSION}'`,
                );
                continue;
            }
            if (!Array.isArray(fm.umbrella_sources) || fm.umbrella_sources.length === 0) {
                errors.push(`  ${doc.name}: umbrella page must declare 'umbrella_sources' as a non-empty array`);
            }
            continue;
        }
        if (!fm.generated_from) {
            errors.push(`  ${doc.name}: frontmatter missing 'generated_from'`);
            continue;
        }
        if (!fm.generated_hash) {
            errors.push(`  ${doc.name}: frontmatter missing 'generated_hash'`);
            continue;
        }
        if (fm.ledger_schema && String(fm.ledger_schema) !== LEDGER_SCHEMA_VERSION) {
            errors.push(
                `  ${doc.name}: ledger_schema '${fm.ledger_schema}' does not match pin '${LEDGER_SCHEMA_VERSION}'`,
            );
            continue;
        }
        const generatedPath = path.join(repoRoot, fm.generated_from);
        if (!fs.existsSync(generatedPath)) {
            errors.push(`  ${doc.name}: generated_from path not found: ${fm.generated_from}`);
            continue;
        }
        const buf = fs.readFileSync(generatedPath);
        const actualHash = sha256Hex(buf);
        if (actualHash !== fm.generated_hash) {
            errors.push(
                `  ${doc.name}: generated_hash mismatch\n      expected: ${fm.generated_hash}\n      actual:   ${actualHash}`,
            );
            continue;
        }
        if (fm.module) {
            let generated;
            try {
                generated = JSON.parse(buf.toString("utf8"));
            } catch (err) {
                errors.push(`  ${doc.name}: generated_from is not valid JSON: ${err.message}`);
                continue;
            }
            if (generated.module && generated.module !== fm.module) {
                errors.push(
                    `  ${doc.name}: module '${fm.module}' does not match generated file's module '${generated.module}'`,
                );
            }
        }
    }
    return errors;
}

function tryReadProfilesFromSourceDir(sourceDir) {
    const profiles = {};
    for (const name of PROFILES) {
        try {
            profiles[name] = readProfile(sourceDir, name);
        } catch {
            return null;
        }
    }
    return profiles;
}

function walkFiles(dir, predicate, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkFiles(fullPath, predicate, out);
        } else if (predicate(fullPath)) {
            out.push(fullPath);
        }
    }
    return out;
}

function diffKindForRemoval() {
    return "deprecated";
}

function entryTupleKey(entry) {
    return `${entry.method} ${entry.path}`;
}

function approxTokens(text) {
    return Math.ceil(text.length / 4);
}

function sanitizeFilenamePart(value) {
    return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function chunkArray(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size));
    }
    return out;
}

function buildModuleIndex(profile) {
    return new Map(buildModules(profile).map((item) => [item.module, item.payload]));
}

function collectModuleDiffs(beforeProfiles, afterProfiles) {
    const beforeModules = beforeProfiles ? buildModuleIndex(beforeProfiles.all) : new Map();
    const afterModules = buildModuleIndex(afterProfiles.all);
    const allModuleNames = new Set([...beforeModules.keys(), ...afterModules.keys()]);
    const diffs = [];

    for (const moduleName of [...allModuleNames].sort()) {
        const before = beforeModules.get(moduleName);
        const after = afterModules.get(moduleName);
        const beforeEntries = new Map((before?.entries ?? []).map((entry) => [entryTupleKey(entry), entry]));
        const afterEntries = new Map((after?.entries ?? []).map((entry) => [entryTupleKey(entry), entry]));
        const entryKeys = new Set([...beforeEntries.keys(), ...afterEntries.keys()]);
        const byChangeType = {
            added: [],
            modified: [],
            deprecated: [],
        };

        for (const key of [...entryKeys].sort()) {
            const previous = beforeEntries.get(key);
            const current = afterEntries.get(key);
            if (!previous && current) {
                byChangeType.added.push({ ...current, diff_kind: "added" });
            } else if (previous && !current) {
                byChangeType.deprecated.push({ ...previous, diff_kind: diffKindForRemoval() });
            } else if (previous && current && previous.registered_by !== current.registered_by) {
                byChangeType.modified.push({
                    ...current,
                    diff_kind: "modified",
                    previous_registered_by: previous.registered_by,
                });
            }
        }

        if (byChangeType.added.length || byChangeType.modified.length || byChangeType.deprecated.length) {
            diffs.push({
                moduleName,
                before,
                after,
                byChangeType,
            });
        }
    }

    return diffs;
}

const MODULE_FILE_ALIASES = {
    key_backup: ["key-backup"],
    friend_room: ["friend"],
    room_summary: ["room-summary"],
    burn_after_read: ["burn-after-read"],
    external_service: ["external-service"],
    ai_connection: ["ai-connection"],
    verification_routes: ["verification"],
    app_service: ["appservice"],
    push_notification: ["notifications", "notification"],
    background_update: ["background-update"],
    feature_flags: ["server-capabilities", "feature-flags"],
    worker_body: ["worker-admin", "worker"],
    account_data: ["account-data"],
};

function candidateTermsForModule(moduleName) {
    const snakeTerms = moduleName.split("_").filter(Boolean);
    const aliases = MODULE_FILE_ALIASES[moduleName] ?? [];
    const derived = [moduleName, moduleName.replace(/_/g, "-"), ...aliases];
    return [...new Set([...snakeTerms, ...derived].map((item) => item.toLowerCase()))];
}

function scoreCandidate(filePath, terms, preferredBasenames) {
    const relative = path.relative(repoRoot, filePath).toLowerCase();
    let score = 0;
    for (const term of terms) {
        if (relative.includes(term)) score += 3;
    }
    const base = path.basename(filePath).toLowerCase();
    if (preferredBasenames.includes(base)) score += 4;
    if (relative.includes("/__generated__/")) score -= 6;
    return score;
}

function selectSnippetFiles(moduleName) {
    const terms = candidateTermsForModule(moduleName);
    const srcFiles = walkFiles(path.join(repoRoot, "src"), (file) => file.endsWith(".ts") && !file.endsWith(".d.ts"));
    const typeFiles = walkFiles(
        path.join(repoRoot, "src", "@types"),
        (file) => file.endsWith(".ts") || file.endsWith(".d.ts"),
    );
    const specFiles = walkFiles(path.join(repoRoot, "spec"), (file) => file.endsWith(".ts"));

    const rankedManager = srcFiles
        .map((filePath) => ({
            filePath,
            score: scoreCandidate(filePath, terms, ["index.ts", "manager.ts"]),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath));

    const rankedTypes = typeFiles
        .map((filePath) => ({
            filePath,
            score: scoreCandidate(filePath, terms, [path.basename(filePath).toLowerCase()]),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath));

    const rankedTests = specFiles
        .map((filePath) => ({
            filePath,
            score: scoreCandidate(filePath, terms, ["index.spec.ts"]),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath));

    const files = [];
    if (rankedManager[0]) files.push({ kind: "manager", filePath: rankedManager[0].filePath, maxLines: 220 });
    for (const item of rankedTypes.slice(0, 2)) {
        files.push({ kind: "types", filePath: item.filePath, maxLines: 90 });
    }
    if (rankedTests[0]) files.push({ kind: "test", filePath: rankedTests[0].filePath, maxLines: 90 });
    return files;
}

function buildSdkSnippet(moduleName) {
    const snippetFiles = selectSnippetFiles(moduleName);
    if (snippetFiles.length === 0) {
        return `// No matching SDK source snippet found for module '${moduleName}'.\n`;
    }

    const chunks = [];
    let totalLines = 0;
    for (const item of snippetFiles) {
        const text = fs.readFileSync(item.filePath, "utf8");
        const lines = text.split(/\r?\n/);
        const allowed = Math.max(0, Math.min(item.maxLines, DRAFT_SNIPPET_HARD_CAP - totalLines));
        if (allowed === 0) break;
        const excerpt = lines.slice(0, allowed).join("\n");
        totalLines += excerpt.split(/\r?\n/).length;
        chunks.push(
            `### ${item.kind}: ${path.relative(repoRoot, item.filePath)}\n` + "```ts\n" + `${excerpt}\n` + "```\n",
        );
        if (totalLines >= DRAFT_SNIPPET_TARGET_LINES) break;
    }

    const joined = chunks.join("\n").trim();
    const lineCount = joined ? joined.split(/\r?\n/).length : 0;
    if (lineCount <= DRAFT_SNIPPET_HARD_CAP) return `${joined}\n`;

    return `${joined.split(/\r?\n/).slice(0, DRAFT_SNIPPET_HARD_CAP).join("\n")}\n`;
}

export function extractCanonicalPrompt(template) {
    const heading = "## 1. Canonical prompt";
    const headingIndex = template.indexOf(heading);
    if (headingIndex < 0) {
        throw new Error("prompt template is missing the '## 1. Canonical prompt' section");
    }
    const fenceStart = template.indexOf("```\n", headingIndex);
    if (fenceStart < 0) {
        throw new Error("prompt template is missing the canonical prompt opening fence");
    }
    const contentStart = fenceStart + "```\n".length;
    const fenceEnd = template.indexOf("\n```", contentStart);
    if (fenceEnd < 0) {
        throw new Error("prompt template is missing the canonical prompt closing fence");
    }
    return template.slice(contentStart, fenceEnd);
}

function renderPrompt(promptBody, { changeType, endpointDiffJson, currentSdkSnippet }) {
    return promptBody
        .replace("{{ change_type }}", changeType)
        .replace("{{ endpoint_diff_json }}", endpointDiffJson)
        .replace("{{ current_sdk_snippet }}", currentSdkSnippet);
}

export function wrapRenderedPrompt({ renderedPrompt, provenanceLines }) {
    return (
        "# Contract Draft\n\n" +
        "## Provenance\n\n" +
        "```text\n" +
        `${provenanceLines.join("\n")}\n` +
        "```\n\n" +
        "## Checklist\n\n" +
        "- reviewer gate: `docs/api-contract/governance/LEDGER_REVIEW_CHECKLIST.md`\n" +
        "- canonical template: `docs/api-contract/governance/SDK_CODEGEN_PROMPT_TEMPLATE.md`\n\n" +
        "## Prompt\n\n" +
        renderedPrompt.trimEnd() +
        "\n"
    );
}

export function renderOverflowStub({ moduleName, changeType, reason, provenanceLines }) {
    return (
        "# Contract Draft Overflow\n\n" +
        `- module: \`${moduleName}\`\n` +
        `- change_type: \`${changeType}\`\n` +
        `- reason: ${reason}\n\n` +
        "## Provenance\n\n" +
        "```\n" +
        `${provenanceLines.join("\n")}\n` +
        "```\n"
    );
}

function clearDraftDirectory() {
    ensureDir(DRAFTS_DIR);
    for (const entry of fs.readdirSync(DRAFTS_DIR)) {
        if (entry.endsWith(".md")) {
            fs.unlinkSync(path.join(DRAFTS_DIR, entry));
        }
    }
}

export function buildDraftDocument({
    promptBody,
    moduleName,
    changeType,
    entries,
    sdkSnippet,
    synapseRustCommit,
    timestampFilePart,
    chunkIndex,
    ledgerProfile = "all",
}) {
    const endpointDiffJson = `${JSON.stringify(entries, null, 2)}\n`;
    const fileName = `${timestampFilePart}-${sanitizeFilenamePart(moduleName)}-${changeType}-${String(chunkIndex + 1).padStart(2, "0")}.md`;
    const provenanceLines = [
        `contract-prompt: docs/api-contract/drafts/${fileName}`,
        `ledger-commit:   synapse-rust@${synapseRustCommit ?? "<unknown>"}`,
        `ledger-profile:  ${ledgerProfile}`,
        `change-type:     ${changeType}`,
        `module:          ${moduleName}`,
    ];
    const renderedPrompt = renderPrompt(promptBody, {
        changeType,
        endpointDiffJson,
        currentSdkSnippet: sdkSnippet,
    });
    let rendered = wrapRenderedPrompt({
        renderedPrompt,
        provenanceLines,
    });
    const snippetLines = sdkSnippet.split(/\r?\n/).length;
    const approxTokenCount = approxTokens(rendered);
    const overflowReasons = [];
    if (entries.length > DRAFT_ENTRY_SOFT_CAP) {
        overflowReasons.push(`endpoint_diff_json soft cap exceeded (${entries.length} > ${DRAFT_ENTRY_SOFT_CAP})`);
    }
    if (snippetLines > DRAFT_SNIPPET_TARGET_LINES) {
        overflowReasons.push(`current_sdk_snippet soft cap exceeded (${snippetLines} > ${DRAFT_SNIPPET_TARGET_LINES})`);
    }
    if (approxTokenCount > DRAFT_TOKEN_SOFT_CAP) {
        overflowReasons.push(
            `rendered prompt soft cap exceeded (~${approxTokenCount} > ${DRAFT_TOKEN_SOFT_CAP} tokens)`,
        );
    }

    let isOverflow = false;
    if (approxTokenCount > DRAFT_TOKEN_HARD_CAP || snippetLines > DRAFT_SNIPPET_HARD_CAP) {
        rendered = renderOverflowStub({
            moduleName,
            changeType,
            reason:
                approxTokenCount > DRAFT_TOKEN_HARD_CAP
                    ? `rendered prompt exceeds hard cap (~${approxTokenCount} > ${DRAFT_TOKEN_HARD_CAP} tokens)`
                    : `current_sdk_snippet exceeds hard cap (${snippetLines} > ${DRAFT_SNIPPET_HARD_CAP} lines)`,
            provenanceLines,
        });
        isOverflow = true;
    } else if (overflowReasons.length > 0) {
        rendered = "<!-- soft-cap notes: " + `${overflowReasons.join("; ")} -->\n\n` + rendered;
    }

    return {
        fileName,
        rendered,
        provenanceLines,
        snippetLines,
        approxTokenCount,
        overflowReasons,
        isOverflow,
    };
}

function renderDrafts(beforeProfiles, afterProfiles) {
    const template = fs.readFileSync(PROMPT_TEMPLATE_PATH, "utf8");
    const promptBody = extractCanonicalPrompt(template);
    const moduleDiffs = collectModuleDiffs(beforeProfiles, afterProfiles);
    clearDraftDirectory();

    const timestampRaw =
        afterProfiles.default.parsed.generated_at ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const timestampFilePart = sanitizeFilenamePart(timestampRaw.replace(/:/g, "-"));
    let draftCount = 0;
    let stubCount = 0;

    for (const diff of moduleDiffs) {
        const sdkSnippet = buildSdkSnippet(diff.moduleName);
        const snippetLines = sdkSnippet.split(/\r?\n/).length;

        for (const [changeType, entries] of Object.entries(diff.byChangeType)) {
            if (entries.length === 0) continue;
            const chunks = chunkArray(entries, DRAFT_ENTRY_HARD_CAP);
            chunks.forEach((chunk, index) => {
                const draft = buildDraftDocument({
                    promptBody,
                    moduleName: diff.moduleName,
                    changeType,
                    entries: chunk,
                    sdkSnippet,
                    synapseRustCommit: afterProfiles.default.parsed.synapse_rust_commit,
                    timestampFilePart,
                    chunkIndex: index,
                    ledgerProfile: "all",
                });
                if (draft.isOverflow) {
                    stubCount += 1;
                }
                fs.writeFileSync(path.join(DRAFTS_DIR, draft.fileName), draft.rendered);
                draftCount += 1;
            });
        }
    }

    return { draftCount, stubCount, changedModules: moduleDiffs.length };
}

function checkDrift(outputs) {
    const drifts = [];
    for (const name of PROFILES) {
        const diskPath = path.join(GENERATED_DIR, `route-manifest.${name}.json`);
        const onDisk = readIfExists(diskPath);
        if (!onDisk || !onDisk.equals(outputs.profileFiles[name])) {
            drifts.push(`  route-manifest.${name}.json`);
        }
    }
    const modulesDir = path.join(GENERATED_DIR, "modules");
    const diskModules = fs.existsSync(modulesDir)
        ? new Set(
              fs
                  .readdirSync(modulesDir)
                  .filter((f) => f.endsWith(".json"))
                  .map((f) => f.replace(/\.json$/, "")),
          )
        : new Set();
    for (const moduleName of outputs.moduleNames) {
        const diskPath = path.join(modulesDir, `${moduleName}.json`);
        const onDisk = readIfExists(diskPath);
        if (!onDisk || !onDisk.equals(outputs.moduleFiles[moduleName])) {
            drifts.push(`  modules/${moduleName}.json`);
        }
        diskModules.delete(moduleName);
    }
    for (const stale of diskModules) {
        drifts.push(`  modules/${stale}.json (stale, should be removed)`);
    }
    const indexPath = path.join(GENERATED_DIR, "index.json");
    const onDisk = readIfExists(indexPath);
    if (!onDisk || !onDisk.equals(outputs.indexFile)) {
        drifts.push(`  index.json`);
    }
    return drifts;
}

function run(argv) {
    let args;
    try {
        args = parseArgs(argv);
    } catch (err) {
        process.stderr.write(`error: ${err.message}\n\n`);
        printHelp();
        return 2;
    }
    if (args.help) {
        printHelp();
        return 0;
    }

    const profiles = {};
    for (const name of PROFILES) {
        profiles[name] = readProfile(args.sourceDir, name);
    }
    const outputs = buildOutputs(profiles);

    if (args.mode === "check") {
        const drifts = checkDrift(outputs);
        const frontmatterErrors = validateFrontmatter(collectModuleDocs());
        if (drifts.length > 0 || frontmatterErrors.length > 0) {
            if (drifts.length > 0) {
                process.stderr.write(
                    `contract-sync: ${drifts.length} generated file(s) drift vs disk:\n${drifts.join("\n")}\n\n`,
                );
            }
            if (frontmatterErrors.length > 0) {
                process.stderr.write(
                    `contract-sync: ${frontmatterErrors.length} module doc(s) failed frontmatter validation:\n${frontmatterErrors.join("\n")}\n\n`,
                );
            }
            process.stderr.write(
                `Run \`pnpm run contract:sync\` (or \`node scripts/contract-sync.mjs\`) to refresh generated/; ` +
                    `for doc hash mismatches re-copy the sha256 from index.json.\n`,
            );
            return 1;
        }
        const moduleDocs = collectModuleDocs();
        const umbrellaCount = moduleDocs.filter((d) => d.frontmatter.umbrella === true).length;
        const pinnedCount = moduleDocs.length - umbrellaCount;
        process.stdout.write(
            `contract-sync: generated/ is in sync (${Object.keys(outputs.moduleFiles).length} modules, ` +
                `${profiles.default.parsed.entry_count} default-profile entries, ` +
                `${pinnedCount} doc page(s) pinned via frontmatter` +
                `${umbrellaCount > 0 ? `, ${umbrellaCount} umbrella page(s) governed via frontmatter` : ""}).\n`,
        );
        return 0;
    }

    const beforeProfiles = args.renderDrafts ? tryReadProfilesFromSourceDir(GENERATED_DIR) : null;
    writeOutputs(outputs);
    let draftSummary = null;
    if (args.renderDrafts) {
        draftSummary = renderDrafts(beforeProfiles, profiles);
    }
    process.stdout.write(
        `contract-sync: wrote ${Object.keys(outputs.moduleFiles).length} module files, ` +
            `${PROFILES.length} profile manifests, and index.json.\n` +
            `  default profile: ${profiles.default.parsed.entry_count} entries\n` +
            `  worker profile:  ${profiles.worker.parsed.entry_count} entries\n` +
            `  openclaw profile: ${profiles.openclaw.parsed.entry_count} entries\n` +
            `  all profile:     ${profiles.all.parsed.entry_count} entries\n` +
            `  synapse_rust_commit: ${profiles.default.parsed.synapse_rust_commit ?? "(none)"}\n`,
    );
    if (draftSummary) {
        process.stdout.write(
            `  drafts:          ${draftSummary.draftCount} file(s) across ${draftSummary.changedModules} changed module(s)` +
                `${draftSummary.stubCount > 0 ? `, ${draftSummary.stubCount} overflow stub(s)` : ""}\n`,
        );
    }
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === entryFilePath) {
    try {
        process.exitCode = run(process.argv);
    } catch (err) {
        process.stderr.write(`error: ${err.message}\n`);
        if (process.env.CONTRACT_SYNC_TRACE) {
            process.stderr.write(`${err.stack}\n`);
        }
        process.exitCode = 1;
    }
}
