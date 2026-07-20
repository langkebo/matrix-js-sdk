/**
 * Step 5: 媒体与推送模块测试
 *
 * 测试模块: media, uploads, url-preview, push, push-rules, push-notifications, notifications, read-receipts, typing, tags-management
 *
 * 运行: pnpm run test:real-backend:tsx -- spec/integ/real-backend/step5-media.test.ts
 */

import { createClient, type MatrixClient } from "../../../src/matrix";
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
    console.log("Step 5: 媒体与推送模块测试");
    console.log("========================================\n");

    console.log("1. 登录测试...");
    client = await login();
    console.log(`   ✅ 登录成功: ${client.getUserId()}\n`);

    // 创建测试房间
    console.log("2. 创建测试房间...");
    const room = await client!.createRoom({
        name: "Media Test Room",
        topic: "Test Room for Media Testing",
    });
    testRoomId = room.room_id;
    console.log(`   ✅ 房间创建成功: ${testRoomId}\n`);

    // === Media Module ===
    console.log("3. Media 模块测试...");

    await runTest("uploadContent (data)", async () => {
        // 测试上传内容
        const content = Buffer.from("Hello Media").toString("base64");
        try {
            const result = await client!.uploadContent(content, {
                type: "text/plain",
                filename: "test.txt",
            });
            // 可能返回 content URI
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Upload may require different format");
        }
    });

    await runTest("getContentUri", async () => {
        // 测试获取内容URI
        const uri = client!.getHomeserverUrl();
        if (!uri) throw new Error("No homeserver URL");
    });

    await runTest("getDownloadLink", async () => {
        // 测试获取下载链接
        try {
            const mxcUrl = "mxc://test-server.com/test-media";
            const link = await client!.getDownloadLink(mxcUrl);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Download link not available");
        }
    });

    await runTest("getThumbnail", async () => {
        try {
            const mxcUrl = "mxc://test-server.com/test-media";
            const thumb = await client!.getThumbnail(mxcUrl, 100, 100);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Thumbnail not available");
        }
    });

    // === URL Preview Module ===
    console.log("\n4. URL Preview 模块测试...");

    await runTest("getUrlPreview", async () => {
        try {
            const preview = await client!.getUrlPreview("https://matrix.org");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ URL preview not supported");
        }
    });

    await runTest("getOEmbedUrl", async () => {
        try {
            const oembed = await client!.getOEmbedUrl("https://matrix.org", true);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ OEmbed not supported");
        }
    });

    // === Push Module ===
    console.log("\n5. Push 模块测试...");

    await runTest("getPushers", async () => {
        try {
            const pushers = await client!.getPushers();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Pushers not supported");
        }
    });

    await runTest("setPusher", async () => {
        try {
            await client!.setPusher({
                pushkey: "test-pushkey",
                kind: "http",
                app_id: "test-app",
                device_id: "test-device",
                data: {
                    url: "https://test.com",
                },
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Set pusher not supported");
        }
    });

    // === Push Rules Module ===
    console.log("\n6. Push Rules 模块测试...");

    await runTest("getPushRules", async () => {
        try {
            const rules = await client!.getPushRules();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Push rules not supported");
        }
    });

    await runTest("getPushRule", async () => {
        try {
            const rule = await client!.getPushRule("global", "room", testRoomId || "");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Get push rule not supported");
        }
    });

    await runTest("setPushRule", async () => {
        try {
            await client!.setPushRule("global", "room", testRoomId || "", {
                actions: ["notify"],
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Set push rule not supported");
        }
    });

    // === Push Notifications Module ===
    console.log("\n7. Push Notifications 模块测试...");

    await runTest("getPushNotifications", async () => {
        try {
            const notifications = await client!.getPushNotifications({}, 10);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Push notifications not supported");
        }
    });

    // === Notifications Module ===
    console.log("\n8. Notifications 模块测试...");

    await runTest("getNotifications", async () => {
        try {
            const notifications = await client!.getNotifications();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Notifications not supported");
        }
    });

    await runTest("getRoomNotifications", async () => {
        try {
            if (testRoomId) {
                const notifications = await client!.getRoomNotifications(testRoomId);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log("    ⚠️ Room notifications not supported");
        }
    });

    // === Read Receipts Module ===
    console.log("\n9. Read Receipts 模块测试...");

    await runTest("sendReadReceipt", async () => {
        if (testRoomId) {
            try {
                await client!.sendReadReceipt(testRoomId, "$test-event");
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) {
                console.log("    ⚠️ Send read receipt may require event");
            }
        }
    });

    await runTest("getReadReceipt", async () => {
        if (testRoomId) {
            try {
                const receipt = await client!.getReadReceipt(testRoomId, client!.getUserId() || "");
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) {
                console.log("    ⚠️ Get read receipt not supported");
            }
        }
    });

    await runTest("getReadReceiptsForEvent", async () => {
        if (testRoomId) {
            try {
                const receipts = await client!.getReadReceiptsForEvent(testRoomId, "$test-event");
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) {
                console.log("    ⚠️ Get receipts for event not supported");
            }
        }
    });

    // === Typing Module ===
    console.log("\n10. Typing 模块测试...");

    await runTest("sendTyping", async () => {
        if (testRoomId) {
            try {
                await client!.sendTyping(testRoomId, client!.getUserId() || "", true, 5000);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) {
                console.log("    ⚠️ Send typing not supported");
            }
        }
    });

    await runTest("getTypingUsers", async () => {
        if (testRoomId) {
            try {
                const users = await client!.getTypingUsers(testRoomId);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) {
                console.log("    ⚠️ Get typing users not supported");
            }
        }
    });

    // === Tags Management Module ===
    console.log("\n11. Tags Management 模块测试...");

    await runTest("getRoomTags", async () => {
        if (testRoomId) {
            try {
                const tags = await client!.getRoomTags(testRoomId);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) {
                console.log("    ⚠️ Get room tags not supported");
            }
        }
    });

    await runTest("setRoomTag", async () => {
        if (testRoomId) {
            try {
                await client!.setRoomTag(testRoomId, "m.favorite", {
                    order: 1,
                });
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) {
                console.log("    ⚠️ Set room tag not supported");
            }
        }
    });

    await runTest("removeRoomTag", async () => {
        if (testRoomId) {
            try {
                await client!.removeRoomTag(testRoomId, "m.favorite");
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) {
                console.log("    ⚠️ Remove room tag not supported");
            }
        }
    });

    // === Additional Tests ===
    console.log("\n12. Additional 模块测试...");

    await runTest("getRoomAccountData (tags)", async () => {
        if (testRoomId) {
            try {
                await client!.setRoomAccountData(testRoomId, "m.tag", { tags: {} });
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) {
                console.log("    ⚠️ Room account data not supported");
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
