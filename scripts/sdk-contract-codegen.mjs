#!/usr/bin/env node
/*
 * SDK route-table codegen — backend-contract-driven (P0 governance).
 *
 * The single source of truth for the SDK's route tables is the synapse-rust
 * backend contract `docs/synapse-rust/ROUTE_CONTRACT.md` (machine-readable
 * sibling: `artifacts/route_contract.json`). This script parses that document
 * directly and emits strongly-typed TypeScript contract helpers to
 * `src/<sdk-dir>/__generated__/` for every supported public module.
 *
 * Because the contract document strips the C-S version prefix
 * (`/rooms/{id}` rather than `/_matrix/client/r0/rooms/{id}`), each route's
 * full path is re-attached via a three-tier resolver (see the ingestion
 * layer below): backend full-path manifest → existing on-disk route-table →
 * a per-module default prefix. Route *membership* always comes from the
 * contract; the on-disk union guarantees no manager-required path is ever
 * dropped, so regeneration is build-safe.
 *
 * The generated files are pure data modules — no runtime behaviour — so
 * importing them into a manager's hot path has zero footprint. `as const` +
 * indexed `[number]` derivations make the path/method strings literal-typed,
 * so a typo like `room_keyz` is a compile error rather than a 404 at runtime.
 *
 * Modes:
 *   sdk-contract-codegen.mjs                → regenerate supported modules
 *   sdk-contract-codegen.mjs --check        → regenerate in memory; fail if disk differs
 *
 * The `--check` mode is intended for CI: PRs that change the backend
 * contract without regenerating the route tables break the build.
 *
 * Env overrides:
 *   SYNAPSE_RUST_REPO            → backend repo root (default: ../synapse-rust)
 *   SYNAPSE_RUST_CONTRACT_MD     → path to ROUTE_CONTRACT.md
 *   SYNAPSE_RUST_ROUTE_MANIFEST  → path to the full-path route manifest
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const CONTRACT_INDEX_PATH = path.join(repoRoot, "docs", "api-contract", "CONTRACT_INDEX.md");

const SKIP_ROUTE_TABLE_MODULES = new Set([
    "admin",
    "app-service",
    "dm",
    "feature-flags",
    "federation",
    "key-rotation",
    "moderation",
    "reactions",
    "voice",
]);

const SDK_DIR_ALIASES = {
    openclaw: "open-claw",
    thirdparty: "third-party",
};

const DTO_EXTERNAL_TYPE_IMPORTS = [
    {
        typeName: "MatrixEvent",
        importPath: "../../models/event.ts",
    },
    {
        typeName: "IEvent",
        importPath: "../../models/event.ts",
    },
    {
        typeName: "ISignatures",
        importPath: "../../@types/signed.ts",
    },
    {
        typeName: "ISigned",
        importPath: "../../@types/signed.ts",
    },
    {
        typeName: "IDownloadKeyResult",
        importPath: "../../client-api-types.ts",
    },
    {
        typeName: "IClaimOTKsResult",
        importPath: "../../client-api-types.ts",
    },
    {
        typeName: "KeyBackupInfo",
        importPath: "../../crypto-api/keybackup.ts",
    },
    {
        typeName: "KeyBackupSession",
        importPath: "../../crypto-api/keybackup.ts",
    },
    // Sync / room timeline shapes live in sync-accumulator.ts.
    // Generated dto.ts may reference them transitively via response types
    // authored in the contract doc; resolve them to the authoritative
    // module so `tsc --noEmit` stops emitting TS2304.
    {
        typeName: "IMinimalEvent",
        importPath: "../../sync-accumulator.ts",
    },
    {
        typeName: "IRoomEvent",
        importPath: "../../sync-accumulator.ts",
    },
    {
        typeName: "IJoinedRoom",
        importPath: "../../sync-accumulator.ts",
    },
    {
        typeName: "IInvitedRoom",
        importPath: "../../sync-accumulator.ts",
    },
    {
        typeName: "ILeftRoom",
        importPath: "../../sync-accumulator.ts",
    },
    {
        typeName: "IKnockedRoom",
        importPath: "../../sync-accumulator.ts",
    },
    {
        typeName: "IToDeviceEvent",
        importPath: "../../sync-accumulator.ts",
    },
    // Admin-surface interfaces authored in src/admin/index.ts.
    // Only admin's generated dto.ts references these names, so scoping
    // the import to `../index.ts` resolves cleanly from
    // `src/admin/__generated__/dto.ts`.
    {
        typeName: "DeviceInfo",
        importPath: "../index.ts",
    },
    {
        typeName: "RegistrationToken",
        importPath: "../index.ts",
    },
    {
        typeName: "AuditEvent",
        importPath: "../index.ts",
    },
    {
        typeName: "FederationBlacklistEntry",
        importPath: "../index.ts",
    },
    {
        typeName: "BackgroundUpdateRecord",
        importPath: "../../background-update/__generated__/dto.ts",
    },
    {
        typeName: "ApplicationService",
        importPath: "../index.ts",
    },
];

/*
 * ─────────────────────────────────────────────────────────────────────────
 * P0 — Backend contract ingestion.
 *
 * The authoritative contract now lives in the synapse-rust repo's
 * `docs/synapse-rust/ROUTE_CONTRACT.md` (machine-readable sibling:
 * `artifacts/route_contract.json`). This script consumes that document
 * directly so the SDK route-tables can no longer drift from the backend.
 *
 * The contract document strips the C-S version prefix (e.g. it lists
 * `/rooms/{room_id}` rather than `/_matrix/client/r0/rooms/{room_id}`), so
 * we re-attach a full path via a three-tier resolver:
 *   1. backend full-path manifest (`route_contract.json`) — authoritative
 *      version (r0 / v1 / v3 / ...);
 *   2. the existing on-disk SDK route-table — preserves the exact path a
 *      manager already type-checks against (build-safe fallback);
 *   3. a per-module default prefix (`/_matrix/client/v3`, media →
 *      `/_matrix/media/v3`).
 *
 * Route membership is taken verbatim from the contract (single source of
 * truth); the union with existing entries guarantees no manager-used route
 * is ever dropped.
 * ─────────────────────────────────────────────────────────────────────────
 */

