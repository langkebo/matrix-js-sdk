#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();

const CHECKS = [
    {
        module: "presence",
        groups: [
            {
                name: "PresenceManager cached presence APIs",
                ownerFile: "src/presence/index.ts",
                methods: [
                    "setPresence",
                    "getPresence",
                    "getPresenceList",
                    "getPresenceListByIds",
                    "subscribeToPresence",
                    "unsubscribeFromPresence",
                    "getSubscribedPresence",
                ],
                testFiles: ["spec/unit/presence.spec.ts"],
            },
        ],
    },
    {
        module: "typing",
        groups: [
            {
                name: "TypingManager typing route and cache helpers",
                ownerFile: "src/typing/index.ts",
                methods: [
                    "startTyping",
                    "stopTyping",
                    "getTypingUsers",
                    "getRoomsTyping",
                    "isUserTyping",
                    "fetchTypingUsers",
                    "fetchUserTyping",
                    "fetchRoomsTyping",
                ],
                testFiles: ["spec/unit/typing.spec.ts"],
            },
        ],
    },
    {
        module: "receipts",
        groups: [
            {
                name: "Receipt request helpers",
                ownerFile: "src/client-receipt-requests.ts",
                methods: [
                    "buildReceiptPath",
                    "buildReceiptBody",
                    "sendReceiptRequest",
                    "setRoomReadMarkersHttpRequest",
                    "setRoomReadMarkersWithLocalEcho",
                ],
                testFiles: ["spec/unit/client-receipt-requests.spec.ts"],
            },
            {
                name: "MatrixClient typing and receipt compatibility surface",
                ownerFile: "src/client.ts",
                methods: ["sendReceipt", "sendReadReceipt", "setRoomReadMarkers", "sendTyping", "getRoomTyping"],
                testFiles: ["spec/unit/read-receipt.spec.ts", "spec/unit/matrix-client.spec.ts"],
            },
        ],
    },
    {
        module: "ephemeral",
        groups: [
            {
                name: "EphemeralManager room ephemeral APIs",
                ownerFile: "src/ephemeral/index.ts",
                methods: [
                    "sendEphemeralEvent",
                    "clearEphemeralEvents",
                    "getEphemeralEventsFromServer",
                    "getTypingEvents",
                    "getReceiptEvents",
                ],
                testFiles: ["spec/unit/ephemeral.spec.ts"],
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

    console.log("=== Presence / Typing / Receipts / Ephemeral Granular Coverage ===");

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
