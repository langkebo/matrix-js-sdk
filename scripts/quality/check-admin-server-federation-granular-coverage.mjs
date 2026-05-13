#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();

const CHECKS = [
    {
        module: "admin-server-federation",
        groups: [
            {
                name: "AdminManager retention policy APIs",
                ownerFile: "src/admin/index.ts",
                methods: [
                    "getRetentionPolicy",
                    "setRetentionPolicy",
                    "getRoomRetentionPolicy",
                    "setRoomRetentionPolicy",
                    "runRetention",
                    "getRetentionStatus",
                ],
                testFiles: ["spec/unit/admin-new-endpoints.spec.ts"],
            },
            {
                name: "AdminManager audit event APIs",
                ownerFile: "src/admin/index.ts",
                methods: ["listAuditEvents", "getAuditEvent", "createAuditEvent"],
                testFiles: ["spec/unit/admin-new-endpoints.spec.ts"],
            },
            {
                name: "AdminManager server status and maintenance APIs",
                ownerFile: "src/admin/index.ts",
                methods: [
                    "getServerStats",
                    "getServerStatus",
                    "getServerHealth",
                    "getServerInfo",
                    "getAdminInfo",
                    "getServerVersion",
                    "purgeMediaCache",
                    "restartServer",
                ],
                testFiles: [
                    "spec/unit/admin.spec.ts",
                    "spec/unit/admin-extended.spec.ts",
                    "spec/unit/admin-new-endpoints.spec.ts",
                ],
            },
            {
                name: "AdminManager federation destination and blacklist APIs",
                ownerFile: "src/admin/index.ts",
                methods: [
                    "getFederationBlacklist",
                    "addToFederationBlacklist",
                    "removeFromFederationBlacklist",
                    "getFederationDestinations",
                    "getFederationDestination",
                    "resetFederationConnection",
                    "getFederationDestinationRooms",
                    "deleteFederationDestination",
                    "resetFederationDestination",
                ],
                testFiles: [
                    "spec/unit/admin.spec.ts",
                    "spec/unit/admin-extended.spec.ts",
                    "spec/unit/admin-new-endpoints.spec.ts",
                ],
            },
            {
                name: "AdminManager federation cache admission and resolution APIs",
                ownerFile: "src/admin/index.ts",
                methods: [
                    "getFederationCache",
                    "clearFederationCache",
                    "deleteFederationCacheEntry",
                    "getFederationAdmissionList",
                    "getPendingFederationServers",
                    "resolveFederation",
                    "rewriteFederation",
                    "confirmFederation",
                ],
                testFiles: ["spec/unit/admin-new-endpoints.spec.ts"],
            },
            {
                name: "AdminManager register and report APIs",
                ownerFile: "src/admin/index.ts",
                methods: [
                    "getRegisterNonce",
                    "registerAdmin",
                    "listReports",
                    "getReport",
                    "deleteReport",
                    "listRoomReports",
                    "getRoomReport",
                ],
                testFiles: ["spec/unit/admin-new-endpoints.spec.ts"],
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

    console.log("=== Admin Server Federation Granular Coverage ===");

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
