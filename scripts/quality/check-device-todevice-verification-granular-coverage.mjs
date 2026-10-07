#!/usr/bin/env node
/**
 * 判定逻辑在 ./lib/granular-coverage.mjs（18 个 granular 门禁共用）。
 * 本文件只维护下面的 CHECKS 数据 —— 改判据请改共享库，并跑 spec/unit/granular-coverage-gate.spec.ts。
 */

import { runGranularCoverage } from "./lib/granular-coverage.mjs";

const CHECKS = [
    {
        module: "device",
        groups: [
            {
                name: "DeviceManager core device APIs",
                ownerFile: "src/device/index.ts",
                methods: [
                    "getDevices",
                    "getDevice",
                    "updateDevice",
                    "setDeviceDetails",
                    "deleteDevice",
                    "deleteDevices",
                ],
                testFiles: ["spec/unit/device.spec.ts"],
            },
            {
                name: "DeviceManager device list update route",
                ownerFile: "src/device/index.ts",
                methods: ["getDeviceListUpdates"],
                testFiles: ["spec/unit/device.spec.ts"],
            },
        ],
    },
    {
        module: "to-device",
        groups: [
            {
                name: "ToDeviceManager message sending APIs",
                ownerFile: "src/to-device/index.ts",
                methods: ["sendToDevice", "sendBatchToDevice", "sendEncryptedToDevice"],
                testFiles: ["spec/unit/to-device.spec.ts"],
            },
            // sendToDevice/queueToDevice 已迁 ToDeviceManager（前端经 getToDeviceManager 调用），client 入口有意移除
        ],
    },
    // 原 module "verification"（KeyVerificationManager 的 11 个 HTTP 方法）已随
    // 后端 2026-09-25 `88001b4a9` 拆除整个服务端验证面而删除：ledger / ROUTE_CONTRACT
    // 均无 `keys/device_signing/verify_*`、`keys/qr_code/*`，后端保留 404 用例。
    // `m.key.verification.*` 是客户端 to-device 流程，无服务端中继端点可覆盖。
];

runGranularCoverage({ title: "Device / To-Device / Verification Granular Coverage", checks: CHECKS });
