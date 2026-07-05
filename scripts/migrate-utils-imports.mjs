#!/usr/bin/env node
/**
 * Migrates imports from src/utils.ts to domain-specific modules.
 * After the utils.ts split, this updates all importers to point directly
 * to the new module locations instead of going through the re-export barrel.
 */

import { readFileSync, writeFileSync } from "fs";
import pkg from "glob";
const { sync: globSync } = pkg;
import { dirname, relative, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "src");

// Symbol → module path (relative to src/)
const SYMBOL_MAP = {
    // async.ts
    sleep: "common/async",
    logDuration: "common/async",
    logDurationSync: "common/async",
    promiseMapSeries: "common/async",
    promiseTry: "common/async",
    simpleRetryOperation: "common/async",

    // strings.ts
    internaliseString: "common/strings",
    removeHiddenChars: "common/strings",
    removeDirectionOverrideChars: "common/strings",
    normalize: "common/strings",
    escapeRegExp: "common/strings",
    globToRegexp: "common/strings",
    DEFAULT_ALPHABET: "common/strings",
    alphabetPad: "common/strings",
    baseToString: "common/strings",
    stringToBase: "common/strings",
    averageBetweenStrings: "common/strings",
    nextString: "common/strings",
    prevString: "common/strings",
    lexicographicCompare: "common/strings",

    // collections.ts
    removeElement: "common/collections",
    deepCopy: "common/collections",
    deepCompare: "common/collections",
    deepSortedObjectEntries: "common/collections",
    mapsEqual: "common/collections",
    recursiveMapToObject: "common/collections",
    MapWithDefault: "common/collections",

    // safety.ts
    checkObjectHasKeys: "common/safety",
    isNumber: "common/safety",
    isNullOrUndefined: "common/safety",
    recursivelyAssign: "common/safety",
    sortEventsByLatestContentTimestamp: "common/safety",
    isSupportedReceiptType: "common/safety",
    unsafeProp: "common/safety",
    safeSet: "common/safety",
    noUnsafeEventProps: "common/safety",

    // http-api/utils.ts
    encodeParams: "http-api/utils",
    encodeUri: "http-api/utils",
    replaceParam: "http-api/utils",
    ensureNoTrailingSlash: "http-api/utils",
    QueryDict: "http-api/utils",
};

function findUtilsPath(importPath) {
    // Match imports like "../utils", "../../utils", "../../../utils", etc.
    const m = importPath.match(/^(\.\.\/)+utils$/);
    return m ? m[0] : null;
}

function processFile(filePath) {
    let content = readFileSync(filePath, "utf-8");
    let modified = false;

    // Find import statements from utils
    const importRegex = /import\s*\{([^}]+)\}\s*from\s*["']([^"']*\/utils)["']\s*;?\s*/g;
    let match;

    while ((match = importRegex.exec(content)) !== null) {
        const fullMatch = match[0];
        const symbols = match[1];
        const importPath = match[2];

        // Only process imports that point to src/utils.ts
        const normalizedPath = findUtilsPath(importPath);
        if (!normalizedPath) continue;

        // Parse imported symbols
        const symbolList = symbols.split(",").map((s) => {
            // Handle "type X" imports
            const trimmed = s.trim();
            if (trimmed.startsWith("type ")) {
                return { name: trimmed.slice(5).trim(), isType: true };
            }
            return { name: trimmed, isType: false };
        });

        // Group by target module
        const groups = new Map();
        const unmapped = [];

        for (const sym of symbolList) {
            // Check if this is a known symbol
            const cleanName = sym.name;
            const modulePath = SYMBOL_MAP[cleanName];
            if (modulePath) {
                if (!groups.has(modulePath)) groups.set(modulePath, []);
                groups.get(modulePath).push(sym);
            } else {
                unmapped.push(sym);
            }
        }

        // If only unmapped symbols, skip (this import isn't from src/utils.ts)
        if (groups.size === 0) continue;

        // Build replacement imports
        const replacements = [];
        for (const [modulePath, syms] of groups) {
            const typeSyms = syms.filter((s) => s.isType);
            const valueSyms = syms.filter((s) => !s.isType);

            let importStr = "import { ";

            if (typeSyms.length > 0) {
                importStr += typeSyms.map((s) => `type ${s.name}`).join(", ");
                if (valueSyms.length > 0) importStr += ", ";
            }
            importStr += valueSyms.map((s) => s.name).join(", ");
            importStr += " }";

            // Compute relative path from this file to the module
            const fileDir = dirname(filePath);
            const absModule = resolve(SRC, modulePath);
            let relPath = relative(fileDir, absModule);
            if (!relPath.startsWith(".")) relPath = "./" + relPath;

            importStr += ` from "${relPath}";`;
            replacements.push(importStr);
        }

        if (replacements.length > 0) {
            content = content.replace(fullMatch, replacements.join("\n"));
            modified = true;
        }
    }

    if (modified) {
        writeFileSync(filePath, content, "utf-8");
        return true;
    }
    return false;
}

const files = globSync("src/**/*.ts", { cwd: ROOT, ignore: ["src/**/__generated__/**"] });
let count = 0;

for (const file of files) {
    const absPath = resolve(ROOT, file);
    if (processFile(absPath)) {
        console.log(`Migrated: ${file}`);
        count++;
    }
}

console.log(`\nMigrated ${count} files.`);
