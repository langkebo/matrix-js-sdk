#!/usr/bin/env node
/**
 * 判定逻辑在 ./lib/granular-coverage.mjs（18 个 granular 门禁共用）。
 * 本文件只维护下面的 CHECKS 数据 —— 改判据请改共享库，并跑 spec/unit/granular-coverage-gate.spec.ts。
 */

import { runGranularCoverage } from "./lib/granular-coverage.mjs";

const CHECKS = [
    {
        module: "cas",
        groups: [
            {
                name: "CasManager admin CRUD APIs",
                ownerFile: "src/cas/index.ts",
                // registerService→createService、setUserAttribute→setUserAttributes（历史名变更）
                methods: ["createService", "listServices", "deleteService", "setUserAttributes", "getUserAttributes"],
                testFiles: ["spec/unit/cas.spec.ts"],
            },
            // buildLoginUrl/buildLogoutUrl/buildValidateUrl 为历史 URL 构造 helper，SDK 实为 serviceValidate/proxyValidate/handleLogout，有意移除
        ],
    },
];

runGranularCoverage({ title: "CAS Granular Coverage", checks: CHECKS });
