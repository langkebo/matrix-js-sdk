#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
const REMEDIATION_TEXT = [
    "[entrypoint-layering] remediation hints:",
    "- keep src/core.ts limited to core-only sources and symbols",
    "- move manager exports (AdminManager/DirectMessageManager/...) to src/advanced.ts",
    "- if layering change is intentional, update allowed source lists and corresponding docs/ADR",
    "- re-run: pnpm quality:entrypoints",
].join("\n");

function read(relPath) {
    const abs = path.join(projectRoot, relPath);
    if (!fs.existsSync(abs)) {
        throw new Error(`[entrypoint-layering] missing file: ${relPath}`);
    }
    return fs.readFileSync(abs, "utf8");
}

function extractExportSpecifiers(source) {
    const exports = [];
    const exportFromRe = /^\s*export\s+(?:type\s+)?(?:\*\s+from|\{[^}]*\}\s+from)\s+"([^"]+)";\s*$/gm;
    for (const match of source.matchAll(exportFromRe)) {
        exports.push(match[1]);
    }
    return exports;
}

function assertNoForbiddenPatterns(relPath, source, forbidden) {
    for (const pattern of forbidden) {
        if (source.includes(pattern)) {
            throw new Error(`[entrypoint-layering] ${relPath}: forbidden pattern found: ${pattern}`);
        }
    }
}

function assertAllowedExportFrom(relPath, exportFrom, allowed) {
    const violations = exportFrom.filter((p) => !allowed.has(p));
    if (violations.length) {
        const lines = violations.map((p) => `- ${p}`).join("\n");
        throw new Error(`[entrypoint-layering] ${relPath}: disallowed export sources:\n${lines}`);
    }
}

function collectExportedSymbols(absFilePath, visited = new Set()) {
    const symbols = new Set();
    if (visited.has(absFilePath)) return symbols;
    visited.add(absFilePath);

    if (!fs.existsSync(absFilePath) || !fs.statSync(absFilePath).isFile()) return symbols;
    const content = fs.readFileSync(absFilePath, "utf8");

    const namedDeclRegex =
        /^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+class|class|interface|type|enum|function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
    for (const match of content.matchAll(namedDeclRegex)) {
        symbols.add(match[1]);
    }

    const exportClauseRegex = /^\s*export\s+(?:type\s+)?\{([^}]+)\}(?:\s+from\s+["'][^"']+["'])?/gm;
    for (const match of content.matchAll(exportClauseRegex)) {
        const specifiers = match[1].split(",");
        for (const specifier of specifiers) {
            const cleaned = specifier.trim().replace(/^type\s+/, "");
            if (!cleaned) continue;
            const asMatch = cleaned.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
            symbols.add(asMatch ? asMatch[2] : cleaned);
        }
    }

    const exportAllRegex = /^\s*export\s+\*\s+from\s+["']([^"']+)["']/gm;
    for (const match of content.matchAll(exportAllRegex)) {
        const target = resolveRelativeModule(absFilePath, match[1]);
        if (!target) continue;
        const nested = collectExportedSymbols(target, visited);
        for (const symbol of nested) {
            if (symbol !== "default") symbols.add(symbol);
        }
    }

    return symbols;
}