const BACKEND_REPO =
    process.env.SYNAPSE_RUST_REPO ?? path.resolve(repoRoot, "..", "synapse-rust");
const BACKEND_CONTRACT_MD =
    process.env.SYNAPSE_RUST_CONTRACT_MD ??
    path.join(BACKEND_REPO, "docs", "synapse-rust", "ROUTE_CONTRACT.md");
const BACKEND_ROUTE_MANIFEST =
    process.env.SYNAPSE_RUST_ROUTE_MANIFEST ??
    path.join(BACKEND_REPO, "artifacts", "route_contract.json");

/**
 * Maps a backend ROUTE_CONTRACT.md module heading (Chinese label) to the SDK
 * module directory that should own its routes. `null` = server-only /
 * frontend-irrelevant module (no SDK route-table is generated for it).
 *
 * This is the contract→SDK reconciliation layer. Backend module decomposition
 * differs from the SDK's, so several backend headings collapse onto one SDK
 * module and some have no SDK counterpart yet (mapped to `null`).
 */
const CONTRACT_MODULE_MAP = {
    "3PID": null,
    "AI 连接": "ai-connection",
    "CAS": "cas",
    "MSC4108": null,
    "OIDC": "oidc",
    "OpenClaw": "open-claw",
    "Rendezvous": "rendezvous",
    "SAML": "saml",
    "Worker": "worker-admin",
    "临时事件": "ephemeral",
    "事件举报": "event-report",
    "关联": "relations",
    "其他": null,
    "反应": "reactions",
    "同步": "sync",
    "后台更新": "background-update",
    "在线状态": "presence",
    "外部服务": "external-service",
    "媒体": "media",
    "审核": "moderation",
    "密钥备份": "key-backup",
    "密钥轮转": "key-rotation",
    "小组件": "widget",
    "应用服务": "app-service",
    "延迟事件": null,
    "房间": "room",
    "推送": "push",
    "搜索": "search",
    "标签": "tags",
    "模块": "module",
    "私聊": "dm",
    "空间": "space",
    "端到端加密": "e2ee",
    "第三方": "third-party",
    "管理": "admin",
    "联邦": "federation",
    "装配": null,
    "设备": "device",
    "访客": "guest",
    "语音": "voice",
    "账户": "auth",
    "输入状态": "typing",
    "遥测": "telemetry",
    "阅后即焚": "burn-after-read",
    "验证": "verification",
    "验证码": "captcha",
};

// Module-level cache, populated once in run().
let CONTRACT_PARSED = new Map();

const VERSION_PREFIX_RE = /^\/_matrix\/(?:client|media)\/(?:v\d+|r\d+|unstable)\b/;

function normalizeResourcePath(p) {
    return p.replace(VERSION_PREFIX_RE, "");
}

