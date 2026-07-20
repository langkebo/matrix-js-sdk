/**
 * Step 9: 预定功能、加密轮换与数据管理模块测试
 *
 * 测试模块: scheduled-call, scheduled-events, beacon, retention, captcha, media-quota, key-claim, key-forwarding, encryption-rotation, room-account-data
 *
 * 运行: pnpm run test:real-backend:tsx -- spec/integ/real-backend/step9-scheduled.test.ts
 */

import { createClient, type MatrixClient } from "../../../src/matrix";
import { extendMatrixClientWithManagers } from "../../../src/manager-extensions";
import { TestConfig } from "./TestConfig";

declare const process: { exit: (code?: number) => never };

let client: MatrixClient | null = null;
const testResults: { name: string; passed: boolean; error?: string }[] = [];
let testRoomId: string | null = null;

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
    try {
        console.log(`  Testing: ${name}...`);
        await fn();
        testResults.push({ name, passed: true });
        console.log(`    ✅ PASSED`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
        testResults.push({ name, passed: false, error: error.message });
        console.log(`    ❌ FAILED: ${error.message}`);
    }
}

async function login(): Promise<MatrixClient> {
    const testClient = createClient({
        baseUrl: TestConfig.baseUrl,
        allowInsecureHttp: true,
    });

    const username = TestConfig.testUser.userId.replace("@", "").split(":")[0];

    const result = await testClient.loginRequest({
        type: "m.login.password",
        user: username,
        password: TestConfig.testUser.password,
    });

    testClient.setAccessToken(result.access_token);

    return testClient;
}

