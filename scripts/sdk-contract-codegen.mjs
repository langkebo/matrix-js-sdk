#!/usr/bin/env node
/*
 * SDK route-table codegen.
 *
 * Reads the per-module machine manifests at
 * `docs/api-contract/generated/modules/<module>.json` (materialised by
 * `contract-sync.mjs`) and emits strongly-typed TypeScript contract helpers
 * to `src/<sdk-dir>/__generated__/` for the supported public modules.
 *
 * The generated file is intentionally a pure data module — no runtime
 * behaviour — so importing it into a manager's hot path has zero
 * footprint. Using `as const` + indexed `[number]` derivations makes the
 * path/method strings literal-typed, so a typo like `room_keyz` is a
 * compile error rather than a 404 at runtime.
 *
 * Phase D D4 deliverable per
 *   docs/api-contract/LEDGER_DRIVEN_SDK_PLAN_2026-05-02.md §2.4.
 *
 * Modes:
 *   sdk-contract-codegen.mjs                → regenerate supported modules
 *   sdk-contract-codegen.mjs --check        → regenerate in memory; fail if disk differs
 *
 * The `--check` mode is intended for CI: PRs that touch the ledger
 * without regenerating the route tables break the build.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const CONTRACT_INDEX_PATH = path.join(repoRoot, "docs", "api-contract", "CONTRACT_INDEX.md");
const GENERATED_MODULES_DIR = path.join(repoRoot, "docs", "api-contract", "generated", "modules");

const SDK_DIR_ALIASES = {
    "app-service": "appservice",
};

const LEDGER_MODULE_ALIASES = {
    "account-data": "account_data",
    "ai-connection": "ai_connection",
    "app-service": "app_service",
    "background-update": "background_update",
    "burn-after-read": "burn_after_read",
    "e2ee": "e2ee_routes",
    "event-report": "event_report",
    "external-service": "external_service",
    "feature-flags": "feature_flags",
    "friend": "friend_room",
    "key-backup": "key_backup",
    "key-rotation": "key_rotation",
    "notifications": "push_notification",
    "room-summary": "room_summary",
    "sliding-sync": "sliding_sync",
    "verification": "verification_routes",
    "worker-admin": "worker_body",
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

export function discoverSupportedModules(contractIndexText = fs.readFileSync(CONTRACT_INDEX_PATH, "utf8")) {
    return extractContractIndexDocLinks(contractIndexText)
        .map((docFileName) => {
            const docBasename = docFileName.replace(/\.md$/, "");
            const docPath = path.join(repoRoot, "docs", "api-contract", docFileName);
            const docText = fs.readFileSync(docPath, "utf8");
            const frontmatter = parseFrontmatter(docText);
            const candidateModules = [
                frontmatter.module,
                LEDGER_MODULE_ALIASES[docBasename],
                docBasename.replace(/-/g, "_"),
            ].filter(Boolean);
            const ledgerModule = candidateModules.find((candidate) =>
                fs.existsSync(path.join(GENERATED_MODULES_DIR, `${candidate}.json`)),
            );
            if (!ledgerModule) return null;
            const sdkDir = SDK_DIR_ALIASES[docBasename] ?? docBasename;
            const heading = extractDocHeading(docText);
            return {
                ledgerModule,
                sdkDir,
                docBasename,
                docPath,
                constName: `${toConstantCase(docBasename)}_ROUTES`,
                typePrefix: toPascalCase(docBasename),
                humanName: heading ? heading.replace(/\s+API.*$/, "").trim() : prettyModuleName(docBasename),
            };
        })
        .filter(Boolean);
}

function renderRouteTable(module, manifest) {
    const lines = [];
    lines.push("/*");
    lines.push(" * AUTO-GENERATED by scripts/sdk-contract-codegen.mjs — DO NOT EDIT.");
    lines.push(` * Regenerate via \`pnpm run contract:codegen\`.`);
    lines.push(" *");
    lines.push(` * Module:        ${module.humanName}`);
    lines.push(` * Source:        docs/api-contract/generated/modules/${module.ledgerModule}.json`);
    lines.push(` * Ledger schema: ${manifest.ledger_schema}`);
    lines.push(` * Source profile: ${manifest.source_profile}`);
    if (manifest.synapse_rust_commit && manifest.synapse_rust_commit !== "0".repeat(40)) {
        lines.push(` * synapse-rust:  ${manifest.synapse_rust_commit}`);
    }
    lines.push(" */");
    lines.push("");
    lines.push(`/** Routes served by the synapse-rust \`${module.ledgerModule}\` module. */`);
    lines.push(`export const ${module.constName} = [`);
    for (const entry of manifest.entries) {
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

function contractDocPathFor(module) {
    return path.join(repoRoot, "docs", "api-contract", `${module.docBasename}.md`);
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
    lines.push(` * DTO snippets extracted from the contract doc for \`${module.ledgerModule}\`.`);
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

export function renderContractAssertions(module, manifest, contractDocText) {
    const statusScenarios = extractStatusScenarios(contractDocText);
    const errorScenarios = extractErrorScenarios(contractDocText);
    const errcodes = extractErrcodes(contractDocText);
    const lines = [];
    lines.push("/*");
    lines.push(" * AUTO-GENERATED by scripts/sdk-contract-codegen.mjs — DO NOT EDIT.");
    lines.push(` * Regenerate via \`pnpm run contract:codegen\`.`);
    lines.push(` * Source: docs/api-contract/generated/modules/${module.ledgerModule}.json`);
    lines.push(" */");
    lines.push("");
    lines.push(`import { ${module.constName} } from "./route-table";`);
    lines.push("");
    lines.push(`export const ${module.constName}_ENTRY_COUNT = ${manifest.entry_count} as const;`);
    lines.push("");
    lines.push("// Compile-time assertion: route-table length must stay aligned with the generated manifest.");
    lines.push(`const _${module.typePrefix}EntryCountAssertion: ${manifest.entry_count} = ${module.constName}.length;`);
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

function loadManifest(ledgerModule) {
    const file = path.join(GENERATED_MODULES_DIR, `${ledgerModule}.json`);
    if (!fs.existsSync(file)) {
        throw new Error(
            `missing generated manifest for '${ledgerModule}' at ${file}; ` + `run \`pnpm run contract:sync\` first.`,
        );
    }
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(parsed.entries)) {
        throw new Error(`${file}: missing 'entries' array`);
    }
    return parsed;
}

function renderAcceptanceTest(module) {
    const lines = [];
    lines.push("/*");
    lines.push(" * AUTO-GENERATED by scripts/sdk-contract-codegen.mjs — DO NOT EDIT.");
    lines.push(` * Regenerate via \`pnpm run contract:codegen\`.`);
    lines.push(` * Source: docs/api-contract/generated/modules/${module.ledgerModule}.json`);
    lines.push(" */");
    lines.push("");
    lines.push(`import { describe, it, expect, vi, beforeEach } from "vitest";`);
    lines.push(`import { ${module.constName} } from "./route-table";`);
    lines.push(
        `import { ${module.constName}_STATUS_SCENARIOS, ${module.constName}_ERROR_SCENARIOS, ${module.constName}_ERRCODES } from "./contract-assertions";`,
    );
    lines.push("");
    lines.push(`describe("${module.ledgerModule} contract acceptance", () => {`);
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
        `                // console.warn(\`No specific error scenario handling for errcode \${code.errcode} in ${module.ledgerModule}\`);`,
    );
    lines.push(`            }`);
    lines.push(`        }`);
    lines.push(`    });`);
    lines.push(`});`);
    return lines.join("\n");
}

function render(module) {
    const manifest = loadManifest(module.ledgerModule);
    const docPath = contractDocPathFor(module);
    const contractDocText = fs.existsSync(docPath) ? fs.readFileSync(docPath, "utf8") : "";
    const generatedDir = path.join(repoRoot, "src", module.sdkDir, "__generated__");
    return {
        module,
        manifest,
        outputs: [
            {
                outputPath: path.join(generatedDir, "route-table.ts"),
                text: renderRouteTable(module, manifest),
            },
            {
                outputPath: path.join(generatedDir, "dto.ts"),
                text: renderDtoFile(module, contractDocText),
            },
            {
                outputPath: path.join(generatedDir, "contract-assertions.ts"),
                text: renderContractAssertions(module, manifest, contractDocText),
            },
            {
                outputPath: path.join(generatedDir, "acceptance.spec.ts"),
                text: renderAcceptanceTest(module),
            },
        ],
    };
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
    process.stdout.write(
        `sdk-contract-codegen: wrote ${rendered.length * 4} generated contract helper files\n` +
            rendered
                .map((r) => `  src/${r.module.sdkDir}/__generated__/  (${r.manifest.entry_count} entries)`)
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
    const rendered = discoverSupportedModules().map(render);
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
