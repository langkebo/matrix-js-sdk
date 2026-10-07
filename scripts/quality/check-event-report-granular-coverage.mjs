#!/usr/bin/env node
/**
 * 判定逻辑在 ./lib/granular-coverage.mjs（18 个 granular 门禁共用）。
 * 本文件只维护下面的 CHECKS 数据 —— 改判据请改共享库，并跑 spec/unit/granular-coverage-gate.spec.ts。
 */

import { runGranularCoverage } from "./lib/granular-coverage.mjs";

const CHECKS = [
    {
        module: "event-report",
        groups: [
            {
                name: "EventReportManager list and count APIs",
                ownerFile: "src/event-report/index.ts",
                methods: ["getAllReports", "listReports", "getReportsCount", "getStats"],
                testFiles: ["spec/unit/event-report.spec.ts"],
            },
            {
                name: "EventReportManager filtered query APIs",
                ownerFile: "src/event-report/index.ts",
                methods: [
                    "getReportsByEvent",
                    "getReportsByRoom",
                    "getReportsByReporter",
                    "getReportsByStatus",
                    "getStatusCount",
                ],
                testFiles: ["spec/unit/event-report.spec.ts"],
            },
            {
                name: "EventReportManager CRUD and moderation APIs",
                ownerFile: "src/event-report/index.ts",
                // 注意：不要再把 getReportHistory 加回来。
                // 后端在 2026-09-25 已删除 GET /_synapse/admin/v1/event_reports/{id}/history
                // 全链（写入侧本就是静默丢弃），SDK 侧于 e095f4428 一并删除方法与 DTO。
                // 该期望漏删导致本门禁自 2026-10-01 起常红——正是"期望表未与实现同步"的典型。
                methods: [
                    "createReport",
                    "getReport",
                    "updateReport",
                    "resolveReport",
                    "dismissReport",
                    "escalateReport",
                    "deleteReport",
                ],
                testFiles: ["spec/unit/event-report.spec.ts"],
            },
            {
                name: "EventReportManager rate limit APIs",
                ownerFile: "src/event-report/index.ts",
                methods: ["checkRateLimit", "blockUser", "unblockUser"],
                testFiles: ["spec/unit/event-report.spec.ts"],
            },
        ],
    },
];

runGranularCoverage({ title: "Event Report Granular Coverage", checks: CHECKS });
