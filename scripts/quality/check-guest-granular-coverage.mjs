#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();

const CHECKS = [
    {
        module: "guest",
        groups: [
            {
                name: "GuestManager guest registration and login APIs",
                ownerFile: "src/guest/index.ts",
                methods: ["registerGuest", "loginGuest", "registerGuestOnServer"],
                testFiles: ["spec/unit/guest.spec.ts"],
            },
            {
                name: "GuestManager server guest info and upgrade APIs",
                ownerFile: "src/guest/index.ts",
                methods: ["getGuestInfoFromServer", "upgradeGuestAccount", "upgradeGuestAccountOnServer", "isGuest"],
                testFiles: ["spec/unit/guest.spec.ts"],
            },
            {
                name: "GuestManager room access APIs",
                ownerFile: "src/guest/index.ts",
                methods: ["getGuestRooms", "joinRoomAsGuest", "canJoinRoom"],
                testFiles: ["spec/unit/guest.spec.ts"],
            },
            {
                name: "GuestManager local guest state APIs",
                ownerFile: "src/guest/index.ts",
                methods: ["getGuestAccessToken", "getGuestInfo", "clearGuestInfo", "isGuestTokenValid", "stop"],
                testFiles: ["spec/unit/guest.spec.ts"],
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

    console.log("=== Guest Granular Coverage ===");

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
