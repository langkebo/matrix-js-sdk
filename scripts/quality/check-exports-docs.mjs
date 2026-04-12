#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const packageJsonPath = path.join(projectRoot, "package.json");
const docsPath = path.join(projectRoot, "docs/api-contract/exports.md");
const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;

if (!fs.existsSync(packageJsonPath)) {
    console.error(`[exports-docs] package.json not found at ${packageJsonPath}`);
    process.exit(1);
}

if (!fs.existsSync(docsPath)) {
    console.error(`[exports-docs] docs not found at ${docsPath}`);
    process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const exportKeys = Object.keys(pkg.exports ?? {}).sort();

const docsContent = fs.readFileSync(docsPath, "utf8");
const docRows = parseExportRows(docsContent);
const docKeys = new Set(docRows.map((row) => row.exportKey));
const duplicateDocKeys = findDuplicates(docRows.map((row) => row.exportKey));
const rowsMissingScope = docRows.filter((row) => !row.whitelistScope.trim()).map((row) => row.exportKey);
const mandatoryKeyExports = new Set([".", "./core", "./advanced", "./legacy", "./client"]);
const rowsMissingMandatoryKeyExports = docRows
    .filter((row) => mandatoryKeyExports.has(row.exportKey) && parseRequiredSymbols(row.keyExports).length === 0)
    .map((row) => row.exportKey);

const docByKey = new Map(docRows.map((row) => [row.exportKey, row]));

const symbolMismatches = [];
for (const key of exportKeys) {
    const row = docByKey.get(key);
    if (!row) continue;

    const requiredSymbols = parseRequiredSymbols(row.keyExports);
    if (requiredSymbols.length === 0) continue;

    const sourceFile = resolveSourceFile(projectRoot, pkg.exports[key]);
    if (!sourceFile) {
        symbolMismatches.push({
            key,
            reason: "source file cannot be resolved from package.json exports mapping",
            missing: requiredSymbols,
        });
        continue;
    }

    const exportedSymbols = collectExportedSymbols(sourceFile, new Set());
    const missingSymbols = requiredSymbols.filter((symbol) => !exportedSymbols.has(symbol));
    if (missingSymbols.length > 0) {
        symbolMismatches.push({
            key,
            reason: `missing required symbols in ${path.relative(projectRoot, sourceFile)}`,
            missing: missingSymbols,
        });
    }
}

const missingInDocs = exportKeys.filter((k) => !docKeys.has(k));
const extraInDocs = [...docKeys].filter((k) => !exportKeys.includes(k)).sort();

if (
    missingInDocs.length ||
    extraInDocs.length ||
    duplicateDocKeys.length ||
    rowsMissingScope.length ||
    rowsMissingMandatoryKeyExports.length ||
    symbolMismatches.length
) {
    console.error("[exports-docs] mismatch between package.json exports and docs/api-contract/exports.md");
    if (missingInDocs.length) {
        console.error("[exports-docs] missing in docs:");
        for (const key of missingInDocs) console.error(`- ${key}`);
    }
    if (extraInDocs.length) {
        console.error("[exports-docs] extra in docs:");
        for (const key of extraInDocs) console.error(`- ${key}`);
    }
    if (duplicateDocKeys.length) {
        console.error("[exports-docs] duplicate export rows in docs:");
        for (const key of duplicateDocKeys) console.error(`- ${key}`);
    }
    if (rowsMissingScope.length) {
        console.error("[exports-docs] missing whitelist scope:");
        for (const key of rowsMissingScope) console.error(`- ${key}`);
    }
    if (rowsMissingMandatoryKeyExports.length) {
        console.error("[exports-docs] missing mandatory key exports (for core entrypoints):");
        for (const key of rowsMissingMandatoryKeyExports) console.error(`- ${key}`);
    }
    if (symbolMismatches.length) {
        console.error("[exports-docs] required symbol check failed:");
        for (const mismatch of symbolMismatches) {
            console.error(`- ${mismatch.key}: ${mismatch.reason}`);
            for (const symbol of mismatch.missing) {
                console.error(`  - ${symbol}`);
            }
        }
    }
    printRemediationHints({
        missingInDocs,
        extraInDocs,
        duplicateDocKeys,
        rowsMissingScope,
        rowsMissingMandatoryKeyExports,
        symbolMismatches,
    });
    writeExportsSummary({
        ok: false,
        exportCount: exportKeys.length,
        rowCount: docRows.length,
        missingInDocs,
        extraInDocs,
        duplicateDocKeys,
        rowsMissingScope,
        rowsMissingMandatoryKeyExports,
        symbolMismatches,
    });
    process.exit(1);
}

console.log(`[exports-docs] ok (${exportKeys.length} exports, ${docRows.length} documented rows)`);
writeExportsSummary({
    ok: true,
    exportCount: exportKeys.length,
    rowCount: docRows.length,
    missingInDocs: [],
    extraInDocs: [],
    duplicateDocKeys: [],
    rowsMissingScope: [],
    rowsMissingMandatoryKeyExports: [],
    symbolMismatches: [],
});

function parseExportRows(markdown) {
    const rows = [];
    const lines = markdown.split(/\r?\n/);

    for (const line of lines) {
        if (!line.trim().startsWith("|")) continue;

        const cells = line
            .split("|")
            .slice(1, -1)
            .map((cell) => cell.trim());

        if (cells.length < 1) continue;
        if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
        if (/^Export$/i.test(cells[0])) continue;

        const exportMatch = cells[0].match(/^`([^`]+)`$/);
        if (!exportMatch) continue;

        rows.push({
            exportKey: exportMatch[1],
            whitelistScope: cells[1] ?? "",
            keyExports: cells[2] ?? "",
        });
    }

    return rows;
}

function findDuplicates(items) {
    const seen = new Set();
    const duplicates = new Set();
    for (const item of items) {
        if (seen.has(item)) duplicates.add(item);
        seen.add(item);
    }
    return [...duplicates].sort();
}

function printRemediationHints({
    missingInDocs,
    extraInDocs,
    duplicateDocKeys,
    rowsMissingScope,
    rowsMissingMandatoryKeyExports,
    symbolMismatches,
}) {
    console.error("[exports-docs] remediation hints:");
    if (missingInDocs.length) {
        console.error("- add missing rows to docs/api-contract/exports.md (template):");
        for (const key of missingInDocs) {
            console.error(`  | \`${key}\` | <whitelist scope> | <symbolA>, <symbolB>, <symbolC> |`);
        }
    }
    if (extraInDocs.length || duplicateDocKeys.length) {
        console.error("- remove stale/duplicate rows so each export key appears exactly once");
    }
    if (rowsMissingScope.length) {
        console.error("- fill Whitelist Scope column for the listed export keys");
    }
    if (rowsMissingMandatoryKeyExports.length) {
        console.error("- fill Key Exports for core entrypoints: ., ./core, ./advanced, ./legacy, ./client");
    }
    if (symbolMismatches.length) {
        console.error("- either update Key Exports names in docs or export the missing symbols in source files");
    }
    console.error("- re-run: pnpm quality:exports");
}

