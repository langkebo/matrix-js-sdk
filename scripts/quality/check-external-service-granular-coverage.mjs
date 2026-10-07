#!/usr/bin/env node
/**
 * 判定逻辑在 ./lib/granular-coverage.mjs（18 个 granular 门禁共用）。
 * 本文件只维护下面的 CHECKS 数据 —— 改判据请改共享库，并跑 spec/unit/granular-coverage-gate.spec.ts。
 */

import { runGranularCoverage } from "./lib/granular-coverage.mjs";

const CHECKS = [
    {
        module: "external-service",
        groups: [
            {
                name: "ExternalServiceManager service CRUD and registration-state APIs",
                ownerFile: "src/external-service/index.ts",
                // registerService→createService；unregisterService/isServiceRegistered 历史方法，SDK 未实现（有意移除）
                methods: ["createService", "updateService", "listServices"],
                testFiles: ["spec/unit/external-service.spec.ts"],
            },
            {
                name: "ExternalServiceManager health APIs",
                ownerFile: "src/external-service/index.ts",
                // getAllHealthStatus→getHealth（历史名变更）
                methods: ["getServiceHealth", "checkServiceHealth", "getHealth"],
                testFiles: ["spec/unit/external-service.spec.ts"],
            },
            // registerTrendRadarService/registerOpenClawService/registerWebhookService 为类型化 helper（无独立后端路由），
            // getCachedService/getCachedServices/clearCache 为客户端 cache helper，SDK 均未实现，有意移除
        ],
    },
];

runGranularCoverage({ title: "External Service Granular Coverage", checks: CHECKS });
