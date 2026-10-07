#!/usr/bin/env node
/**
 * 判定逻辑在 ./lib/granular-coverage.mjs（18 个 granular 门禁共用）。
 * 本文件只维护下面的 CHECKS 数据 —— 改判据请改共享库，并跑 spec/unit/granular-coverage-gate.spec.ts。
 */

import { runGranularCoverage } from "./lib/granular-coverage.mjs";

const CHECKS = [
    {
        module: "password-reset",
        groups: [
            {
                name: "PasswordResetManager password recovery routes",
                ownerFile: "src/password-reset/index.ts",
                methods: ["requestPasswordEmailToken", "requestPasswordMsisdnToken", "setPassword"],
                testFiles: ["spec/unit/password-reset.spec.ts"],
            },
            {
                name: "MatrixClient password recovery compatibility surface",
                ownerFile: "src/client.ts",
                methods: ["requestPasswordEmailToken", "requestPasswordMsisdnToken", "setPassword"],
                testFiles: ["spec/unit/matrix-client.spec.ts"],
            },
        ],
    },
    {
        module: "identity",
        groups: [
            {
                name: "IdentityManager identity lookup routes",
                ownerFile: "src/identity/index.ts",
                methods: ["getIdentityServerUrl", "lookup3pid", "store3pid", "requestVerificationToken", "bind3pid"],
                testFiles: ["spec/unit/identity.spec.ts"],
            },
            {
                name: "IdentityServerManager identity server config surface",
                ownerFile: "src/identity-server/index.ts",
                methods: ["getIdentityServerUrl", "setIdentityServerUrl"],
                testFiles: ["spec/unit/identity-server.spec.ts"],
            },
            // getIdentityServerUrl/setIdentityServerUrl 已迁 IdentityServerManager（前端经 getIdentityServerManager 调用），client 入口有意移除
        ],
    },
];

runGranularCoverage({ title: "Password / Identity Granular Coverage", checks: CHECKS });