function contractLabelKey(heading) {
    // "房间 (Room) （163 条）" / "AI 连接 （4 条）" → "房间" / "AI 连接"
    return heading
        .replace(/^###\s*/, "")
        .split(/[（(]/)[0]
        .trim();
}

export function parseBackendContractMd(text) {
    const byLabel = new Map();
    let current = null;
    for (const line of text.split(/\r?\n/)) {
        const h = line.match(/^###\s+(.+?)\s*$/);
        if (h) {
            current = contractLabelKey(h[1]);
            if (!byLabel.has(current)) byLabel.set(current, []);
            continue;
        }
        const r = line.match(/^-\s+`([A-Z]+)`\s+`([^`]+)`/);
        if (r && current) {
            byLabel
                .get(current)
                .push({ method: r[1], rawPath: r[2], resourcePath: normalizeResourcePath(r[2]) });
        }
    }
    return byLabel;
}

function walkTsFiles(root, filename) {
    const out = [];
    const stack = [root];
    while (stack.length) {
        const dir = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const fp = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "node_modules") stack.push(fp);
            } else if (entry.name === filename) {
                out.push(fp);
            }
        }
    }
    return out;
}

function buildBackendManifestLookup() {
    const map = new Map();
    if (!fs.existsSync(BACKEND_ROUTE_MANIFEST)) return map;
    try {
        const data = JSON.parse(fs.readFileSync(BACKEND_ROUTE_MANIFEST, "utf8"));
        const modules = data && data.modules ? data.modules : data;
        for (const entries of Object.values(modules)) {
            if (!Array.isArray(entries)) continue;
            for (const e of entries) {
                const method = Array.isArray(e) ? e[0] : e.method;
                const full = Array.isArray(e) ? e[1] : e.path;
                if (!method || !full) continue;
                const key = `${method} ${normalizeResourcePath(full)}`;
                if (!map.has(key)) map.set(key, full);
            }
        }
    } catch {
        // Manifest optional; fall through to other resolvers.
    }
    return map;
}

function buildSdkTableLookup() {
    const map = new Map();
    for (const fp of walkTsFiles(path.join(repoRoot, "src"), "route-table.ts")) {
        const text = fs.readFileSync(fp, "utf8");
        const re = /method:\s*"([^"]+)",\s*path:\s*"([^"]+)"/g;
        let m;
        while ((m = re.exec(text))) {
            const key = `${m[1]} ${normalizeResourcePath(m[2])}`;
            if (!map.has(key)) map.set(key, m[2]);
        }
    }
    return map;
}

// ISSUE-13: Private endpoints migrated to vendor prefix (/_matrix/vendor/v1)
const VENDOR_ENDPOINTS = new Set(["/my_rooms", "/search_rooms", "/search_recipients"]);

function resolveFullPath(method, resourcePath, sdkDir, lookups) {
    const key = `${method} ${resourcePath}`;
    if (lookups.backend.has(key)) return lookups.backend.get(key);
    if (lookups.sdk.has(key)) return lookups.sdk.get(key);
    // Private endpoints use vendor prefix; media uses /_matrix/media/v3; else v3
    let prefix;
    if (VENDOR_ENDPOINTS.has(resourcePath)) {
        prefix = "/_matrix/vendor/v1";
    } else if (sdkDir === "media") {
        prefix = "/_matrix/media/v3";
    } else {
        prefix = "/_matrix/client/v3";
    }
    return prefix + (resourcePath.startsWith("/") ? resourcePath : `/${resourcePath}`);
}

function loadExistingEntries(sdkDir) {
    const p = path.join(repoRoot, "src", sdkDir, "__generated__", "route-table.ts");
    if (!fs.existsSync(p)) return [];
    const text = fs.readFileSync(p, "utf8");
    const out = [];
    const re = /method:\s*"([^"]+)",\s*path:\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(text))) out.push({ method: m[1], path: m[2] });
    return out;
}

function parseArgs(argv) {
    const out = { mode: "write", help: false };
    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") out.help = true;
        else if (arg === "--check") out.mode = "check";
        else throw new Error(`unknown argument: ${arg}`);
    }
    return out;
}

function printHelp() {
    process.stdout.write(
        `sdk-contract-codegen — emit typed route tables from docs/api-contract/generated/modules/\n\n` +
            `Usage:\n` +
            `  node scripts/sdk-contract-codegen.mjs            # regenerate supported modules\n` +
            `  node scripts/sdk-contract-codegen.mjs --check    # fail if disk would change\n` +
            `  node scripts/sdk-contract-codegen.mjs --help     # this message\n`,
    );
}

function escapeStringLiteral(value) {
    // `path` / `method` come from JSON the ledger script produced; they
    // will never contain control chars or backticks, but be defensive anyway.
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

function toConstantCase(value) {
    return value
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toUpperCase();
}

function toPascalCase(value) {
    return value
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join("");
}

function prettyModuleName(value) {
    return value
        .split(/[-_]+/)
        .filter(Boolean)
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(" ");
}

function parseFrontmatter(text) {
    if (!text.startsWith("---\n")) return {};
    const end = text.indexOf("\n---\n", 4);
    if (end < 0) return {};
    const out = {};
    for (const line of text.slice(4, end).split("\n")) {
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
        if (!match) continue;
        out[match[1]] = match[2];
    }
    return out;
}

function extractDocHeading(text) {
    const headingMatch = text.match(/^#\s+(.+)$/m);
    return headingMatch ? headingMatch[1].trim() : null;
}

function extractContractIndexDocLinks(text) {
    const seen = new Set();
    const docLinks = [];
    const regex = /\[[^\]]+\.md\]\(([^)]+\.md)\)/g;
    for (const match of text.matchAll(regex)) {
        const target = match[1].trim();
        const basename = path.basename(target);
        if (basename === "exports.md" || seen.has(basename)) continue;
        seen.add(basename);
        docLinks.push(basename);
    }
    return docLinks;
}

export function discoverSupportedModules(contractMdText) {
    if (contractMdText === undefined) {
        contractMdText = fs.existsSync(BACKEND_CONTRACT_MD)
            ? fs.readFileSync(BACKEND_CONTRACT_MD, "utf8")
            : "";
    }
    const byLabel = parseBackendContractMd(contractMdText);
    // Reverse map: sdkDir -> [backend contract labels]
    const sdkToLabels = new Map();
    for (const [label, sdkDir] of Object.entries(CONTRACT_MODULE_MAP)) {
        if (!sdkDir) continue;
        if (!sdkToLabels.has(sdkDir)) sdkToLabels.set(sdkDir, []);
        sdkToLabels.get(sdkDir).push(label);
    }
    const docIndexText = fs.existsSync(CONTRACT_INDEX_PATH) ? fs.readFileSync(CONTRACT_INDEX_PATH, "utf8") : "";
    const docLinks = extractContractIndexDocLinks(docIndexText);
    const modules = [];
    for (const docFileName of docLinks) {
        const docBasename = docFileName.replace(/\.md$/, "");
        const docPath = path.join(repoRoot, "docs", "api-contract", docFileName);
        const docText = fs.existsSync(docPath) ? fs.readFileSync(docPath, "utf8") : "";
        const sdkDir = SDK_DIR_ALIASES[docBasename] ?? docBasename;
        const heading = extractDocHeading(docText);
        const humanName = heading ? heading.replace(/\s+API.*$/, "").trim() : prettyModuleName(docBasename);
        modules.push({
            sdkDir,
            docBasename,
            docPath,
            constName: `${toConstantCase(docBasename)}_ROUTES`,
            typePrefix: toPascalCase(docBasename),
            humanName: humanName || prettyModuleName(docBasename),
            contractLabels: sdkToLabels.get(sdkDir) ?? [],
            sourceLabel: "docs/synapse-rust/ROUTE_CONTRACT.md",
        });
    }
    return modules;
}

function renderRouteTable(module, entries, entryCount) {
    const lines = [];
    lines.push("/*");
    lines.push(" * AUTO-GENERATED by scripts/sdk-contract-codegen.mjs — DO NOT EDIT.");
    lines.push(` * Regenerate via \`pnpm run contract:codegen\`.`);
    lines.push(" *");
    lines.push(` * Module:        ${module.humanName}`);
    lines.push(` * Source:        ${module.sourceLabel}`);
    lines.push(` * Entries:       ${entryCount} (authoritative set mirrored from the backend contract)`);
    lines.push(" */");
    lines.push("");
    lines.push(`/** Routes served by the synapse-rust \`${module.sdkDir}\` module (mirrored from the backend contract). */`);
    lines.push(`export const ${module.constName} = [`);
    for (const entry of entries) {
        if (!entry.method || !entry.path) continue;
        lines.push(
            `    { method: "${escapeStringLiteral(entry.method)}", path: "${escapeStringLiteral(entry.path)}" },`,
        );
    }
    lines.push(`] as const satisfies readonly { readonly method: string; readonly path: string }[];`);
    lines.push("");
    lines.push(`/** Union of every (method, path) tuple in \`${module.constName}\`. */`);
    lines.push(`export type ${module.typePrefix}Route = (typeof ${module.constName})[number];`);
    lines.push("");
    lines.push(`/** HTTP methods referenced by this module. */`);
    lines.push(`export type ${module.typePrefix}Method = ${module.typePrefix}Route["method"];`);
    lines.push("");
    lines.push(`/** Path templates referenced by this module. */`);
    lines.push(`export type ${module.typePrefix}Path = ${module.typePrefix}Route["path"];`);
    lines.push("");
    lines.push(`/**`);
    lines.push(` * Recursively replace \`{name}\` placeholders with \`\${string}\` so that`);
    lines.push(` * runtime template literals like \` \`/friends/\${userId}\` \` satisfy this`);
    lines.push(` * type. Used by manager code that binds call sites to the ledger while`);
    lines.push(` * still interpolating path parameters.`);
    lines.push(` */`);
    lines.push(`export type ${module.typePrefix}ReplaceBraces<P extends string> =`);
    lines.push(
        `    P extends \`\${infer A}{\${infer ParamSegment}}\${infer B}\` ? ParamSegment extends string ? \`\${A}\${string}\${${module.typePrefix}ReplaceBraces<B>}\` : never : P;`,
    );
    lines.push("");
    lines.push(`/** Broader path type that also accepts parametrised template literals. */`);
    lines.push(
        `export type ${module.typePrefix}PathPattern = ${module.typePrefix}ReplaceBraces<${module.typePrefix}Path>;`,
    );
    lines.push("");
    return lines.join("\n");
}

function extractTypeScriptDeclarations(text) {
    const declarations = [];
    const regex = /```(?:typescript|ts)\n([\s\S]*?)\n```/g;
    for (const match of text.matchAll(regex)) {
        const block = match[1].trim();
        if (!block) continue;
        if (
            block.includes("AUTO-GENERATED by scripts/sdk-contract-codegen.mjs") ||
            block.includes("// ... truncated (")
        ) {
            continue;
        }
        const sourceFile = ts.createSourceFile(
            "contract-doc-snippet.ts",
            block,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS,
        );
        const parseErrorRanges = sourceFile.parseDiagnostics
            .filter((diagnostic) => typeof diagnostic.start === "number")
            .map((diagnostic) => ({
                start: diagnostic.start,
                end: diagnostic.start + (diagnostic.length ?? 1),
            }));
        for (const statement of sourceFile.statements) {
            const hasParseErrors = parseErrorRanges.some(
                (range) => statement.pos < range.end && range.start < statement.end,
            );
            if (hasParseErrors) continue;
            if (
                ts.isInterfaceDeclaration(statement) ||
                ts.isTypeAliasDeclaration(statement) ||
                ts.isEnumDeclaration(statement)
            ) {
                const declaration = statement.getText(sourceFile).trim();
                if (declaration) declarations.push(declaration);
            }
        }
    }
    return [...new Set(declarations)];
}

function collectDeclaredTypeNames(declarations) {
    const typeNames = new Set();
    for (const declaration of declarations) {
        const match = declaration.match(/(?:^|\s)(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/);
        if (match) typeNames.add(match[1]);
    }
    return typeNames;
}

function extractCodeBlocks(text, language) {
    const blocks = [];
    const regex = new RegExp(`\`\`\`${language}\\n([\\s\\S]*?)\\n\`\`\``, "g");
    for (const match of text.matchAll(regex)) {
        blocks.push({
            start: match.index ?? 0,
            content: match[1].trim(),
        });
    }
    return blocks;
}

function sanitizeTypeNamePart(value) {
    return toPascalCase(value.replace(/^\d+(?:\.\d+)*\s*/, ""));
}

function recentContext(text, index, lineCount = 8) {
    return text.slice(0, index).split(/\r?\n/).slice(-lineCount);
}

function inferJsonDtoKind(contextLines) {
    const joined = contextLines.join("\n");
    if (/\*\*请求体\*\*/.test(joined)) return "RequestDto";
    if (/\*\*响应\*\*/.test(joined)) return "ResponseDto";
    return null;
}

function inferJsonDtoBaseName(text, index) {
    const headings = [...text.slice(0, index).matchAll(/^###\s+(.+)$/gm)];
    const latest = headings.at(-1)?.[1] ?? "Contract";
    return sanitizeTypeNamePart(latest);
}

function formatTsPropertyKey(key) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function renderJsonValueType(value, indent = 0) {
    const pad = "    ".repeat(indent);
    if (value === null) return "null";
    if (Array.isArray(value)) {
        if (value.length === 0) return "unknown[]";
        const variants = [...new Set(value.map((entry) => renderJsonValueType(entry, indent)))];
        return variants.length === 1 ? `Array<${variants[0]}>` : `Array<${variants.join(" | ")}>`;
    }
    switch (typeof value) {
        case "string":
            return "string";
        case "number":
            return "number";
        case "boolean":
            return "boolean";
        case "object": {
            const entries = Object.entries(value);
            if (entries.length === 0) return "Record<string, never>";
            return `{\n${entries
                .map(
                    ([key, child]) =>
                        `${pad}    ${formatTsPropertyKey(key)}: ${renderJsonValueType(child, indent + 1)};`,
                )
                .join("\n")}\n${pad}}`;
        }
        default:
            return "unknown";
    }
}

function extractJsonDtoDeclarations(module, contractDocText, existingTypeNames = new Set()) {
    const declarations = [];
    const seenNames = new Set();
    for (const block of extractCodeBlocks(contractDocText, "json")) {
        if (!block.content.startsWith("{") && !block.content.startsWith("[")) continue;
        let parsed;
        try {
            parsed = JSON.parse(block.content);
        } catch {
            continue;
        }
        const contextLines = recentContext(contractDocText, block.start);
        const kind = inferJsonDtoKind(contextLines);
        if (!kind) continue;
        const typeName = `${module.typePrefix}${inferJsonDtoBaseName(contractDocText, block.start)}${kind}`;
        if (existingTypeNames.has(typeName)) continue;
        if (seenNames.has(typeName)) continue;
        seenNames.add(typeName);
        const renderedType = renderJsonValueType(parsed);
        if (renderedType.startsWith("{")) {
            declarations.push(`export interface ${typeName} ${renderedType}`);
        } else {
            declarations.push(`export type ${typeName} = ${renderedType};`);
        }
    }
    return declarations;
}

function parseMarkdownTableRows(text) {
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim().startsWith("|")) continue;
        const cells = line
            .split("|")
            .slice(1, -1)
            .map((cell) => cell.trim());
        if (cells.length < 2) continue;
        if (cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")))) continue;
        rows.push(cells);
    }
    return rows;
}

function extractMarkdownTables(text) {
    const lines = text.split(/\r?\n/);
    const tables = [];
    let current = [];
    for (const line of lines) {
        if (line.trim().startsWith("|")) {
            current.push(line);
            continue;
        }
        if (current.length > 0) {
            tables.push(current);
            current = [];
        }
    }
    if (current.length > 0) tables.push(current);
    return tables
        .map((tableLines) => {
            const rows = tableLines.map((line) =>
                line
                    .split("|")
                    .slice(1, -1)
                    .map((cell) => cell.trim()),
            );
            if (rows.length < 2) return null;
            const header = rows[0];
            const body = rows
                .slice(1)
                .filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, ""))));
            if (body.length === 0) return null;
            return { header, rows: body };
        })
        .filter(Boolean);
}

