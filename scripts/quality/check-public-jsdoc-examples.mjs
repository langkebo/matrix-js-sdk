#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";

const projectRoot = process.cwd();
const docsRoot = path.join(projectRoot, "docs", "api-contract");
const srcRoot = path.join(projectRoot, "src");
const DOC_IGNORE_BASENAMES = new Set([
    "README.md",
    "CHANGELOG.md",
    "AUDIT_INDEX.md",
    "CONTRACT_INDEX.md",
    "LEDGER_DRIVEN_SDK_PLAN_2026-05-02.md",
    "THROW_ON_ERROR_MIGRATION.md",
]);

function walk(dir, predicate = () => true, acc = []) {
    if (!fs.existsSync(dir)) return acc;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath, predicate, acc);
        } else if (predicate(fullPath)) {
            acc.push(fullPath);
        }
    }
    return acc;
}

function splitTableCells(line) {
    if (!line.trim().startsWith("|")) return [];
    return line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
}

function isDividerRow(cells) {
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function extractInlineCode(cell) {
    const match = cell.match(/`([^`]+)`/);
    return match ? match[1].trim() : cell.replace(/\*\*/g, "").trim();
}

function upperFirst(value) {
    return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function normalizeOwner(rawOwner) {
    const owner = rawOwner.trim();
    if (!owner || owner === "-") return null;
    if (owner === "MatrixClient" || owner === "client") return "MatrixClient";
    if (/^[a-z][A-Za-z0-9]+Manager$/.test(owner)) return upperFirst(owner);
    const getterMatch = owner.match(/get([A-Z][A-Za-z0-9]+Manager)$/);
    if (getterMatch) return getterMatch[1];
    return owner;
}

function normalizeMethod(rawMethod) {
    const method = rawMethod.trim();
    if (!method || method === "-") return null;
    const directMatch = method.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/);
    if (directMatch) return directMatch[1];
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(method) ? method : null;
}

function parseSdkReferenceFromCell(cell) {
    const value = extractInlineCode(cell);
    if (!value || value === "-") return null;
    const clientGetterMatch = value.match(/client\.get([A-Z][A-Za-z0-9]+Manager)\(\)\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/);
    if (clientGetterMatch) {
        return {
            owner: clientGetterMatch[1],
            method: clientGetterMatch[2],
        };
    }
    const directMatch = value.match(/([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/);
    if (directMatch) {
        return {
            owner: normalizeOwner(directMatch[1]),
            method: directMatch[2],
        };
    }
    return null;
}

function parseHeaderIndices(headerCells) {
    const normalized = headerCells.map((cell) => cell.replace(/[`*\s]/g, ""));
    const statusIndex = normalized.findIndex((cell) => cell.includes("状态"));
    const methodIndex = normalized.findIndex((cell) => cell === "SDK方法" || cell.endsWith("SDK方法"));
    const managerIndex = normalized.findIndex((cell) => cell === "SDKManager" || cell.endsWith("SDKManager"));
    if (statusIndex === -1 || (methodIndex === -1 && managerIndex === -1)) return null;
    return { statusIndex, methodIndex, managerIndex };
}

