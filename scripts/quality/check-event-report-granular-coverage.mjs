#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();

const CHECKS = [
    {
        module: "event-report",
        groups: [
            {
                name: "EventReportManager list and count APIs",
                ownerFile: "src/event-report/index.ts",
                methods: ["getAllReports", "listReports", "getReportsCount", "getStats"],
                testFiles: ["spec/unit/event-report.spec.ts"],
            },
            {
                name: "EventReportManager filtered query APIs",
                ownerFile: "src/event-report/index.ts",
                methods: [
                    "getReportsByEvent",
                    "getReportsByRoom",
                    "getReportsByReporter",
                    "getReportsByStatus",
                    "getStatusCount",
                ],
                testFiles: ["spec/unit/event-report.spec.ts"],
            },
            {
                name: "EventReportManager CRUD and moderation APIs",
                ownerFile: "src/event-report/index.ts",
                methods: [
                    "createReport",
                    "getReport",
                    "updateReport",
                    "resolveReport",
                    "dismissReport",
                    "escalateReport",
                    "deleteReport",
                    "getReportHistory",
                ],
                testFiles: ["spec/unit/event-report.spec.ts"],
            },
            {
                name: "EventReportManager rate limit APIs",
                ownerFile: "src/event-report/index.ts",
                methods: ["checkRateLimit", "blockUser", "unblockUser"],
                testFiles: ["spec/unit/event-report.spec.ts"],
            },
        ],
    },
];

function readRelative(file) {
    return fs.readFileSync(path.join(projectRoot, file), "utf8");
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasMethod(content, method) {
    const escapedMethod = escapeRegex(method);
    const methodCall = new RegExp(`\\b${escapedMethod}(?:<[^>]+>)?\\s*\\(`);
    const propertyShape = new RegExp(`\\b${escapedMethod}\\s*:`);
    const delegatedCall = new RegExp(`\\.${escapedMethod}(?:<[^>]+>)?\\s*\\(`);
    return methodCall.test(content) || propertyShape.test(content) || delegatedCall.test(content);
}

function collectMissing(items, predicate) {
    return items.filter((item) => !predicate(item));
}

function main() {
    const failures = [];
    let totalGroups = 0;
    let passedGroups = 0;

    console.log("=== Event Report Granular Coverage ===");

    for (const moduleCheck of CHECKS) {
        console.log(`\n[${moduleCheck.module}]`);

        for (const group of moduleCheck.groups) {
            totalGroups += 1;
            const ownerContent = readRelative(group.ownerFile);
            const testContents = group.testFiles.map((file) => ({ file, content: readRelative(file) }));

            const missingMethods = collectMissing(group.methods, (method) => hasMethod(ownerContent, method));
            const methodsWithoutTests = collectMissing(group.methods, (method) =>
                testContents.some(({ content }) => content.includes(`${method}(`)),
            );

            if (missingMethods.length === 0 && methodsWithoutTests.length === 0) {
                passedGroups += 1;
                console.log(`  PASS: ${group.name}`);
                continue;
            }

            console.log(`  FAIL: ${group.name}`);
            if (missingMethods.length > 0) {
                console.log(`    missing methods in ${group.ownerFile}: ${missingMethods.join(", ")}`);
            }
            if (methodsWithoutTests.length > 0) {
                console.log(`    methods without test hits: ${methodsWithoutTests.join(", ")}`);
            }

            failures.push({
                module: moduleCheck.module,
                group: group.name,
                ownerFile: group.ownerFile,
                missingMethods,
                methodsWithoutTests,
            });
        }
    }

    console.log(`\nGroups passed: ${passedGroups}/${totalGroups}`);

    if (failures.length > 0) {
        console.log("\nGranular coverage gaps detected.");
        process.exitCode = 1;
        return;
    }

    console.log("\nGranular coverage check passed.");
}

main();
