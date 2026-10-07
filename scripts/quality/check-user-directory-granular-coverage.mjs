#!/usr/bin/env node
/**
 * 判定逻辑在 ./lib/granular-coverage.mjs（18 个 granular 门禁共用）。
 * 本文件只维护下面的 CHECKS 数据 —— 改判据请改共享库，并跑 spec/unit/granular-coverage-gate.spec.ts。
 */

import { runGranularCoverage } from "./lib/granular-coverage.mjs";

const CHECKS = [
    {
        module: "user-directory",
        groups: [
            {
                name: "UserDirectoryManager remote query APIs",
                ownerFile: "src/user-directory/index.ts",
                methods: ["searchUserDirectory", "listUserDirectory", "getProfile"],
                testFiles: ["spec/unit/user-directory.spec.ts"],
            },
            {
                name: "UserDirectoryManager local user lookup APIs",
                ownerFile: "src/user-directory/index.ts",
                methods: ["getUser", "getUsers", "getUserByDisplayName"],
                testFiles: ["spec/unit/user-directory.spec.ts"],
            },
        ],
    },
];

runGranularCoverage({ title: "User Directory Granular Coverage", checks: CHECKS });
