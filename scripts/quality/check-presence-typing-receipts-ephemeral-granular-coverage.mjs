#!/usr/bin/env node
/**
 * 判定逻辑在 ./lib/granular-coverage.mjs（18 个 granular 门禁共用）。
 * 本文件只维护下面的 CHECKS 数据 —— 改判据请改共享库，并跑 spec/unit/granular-coverage-gate.spec.ts。
 */

import { runGranularCoverage } from "./lib/granular-coverage.mjs";

const CHECKS = [
    {
        module: "presence",
        groups: [
            {
                name: "PresenceManager cached presence APIs",
                ownerFile: "src/presence/index.ts",
                methods: [
                    "setPresence",
                    "getPresence",
                    "getPresenceList",
                    "getPresenceListByIds",
                    "subscribeToPresence",
                    "unsubscribeFromPresence",
                    "getSubscribedPresence",
                ],
                testFiles: ["spec/unit/presence.spec.ts"],
            },
        ],
    },
    {
        module: "typing",
        groups: [
            {
                name: "TypingManager typing route and cache helpers",
                ownerFile: "src/typing/index.ts",
                methods: [
                    "startTyping",
                    "stopTyping",
                    "getTypingUsers",
                    "getRoomsTyping",
                    "isUserTyping",
                    "fetchTypingUsers",
                    "fetchUserTyping",
                    "fetchRoomsTyping",
                ],
                testFiles: ["spec/unit/typing.spec.ts"],
            },
        ],
    },
    {
        module: "receipts",
        groups: [
            {
                name: "Receipt request helpers",
                ownerFile: "src/client-receipt-requests.ts",
                methods: [
                    "buildReceiptPath",
                    "buildReceiptBody",
                    "sendReceiptRequest",
                    "setRoomReadMarkersHttpRequest",
                    "setRoomReadMarkersWithLocalEcho",
                ],
                testFiles: ["spec/unit/client-receipt-requests.spec.ts"],
            },
            // sendReceipt/sendReadReceipt/setRoomReadMarkers 已迁 ReadReceiptsManager、sendTyping/getRoomTyping 已迁 TypingManager（前端经 getXManager 调用），client 入口有意移除
        ],
    },
    {
        module: "ephemeral",
        groups: [
            {
                name: "EphemeralManager room ephemeral APIs",
                ownerFile: "src/ephemeral/index.ts",
                methods: [
                    "sendEphemeralEvent",
                    "clearEphemeralEvents",
                    "getEphemeralEventsFromServer",
                    "getTypingEvents",
                    "getReceiptEvents",
                ],
                testFiles: ["spec/unit/ephemeral.spec.ts"],
            },
        ],
    },
];

runGranularCoverage({ title: "Presence / Typing / Receipts / Ephemeral Granular Coverage", checks: CHECKS });
