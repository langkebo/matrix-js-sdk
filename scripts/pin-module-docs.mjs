#!/usr/bin/env node
/*
 * One-shot (idempotent) helper: add `generated_from` / `generated_hash`
 * frontmatter to each module `.md` page in `docs/api-contract/` that
 * matches a committed `docs/api-contract/generated/modules/<module>.json`
 * file. Pages that already carry a YAML frontmatter block are skipped.
 *
 * Runs as `pnpm run contract:pin-docs`. Referenced from §0.0 (Phase C
 * closeout) and §2.3 of LEDGER_DRIVEN_SDK_PLAN_2026-05-02.md.
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
    "admin": "admin",
    "ai-connection": "ai_connection",
    "app-service": "app_service",
    "background-update": "background_update",
    "burn-after-read": "burn_after_read",
    "captcha": "captcha",
    "cas": "cas",
    "device": "device",
    "dm": "dm",
    "e2ee": "e2ee_routes",
    "ephemeral": "ephemeral",
    "event-report": "event_report",
    "external-service": "external_service",
    "feature-flags": "feature_flags",
    "federation": "federation",
    "friend": "friend_room",
    "guest": "guest",
    "key-backup": "key_backup",
    "key-rotation": "key_rotation",
    "media": "media",
    "moderation": "moderation",
    "module": "module",
    "notifications": "push_notification",
    "oidc": "oidc",
    "openclaw": "openclaw",
    "presence": "presence",
    "push": "push",
    "reactions": "reactions",
    "relations": "relations",
    "rendezvous": "rendezvous",
    "room-summary": "room_summary",
    "room": "room",
    "saml": "saml",
    "search": "search",
    "sliding-sync": "sliding_sync",
    "space": "space",
    "sync": "sync",
    "tags": "tags",
    "telemetry": "telemetry",
    "thirdparty": "thirdparty",
    "thread": "thread",
    "typing": "typing",
    "verification": "verification_routes",
    "voice": "voice",
    "widget": "widget",
    "worker-admin": "worker",
    "worker-body": "worker_body",
};

const TODAY = new Date().toISOString().slice(0, 10);

let added = 0;
let already = 0;
let skipped = 0;

for (const [docBase, moduleKey] of Object.entries(DOC_TO_MODULE)) {
    const docPath = path.join(docsDir, `${docBase}.md`);
    const modulePath = path.join(modulesDir, `${moduleKey}.json`);

    if (!fs.existsSync(docPath)) {
        skipped += 1;
        continue;
    }
    if (!fs.existsSync(modulePath)) {
        skipped += 1;
        continue;
    }

    const existing = fs.readFileSync(docPath, "utf8");
    if (existing.startsWith("---\n")) {
        already += 1;
        continue;
    }

    const jsonBytes = fs.readFileSync(modulePath);
    const hash = crypto.createHash("sha256").update(jsonBytes).digest("hex");

    const frontmatter =
        `---\n` +
        `module: ${moduleKey}\n` +
        `generated_from: docs/api-contract/generated/modules/${moduleKey}.json\n` +
        `generated_hash: sha256-${hash}\n` +
        `ledger_schema: 1\n` +
        `last_reviewed: ${TODAY}\n` +
        `---\n\n`;

    fs.writeFileSync(docPath, frontmatter + existing);
    added += 1;
}

console.log(
    `pin-module-docs: added ${added} frontmatter block(s), ${already} already pinned, ${skipped} no matching pair.`,
);
