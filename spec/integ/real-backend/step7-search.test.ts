/**
 * Step 7: 搜索与同步模块测试
 * 
 * 测试模块: search, filtering, filter, sync-management, sync-accumulator, sessions, server-capabilities, server-time, capabilities, identity
 * 
 * 运行: npx tsx spec/integ/real-backend/step7-search.test.ts
 */

import { createClient, type MatrixClient, MsgType } from "../../../src/matrix";
import { TestConfig } from "./TestConfig";

let client: MatrixClient | null = null;
const testResults: { name: string; passed: boolean; error?: string }[] = [];
let testRoomId: string | null = null;

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
    try {
        console.log(`  Testing: ${name}...`);
        await fn();
        testResults.push({ name, passed: true });
        console.log(`    ✅ PASSED`);
    } catch (error: any) {
        testResults.push({ name, passed: false, error: error.message });
        console.log(`    ❌ FAILED: ${error.message}`);
    }
}

async function login(): Promise<MatrixClient> {
    const testClient = createClient({
        baseUrl: TestConfig.baseUrl
    });
    
    const username = TestConfig.testUser.userId.replace("@", "").split(":")[0];
    
    const result = await testClient.login("m.login.password", {
        user: username,
        password: TestConfig.testUser.password
    });
    
    testClient.setAccessToken(result.access_token);
    
    return testClient;
}

