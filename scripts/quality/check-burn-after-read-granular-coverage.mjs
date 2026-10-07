#!/usr/bin/env node
/**
 * 判定逻辑在 ./lib/granular-coverage.mjs（18 个 granular 门禁共用）。
 * 本文件只维护下面的 CHECKS 数据 —— 改判据请改共享库，并跑 spec/unit/granular-coverage-gate.spec.ts。
 */

import { runGranularCoverage } from "./lib/granular-coverage.mjs";

const CHECKS = [
    {
        module: "burn-after-read",
        groups: [
            {
                name: "BurnAfterReadManager server settings APIs",
                ownerFile: "src/burn-after-read/index.ts",
                methods: [
                    "enableBurn",
                    "disableBurn",
                    "getBurnSettings",
                    "getPendingBurns",
                    "markBurnRead",
                    "cancelBurn",
                    "setBurnConfig",
                    "getBurnStats",
                ],
                testFiles: ["spec/unit/burn-after-read.spec.ts"],
            },
            {
                name: "BurnAfterReadManager message flow APIs",
                ownerFile: "src/burn-after-read/index.ts",
                methods: ["sendMessage", "burnMessage", "markAsRead", "cancelLocalBurn", "extendBurnTime"],
                testFiles: ["spec/unit/burn-after-read.spec.ts"],
            },
            {
                name: "BurnAfterReadManager local cache and lifecycle APIs",
                ownerFile: "src/burn-after-read/index.ts",
                methods: [
                    "getBurnAfterReadMessages",
                    "getBurnAfterReadMessage",
                    "getConfig",
                    "getBurnConfig",
                    "getCachedMessages",
                    "getCachedMessage",
                    "getRoomSettings",
                    "isBurnEnabled",
                    "getPendingLocalBurns",
                    "getActiveBurnCount",
                    "getRequestStats",
                    "start",
                    "clearCache",
                    "stop",
                ],
                testFiles: ["spec/unit/burn-after-read.spec.ts"],
            },
            {
                name: "BurnAfterReadManager compatibility alias APIs",
                ownerFile: "src/burn-after-read/index.ts",
                methods: ["enableBurnAfterRead", "disableBurnAfterRead"],
                testFiles: ["spec/unit/burn-after-read.spec.ts"],
            },
        ],
    },
];

runGranularCoverage({ title: "Burn After Read Granular Coverage", checks: CHECKS });
