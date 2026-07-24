#!/usr/bin/env node
/*
 * One-shot helper: update existing `generated_hash` frontmatter in each
 * module .md doc to match the hash computed from the current generated
 * module JSON. Run when `contract:check` reports stale hashes after a
 * `contract:sync` / `contract:codegen` cycle.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const docsDir = path.join(repoRoot, "docs", "api-contract");
const modulesDir = path.join(docsDir, "generated", "modules");

const DOC_TO_MODULE = {
    "account-data": "account_data",
    admin: "admin",
    "ai-connection": "ai_connection",
    "app-service": "app_service",
    "background-update": "background_update",
    "burn-after-read": "burn_after_read",
    captcha: "captcha",
    cas: "cas",
    device: "device",
    dm: "dm",
    e2ee: "e2ee",
    ephemeral: "ephemeral",
    "event-report": "event_report",
    "external-service": "external_service",
    "feature-flags": "feature_flags",
    federation: "federation",
    friend: "friend_room",
    guest: "guest",
    "key-backup": "key_backup",
    "key-rotation": "key_rotation",
    media: "media",
    moderation: "moderation",
    module: "module",
    notifications: "push_notification",
    oidc: "oidc",
    openclaw: "openclaw",
    presence: "presence",
    push: "push",
    reactions: "reactions",
    relations: "relations",
    rendezvous: "rendezvous",
    "room-summary": "room_summary",
    room: "room",
    saml: "saml",
    search: "search",
    "sliding-sync": "sliding_sync",
    space: "space",
    sync: "sync",
    tags: "tags",
    telemetry: "telemetry",
    thirdparty: "thirdparty",
    thread: "thread",
    typing: "typing",
    verification: "verification_routes",
    voice: "voice",
    widget: "widget",
    "worker-admin": "worker",
    "worker-body": "worker_body",
};

let updated = 0;
let unchanged = 0;
let skipped = 0;

for (const [docBase, moduleKey] of Object.entries(DOC_TO_MODULE)) {
    const docPath = path.join(docsDir, `${docBase}.md`);
    const modulePath = path.join(modulesDir, `${moduleKey}.json`);

    if (!fs.existsSync(docPath) || !fs.existsSync(modulePath)) {
        skipped += 1;
        continue;
    }

    const existing = fs.readFileSync(docPath, "utf8");
    if (!existing.startsWith("---\n")) {
        skipped += 1;
        continue;
    }

    const endIdx = existing.indexOf("\n---\n", 4);
    if (endIdx === -1) {
        skipped += 1;
        continue;
    }

    const frontmatter = existing.slice(4, endIdx);
    const rest = existing.slice(endIdx + 5);

    const buf = fs.readFileSync(modulePath);
    const newHash = "sha256-" + crypto.createHash("sha256").update(buf).digest("hex");

    const hashLineRegex = /^generated_hash: .*$/m;
    const match = frontmatter.match(hashLineRegex);
    if (!match) {
        skipped += 1;
        continue;
    }

    const oldHash = match[0].replace(/^generated_hash: /, "");
    if (oldHash === newHash) {
        unchanged += 1;
        continue;
    }

    const newFrontmatter = frontmatter.replace(hashLineRegex, `generated_hash: ${newHash}`);
    fs.writeFileSync(docPath, `---\n${newFrontmatter}\n---\n${rest}`);
    updated += 1;
    console.log(`  ${docBase}.md: ${oldHash.slice(0, 20)}... -> ${newHash.slice(0, 24)}...`);
}

console.log(`\nupdate-doc-hashes: updated ${updated}, unchanged ${unchanged}, skipped ${skipped}.`);
