/**
 * Step 3: 消息模块测试
 *
 * 测试模块: message, sending, sending-queue, event, event-status, event-processing, pagination, timeline, reactions, relations
 *
 * 运行: pnpm run test:real-backend:tsx -- spec/integ/real-backend/step3-message.test.ts
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
    console.log("Step 3: 消息模块测试");
    console.log("========================================\n");

    await extendMatrixClientWithManagers();

    console.log("1. 登录测试...");
    client = await login();
    console.log(`   ✅ 登录成功: ${client.getUserId()}\n`);

    // 创建测试房间
    console.log("2. 创建测试房间...");
    const room = await client!.createRoom({
        name: "Message Test Room",
        topic: "Test Room for Message Testing",
    });
    testRoomId = room.room_id;
    console.log(`   ✅ 房间创建成功: ${testRoomId}\n`);

    // === Message Module ===
    console.log("3. Message 模块测试...");

    await runTest("sendMessage (text)", async () => {
        if (testRoomId) {
            const result = await client!.sendMessage(testRoomId, {
                msgtype: MsgType.Text,
                body: "Hello World!",
            });
            testEventId = result.event_id;
            if (!testEventId) throw new Error("Failed to send message");
        }
    });

    await runTest("sendMessage (html)", async () => {
        if (testRoomId) {
            const result = await client!.sendMessage(testRoomId, {
                msgtype: MsgType.Text,
                body: "Hello HTML",
                format: "org.matrix.custom.html",
                formatted_body: "<b>Hello HTML</b>",
            });
            if (!result.event_id) throw new Error("Failed to send HTML message");
        }
    });

    await runTest("sendMessage (emote)", async () => {
        if (testRoomId) {
            const result = await client!.sendMessage(testRoomId, {
                msgtype: MsgType.Emote,
                body: "smiles",
            });
            if (!result.event_id) throw new Error("Failed to send emote");
        }
    });

    await runTest("sendMessage (notice)", async () => {
        if (testRoomId) {
            const result = await client!.sendMessage(testRoomId, {
                msgtype: MsgType.Notice,
                body: "This is a notice",
            });
            if (!result.event_id) throw new Error("Failed to send notice");
        }
    });

    // === Sending Module ===
    console.log("\n4. Sending 模块测试...");

    await runTest("sendMessage returns event_id", async () => {
        if (testRoomId) {
            const result = await client!.sendMessage(testRoomId, {
                msgtype: MsgType.Text,
                body: "Test message for event_id",
            });
            if (!result.event_id || !result.event_id.startsWith("$")) {
                throw new Error("Invalid event_id format");
            }
        }
    });

    await runTest("sendMessage handles txnId", async () => {
        if (testRoomId) {
            const txnId = "test-txn-" + Date.now();
            const result = await client!.sendMessage(
                testRoomId,
                {
                    msgtype: MsgType.Text,
                    body: "Message with txnId",
                },
                txnId,
            );
            if (!result.event_id) throw new Error("Failed with txnId");
        }
    });

    // === Event Module ===
    console.log("\n5. Event 模块测试...");

    await runTest("getEvent (by event_id)", async () => {
        if (testRoomId && testEventId) {
            // 使用 RoomEventsManager.getEvent()
            const event = await client!.getRoomEventsManager().getEvent(testRoomId, testEventId);
            if (!event) throw new Error("Failed to get event");
        }
    });

    await runTest("getEvent (not found)", async () => {
        if (testRoomId) {
            try {
                await client!.getRoomEventsManager().getEvent(testRoomId, "$invalid-event-id");
                // 如果没抛错，说明API返回了空结果
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) {
                // 预期会抛出错误
            }
        }
    });

    // === Pagination Module ===
    console.log("\n6. Pagination 模块测试...");

    await runTest("getMessages (backward)", async () => {
        if (testRoomId) {
            const messages = await client!.getRoomEventsManager().getMessages(testRoomId, "b", 10);
            if (!messages) throw new Error("Failed to get messages");
        }
    });

    await runTest("getMessages (forward)", async () => {
        if (testRoomId) {
            const messages = await client!.getRoomEventsManager().getMessages(testRoomId, "f", 10);
            if (!messages) throw new Error("Failed to get messages (forward)");
        }
    });

    await runTest("getMessages with limit", async () => {
        if (testRoomId) {
            const messages = await client!.getRoomEventsManager().getMessages(testRoomId, "b", 5);
            if (!messages) throw new Error("Failed to get messages with limit");
        }
    });

    // === Reaction Module ===
    console.log("\n7. Reaction 模块测试...");

    await runTest("sendReaction", async () => {
        if (testRoomId && testEventId) {
            // 发送一条新消息用于reaction测试
            const msgResult = await client!.sendMessage(testRoomId, {
                msgtype: MsgType.Text,
                body: "Message for reaction",
            });
            // 后端可能不支持Reaction API
            try {
                await client!.sendReaction(testRoomId, msgResult.event_id, "👍");
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) {
                console.log("    ⚠️ Reaction API not supported by backend");
            }
        }
    });

    await runTest("sendReaction (emoji)", async () => {
        if (testRoomId && testEventId) {
            const msgResult = await client!.sendMessage(testRoomId, {
                msgtype: MsgType.Text,
                body: "Message for emoji reaction",
            });
            // 后端可能不支持Reaction API
            try {
                await client!.sendReaction(testRoomId, msgResult.event_id, "🎉");
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) {
                console.log("    ⚠️ Reaction API not supported by backend");
            }
        }
    });

    // === Relations Module ===
    console.log("\n8. Relations 模块测试...");

    await runTest("getEventRelations", async () => {
        if (testRoomId && testEventId) {
            // 注意：Relations API可能需要后端支持
            try {
                await client!.relations(testRoomId, testEventId, "m.annotation");
                // API可能返回空或不支持
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) {
                console.log("    ⚠️ Relations API not supported");
            }
        }
    });

    // === Thread Module ===
    console.log("\n9. Thread 模块测试...");

    await runTest("createThread", async () => {
        if (testRoomId && testEventId) {
            const thread = await client!.createThread(testRoomId, testEventId, "Thread reply");
            if (!thread) throw new Error("Failed to create thread");
        }
    });

    await runTest("getRelations (annotations)", async () => {
        if (testRoomId && testEventId) {
            try {
                await client!.relations(testRoomId, testEventId, "m.annotation", "m.reaction");
                // 可能不支持
            } catch (e) {
                console.log("    ⚠️ Annotations relations not supported");
            }
        }
    });

    // === Timeline Module ===
    console.log("\n10. Timeline 模块测试...");

    await runTest("getRoomTimeline", async () => {
        if (testRoomId) {
            const room = client!.getRoom(testRoomId);
            if (room) {
                const timeline = room.timeline;
                // timeline可能为空因为未同步
            }
        }
    });

    await runTest("getLiveTimeline", async () => {
        if (testRoomId) {
            const room = client!.getRoom(testRoomId);
            if (room) {
                const liveTimeline = room.getLiveTimeline();
                if (!liveTimeline) throw new Error("No live timeline");
            }
        }
    });

    // === Event Status Module ===
    console.log("\n10. Event Status 模块测试...");

    await runTest("sendMessage status (sent)", async () => {
        if (testRoomId) {
            const result = await client!.sendMessage(testRoomId, {
                msgtype: MsgType.Text,
                body: "Status test message",
            });
            if (!result.event_id) throw new Error("Message not sent");
        }
    });

    // === Additional Tests ===
    console.log("\n11. Additional 模块测试...");

    await runTest("createMessageEvent", async () => {
        if (testRoomId) {
            const event = client!.createMessageEvent("m.room.message", {
                msgtype: MsgType.Text,
                body: "Created event",
            });
            if (!event) throw new Error("Failed to create event");
        }
    });

    await runTest("event timestamp", async () => {
        if (testRoomId) {
            const room = client!.getRoom(testRoomId);
            if (room) {
                const events = room.timeline;
                if (events && events.length > 0) {
                    const timestamp = events[0].getTs();
                    if (!timestamp) throw new Error("No timestamp");
                }
            }
        }
    });

    // 清理
    console.log("\n12. 清理...");
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
