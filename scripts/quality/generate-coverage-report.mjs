#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const docsRoot = path.join(projectRoot, "docs", "api-contract");

function walk(dir, predicate = () => true, acc = []) {
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

function parseHeaderIndices(headerCells) {
    const normalized = headerCells.map((cell) => cell.replace(/[`*\s]/g, ""));
    const statusIndex = normalized.findIndex((cell) => cell.includes("状态"));
    return statusIndex >= 0 ? { statusIndex } : null;
}

function parseModuleCoverage(filePath) {
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    const moduleName = path.basename(filePath, ".md");
    let totalEndpoints = 0;
    let implementedEndpoints = 0;
    let inSdkSection = false;

    for (let i = 0; i < lines.length; i++) {
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

        for (let j = i + 1; j < lines.length; j++) {
            const rowLine = lines[j];
            if (!rowLine.trim().startsWith("|")) {
                i = j - 1;
                break;
            }

            const rowCells = splitTableCells(rowLine);
            if (isDividerRow(rowCells)) continue;
            if (rowCells.length <= headerIndices.statusIndex) continue;

            totalEndpoints++;
            const status = rowCells[headerIndices.statusIndex] ?? "";
            if (status.includes("✅")) {
                implementedEndpoints++;
            }
        }
    }

    return {
        module: moduleName,
        total: totalEndpoints,
        implemented: implementedEndpoints,
        coverage: totalEndpoints > 0 ? ((implementedEndpoints / totalEndpoints) * 100).toFixed(1) : "0.0",
    };
}

const docFiles = walk(
    docsRoot,
    (filePath) =>
        filePath.endsWith(".md") &&
        !filePath.includes(`${path.sep}history${path.sep}`) &&
        !["README.md", "CHANGELOG.md", "VERIFICATION_REPORT.md", "THROW_ON_ERROR_MIGRATION.md"].includes(
            path.basename(filePath),
        ),
);

const moduleStats = docFiles.map((filePath) => parseModuleCoverage(filePath)).filter((stat) => stat.total > 0);

moduleStats.sort((a, b) => parseFloat(a.coverage) - parseFloat(b.coverage));

const totalEndpoints = moduleStats.reduce((sum, stat) => sum + stat.total, 0);
const totalImplemented = moduleStats.reduce((sum, stat) => sum + stat.implemented, 0);
const overallCoverage = totalEndpoints > 0 ? ((totalImplemented / totalEndpoints) * 100).toFixed(1) : "0.0";

console.log("\n╔══════════════════════════════════════════════════════════════════╗");
console.log("║                SDK Coverage Report                               ║");
console.log("╚══════════════════════════════════════════════════════════════════╝\n");

console.log(`Overall Coverage: ${overallCoverage}% (${totalImplemented}/${totalEndpoints} endpoints)\n`);

console.log("Module Breakdown:\n");
console.log("┌─────────────────────────┬───────┬─────────────┬──────────┐");
console.log("│ Module                  │ Total │ Implemented │ Coverage │");
console.log("├─────────────────────────┼───────┼─────────────┼──────────┤");

for (const stat of moduleStats) {
    const coverage = parseFloat(stat.coverage);
    const icon = coverage === 100 ? "✅" : coverage >= 80 ? "🟡" : coverage >= 50 ? "🟠" : "🔴";
    console.log(
        `│ ${stat.module.padEnd(23)} │ ${stat.total.toString().padStart(5)} │ ${stat.implemented.toString().padStart(11)} │ ${icon} ${stat.coverage.padStart(5)}% │`,
    );
}

console.log("└─────────────────────────┴───────┴─────────────┴──────────┘\n");

const reportPath = path.join(projectRoot, "docs", "SDK_COVERAGE_REPORT.md");
const reportLines = [
    "# SDK Coverage Report",
    "",
    `> Generated: ${new Date().toISOString().split("T")[0]}`,
    "",
    "## Overall Statistics",
    "",
    `- **Total Endpoints**: ${totalEndpoints}`,
    `- **Implemented**: ${totalImplemented}`,
    `- **Coverage**: ${overallCoverage}%`,
    "",
    "## Module Breakdown",
    "",
    "| Module | Total | Implemented | Coverage |",
    "|--------|-------|-------------|----------|",
];

for (const stat of moduleStats) {
    const coverage = parseFloat(stat.coverage);
    const icon = coverage === 100 ? "✅" : coverage >= 80 ? "🟡" : coverage >= 50 ? "🟠" : "🔴";
    reportLines.push(`| ${stat.module} | ${stat.total} | ${stat.implemented} | ${icon} ${stat.coverage}% |`);
}

reportLines.push("");
reportLines.push("## Legend");
reportLines.push("");
reportLines.push("- ✅ 100% coverage");
reportLines.push("- 🟡 80-99% coverage");
reportLines.push("- 🟠 50-79% coverage");
reportLines.push("- 🔴 <50% coverage");
reportLines.push("");

fs.writeFileSync(reportPath, reportLines.join("\n"));
console.log(`Report saved to: ${path.relative(projectRoot, reportPath)}\n`);
