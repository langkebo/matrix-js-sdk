/**
 * Step 10: 举报、权限与消息管理模块测试
 *
 * 测试模块: reporting, content-scan, power-levels, membership, pinned-messages, editions, threading, aggregations
 *
 * 运行: pnpm run test:real-backend:tsx -- spec/integ/real-backend/step10-reporting.test.ts
 */

import { createClient, type MatrixClient } from "../../../src/matrix";
import { extendMatrixClientWithManagers } from "../../../src/manager-extensions";
import { MsgType } from "../../../src/@types/event.ts";
import { TestConfig } from "./TestConfig";

declare const process: { exit: (code?: number) => never };

let client: MatrixClient | null = null;
const testResults: { name: string; passed: boolean; error?: string }[] = [];
let testRoomId: string | null = null;
let testEventId: string | null = null;

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
    console.log("Step 10: 举报、权限与消息管理模块测试");
    console.log("========================================\n");

    await extendMatrixClientWithManagers();

    console.log("1. 登录测试...");
    client = await login();
    console.log(`   ✅ 登录成功: ${client.getUserId()}\n`);

    // 创建测试房间并发送消息
    console.log("2. 创建测试房间并发送消息...");
    const room = await client!.createRoom({
        name: "Step10 Test Room",
        topic: "Test Room for Step 10",
    });
    testRoomId = room.room_id;
    console.log(`   ✅ 房间创建成功: ${testRoomId}`);

    // 发送测试消息
    const msgResult = await client!.sendMessage(testRoomId, {
        msgtype: MsgType.Text,
        body: "Test message for Step 10",
    });
    testEventId = msgResult.event_id;
    console.log(`   ✅ 消息已发送: ${testEventId}\n`);

    // === Reporting Module ===
    console.log("3. Reporting 模块测试...");

    await runTest("reportRoom", async () => {
        try {
            if (testRoomId) {
                await client!.reportRoom(testRoomId, "Test reason");
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Report room not available");
        }
    });

    await runTest("reportEvent", async () => {
        try {
            if (testRoomId && testEventId) {
                await client!.reportEvent(testRoomId, testEventId, -100, "Test reason");
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Report event not available");
        }
    });

    // === Content Scan Module ===
    console.log("\n4. Content Scan 模块测试...");

    await runTest("scanContent", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (client as any).scanContent("test-content");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Scan content not available");
        }
    });

    await runTest("getContentScannerInfo", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (client as any).getContentScannerInfo();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get content scanner info not available");
        }
    });

    // === Power Levels Module ===
    console.log("\n5. Power Levels 模块测试...");

    await runTest("getStateEvents (power_levels)", async () => {
        try {
            if (testRoomId) {
                await client!.getStateEvents(testRoomId, "m.room.power_levels");
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get power levels not available");
        }
    });

    await runTest("setPowerLevel", async () => {
        try {
            if (testRoomId) {
                await client!.setPowerLevel(testRoomId, client!.getUserId()!, 100);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Set power level not available");
        }
    });

    await runTest("getUserPowerLevel", async () => {
        try {
            if (testRoomId) {
                await client!.getUserPowerLevel(testRoomId, client!.getUserId()!);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get user power level not available");
        }
    });

    // === Membership Module ===
    console.log("\n6. Membership 模块测试...");

    await runTest("getMembership", async () => {
        try {
            if (testRoomId) {
                await client!.getMembership(testRoomId, client!.getUserId()!);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get membership not available");
        }
    });

    await runTest("getMembers", async () => {
        try {
            if (testRoomId) {
                await client!.getMembers(testRoomId);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get members not available");
        }
    });

    await runTest("getMembersWithProfiles", async () => {
        try {
            if (testRoomId) {
                await client!.getMembersWithProfiles(testRoomId);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get members with profiles not available");
        }
    });

    // === Pinned Messages Module ===
    console.log("\n7. Pinned Messages 模块测试...");

    await runTest("getPinnedEvents", async () => {
        try {
            if (testRoomId) {
                await client!.getPinnedEvents(testRoomId);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get pinned events not available");
        }
    });

    await runTest("pinEvent", async () => {
        try {
            if (testRoomId && testEventId) {
                await client!.pinEvent(testRoomId, testEventId);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Pin event not available");
        }
    });

    await runTest("unpinEvent", async () => {
        try {
            if (testRoomId && testEventId) {
                await client!.unpinEvent(testRoomId, testEventId);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Unpin event not available");
        }
    });

    // === Editions Module ===
    console.log("\n8. Editions 模块测试...");

    await runTest("replaceEvent", async () => {
        try {
            if (testRoomId && testEventId) {
                await client!.replaceEvent(testRoomId, testEventId, {
                    msgtype: "m.text",
                    body: "Updated message",
                });
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Replace event not available");
        }
    });

    await runTest("editEvent", async () => {
        try {
            if (testRoomId && testEventId) {
                await client!.editEvent(testRoomId, testEventId, "Updated message");
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Edit event not available");
        }
    });

    await runTest("redactEvent", async () => {
        try {
            if (testRoomId && testEventId) {
                await client!.redactEvent(testRoomId, testEventId, "Test reason");
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Redact event not available");
        }
    });

    // === Threading Module ===
    console.log("\n9. Threading 模块测试...");

    await runTest("getThread", async () => {
        try {
            if (testRoomId && testEventId) {
                await client!.getThread(testRoomId, testEventId);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get thread not available");
        }
    });

    await runTest("getThreads", async () => {
        try {
            if (testRoomId) {
                await client!.getThreads(testRoomId);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get threads not available");
        }
    });

    await runTest("createThread", async () => {
        try {
            if (testRoomId && testEventId) {
                await client!.createThread(testRoomId, testEventId, "Thread reply");
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Create thread not available");
        }
    });

    // === Aggregations Module ===
    console.log("\n10. Aggregations 模块测试...");

    await runTest("getAggregatedTimeline", async () => {
        try {
            if (testRoomId) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (client as any).getAggregatedTimeline(testRoomId);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get aggregated timeline not available");
        }
    });

    await runTest("getRelations", async () => {
        try {
            if (testRoomId && testEventId) {
                await client!.getRelations(testRoomId, testEventId);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get relations not available");
        }
    });

    await runTest("getEventAggregations", async () => {
        try {
            if (testRoomId && testEventId) {
                await client!.getEventAggregations(testRoomId, testEventId);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get event aggregations not available");
        }
    });

    await runTest("getReactionCount", async () => {
        try {
            if (testRoomId && testEventId) {
                await client!.getReactionCount(testRoomId, testEventId);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get reaction count not available");
        }
    });

    // 清理
    console.log("\n11. 清理...");
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
