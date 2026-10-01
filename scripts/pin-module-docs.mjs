#!/usr/bin/env node
/*
 * Idempotent helper that keeps `generated_hash` frontmatter on the module
 * `.md` pages in `docs/api-contract/` in lockstep with the committed
 * `docs/api-contract/generated/modules/<module>.json` manifests.
 *
 * Two jobs:
 *   1. ADD     — pages with no YAML frontmatter get a full block.
 *   2. REFRESH — pages whose `generated_hash` no longer matches the manifest
 *                get just that one line rewritten. Everything else in the
 *                frontmatter (notably `last_reviewed`) is left untouched:
 *                re-pinning is an integrity sync, NOT a content review, so it
 *                must not claim the page was re-reviewed.
 *
 * Why REFRESH exists: `contract-sync.mjs --check` fails with "generated_hash
 * mismatch" for every module whose manifest changed, and its own remedy text
 * ("re-copy the sha256 from index.json") means hand-editing ~46 files after
 * each ledger refresh. Mechanising it removes that manual, error-prone step.
 *
 * Resolution order for "which manifest does this page describe":
 *   1. the page's own `generated_from` frontmatter — authoritative, because it
 *      is the exact path `contract-sync.mjs --check` will re-hash;
 *   2. otherwise `LEDGER_MODULE_ALIASES` from `contract-module-map.mjs`, the
 *      declared single source of truth for ledger-module <-> SDK-dir mapping.
 * Step 1 exists because this script used to keep a **third** hand-copied copy
 * of that table, and its `e2ee -> e2ee_routes` entry had gone stale (the ledger
 * module is now plain `e2ee`), so `e2ee.md` was silently skipped as "no matching
 * pair" and its pin stayed broken.
 *
 * Runs as `pnpm run contract:pin-docs`. Referenced from §0.0 (Phase C
 * closeout) and §2.3 of LEDGER_DRIVEN_SDK_PLAN_2026-05-02.md.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { LEDGER_MODULE_ALIASES } from "./contract-module-map.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const docsDir = path.join(repoRoot, "docs", "api-contract");
const modulesDir = path.join(docsDir, "generated", "modules");

const TODAY = new Date().toISOString().slice(0, 10);

let added = 0;
let refreshed = 0;
let already = 0;
let skipped = 0;

/** Split a page into its YAML frontmatter block and the remaining body. */
function splitFrontmatter(text) {
    if (!text.startsWith("---\n")) return null;
    const end = text.indexOf("\n---\n", 3);
    if (end === -1) return null;
    return { block: text.slice(4, end), body: text.slice(end + 5) };
}

const readField = (block, name) => {
    const m = new RegExp(`^${name}:\\s*(.+)$`, "m").exec(block ?? "");
    return m ? m[1].trim() : null;
};

const docBases = fs
    .readdirSync(docsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();

for (const docBase of docBases) {
    const docPath = path.join(docsDir, `${docBase}.md`);
    const existing = fs.readFileSync(docPath, "utf8");
    const split = splitFrontmatter(existing);

    // 1. Authoritative: whatever path the page says it was generated from.
    let modulePath = null;
    const declared = split ? readField(split.block, "generated_from") : null;
    if (declared) {
        const candidate = path.join(repoRoot, declared);
        if (fs.existsSync(candidate)) modulePath = candidate;
    }

    // 2. Fallback: ledger-module alias table, for pages still lacking frontmatter.
    //    Restricted to pages the alias table actually knows about. Without that
    //    guard this loop would happily stamp `generated_hash` onto non-module
    //    pages that live in the same directory (README/CHANGELOG/AUDIT_INDEX/...).
    let moduleKey = split ? readField(split.block, "module") : null;
    const aliasModule = LEDGER_MODULE_ALIASES[docBase];
    if (!modulePath && aliasModule) {
        moduleKey = aliasModule;
        const candidate = path.join(modulesDir, `${aliasModule}.json`);
        if (fs.existsSync(candidate)) modulePath = candidate;
    }

    if (!modulePath) {
        skipped += 1;
        continue;
    }

    const jsonBytes = fs.readFileSync(modulePath);
    const hash = `sha256-${crypto.createHash("sha256").update(jsonBytes).digest("hex")}`;
    // Mirror the manifest's own schema pin instead of hardcoding it — the
    // previous version emitted `ledger_schema: 1` blocks that failed
    // `contract-sync.mjs --check` on sight.
    let ledgerSchema = "4";
    try {
        const parsed = JSON.parse(jsonBytes.toString("utf8"));
        if (parsed.ledger_schema) ledgerSchema = String(parsed.ledger_schema);
    } catch {
        // Manifest is not valid JSON; leave the default and let the gate complain.
    }

    if (!split) {
        const frontmatter =
            `---\n` +
            `module: ${moduleKey}\n` +
            `generated_from: ${path.relative(repoRoot, modulePath)}\n` +
            `generated_hash: ${hash}\n` +
            `ledger_schema: ${ledgerSchema}\n` +
            `last_reviewed: ${TODAY}\n` +
            `---\n\n`;

        fs.writeFileSync(docPath, frontmatter + existing);
        added += 1;
        continue;
    }

    if (readField(split.block, "generated_hash") === hash) {
        already += 1;
        continue;
    }

    const nextBlock = /^generated_hash:.*$/m.test(split.block)
        ? split.block.replace(/^generated_hash:.*$/m, `generated_hash: ${hash}`)
        : `${split.block}\ngenerated_hash: ${hash}`;

    fs.writeFileSync(docPath, `---\n${nextBlock}\n---\n${split.body}`);
    refreshed += 1;
}

console.log(
    `pin-module-docs: added ${added}, refreshed ${refreshed}, already in sync ${already}, ${skipped} no matching pair.`,
);