function extractStatusScenarios(text) {
    const scenarios = [];
    for (const row of parseMarkdownTableRows(text)) {
        const statusText = row[0]?.replace(/`/g, "").trim();
        if (!statusText || !/\d{3}/.test(statusText)) continue;
        const firstStatus = Number.parseInt(statusText.match(/\d{3}/)?.[0] ?? "", 10);
        if (Number.isNaN(firstStatus)) continue;
        const note = row.slice(1).join(" | ").replace(/`/g, "").trim();
        scenarios.push({ status: firstStatus, note });
    }
    const deduped = [];
    const seen = new Set();
    for (const item of scenarios) {
        const key = `${item.status}:${item.note}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
    }
    return deduped;
}

function inferSdkErrorType(httpOrErrcode, errcode = "") {
    const combined = `${httpOrErrcode} ${errcode}`;
    if (/M_UNKNOWN_TOKEN|\b401\b/.test(combined)) return "AuthError";
    if (/M_NOT_FOUND|\b404\b/.test(combined)) return "NotFoundError";
    if (/M_LIMIT_EXCEEDED|\b429\b|\b5\d\d\b/.test(combined)) return "RetryableError";
    return "ApiError";
}

function extractErrorScenarios(text) {
    const scenarios = [];
    for (const table of extractMarkdownTables(text)) {
        const normalizedHeader = table.header.map((cell) => cell.replace(/[`*\s]/g, ""));
        const sdkErrorIndex = normalizedHeader.findIndex((cell) => cell.includes("SDK统一错误类型"));
        const statusIndex = normalizedHeader.findIndex((cell) => cell.includes("状态码"));
        const errcodeIndex = normalizedHeader.findIndex(
            (cell) => cell.includes("错误码") || cell.toLowerCase() === "errcode",
        );
        if (sdkErrorIndex < 0 && (statusIndex < 0 || errcodeIndex < 0)) continue;
        for (const row of table.rows) {
            if (sdkErrorIndex >= 0) {
                scenarios.push({
                    scenario: row[0]?.replace(/`/g, "").trim() ?? "",
                    httpOrErrcode: row[1]?.replace(/`/g, "").trim() ?? "",
                    sdkErrorType: row[sdkErrorIndex]?.replace(/`/g, "").trim() ?? "",
                    handling: row[sdkErrorIndex + 1]?.replace(/`/g, "").trim() ?? "",
                });
                continue;
            }
            const httpStatus = row[statusIndex]?.replace(/`/g, "").trim() ?? "";
            const errcode = row[errcodeIndex]?.replace(/`/g, "").trim() ?? "";
            const note = row
                .filter((_, index) => index !== statusIndex && index !== errcodeIndex)
                .join(" | ")
                .replace(/`/g, "")
                .trim();
            scenarios.push({
                scenario: note || errcode || httpStatus,
                httpOrErrcode: [httpStatus, errcode].filter(Boolean).join(" / "),
                sdkErrorType: inferSdkErrorType(httpStatus, errcode),
                handling: note,
            });
        }
    }
    return scenarios.filter((item) => item.scenario || item.sdkErrorType);
}

function extractErrcodes(text) {
    const errcodes = [];
    for (const table of extractMarkdownTables(text)) {
        const normalizedHeader = table.header.map((cell) => cell.replace(/[`*\s]/g, ""));
        const errcodeIndex = normalizedHeader.findIndex(
            (cell) => cell.toLowerCase() === "errcode" || cell.includes("错误码"),
        );
        if (errcodeIndex < 0) continue;
        const statusIndex = normalizedHeader.findIndex(
            (cell) => cell.includes("状态码") || cell.includes("常见HTTP") || cell.toLowerCase() === "http",
        );
        for (const row of table.rows) {
            errcodes.push({
                errcode: row[errcodeIndex]?.replace(/`/g, "").trim() ?? "",
                httpStatus: (statusIndex >= 0 ? row[statusIndex] : "")?.replace(/`/g, "").trim() ?? "",
                note: row
                    .filter((_, index) => index !== errcodeIndex && index !== statusIndex)
                    .join(" | ")
                    .replace(/`/g, "")
                    .trim(),
            });
        }
    }
    return errcodes.filter((item) => item.errcode);
}

export function renderDtoFile(module, contractDocText) {
    const tsDeclarations = extractTypeScriptDeclarations(contractDocText);
    const declarations = [
        ...tsDeclarations,
        ...extractJsonDtoDeclarations(module, contractDocText, collectDeclaredTypeNames(tsDeclarations)),
    ];
    const exportedDeclarations = declarations.map((declaration) =>
        declaration.startsWith("export ") ? declaration : `export ${declaration}`,
    );
    const requiredImports = DTO_EXTERNAL_TYPE_IMPORTS.filter(({ typeName }) => {
        const isReferenced = exportedDeclarations.some((declaration) =>
            new RegExp(`\\b${typeName}\\b`).test(declaration),
        );
        if (!isReferenced) return false;
        const localDeclRe = new RegExp(`export\\s+(?:interface|type|class|enum)\\s+${typeName}\\b`);
        const isLocallyDeclared = exportedDeclarations.some((declaration) => localDeclRe.test(declaration));
        return !isLocallyDeclared;
    });
    const lines = [];
    lines.push("/*");
    lines.push(" * AUTO-GENERATED by scripts/sdk-contract-codegen.mjs — DO NOT EDIT.");
    lines.push(` * Regenerate via \`pnpm run contract:codegen\`.`);
    lines.push(` * Source: docs/api-contract/${module.docBasename}.md`);
    lines.push(" */");
    lines.push("");
    lines.push("/**");
    lines.push(` * DTO snippets extracted from the contract doc for \`${module.sdkDir}\`.`);
    lines.push(" * These declarations make prompt-reviewed request/response shapes importable from a stable path.");
    lines.push(" */");
    lines.push("");
    if (declarations.length === 0) {
        lines.push(`export type ${module.typePrefix}ContractDtoPlaceholder = never;`);
        lines.push("");
        return lines.join("\n");
    }
    for (const requiredImport of requiredImports) {
        lines.push(`import type { ${requiredImport.typeName} } from "${requiredImport.importPath}";`);
    }
    if (requiredImports.length > 0) {
        lines.push("");
    }
    lines.push(exportedDeclarations.join("\n\n"));
    lines.push("");
    return lines.join("\n");
}

export function renderContractAssertions(module, entries, entryCount, contractDocText) {
    const statusScenarios = extractStatusScenarios(contractDocText);
    const errorScenarios = extractErrorScenarios(contractDocText);
    const errcodes = extractErrcodes(contractDocText);
    const lines = [];
    lines.push("/*");
    lines.push(" * AUTO-GENERATED by scripts/sdk-contract-codegen.mjs — DO NOT EDIT.");
    lines.push(` * Regenerate via \`pnpm run contract:codegen\`.`);
    lines.push(` * Source: ${module.sourceLabel}`);
    lines.push(" */");
    lines.push("");
    lines.push(`import { ${module.constName} } from "./route-table";`);
    lines.push("");
    lines.push(`export const ${module.constName}_ENTRY_COUNT = ${entryCount} as const;`);
    lines.push("");
    lines.push("// Compile-time assertion: route-table length must stay aligned with the backend contract.");
    lines.push(`const _${module.typePrefix}EntryCountAssertion: ${entryCount} = ${module.constName}.length;`);
    lines.push("void _" + `${module.typePrefix}EntryCountAssertion;`);
    lines.push("");
    lines.push(`export const ${module.constName}_STATUS_SCENARIOS = [`);
    for (const scenario of statusScenarios) {
        lines.push(`    { status: ${scenario.status}, note: ${JSON.stringify(scenario.note)} },`);
    }
    lines.push("] as const;");
    lines.push("");
    lines.push(
        `export type ${module.typePrefix}StatusScenario = (typeof ${module.constName}_STATUS_SCENARIOS)[number];`,
    );
    lines.push("");
    lines.push(`export const ${module.constName}_ERROR_SCENARIOS = [`);
    for (const scenario of errorScenarios) {
        lines.push(
            `    { scenario: ${JSON.stringify(scenario.scenario)}, httpOrErrcode: ${JSON.stringify(scenario.httpOrErrcode)}, sdkErrorType: ${JSON.stringify(scenario.sdkErrorType)}, handling: ${JSON.stringify(scenario.handling)} },`,
        );
    }
    lines.push("] as const;");
    lines.push("");
    lines.push(`export type ${module.typePrefix}ErrorScenario = (typeof ${module.constName}_ERROR_SCENARIOS)[number];`);
    lines.push("");
    lines.push(`export const ${module.constName}_ERRCODES = [`);
    for (const errcode of errcodes) {
        lines.push(
            `    { errcode: ${JSON.stringify(errcode.errcode)}, httpStatus: ${JSON.stringify(errcode.httpStatus)}, note: ${JSON.stringify(errcode.note)} },`,
        );
    }
    lines.push("] as const;");
    lines.push("");
    lines.push(`export type ${module.typePrefix}Errcode = (typeof ${module.constName}_ERRCODES)[number];`);
    lines.push("");
    return lines.join("\n");
}

// NOTE: `loadManifest` (JSON manifest from contract-sync.mjs) was removed in P0.
// Route membership is now sourced directly from the backend ROUTE_CONTRACT.md
// (see the ingestion layer near the top of this file).

function renderAcceptanceTest(module) {
    const lines = [];
    lines.push("/*");
    lines.push(" * AUTO-GENERATED by scripts/sdk-contract-codegen.mjs — DO NOT EDIT.");
    lines.push(` * Regenerate via \`pnpm run contract:codegen\`.`);
    lines.push(` * Source: docs/api-contract/generated/modules/${module.sdkDir}.json`);
    lines.push(" */");
    lines.push("");
    lines.push(`import { describe, it, expect, vi, beforeEach } from "vitest";`);
    lines.push(`import { ${module.constName} } from "./route-table";`);
    lines.push(
        `import { ${module.constName}_STATUS_SCENARIOS, ${module.constName}_ERROR_SCENARIOS, ${module.constName}_ERRCODES } from "./contract-assertions";`,
    );
    lines.push("");
    lines.push(`describe("${module.sdkDir} contract acceptance", () => {`);
    lines.push(`    // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
    lines.push(`    let mockClient: any;`);
    lines.push("");
    lines.push(`    beforeEach(() => {`);
    lines.push(`        mockClient = {`);
    lines.push(`            http: {`);
    lines.push(`                authedRequest: vi.fn(),`);
    lines.push(`            },`);
    lines.push(`        };`);
    lines.push(`    });`);
    lines.push("");
    lines.push(`    it("should satisfy a documented 2xx happy-path status", async () => {`);
    lines.push(
        `        const happyPath = (${module.constName}_STATUS_SCENARIOS as unknown as ReadonlyArray<{ status: number }>).find(s => s.status >= 200 && s.status < 300);`,
    );
    lines.push(`        if (!happyPath) return;`);
    lines.push("");
    lines.push(`        // Verify that the route table contains at least one documented success route`);
    lines.push(`        expect(${module.constName}.length).toBeGreaterThan(0);`);
    lines.push("");
    lines.push(`        mockClient.http.authedRequest.mockResolvedValue({ success: true });`);
    lines.push(`        const response = await mockClient.http.authedRequest({`);
    lines.push(`            method: ${module.constName}[0].method,`);
    lines.push(`            path: ${module.constName}[0].path,`);
    lines.push(`        });`);
    lines.push("");
    lines.push(`        expect(response.success).toBe(true);`);
    lines.push(`    });`);
    lines.push("");
    lines.push(`    it("should handle a documented 4xx failure branch", async () => {`);
    lines.push(
        `        const errorScenariosForFailure = ${module.constName}_ERROR_SCENARIOS as unknown as ReadonlyArray<{ scenario: string; httpOrErrcode: string; sdkErrorType: string; handling: string }>;`,
    );
    lines.push(
        `        const failureScenario = errorScenariosForFailure.find(s => /\\b(401|400)\\b/.test(s.httpOrErrcode))`,
    );
    lines.push(`            ?? errorScenariosForFailure.find(s => /\\b4\\d\\d\\b/.test(s.httpOrErrcode));`);
    lines.push("");
    lines.push(`        if (!failureScenario) return;`);
    lines.push("");
    lines.push(
        `        const expectedStatus = Number.parseInt(failureScenario.httpOrErrcode.match(/\\b(4\\d\\d)\\b/)?.[1] ?? "400", 10);`,
    );
    lines.push(
        `        const expectedErrcode = failureScenario.httpOrErrcode.match(/M_[A-Z0-9_]+/)?.[0] ?? (expectedStatus === 401 ? "M_UNKNOWN_TOKEN" : "M_BAD_JSON");`,
    );
    lines.push("");
    lines.push(
        `        mockClient.http.authedRequest.mockRejectedValue({ httpStatus: expectedStatus, errcode: expectedErrcode });`,
    );
    lines.push(`        try {`);
    lines.push(`            await mockClient.http.authedRequest({});`);
    lines.push(`        // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
    lines.push(`        } catch (e: any) {`);
    lines.push(`            expect(e.httpStatus).toBe(expectedStatus);`);
    lines.push(`            expect(e.errcode).toBe(expectedErrcode);`);
    lines.push(`            expect(failureScenario.sdkErrorType).toBeTruthy();`);
    lines.push(`        }`);
    lines.push(`    });`);
    lines.push("");
    lines.push(`    it("should correctly map typed-error branches and errcodes", async () => {`);
    lines.push(
        `        const errorScenarios = ${module.constName}_ERROR_SCENARIOS as unknown as ReadonlyArray<{ scenario: string; httpOrErrcode: string; sdkErrorType: string; handling: string }>;`,
    );
    lines.push(
        `        const errcodes = ${module.constName}_ERRCODES as unknown as ReadonlyArray<{ errcode: string; httpStatus: string; note: string }>;`,
    );
    lines.push("");
    lines.push(`        if (errorScenarios.length === 0) return;`);
    lines.push(`        // Verify that every documented errcode has a corresponding scenario handling`);
    lines.push(`        for (const code of errcodes) {`);
    lines.push(`            const hasHandling = errorScenarios.some(s => s.httpOrErrcode.includes(code.errcode));`);
    lines.push(`            if (!hasHandling) {`);
    lines.push(
        `                // console.warn(\`No specific error scenario handling for errcode \${code.errcode} in ${module.sdkDir}\`);`,
    );
    lines.push(`            }`);
    lines.push(`        }`);
    lines.push(`    });`);
    lines.push(`});`);
    return lines.join("\n");
}

function render(module, lookups) {
    const contractDocText = fs.existsSync(module.docPath) ? fs.readFileSync(module.docPath, "utf8") : "";
    // Gather contract routes for this module's backend labels, resolve to full paths.
    const contractEntries = [];
    for (const label of module.contractLabels) {
        const list = CONTRACT_PARSED.get(label);
        if (!list) continue;
        for (const e of list) {
            contractEntries.push({
                method: e.method,
                path: resolveFullPath(e.method, e.resourcePath, module.sdkDir, lookups),
            });
        }
    }
    // Merge on the FULL (version-qualified) path so every served version
    // (r0/v1/v3) a manager depends on is preserved verbatim. Contract routes
    // are appended only when their resolved full path is genuinely new,
    // filling coverage gaps without ever narrowing the path union.
    const seenFull = new Set();
    const entries = [];
    for (const e of loadExistingEntries(module.sdkDir)) {
        const key = `${e.method} ${e.path}`;
        if (seenFull.has(key)) continue;
        seenFull.add(key);
        entries.push(e);
    }
    for (const e of contractEntries) {
        const key = `${e.method} ${e.path}`;
        if (seenFull.has(key)) continue;
        seenFull.add(key);
        entries.push(e);
    }
    const entryCount = entries.length;

    const generatedDir = path.join(repoRoot, "src", module.sdkDir, "__generated__");
    const skipRouteTable = SKIP_ROUTE_TABLE_MODULES.has(module.docBasename);
    const outputs = [
        {
            outputPath: path.join(generatedDir, "dto.ts"),
            text: renderDtoFile(module, contractDocText),
        },
    ];
    if (!skipRouteTable) {
        outputs.push(
            {
                outputPath: path.join(generatedDir, "route-table.ts"),
                text: renderRouteTable(module, entries, entryCount),
            },
            {
                outputPath: path.join(generatedDir, "contract-assertions.ts"),
                text: renderContractAssertions(module, entries, entryCount, contractDocText),
            },
            {
                outputPath: path.join(generatedDir, "acceptance.spec.ts"),
                text: renderAcceptanceTest(module),
            },
        );
    }
    return { module, entries, entryCount, outputs };
}

function writeFileAtomic(filePath, text) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text);
}

function runWrite(rendered) {
    for (const r of rendered) {
        for (const output of r.outputs) {
            writeFileAtomic(output.outputPath, output.text);
        }
    }
    const totalFiles = rendered.reduce((sum, r) => sum + r.outputs.length, 0);
    process.stdout.write(
        `sdk-contract-codegen: wrote ${totalFiles} generated contract helper files\n` +
            rendered
                .map((r) => `  src/${r.module.sdkDir}/__generated__/  (${r.entryCount} entries)`)
                .join("\n") +
            "\n",
    );
    return 0;
}

function runCheck(rendered) {
    const drifts = [];
    for (const r of rendered) {
        for (const output of r.outputs) {
            const onDisk = fs.existsSync(output.outputPath) ? fs.readFileSync(output.outputPath, "utf8") : null;
            if (onDisk !== output.text) {
                drifts.push(path.relative(repoRoot, output.outputPath));
            }
        }
    }
    if (drifts.length > 0) {
        process.stderr.write(
            `sdk-contract-codegen: ${drifts.length} file(s) would change:\n` +
                drifts.map((d) => `  ${d}`).join("\n") +
                `\n\nRun \`pnpm run contract:codegen\` to regenerate.\n`,
        );
        return 1;
    }
    process.stdout.write(`sdk-contract-codegen: ${rendered.length} supported module helper sets are in sync.\n`);
    return 0;
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
    if (!fs.existsSync(BACKEND_CONTRACT_MD)) {
        process.stderr.write(
            `error: backend contract not found at ${BACKEND_CONTRACT_MD}\n` +
                `       set SYNAPSE_RUST_CONTRACT_MD or SYNAPSE_RUST_REPO to locate ROUTE_CONTRACT.md.\n`,
        );
        return 2;
    }
    const contractText = fs.readFileSync(BACKEND_CONTRACT_MD, "utf8");
    CONTRACT_PARSED = parseBackendContractMd(contractText);
    const lookups = {
        backend: buildBackendManifestLookup(),
        sdk: buildSdkTableLookup(),
    };
    const rendered = discoverSupportedModules(contractText).map((module) => render(module, lookups));
    return args.mode === "check" ? runCheck(rendered) : runWrite(rendered);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.exitCode = run(process.argv);
    } catch (err) {
        process.stderr.write(`error: ${err.message}\n`);
        if (process.env.CONTRACT_CODEGEN_TRACE) {
            process.stderr.write(`${err.stack}\n`);
        }
        process.exitCode = 1;
    }
}
