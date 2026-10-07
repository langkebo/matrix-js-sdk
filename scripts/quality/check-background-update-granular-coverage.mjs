#!/usr/bin/env node
/**
 * 判定逻辑在 ./lib/granular-coverage.mjs（18 个 granular 门禁共用）。
 * 本文件只维护下面的 CHECKS 数据 —— 改判据请改共享库，并跑 spec/unit/granular-coverage-gate.spec.ts。
 */

import { runGranularCoverage } from "./lib/granular-coverage.mjs";

const CHECKS = [
    {
        module: "background-update",
        groups: [
            {
                name: "BackgroundUpdateManager queue overview APIs",
                ownerFile: "src/background-update/index.ts",
                methods: [
                    "listBackgroundUpdates",
                    "createBackgroundUpdate",
                    "cleanupLocks",
                    "getUpdateCount",
                    "getNextPendingUpdate",
                    "listPendingUpdates",
                    "retryFailedUpdates",
                    "listRunningUpdates",
                    "getStats",
                    "getStatus",
                    "countByStatus",
                ],
                testFiles: ["spec/unit/background-update.spec.ts"],
            },
            {
                name: "BackgroundUpdateManager per-job lifecycle APIs",
                ownerFile: "src/background-update/index.ts",
                methods: [
                    "getUpdate",
                    "deleteUpdate",
                    "startUpdate",
                    "updateProgress",
                    "completeUpdate",
                    "failUpdate",
                    "cancelUpdate",
                    "getHistory",
                ],
                testFiles: ["spec/unit/background-update.spec.ts"],
            },
        ],
    },
];

runGranularCoverage({ title: "Background Update Granular Coverage", checks: CHECKS });
