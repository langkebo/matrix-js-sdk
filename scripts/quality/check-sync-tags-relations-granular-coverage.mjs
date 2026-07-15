#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();

const CHECKS = [
    {
        module: "sync",
        groups: [
            {
                name: "Joined rooms request helper",
                ownerFile: "src/client-batch-requests.ts",
                methods: ["getJoinedRoomsRequest"],
                testFiles: ["spec/unit/client-batch-requests.spec.ts"],
            },
            {
                name: "My rooms request helper",
                ownerFile: "src/client-secure-backup-requests.ts",
                methods: ["getMyRoomsRequest"],
                testFiles: ["spec/unit/client-batch-requests.spec.ts"],
            },
            {
                name: "MatrixClient sync REST entrypoints",
                ownerFile: "src/client.ts",
                methods: ["getJoinedRooms", "slidingSync", "getMyRooms"],
                testFiles: ["spec/unit/matrix-client.spec.ts"],
            },
            {
                name: "SyncManager delegated sync accessors",
                ownerFile: "src/sync-management/index.ts",
                methods: [
                    "getSyncToken",
                    "getSyncState",
                    "getSyncStateData",
                    "isSyncing",
                    "getRooms",
                    "getJoinedRooms",
                    "getInvitedRooms",
                    "getLeftRooms",
                ],
                testFiles: ["spec/unit/sync-management.spec.ts"],
            },
        ],
    },
    {
        module: "tags",
        groups: [
            {
                name: "RoomManager tag route entrypoints",
                ownerFile: "src/room/RoomManager.ts",
                methods: ["getRoomTags", "setRoomTag", "deleteRoomTag"],
                testFiles: ["spec/unit/room-manager.spec.ts"],
            },
            {
                name: "MatrixClient tag delegations",
                ownerFile: "src/client.ts",
                methods: ["getRoomTags", "setRoomTag", "deleteRoomTag"],
                testFiles: ["spec/unit/matrix-client.spec.ts"],
            },
            {
                name: "TagManager cached tag API",
                ownerFile: "src/tags/index.ts",
                methods: ["getRoomTags", "addRoomTag", "removeRoomTag"],
                testFiles: ["spec/unit/tags.spec.ts"],
            },
            {
                name: "TagsManager compatibility tag API",
                ownerFile: "src/tags-management/index.ts",
                methods: ["getRoomTags", "addRoomTag", "removeRoomTag", "setRoomAccountData"],
                testFiles: ["spec/unit/tags-management.spec.ts"],
            },
        ],
    },
    {
        module: "relations",
        groups: [
            {
                name: "RelationsManager dedicated routes",
                ownerFile: "src/relations/index.ts",
                methods: ["fetchRelations", "getAggregations", "sendRelation"],
                testFiles: ["spec/unit/relations-manager.spec.ts"],
            },
            {
                name: "MatrixClient compatibility relations surface",
                ownerFile: "src/client.ts",
                methods: ["relations", "getAggregations", "fetchRelations"],
                testFiles: ["spec/unit/matrix-client.spec.ts"],
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

    console.log("=== Sync / Tags / Relations Granular Coverage ===");

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