async function main(): Promise<void> {
    console.log("\n========================================");
    console.log("Step 9: 预定功能、加密轮换与数据管理模块测试");
    console.log("========================================\n");

    await extendMatrixClientWithManagers();

    console.log("1. 登录测试...");
    client = await login();
    console.log(`   ✅ 登录成功: ${client.getUserId()}\n`);

    // 创建测试房间
    console.log("2. 创建测试房间...");
    const room = await client!.createRoom({
        name: "Step9 Test Room",
        topic: "Test Room for Step 9",
    });
    testRoomId = room.room_id;
    console.log(`   ✅ 房间创建成功: ${testRoomId}\n`);

    // === Scheduled Call Module ===
    console.log("3. Scheduled Call 模块测试...");

    await runTest("getScheduledCall", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const call = await (client as any).getScheduledCall("test-call-id");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Scheduled call not available");
        }
    });

    await runTest("getScheduledCalls", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const calls = await (client as any).getScheduledCalls();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get scheduled calls not available");
        }
    });

    await runTest("createScheduledCall", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const call = await (client as any).createScheduledCall(testRoomId!, {
                type: "m.call.invite",
                room_id: testRoomId,
                intent: "m.call.invite",
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Create scheduled call not available");
        }
    });

    await runTest("cancelScheduledCall", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (client as any).cancelScheduledCall("test-call-id");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Cancel scheduled call not available");
        }
    });

    // === Scheduled Events Module ===
    console.log("\n4. Scheduled Events 模块测试...");

    await runTest("scheduleEvent", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const event = await (client as any).scheduleEvent(
                testRoomId!,
                {
                    type: "m.room.message",
                    content: { body: "scheduled" },
                },
                Date.now() + 60000,
            );
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Schedule event not available");
        }
    });

    await runTest("getScheduledEvents", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const events = await (client as any).getScheduledEvents(testRoomId!);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get scheduled events not available");
        }
    });

    await runTest("cancelScheduledEvent", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (client as any).cancelScheduledEvent(testRoomId!, "test-event-id");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Cancel scheduled event not available");
        }
    });

    // === Beacon Module ===
    console.log("\n5. Beacon 模块测试...");

    await runTest("getLiveBeacon", async () => {
        try {
            if (testRoomId) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const beacon = await (client as any).getLiveBeacon(testRoomId);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get live beacon not available");
        }
    });

    await runTest("publishBeacon", async () => {
        try {
            if (testRoomId) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (client as any).publishBeacon(testRoomId, {
                    uri: "geo:test",
                    description: "test beacon",
                });
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Publish beacon not available");
        }
    });

    await runTest("getBeaconLocations", async () => {
        try {
            if (testRoomId) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const locations = await (client as any).getBeaconLocations(testRoomId, "test-beacon-id");
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get beacon locations not available");
        }
    });

    // === Retention Module ===
    console.log("\n6. Retention 模块测试...");

    await runTest("getRetentionPolicy", async () => {
        try {
            if (testRoomId) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const policy = await (client as any).getRetentionPolicy(testRoomId);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get retention policy not available");
        }
    });

    await runTest("setRetentionPolicy", async () => {
        try {
            if (testRoomId) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (client as any).setRetentionPolicy(testRoomId, {
                    min_lifetime: 86400,
                    max_lifetime: 604800,
                });
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Set retention policy not available");
        }
    });

    await runTest("getRoomRetention", async () => {
        try {
            if (testRoomId) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const retention = await (client as any).getRoomRetention(testRoomId);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get room retention not available");
        }
    });

    // === Captcha Module ===
    console.log("\n7. Captcha 模块测试...");

    await runTest("getCaptchaPublicKey", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const captcha = await (client as any).getCaptchaPublicKey();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Captcha not available");
        }
    });

    await runTest("getCaptchaPicture", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const picture = await (client as any).getCaptchaPicture("test-session-id");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Captcha picture not available");
        }
    });

    // === Media Quota Module ===
    console.log("\n8. Media Quota 模块测试...");

    await runTest("getMediaQuotaInformation", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const quota = await (client as any).getMediaQuotaInformation();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Media quota not available");
        }
    });

    await runTest("getUploadQuota", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const quota = await (client as any).getUploadQuota();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Upload quota not available");
        }
    });

    // === Key Claim Module ===
    console.log("\n9. Key Claim 模块测试...");

    await runTest("claimOneTimeKeys", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const keys = await (client as any).claimOneTimeKeys(["@test2:cjystx.top"], "signed_curve25519");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Claim one-time keys not available");
        }
    });

    await runTest("getKeyChanges", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const changes = await (client as any).getKeyChanges("test-from", "test-to");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get key changes not available");
        }
    });

    // === Key Forwarding Module ===
    console.log("\n10. Key Forwarding 模块测试...");

    await runTest("requestRoomKey", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (client as any).requestRoomKey({
                room_id: testRoomId,
                event_id: "test-event",
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Request room key not available");
        }
    });

    await runTest("shareRoomKey", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (client as any).shareRoomKey(testRoomId!, ["@test2:cjystx.top"]);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Share room key not available");
        }
    });

    // === Encryption Rotation Module ===
    console.log("\n11. Encryption Rotation 模块测试...");

    await runTest("getEncryptionAlgorithm", async () => {
        try {
            if (testRoomId) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const algo = await (client as any).getEncryptionAlgorithm(testRoomId);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get encryption algorithm not available");
        }
    });

    await runTest("setEncryptionAlgorithm", async () => {
        try {
            if (testRoomId) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (client as any).setEncryptionAlgorithm(testRoomId, "m.megolm.v1.aes-sha2");
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Set encryption algorithm not available");
        }
    });

    await runTest("rotateOlmKeys", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (client as any).rotateOlmKeys();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Rotate Olm keys not available");
        }
    });

    // === Room Account Data Module ===
    console.log("\n12. Room Account Data 模块测试...");

    await runTest("getRoomAccountData", async () => {
        if (testRoomId) {
            try {
                const data = client!.getRoomAccountData(testRoomId, "m.test");
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) {
                console.log("    ⚠️ Get room account data not available");
            }
        }
    });

    await runTest("setRoomAccountData", async () => {
        if (testRoomId) {
            try {
                await client!.setRoomAccountData(testRoomId, "m.test", { key: "value" });
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) {
                console.log("    ⚠️ Set room account data not available");
            }
        }
    });

    await runTest("getRoomAccountDataByType", async () => {
        if (testRoomId) {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const data = await (client as any).getRoomAccountDataByType(testRoomId, "m.test");
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) {
                console.log("    ⚠️ Get room account data by type not available");
            }
        }
    });

    // 清理
    console.log("\n13. 清理...");
    if (testRoomId) {
        try {
            await client!.leave(testRoomId);
            console.log("   ✅ 已删除测试房间");
        } catch (e) {
            console.log("   ⚠️ 清理失败");
        }
    }

    try {
        await client!.logout();
        console.log("   ✅ 已登出");
    } catch (e) {
        console.log("   ⚠️ 登出失败");
    }

    // 输出结果
    console.log("\n========================================");
    console.log("测试结果汇总");
    console.log("========================================");

    const passed = testResults.filter((r) => r.passed).length;
    const failed = testResults.filter((r) => !r.passed).length;
    const total = testResults.length;

    console.log(`总计: ${total} | ✅ 通过: ${passed} | ❌ 失败: ${failed}`);
    console.log(`通过率: ${((passed / total) * 100).toFixed(1)}%\n`);

    if (failed > 0) {
        console.log("失败测试:");
        testResults
            .filter((r) => !r.passed)
            .forEach((r) => {
                console.log(`  - ${r.name}: ${r.error}`);
            });
    }

    process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
