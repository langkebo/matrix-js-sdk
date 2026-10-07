#!/usr/bin/env node
/**
 * 判定逻辑在 ./lib/granular-coverage.mjs（18 个 granular 门禁共用）。
 * 本文件只维护下面的 CHECKS 数据 —— 改判据请改共享库，并跑 spec/unit/granular-coverage-gate.spec.ts。
 */

import { runGranularCoverage } from "./lib/granular-coverage.mjs";

const CHECKS = [
    {
        module: "guest",
        groups: [
            {
                name: "GuestManager guest registration and login APIs",
                ownerFile: "src/guest/index.ts",
                methods: ["registerGuest", "loginGuest", "registerGuestOnServer"],
                testFiles: ["spec/unit/guest.spec.ts"],
            },
            {
                name: "GuestManager server guest info and upgrade APIs",
                ownerFile: "src/guest/index.ts",
                methods: ["getGuestInfoFromServer", "upgradeGuestAccount", "upgradeGuestAccountOnServer", "isGuest"],
                testFiles: ["spec/unit/guest.spec.ts"],
            },
            {
                name: "GuestManager room access APIs",
                ownerFile: "src/guest/index.ts",
                methods: ["getGuestRooms", "joinRoomAsGuest", "canJoinRoom"],
                testFiles: ["spec/unit/guest.spec.ts"],
            },
            {
                name: "GuestManager local guest state APIs",
                ownerFile: "src/guest/index.ts",
                methods: ["getGuestAccessToken", "getGuestInfo", "clearGuestInfo", "isGuestTokenValid", "stop"],
                testFiles: ["spec/unit/guest.spec.ts"],
            },
        ],
    },
];

runGranularCoverage({ title: "Guest Granular Coverage", checks: CHECKS });
