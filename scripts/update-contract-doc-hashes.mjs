#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const docsDir = path.join(repoRoot, "docs", "api-contract");
const indexPath = path.join(docsDir, "generated", "index.json");
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const modules = index.modules ?? {};

const generatedFromRe = /^generated_from:\s+docs\/api-contract\/generated\/modules\/([^\n]+)\.json$/m;
const generatedHashRe = /^generated_hash:\s+sha256-[a-f0-9]+$/m;

let updated = 0;

for (const entry of fs.readdirSync(docsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = path.join(docsDir, entry.name);
    const text = fs.readFileSync(filePath, "utf8");
    if (!text.startsWith("---\n")) continue;

    const frontmatterEnd = text.indexOf("\n---\n", 4);
    if (frontmatterEnd === -1) continue;

    const frontmatter = text.slice(4, frontmatterEnd);
    const generatedFromMatch = frontmatter.match(generatedFromRe);
    if (!generatedFromMatch) continue;

    const moduleKey = generatedFromMatch[1];
    const moduleMeta = modules[moduleKey];
    if (!moduleMeta?.sha256) continue;

    const nextText = text.replace(generatedHashRe, `generated_hash: ${moduleMeta.sha256}`);
    if (nextText === text) continue;

    fs.writeFileSync(filePath, nextText);
    updated += 1;
}

process.stdout.write(`updated ${updated} contract doc hash(es)\n`);
