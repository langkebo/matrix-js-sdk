#!/usr/bin/env node
/**
 * 判定逻辑在 ./lib/granular-coverage.mjs（18 个 granular 门禁共用）。
 * 本文件只维护下面的 CHECKS 数据 —— 改判据请改共享库，并跑 spec/unit/granular-coverage-gate.spec.ts。
 */

import { runGranularCoverage } from "./lib/granular-coverage.mjs";

const CHECKS = [
    {
        module: "telemetry",
        groups: [
            {
                name: "TelemetryManager configuration and queue access APIs",
                ownerFile: "src/telemetry/index.ts",
                methods: [
                    "configure",
                    "enable",
                    "disable",
                    "isEnabled",
                    "getPendingEvents",
                    "getUsageStats",
                    "getSessionDuration",
                    "getClientInfo",
                    "resetStats",
                ],
                testFiles: ["spec/unit/telemetry.spec.ts"],
            },
            {
                name: "TelemetryManager client tracking APIs",
                ownerFile: "src/telemetry/index.ts",
                methods: [
                    "track",
                    "trackMessageSent",
                    "trackMessageReceived",
                    "trackRoomJoined",
                    "trackCall",
                    "trackMediaUploaded",
                    "trackError",
                ],
                testFiles: ["spec/unit/telemetry.spec.ts"],
            },
            {
                name: "TelemetryManager server admin telemetry APIs",
                ownerFile: "src/telemetry/index.ts",
                methods: [
                    "getServerStatus",
                    "getServerAttributes",
                    "getServerMetricsSummary",
                    "getServerAlerts",
                    "acknowledgeServerAlert",
                    "getServerHealth",
                ],
                testFiles: ["spec/unit/telemetry.spec.ts"],
            },
            {
                name: "TelemetryManager lifecycle and flushing APIs",
                ownerFile: "src/telemetry/index.ts",
                // `start` 为历史名，SDK 实为 `enable`（flush/stop 保留）
                methods: ["flush", "enable", "stop"],
                testFiles: ["spec/unit/telemetry.spec.ts"],
            },
        ],
    },
];

runGranularCoverage({ title: "Telemetry Granular Coverage", checks: CHECKS });
