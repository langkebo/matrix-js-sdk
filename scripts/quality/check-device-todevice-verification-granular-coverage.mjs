#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();

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

function readRelative(file) {
    return fs.readFileSync(path.join(projectRoot, file), "utf8");
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasMethod(content, method) {
    const escapedMethod = escapeRegex(method);
    const methodCall = new RegExp(`\\b${escapedMethod}(?:<[^>]+>)?\\s*\\(`);
    const propertyShape = new RegExp(`\\b${escapedMethod}\\s*:`);
    const delegatedCall = new RegExp(`\\.${escapedMethod}(?:<[^>]+>)?\\s*\\(`);
    return methodCall.test(content) || propertyShape.test(content) || delegatedCall.test(content);
}

function collectMissing(items, predicate) {
    return items.filter((item) => !predicate(item));
}

function main() {
    const failures = [];
    let totalGroups = 0;
    let passedGroups = 0;

    console.log("=== Device / To-Device / Verification Granular Coverage ===");

    for (const moduleCheck of CHECKS) {
        console.log(`\n[${moduleCheck.module}]`);

        for (const group of moduleCheck.groups) {
            totalGroups += 1;
            const ownerContent = readRelative(group.ownerFile);
            const testContents = group.testFiles.map((file) => ({ file, content: readRelative(file) }));

            const missingMethods = collectMissing(group.methods, (method) => hasMethod(ownerContent, method));
            const methodsWithoutTests = collectMissing(group.methods, (method) =>
                testContents.some(({ content }) => content.includes(`${method}(`)),
            );

            if (missingMethods.length === 0 && methodsWithoutTests.length === 0) {
                passedGroups += 1;
                console.log(`  PASS: ${group.name}`);
                continue;
            }

            console.log(`  FAIL: ${group.name}`);
            if (missingMethods.length > 0) {
                console.log(`    missing methods in ${group.ownerFile}: ${missingMethods.join(", ")}`);
            }
            if (methodsWithoutTests.length > 0) {
                console.log(`    methods without test hits: ${methodsWithoutTests.join(", ")}`);
            }

            failures.push({
                module: moduleCheck.module,
                group: group.name,
                ownerFile: group.ownerFile,
                missingMethods,
                methodsWithoutTests,
            });
        }
    }

    console.log(`\nGroups passed: ${passedGroups}/${totalGroups}`);

    if (failures.length > 0) {
        console.log("\nGranular coverage gaps detected.");
        process.exitCode = 1;
        return;
    }

    console.log("\nGranular coverage check passed.");
}

main();
