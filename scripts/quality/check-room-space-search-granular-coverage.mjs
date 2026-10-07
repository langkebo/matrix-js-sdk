#!/usr/bin/env node
/**
 * 判定逻辑在 ./lib/granular-coverage.mjs（18 个 granular 门禁共用）。
 * 本文件只维护下面的 CHECKS 数据 —— 改判据请改共享库，并跑 spec/unit/granular-coverage-gate.spec.ts。
 */

import { runGranularCoverage } from "./lib/granular-coverage.mjs";

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

runGranularCoverage({ title: "Room / Space / Search Granular Coverage", checks: CHECKS });