export function parseContractPublicApiReferences(docText, filePath = "<memory>") {
    const lines = docText.split(/\r?\n/);
    const references = [];
    let inSdkSection = false;

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const headingMatch = line.match(/^(#{2,3})\s+(.*)$/);
        if (headingMatch) {
            const heading = headingMatch[2].trim();
            if (heading.includes("SDK 对齐状态")) {
                inSdkSection = true;
                continue;
            }
            if (inSdkSection && headingMatch[1].length <= 2) {
                inSdkSection = false;
            }
        }

        if (!inSdkSection || !line.trim().startsWith("|")) continue;
        const headerCells = splitTableCells(line);
        const headerIndices = parseHeaderIndices(headerCells);
        if (!headerIndices) continue;

        for (let j = i + 1; j < lines.length; j += 1) {
            const rowLine = lines[j];
            if (!rowLine.trim().startsWith("|")) {
                i = j - 1;
                break;
            }
            const rowCells = splitTableCells(rowLine);
            if (isDividerRow(rowCells)) continue;
            const status = rowCells[headerIndices.statusIndex] ?? "";
            if (!status.includes("✅")) continue;

            let reference = null;
            if (headerIndices.managerIndex >= 0 && headerIndices.methodIndex >= 0) {
                const owner = normalizeOwner(extractInlineCode(rowCells[headerIndices.managerIndex] ?? ""));
                const method = normalizeMethod(extractInlineCode(rowCells[headerIndices.methodIndex] ?? ""));
                if (owner && method) {
                    reference = { owner, method };
                }
            } else if (headerIndices.methodIndex >= 0) {
                reference = parseSdkReferenceFromCell(rowCells[headerIndices.methodIndex] ?? "");
            }

            if (reference?.owner && reference?.method) {
                references.push({
                    ...reference,
                    file: filePath,
                    line: j + 1,
                });
            }
        }
    }

    return references;
}

function buildMethodKey(owner, method) {
    return `${owner}.${method}`;
}

function getJSDocInfo(node) {
    const tags = ts.getJSDocTags(node).map((tag) => tag.tagName.text);
    const docs = ts.getJSDocCommentsAndTags(node);
    return {
        hasJSDoc: docs.length > 0,
        hasExample: tags.includes("example"),
    };
}

export function collectJSDocIndexFromSource(sourceText, filePath = "<memory>") {
    const index = new Map();
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    function visit(node) {
        if (ts.isClassDeclaration(node) && node.name?.text) {
            const owner = node.name.text;
            for (const member of node.members) {
                if (!ts.isMethodDeclaration(member) || !member.name || !ts.isIdentifier(member.name)) continue;
                if (member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword)) continue;
                index.set(buildMethodKey(owner, member.name.text), {
                    file: filePath,
                    owner,
                    method: member.name.text,
                    ...getJSDocInfo(member),
                });
            }
        }
        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return index;
}

export function findMissingJSDocExamples(references, methodIndex) {
    const issues = [];
    for (const reference of references) {
        const target = methodIndex.get(buildMethodKey(reference.owner, reference.method));
        if (!target) {
            issues.push({ ...reference, reason: "missing-method" });
            continue;
        }
        if (!target.hasJSDoc) {
            issues.push({ ...reference, reason: "missing-jsdoc", implementationFile: target.file });
            continue;
        }
        if (!target.hasExample) {
            issues.push({ ...reference, reason: "missing-example", implementationFile: target.file });
        }
    }
    return issues;
}

function collectMethodIndexFromWorkspace() {
    const merged = new Map();
    for (const filePath of walk(
        srcRoot,
        (candidate) =>
            candidate.endsWith(".ts") &&
            !candidate.endsWith(".d.ts") &&
            !candidate.includes(`${path.sep}__generated__${path.sep}`),
    )) {
        const sourceText = fs.readFileSync(filePath, "utf8");
        for (const [key, value] of collectJSDocIndexFromSource(sourceText, path.relative(projectRoot, filePath))) {
            merged.set(key, value);
        }
    }
    return merged;
}

function collectTrackedReferences() {
    const docFiles = walk(
        docsRoot,
        (filePath) =>
            filePath.endsWith(".md") &&
            !filePath.includes(`${path.sep}history${path.sep}`) &&
            !filePath.includes(`${path.sep}governance${path.sep}`) &&
            !DOC_IGNORE_BASENAMES.has(path.basename(filePath)),
    );
    return docFiles.flatMap((filePath) =>
        parseContractPublicApiReferences(fs.readFileSync(filePath, "utf8"), path.relative(projectRoot, filePath)),
    );
}

function collectChangedFiles(baseRef) {
    if (process.env.JSDOC_PUBLIC_API_FULL_SCAN === "1") return null;
    if (!baseRef) return new Set();
    try {
        const output = execFileSync("git", ["diff", "--name-only", "--diff-filter=AMR", `${baseRef}...HEAD`], {
            cwd: projectRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });
        return new Set(
            output
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean),
        );
    } catch {
        return null;
    }
}

export function filterIssuesByChangedFiles(issues, changedFiles) {
    if (changedFiles === null) return issues;
    return issues.filter(
        (issue) =>
            changedFiles.has(issue.file) ||
            (issue.implementationFile ? changedFiles.has(issue.implementationFile) : false),
    );
}

function run() {
    const references = collectTrackedReferences();
    const methodIndex = collectMethodIndexFromWorkspace();
    const issues = findMissingJSDocExamples(references, methodIndex);
    const changedFiles = collectChangedFiles(process.env.GITHUB_BASE_SHA);
    const scopedIssues = filterIssuesByChangedFiles(issues, changedFiles);

    if (scopedIssues.length > 0) {
        console.error("[public-jsdoc-examples] documented public API methods are missing JSDoc examples");
        for (const issue of scopedIssues) {
            const suffix = issue.implementationFile ? ` -> ${issue.implementationFile}` : "";
            console.error(`- ${issue.file}:${issue.line} ${issue.owner}.${issue.method} (${issue.reason})${suffix}`);
        }
        process.exit(1);
    }

    if (changedFiles !== null) {
        console.log(
            `[public-jsdoc-examples] ok (${references.length} documented public methods scanned, scoped to ${changedFiles.size} changed file(s))`,
        );
        return;
    }

    console.log(`[public-jsdoc-examples] ok (${references.length} documented public methods checked)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
    run();
}
