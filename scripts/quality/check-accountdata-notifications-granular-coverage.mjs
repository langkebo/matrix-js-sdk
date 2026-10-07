#!/usr/bin/env node
/**
 * 判定逻辑在 ./lib/granular-coverage.mjs（18 个 granular 门禁共用）。
 * 本文件只维护下面的 CHECKS 数据 —— 改判据请改共享库，并跑 spec/unit/granular-coverage-gate.spec.ts。
 */

import { runGranularCoverage } from "./lib/granular-coverage.mjs";

const CHECKS = [
    {
        module: "account-data",
        groups: [
            {
                name: "Account-data request helpers",
                ownerFile: "src/client-account-data-requests.ts",
                methods: [
                    "buildUserAccountDataPath",
                    "buildUserAccountDataListPath",
                    "buildRoomAccountDataPath",
                    "buildCreateFilterPath",
                    "buildFilterPath",
                    "setUserAccountDataRequest",
                    "getUserAccountDataRequest",
                    "deleteUserAccountDataRequest",
                    "selectDeleteAccountDataRequestOptions",
                ],
                testFiles: ["spec/unit/client-account-data-requests.spec.ts"],
            },
            {
                name: "AccountDataManager core account-data APIs",
                ownerFile: "src/account-data/index.ts",
                methods: [
                    "setAccountData",
                    "getAccountData",
                    "getAccountDataFromServer",
                    "listAccountData",
                    "setRoomAccountData",
                    "getRoomAccountDataFromServer",
                    "deleteRoomAccountData",
                    "deleteAccountData",
                ],
                testFiles: ["spec/unit/account-data.spec.ts"],
            },
            {
                name: "MatrixClient account-data compatibility surface",
                ownerFile: "src/client.ts",
                methods: ["setAccountData", "deleteAccountData", "createFilter", "getFilter", "getOpenIdToken"],
                testFiles: ["spec/unit/matrix-client.spec.ts", "spec/unit/embedded.spec.ts"],
            },
        ],
    },
    {
        module: "notifications",
        groups: [
            {
                name: "MatrixClient local notification state",
                ownerFile: "src/client.ts",
                methods: [
                    "getNotifTimelineSet",
                    "setNotifTimelineSet",
                    "resetNotifTimelineSet",
                    "setLocalNotificationSettings",
                ],
                testFiles: ["spec/unit/matrix-client.spec.ts", "spec/unit/local_notifications.spec.ts"],
            },
            {
                name: "NotificationsManager dedicated notification APIs",
                ownerFile: "src/notifications/index.ts",
                methods: ["getNotifications", "ackNotification"],
                testFiles: ["spec/unit/notifications-manager.spec.ts"],
            },
            {
                name: "PushManager notification compatibility APIs",
                ownerFile: "src/push/index.ts",
                methods: ["getNotifications", "ackNotification"],
                testFiles: ["spec/unit/push.spec.ts"],
            },
        ],
    },
];

runGranularCoverage({ title: "Account-Data / Notifications Granular Coverage", checks: CHECKS });
