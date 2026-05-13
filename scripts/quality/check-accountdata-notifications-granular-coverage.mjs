#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();

const CHECKS = [
    {
        module: "account-data",
        groups: [
            {
                name: "Account-data request helpers",
                ownerFile: "src/client-account-data-requests.ts",
                methods: [
                    "buildUserAccountDataPath",
                    "buildUserAccountDataListPath",
                    "buildRoomAccountDataPath",
                    "buildCreateFilterPath",
                    "buildFilterPath",
                    "setUserAccountDataRequest",
                    "getUserAccountDataRequest",
                    "deleteUserAccountDataRequest",
                    "selectDeleteAccountDataRequestOptions",
                ],
                testFiles: ["spec/unit/client-account-data-requests.spec.ts"],
            },
            {
                name: "AccountDataManager core account-data APIs",
                ownerFile: "src/account-data/index.ts",
                methods: [
                    "setAccountData",
                    "getAccountData",
                    "getAccountDataFromServer",
                    "listAccountData",
                    "setRoomAccountData",
                    "getRoomAccountDataFromServer",
                    "deleteRoomAccountData",
                    "deleteAccountData",
                ],
                testFiles: ["spec/unit/account-data.spec.ts"],
            },
            {
                name: "MatrixClient account-data compatibility surface",
                ownerFile: "src/client.ts",
                methods: ["setAccountData", "deleteAccountData", "createFilter", "getFilter", "getOpenIdToken"],
                testFiles: ["spec/unit/matrix-client.spec.ts", "spec/unit/embedded.spec.ts"],
            },
        ],
    },
    {
        module: "notifications",
        groups: [
            {
                name: "MatrixClient local notification state",
                ownerFile: "src/client.ts",
                methods: [
                    "getNotifTimelineSet",
                    "setNotifTimelineSet",
                    "resetNotifTimelineSet",
                    "setLocalNotificationSettings",
                ],
                testFiles: ["spec/unit/matrix-client.spec.ts", "spec/unit/local_notifications.spec.ts"],
            },
            {
                name: "NotificationsManager dedicated notification APIs",
                ownerFile: "src/notifications/index.ts",
                methods: ["getNotifications", "ackNotification"],
                testFiles: ["spec/unit/notifications-manager.spec.ts"],
            },
            {
                name: "PushManager notification compatibility APIs",
                ownerFile: "src/push/index.ts",
                methods: ["getNotifications", "ackNotification"],
                testFiles: ["spec/unit/push.spec.ts"],
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

    console.log("=== Account-Data / Notifications Granular Coverage ===");

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
