#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();

const CHECKS = [
    {
        module: "room",
        groups: [
            {
                name: "RoomManager core room lifecycle",
                ownerFile: "src/room/RoomManager.ts",
                methods: [
                    "createRoom",
                    "joinRoom",
                    "knockRoom",
                    "leave",
                    "forget",
                    "getRoomVersion",
                    "getRoomCapabilities",
                    "getRoomMetadata",
                    "getMembers",
                    "getJoinedMembers",
                    "getMembership",
                    "invite",
                    "inviteByThreePid",
                    "kick",
                    "ban",
                    "unban",
                    "getEvent",
                    "getEventContext",
                    "redactEvent",
                    "getLocalAliases",
                    "getRoomHierarchy",
                    "upgradeRoom",
                    "reportRoom",
                    "roomInitialSync",
                ],
                testFiles: ["spec/unit/room-manager.spec.ts"],
            },
            {
                name: "RoomSummary extended room endpoints",
                ownerFile: "src/room-summary/index.ts",
                methods: [
                    "getRoomServiceTypes",
                    "getRoomFragments",
                    "getRoomDevice",
                    "getRoomVaultData",
                    "setRoomVaultData",
                    "getRoomExternalIds",
                    "translateRoomEvent",
                    "convertRoomEvent",
                    "signRoomEvent",
                    "verifyRoomEvent",
                ],
                testFiles: ["spec/unit/room-summary.spec.ts"],
            },
        ],
    },
    {
        module: "space",
        groups: [
            {
                name: "SpaceManager semantic endpoints",
                ownerFile: "src/space/index.ts",
                methods: [
                    "createSpace",
                    "getPublicSpaces",
                    "searchSpaces",
                    "getSpaceStatistics",
                    "getUserSpaces",
                    "getSpace",
                    "updateSpace",
                    "deleteSpace",
                    "getSpaceChildren",
                    "addChild",
                    "removeChild",
                    "getSpaceHierarchy",
                    "getSpaceHierarchyV1",
                    "getSpaceTreePath",
                    "getRoomParentSpaces",
                    "getSpaceMembers",
                    "getSpaceRooms",
                    "getSpaceState",
                    "inviteToSpace",
                    "joinSpace",
                    "leaveSpace",
                    "getSpaceSummary",
                    "getSpaceSummaryWithChildren",
                    "getSpaceByRoom",
                ],
                testFiles: ["spec/unit/space.spec.ts", "spec/unit/space-extended.spec.ts"],
            },
        ],
    },
    {
        module: "search",
        groups: [
            {
                name: "SearchManager explicit search entrypoints",
                ownerFile: "src/search/index.ts",
                methods: ["search", "searchRecipients"],
                testFiles: ["spec/unit/search.spec.ts"],
            },
            {
                name: "MatrixClient delegated search helpers",
                ownerFile: "src/client.ts",
                methods: ["searchRooms", "timestampToEvent"],
                testFiles: ["spec/unit/search.spec.ts", "spec/unit/matrix-client.spec.ts"],
            },
            {
                name: "Event and room hierarchy search-adjacent entrypoints",
                ownerFile: "src/event/EventManager.ts",
                methods: ["getEventContext"],
                testFiles: ["spec/unit/room-manager.spec.ts"],
            },
            {
                name: "RoomManager hierarchy bridge",
                ownerFile: "src/room/RoomManager.ts",
                methods: ["getRoomHierarchy"],
                testFiles: ["spec/unit/room-manager.spec.ts"],
            },
        ],
    },
];

function readRelative(file) {
    return fs.readFileSync(path.join(projectRoot, file), "utf8");
}

function hasMethod(content, method) {
    return (
        content.includes(`${method}(`) ||
        content.includes(`${method}:`) ||
        content.includes(`.${method}(`)
    );
}

function collectMissing(items, predicate) {
    return items.filter((item) => !predicate(item));
}

function main() {
    const failures = [];
    let totalGroups = 0;
    let passedGroups = 0;

    console.log("=== Room / Space / Search Granular Coverage ===");

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
