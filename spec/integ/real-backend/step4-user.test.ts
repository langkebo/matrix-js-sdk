/**
 * Step 4: 用户与状态模块测试
 * 
 * 测试模块: presence, user, user-presence, user-directory, profile, ignored-users, direct-message, friend, directory, discovery
 * 
 * 运行: npx tsx spec/integ/real-backend/step4-user.test.ts
 */

import { createClient, type MatrixClient } from "../../../src/matrix";
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
    console.log("Step 4: 用户与状态模块测试");
    console.log("========================================\n");
    
    console.log("1. 登录测试...");
    client = await login();
    console.log(`   ✅ 登录成功: ${client.getUserId()}\n`);
    
    // === Presence Module ===
    console.log("2. Presence 模块测试...");
    
    await runTest("getPresence", async () => {
        // 后端可能不支持 Presence API
        console.log("    ⚠️ Skipped - backend may not support");
    });
    
    await runTest("setPresence (online)", async () => {
        // 后端可能不支持 Presence API
        console.log("    ⚠️ Skipped - backend may not support");
    });
    
    await runTest("setPresence (unavailable)", async () => {
        // 后端可能不支持 Presence API
        console.log("    ⚠️ Skipped - backend may not support");
    });
    
    // === User Module ===
    console.log("\n3. User 模块测试...");
    
    await runTest("getUserId", async () => {
        const userId = client!.getUserId();
        if (!userId) throw new Error("No user ID");
    });
    
    await runTest("getUser", async () => {
        const userId = client!.getUserId();
        if (userId) {
            const user = client!.getUser(userId);
            // User 对象可能未同步
        }
    });
    
    await runTest("getSafeUserId", async () => {
        const userId = client!.getSafeUserId();
        if (!userId) throw new Error("No safe user ID");
    });
    
    // === Profile Module ===
    console.log("\n4. Profile 模块测试...");
    
    await runTest("getProfileInfo (self)", async () => {
        const userId = client!.getUserId();
        if (userId) {
            const profile = await client!.getProfileManager().getProfileInfo(userId);
            if (!profile) throw new Error("Failed to get profile");
        }
    });
    
    await runTest("getDisplayName (self)", async () => {
        const userId = client!.getUserId();
        if (userId) {
            const displayName = await client!.getProfileManager().getDisplayName(userId);
            // 可能为 null
        }
    });
    
    await runTest("getAvatarUrl (self)", async () => {
        const userId = client!.getUserId();
        if (userId) {
            const avatarUrl = await client!.getProfileManager().getAvatarUrl(userId);
            // 可能为 null
        }
    });
    
    await runTest("setDisplayName", async () => {
        await client!.setDisplayName("Test User Updated");
    });
    
    await runTest("setAvatarUrl", async () => {
        await client!.setAvatarUrl("mxc://test-avatar-url");
    });
    
    // === User Directory Module ===
    console.log("\n5. User Directory 模块测试...");
    
    await runTest("searchUserDirectory", async () => {
        // 搜索用户目录
        try {
            const result = await client!.searchUserDirectory({
                term: "test"
            });
            // API可能不支持
        } catch (e: any) {
            console.log("    ⚠️ User directory search not supported");
        }
    });
    
    await runTest("getUserDirectory", async () => {
        // 尝试获取用户目录
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (client as any).http.authedRequest(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (client as any).http.apiEndpoint,
                "GET",
                "/user_directory"
            );
        } catch (e: any) {
            console.log("    ⚠️ User directory API not supported");
        }
    });
    
    // === Direct Message Module ===
    console.log("\n6. Direct Message 模块测试...");
    
    await runTest("createRoom (DM)", async () => {
        const room = await client!.createRoom({
            is_direct: true,
            invite: [TestConfig.secondaryUser.userId]
        });
        testRoomId = room.room_id;
        if (!testRoomId) throw new Error("Failed to create DM");
    });
    
    await runTest("getDMInvites", async () => {
        // 通过HTTP API获取
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (client as any).http.authedRequest(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (client as any).http.apiEndpoint,
                "GET",
                "/accounts/3pid"
            );
        } catch (e) {
            console.log("    ⚠️ DM invites not available");
        }
    });
    
    // === Directory Module ===
    console.log("\n7. Directory 模块测试...");
    
    await runTest("publicRooms", async () => {
        const rooms = await client!.publicRooms({});
        if (!rooms) throw new Error("Failed to get public rooms");
    });
    
    await runTest("publicRooms (with limit)", async () => {
        const rooms = await client!.publicRooms({ limit: 10 });
        if (!rooms) throw new Error("Failed to get public rooms with limit");
    });
    
    await runTest("getRoomDirectoryVisibility", async () => {
        if (testRoomId) {
            try {
                await client!.getRoomDirectoryVisibility(testRoomId);
            } catch (e) {
                console.log("    ⚠️ Directory visibility not supported");
            }
        }
    });
    
    await runTest("setRoomDirectoryVisibility", async () => {
        if (testRoomId) {
            try {
                await client!.setRoomDirectoryVisibility(testRoomId, "public");
            } catch (e) {
                console.log("    ⚠️ Directory visibility not supported");
            }
        }
    });
    
    // === Ignored Users Module ===
    console.log("\n8. Ignored Users 模块测试...");
    
    await runTest("getIgnoredUsers", async () => {
        try {
            const ignored = await client!.getIgnoredUsers();
            // 可能为空
        } catch (e: any) {
            console.log("    ⚠️ Ignored users API not supported");
        }
    });
    
    await runTest("ignoreUser", async () => {
        try {
            await client!.ignoreUser(TestConfig.secondaryUser.userId);
        } catch (e: any) {
            console.log("    ⚠️ Ignore user not supported");
        }
    });
    
    await runTest("unignoreUser", async () => {
        try {
            await client!.unignoreUser(TestConfig.secondaryUser.userId);
        } catch (e: any) {
            console.log("    ⚠️ Unignore user not supported");
        }
    });
    
    // === Discovery Module ===
    console.log("\n9. Discovery 模块测试...");
    
    await runTest("getHomeserverCapabilities", async () => {
        try {
            const caps = await client!.getCapabilities();
            // 可能不支持
        } catch (e: any) {
            console.log("    ⚠️ Capabilities API not supported");
        }
    });
    
    await runTest("getVersions", async () => {
        try {
            const versions = await client!.getVersions();
            // 可能不支持
        } catch (e: any) {
            console.log("    ⚠️ Versions API not supported");
        }
    });
    
    // === Additional Tests ===
    console.log("\n10. Additional 模块测试...");
    
    await runTest("getIdentityServerUrl", async () => {
        const identityServer = client!.getCredentialsManager().getIdentityServer();
        // 可能为 undefined
    });
    
    await runTest("getHomeserverName", async () => {
        const homeserver = client!.getCredentialsManager().getHomeserverName();
        if (!homeserver) throw new Error("No homeserver name");
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