function parseRequiredSymbols(keyExportsCell) {
    const normalized = keyExportsCell.trim();
    if (!normalized || normalized === "-" || normalized === "`-`") return [];

    const inlineCodeMatches = [...normalized.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim());
    if (inlineCodeMatches.length > 0) {
        const filtered = inlineCodeMatches.filter((symbol) => symbol && symbol !== "-");
        return [...new Set(filtered)];
    }

    return [
        ...new Set(
            normalized
                .split(",")
                .map((part) => part.trim())
                .filter(Boolean),
        ),
    ];
}

function writeExportsSummary({
    ok,
    exportCount,
    rowCount,
    missingInDocs,
    extraInDocs,
    duplicateDocKeys,
    rowsMissingScope,
    rowsMissingMandatoryKeyExports,
    symbolMismatches,
}) {
    if (!stepSummaryPath) return;

    const lines = [];
    lines.push("## Exports Contract Gate");
    lines.push("");
    lines.push(`- Status: ${ok ? "PASS" : "FAIL"}`);
    lines.push(`- package exports: ${exportCount}`);
    lines.push(`- documented rows: ${rowCount}`);
    lines.push("");

    if (!ok) {
        lines.push("### Failure Checklist");
        lines.push("");
        lines.push(`- [ ] Missing docs rows: ${missingInDocs.length}`);
        lines.push(`- [ ] Extra docs rows: ${extraInDocs.length}`);
        lines.push(`- [ ] Duplicate docs rows: ${duplicateDocKeys.length}`);
        lines.push(`- [ ] Empty whitelist scope: ${rowsMissingScope.length}`);
        lines.push(`- [ ] Missing key exports (mandatory entrypoints): ${rowsMissingMandatoryKeyExports.length}`);
        lines.push(`- [ ] Missing required symbols: ${symbolMismatches.length}`);
        lines.push("");
        lines.push("### Quick Fix");
        lines.push("");
        lines.push("- Update `docs/api-contract/exports.md` to match `package.json#exports`.");
        lines.push("- Ensure key symbols in docs are exported by corresponding source entrypoints.");
        lines.push("- Re-run `pnpm quality:exports`.");
    } else {
        lines.push("### Result");
        lines.push("");
        lines.push("- Exports docs contract is consistent with `package.json#exports`.");
        lines.push("- Required key symbols are resolvable from source entrypoints.");
    }

    fs.appendFileSync(stepSummaryPath, `${lines.join("\n")}\n`);
}