function resolveRelativeModule(fromFile, importSpecifier) {
    if (!importSpecifier.startsWith(".")) return null;
    const basePath = path.resolve(path.dirname(fromFile), importSpecifier);
    const candidates = [
        basePath,
        `${basePath}.ts`,
        `${basePath}.d.ts`,
        path.join(basePath, "index.ts"),
        path.join(basePath, "index.d.ts"),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
}

function assertNoForbiddenExportedSymbols(relPath, forbiddenSymbols) {
    const absPath = path.join(projectRoot, relPath);
    const exportedSymbols = collectExportedSymbols(absPath);
    const hits = forbiddenSymbols.filter((symbol) => exportedSymbols.has(symbol));
    if (hits.length) {
        throw new Error(
            `[entrypoint-layering] ${relPath}: forbidden exported symbols detected:\n${hits.map((s) => `- ${s}`).join("\n")}`,
        );
    }
}

try {
    const corePath = "src/core.ts";
    const advancedPath = "src/advanced.ts";
    const legacyPath = "src/legacy.ts";

    const coreSource = read(corePath);
    const advancedSource = read(advancedPath);
    const legacySource = read(legacyPath);

    assertNoForbiddenPatterns(corePath, coreSource, ['export * from "./matrix"']);
    assertNoForbiddenPatterns(advancedPath, advancedSource, ['export * from "./matrix"']);

    const coreAllowed = new Set([
        "./matrix",
        "./client",
        "./errors",
        "./http-api/index",
        "./http-api/prefix",
        "./http-api/method",
        "./models/event",
        "./models/room",
        "./models/thread",
        "./models/user",
        "./@types/event",
        "./@types/events",
        "./@types/auth",
        "./@types/requests",
        "./@types/read_receipts",
        "./client-config-types",
        "./models/room-member",
        "./@types/PushRules",
        "./@types/membership",
        "./@types/search",
        "./@types/topic",
        "./@types/three-pids",
        "./@types/partials",
        "./models/event-timeline",
        "./telemetry/index",
        "./manager-extensions/index",
    ]);

    const advancedAllowed = new Set([
        "./core",
        "./crypto-api/index",
        "./admin",
        "./dm",
        "./friend",
        "./push",
        "./space",
        "./room-summary",
        "./beacon",
    ]);

    assertAllowedExportFrom(corePath, extractExportSpecifiers(coreSource), coreAllowed);
    assertAllowedExportFrom(advancedPath, extractExportSpecifiers(advancedSource), advancedAllowed);

    assertNoForbiddenExportedSymbols(corePath, [
        "AdminManager",
        "DirectMessageManager",
        "FriendManager",
        "PushManager",
        "SpaceManager",
        "RoomSummaryManager",
        "BeaconManager",
    ]);

    if (!legacySource.trim().length) {
        throw new Error("[entrypoint-layering] src/legacy.ts is empty");
    }

    console.log("[entrypoint-layering] ok");
    writeEntrypointSummary({ ok: true });
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    console.error(REMEDIATION_TEXT);
    writeEntrypointSummary({ ok: false, errorMessage: message });
    process.exit(1);
}

function writeEntrypointSummary({ ok, errorMessage = "" }) {
    if (!stepSummaryPath) return;

    const lines = [];
    lines.push("## Entrypoint Layering Gate");
    lines.push("");
    lines.push(`- Status: ${ok ? "PASS" : "FAIL"}`);
    lines.push("");

    if (!ok) {
        lines.push("### Failure Checklist");
        lines.push("");
        lines.push("- [ ] `src/core.ts` only exports from core allowlist modules");
        lines.push("- [ ] `src/core.ts` does not export advanced-only manager symbols");
        lines.push("- [ ] `src/advanced.ts` only exports from advanced allowlist modules");
        lines.push("- [ ] `src/legacy.ts` is non-empty and remains compatibility-only");
        lines.push("");
        lines.push("### Error");
        lines.push("");
        lines.push("```text");
        lines.push(errorMessage);
        lines.push("```");
        lines.push("");
        lines.push("### Quick Fix");
        lines.push("");
        lines.push("- Move manager exports from `core` to `advanced` when applicable.");
        lines.push("- Update allowlist and ADR/docs only for intentional layering changes.");
        lines.push("- Re-run `pnpm quality:entrypoints`.");
    } else {
        lines.push("### Result");
        lines.push("");
        lines.push("- Entrypoint source allowlists pass.");
        lines.push("- `core` does not leak advanced-only manager exports.");
    }

    fs.appendFileSync(stepSummaryPath, `${lines.join("\n")}\n`);
}
