#!/usr/bin/env node
/**
 * 判定逻辑在 ./lib/granular-coverage.mjs（18 个 granular 门禁共用）。
 * 本文件只维护下面的 CHECKS 数据 —— 改判据请改共享库，并跑 spec/unit/granular-coverage-gate.spec.ts。
 */

import { runGranularCoverage } from "./lib/granular-coverage.mjs";

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

runGranularCoverage({ title: "Admin Server Federation Granular Coverage", checks: CHECKS });