function resolveSourceFile(root, exportEntry) {
    if (!exportEntry) return null;

    const exportPath =
        typeof exportEntry === "string"
            ? exportEntry
            : (exportEntry.import ?? exportEntry.default ?? exportEntry.types ?? null);

    if (!exportPath || !exportPath.startsWith("./lib/")) return null;

    const pathWithoutLibPrefix = exportPath.replace(/^\.\/lib\//, "");
    const baseNoExt = pathWithoutLibPrefix.replace(/\.d\.ts$|\.js$/, "");

    const candidates = [
        path.join(root, "src", `${baseNoExt}.ts`),
        path.join(root, "src", `${baseNoExt}.d.ts`),
        path.join(root, "src", baseNoExt, "index.ts"),
        path.join(root, "src", baseNoExt, "index.d.ts"),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }

    return null;
}

function collectExportedSymbols(filePath, visited) {
    const symbols = new Set();

    if (visited.has(filePath)) return symbols;
    visited.add(filePath);

    if (!fs.existsSync(filePath)) return symbols;
    if (!fs.statSync(filePath).isFile()) return symbols;
    const content = fs.readFileSync(filePath, "utf8");

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

    const exportNamespaceRegex = /^\s*export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["'][^"']+["']/gm;
    for (const match of content.matchAll(exportNamespaceRegex)) {
        symbols.add(match[1]);
    }

    const exportDefaultRegex = /^\s*export\s+default\b/gm;
    if (exportDefaultRegex.test(content)) {
        symbols.add("default");
    }

    const exportAllRegex = /^\s*export\s+\*\s+from\s+["']([^"']+)["']/gm;
    for (const match of content.matchAll(exportAllRegex)) {
        const target = resolveRelativeModule(filePath, match[1]);
        if (!target) continue;

        const nestedSymbols = collectExportedSymbols(target, visited);
        for (const symbol of nestedSymbols) {
            if (symbol !== "default") {
                symbols.add(symbol);
            }
        }
    }

    return symbols;
}

function resolveRelativeModule(fromFile, importSpecifier) {
    if (!importSpecifier.startsWith(".")) return null;

    const fromDir = path.dirname(fromFile);
    const basePath = path.resolve(fromDir, importSpecifier);
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