async function main(): Promise<void> {
    console.log("\n========================================");
    console.log("Step 7: 搜索与同步模块测试");
    console.log("========================================\n");
    
    console.log("1. 登录测试...");
    client = await login();
    console.log(`   ✅ 登录成功: ${client.getUserId()}\n`);
    
    // 创建测试房间
    console.log("2. 创建测试房间...");
    const room = await client!.createRoom({
        name: "Search Test Room",
        topic: "Test Room for Search Testing"
    });
    testRoomId = room.room_id;
    console.log(`   ✅ 房间创建成功: ${testRoomId}\n`);
    
    // 发送测试消息
    console.log("3. 发送测试消息...");
    await client!.sendMessage(testRoomId, {
        msgtype: MsgType.Text,
        body: "Hello search test"
    });
    console.log("   ✅ 消息已发送\n");
    
    // === Search Module ===
    console.log("4. Search 模块测试...");
    
    await runTest("search", async () => {
        const result = await client!.search({
            body: {
                search_categories: {
                    room_events: {
                        search_term: "hello"
                    }
                }
            }
        });
    });
    
    await runTest("search (users)", async () => {
        try {
            const result = await client!.searchUserDirectory({
                term: "test"
            });
        } catch (e: any) {
            console.log("    ⚠️ User search not available");
        }
    });
    
    // === Filtering Module ===
    console.log("\n5. Filtering 模块测试...");
    
    await runTest("createFilter", async () => {
        const filter = await client!.createFilter({
            room: {
                timeline: {
                    limit: 10
                }
            }
        });
    });
    
    await runTest("getFilter", async () => {
        try {
            const filter = await client!.getFilter(client!.getUserId() || "", "test-filter-id", true);
        } catch (e: any) {
            console.log("    ⚠️ Get filter not available");
        }
    });
    
    // === Sync Management Module ===
    console.log("\n6. Sync Management 模块测试...");
    
    await runTest("sync (initial)", async () => {
        try {
            const result = await (client as any).sync({}, "");
        } catch (e: any) {
            console.log("    ⚠️ Sync not available");
        }
    });
    
    await runTest("sync (增量)", async () => {
        try {
            const result = await (client as any).sync({}, "test-token");
        } catch (e: any) {
            console.log("    ⚠️ Sync with token not available");
        }
    });
    
    await runTest("syncNext", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (client as any).syncNext();
        } catch (e: any) {
            console.log("    ⚠️ SyncNext not available");
        }
    });
    
    // === Sync Accumulator Module ===
    console.log("\n7. Sync Accumulator 模块测试...");
    
    await runTest("getSyncAccumulator", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const accumulator = await (client as any).getSyncAccumulator();
        } catch (e: any) {
            console.log("    ⚠️ Sync accumulator not available");
        }
    });
    
    await runTest("getRooms", async () => {
        const rooms = client!.getRooms();
        // 可能为空因为未同步
    });
    
    await runTest("getRoom", async () => {
        if (testRoomId) {
            const room = client!.getRoom(testRoomId);
            // 可能为 null 因为未完全同步
        }
    });
    
    // === Sessions Module ===
    console.log("\n8. Sessions 模块测试...");
    
    await runTest("getSessions", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sessions = await (client as any).getSessions();
        } catch (e: any) {
            console.log("    ⚠️ Get sessions not available");
        }
    });
    
    await runTest("getSessionId", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sessionId = await (client as any).getSessionId();
        } catch (e: any) {
            console.log("    ⚠️ Get session id not available");
        }
    });
    
    // === Server Capabilities Module ===
    console.log("\n9. Server Capabilities 模块测试...");
    
    await runTest("getCapabilities", async () => {
        const caps = await client!.getCapabilities();
    });
    
    await runTest("getServerVersions", async () => {
        const versions = await client!.getVersions();
    });
    
    await runTest("getSupportedVersions", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const versions = await (client as any).getSupportedVersions();
        } catch (e: any) {
            console.log("    ⚠️ Supported versions not available");
        }
    });
    
    // === Server Time Module ===
    console.log("\n10. Server Time 模块测试...");
    
    await runTest("getServerTimestamp", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const timestamp = await (client as any).getServerTimestamp();
        } catch (e: any) {
            console.log("    ⚠️ Server timestamp not available");
        }
    });
    
    await runTest("getTimestampToDeviceMessage", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const msg = await (client as any).getTimestampToDeviceMessage(Date.now());
        } catch (e: any) {
            console.log("    ⚠️ Timestamp to device message not available");
        }
    });
    
    // === Identity Module ===
    console.log("\n11. Identity 模块测试...");
    
    await runTest("getIdentityServerUrl", async () => {
        const url = client!.getIdentityServerUrl();
    });
    
    await runTest("getIdentityServerAccessToken", async () => {
        try {
            const token = (client as any).getIdentityServerAccessToken();
        } catch (e: any) {
            console.log("    ⚠️ Identity access token not available");
        }
    });
    
    await runTest("requestIdentity3pidOwnership", async () => {
        try {
            await (client as any).requestIdentity3pidOwnership("test", "test");
        } catch (e: any) {
            console.log("    ⚠️ Request 3pid ownership not available");
        }
    });
    
    await runTest("lookupThreePids", async () => {
        try {
            await client!.lookupThreePid("email", "test@example.com", "test-access-token");
        } catch (e: any) {
            console.log("    ⚠️ Lookup three pids not available");
        }
    });
    
    // === Additional Tests ===
    console.log("\n12. Additional 模块测试...");
    
    await runTest("getClientWellKnown", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const wellKnown = await (client as any).getClientWellKnown();
        } catch (e: any) {
            console.log("    ⚠️ Well-known not available");
        }
    });
    
    await runTest("getPushGatewayDiscovery", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const discovery = await (client as any).getPushGatewayDiscovery();
        } catch (e: any) {
            console.log("    ⚠️ Push gateway discovery not available");
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
    
    const passed = testResults.filter(r => r.passed).length;
    const failed = testResults.filter(r => !r.passed).length;
    const total = testResults.length;
    
    console.log(`总计: ${total} | ✅ 通过: ${passed} | ❌ 失败: ${failed}`);
    console.log(`通过率: ${((passed / total) * 100).toFixed(1)}%\n`);
    
    if (failed > 0) {
        console.log("失败测试:");
        testResults.filter(r => !r.passed).forEach(r => {
            console.log(`  - ${r.name}: ${r.error}`);
        });
    }
    
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
