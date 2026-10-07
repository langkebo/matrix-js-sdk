#!/usr/bin/env node
/**
 * 判定逻辑在 ./lib/granular-coverage.mjs（18 个 granular 门禁共用）。
 * 本文件只维护下面的 CHECKS 数据 —— 改判据请改共享库，并跑 spec/unit/granular-coverage-gate.spec.ts。
 */

import { runGranularCoverage } from "./lib/granular-coverage.mjs";

const CHECKS = [
    {
        module: "worker-admin",
        groups: [
            {
                name: "WorkerAdminManager worker registry APIs",
                ownerFile: "src/worker-admin/index.ts",
                methods: ["registerWorker", "listWorkers", "listWorkersByType", "getWorker", "unregisterWorker"],
                testFiles: ["spec/unit/worker-admin.spec.ts"],
            },
            {
                name: "WorkerAdminManager worker command APIs",
                ownerFile: "src/worker-admin/index.ts",
                methods: ["sendCommand"],
                testFiles: ["spec/unit/worker-admin.spec.ts"],
            },
            {
                name: "WorkerAdminManager task assignment APIs",
                ownerFile: "src/worker-admin/index.ts",
                methods: ["assignTask", "getPendingTasks", "claimTask", "claimSpecificTask"],
                testFiles: ["spec/unit/worker-admin.spec.ts"],
            },
            {
                name: "WorkerAdminManager statistics and routing APIs",
                ownerFile: "src/worker-admin/index.ts",
                methods: ["getStatistics", "getStatisticsByType", "selectWorker"],
                testFiles: ["spec/unit/worker-admin.spec.ts"],
            },
        ],
    },
];

runGranularCoverage({ title: "Worker Admin Granular Coverage", checks: CHECKS });
