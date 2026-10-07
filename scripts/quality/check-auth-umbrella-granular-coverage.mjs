#!/usr/bin/env node
/**
 * 判定逻辑在 ./lib/granular-coverage.mjs（18 个 granular 门禁共用）。
 * 本文件只维护下面的 CHECKS 数据 —— 改判据请改共享库，并跑 spec/unit/granular-coverage-gate.spec.ts。
 */

import { runGranularCoverage } from "./lib/granular-coverage.mjs";

const CHECKS = [
    {
        module: "auth",
        groups: [
            {
                name: "AuthManager login/register flow discovery",
                ownerFile: "src/auth/index.ts",
                methods: ["getSupportedLoginFlows", "getRegisterFlows"],
                testFiles: ["spec/unit/auth.spec.ts"],
            },
            {
                name: "AccountManager auth session actions",
                ownerFile: "src/account/index.ts",
                methods: ["login", "logout", "logoutAll", "submitEmailToken", "deactivateAccount"],
                testFiles: ["spec/unit/account.spec.ts"],
            },
            {
                name: "MatrixClient auth compatibility surface",
                ownerFile: "src/client.ts",
                methods: ["requestRegisterEmailToken", "isUsernameAvailable", "register", "refreshToken"],
                testFiles: ["spec/unit/matrix-client.spec.ts", "spec/unit/login.spec.ts"],
            },
        ],
    },
    {
        module: "discovery",
        groups: [
            {
                name: "DiscoveryManager public discovery surface",
                ownerFile: "src/discovery/index.ts",
                methods: [
                    "getServerDiscoveryInfo",
                    "getClientConfig",
                    "getServerWellKnown",
                    "getSupportWellKnown",
                    "getVersions",
                    "getMatrixServerVersion",
                    "getHealth",
                    "getUnderscoreHealth",
                ],
                testFiles: ["spec/unit/discovery.spec.ts"],
            },
        ],
    },
    {
        module: "account",
        groups: [
            {
                name: "MatrixClient account compatibility surface",
                ownerFile: "src/client.ts",
                // getThreePids/bindThreePid/deleteThreePid/unbindThreePid 已迁 ThreePidsManager（前端经 getThreePidsManager 调用）
                methods: ["whoami", "setPassword"],
                testFiles: ["spec/unit/matrix-client.spec.ts"],
            },
        ],
    },
];

runGranularCoverage({ title: "Auth Umbrella Granular Coverage", checks: CHECKS });
