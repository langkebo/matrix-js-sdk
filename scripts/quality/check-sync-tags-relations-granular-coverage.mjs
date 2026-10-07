#!/usr/bin/env node
/**
 * 判定逻辑在 ./lib/granular-coverage.mjs（18 个 granular 门禁共用）。
 * 本文件只维护下面的 CHECKS 数据 —— 改判据请改共享库，并跑 spec/unit/granular-coverage-gate.spec.ts。
 */

import { runGranularCoverage } from "./lib/granular-coverage.mjs";

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

runGranularCoverage({ title: "Sync / Tags / Relations Granular Coverage", checks: CHECKS });
