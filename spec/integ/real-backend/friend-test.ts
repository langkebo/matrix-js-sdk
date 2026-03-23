/**
 * 好友模块真实服务器测试
 * 运行: npx tsx spec/integ/real-backend/friend-test.ts
 */

import { createClient, type MatrixClient } from "../../../src/matrix";
import { TestConfig } from "./TestConfig";

let client: MatrixClient | null = null;
let testResults: { name: string; passed: boolean; error?: string }[] = [];

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

async function login(user: { userId: string, password: string }): Promise<MatrixClient> {
    const testClient = createClient({ baseUrl: TestConfig.baseUrl });
    const username = user.userId.replace("@", "").split(":")[0];
    const result = await testClient.login("m.login.password", {
        user: username,
        password: user.password
    });
    testClient.setAccessToken(result.access_token);
    return testClient;
}

async function main(): Promise<void> {
    console.log("\n========================================");
    console.log("好友模块真实服务器测试 (集成到 MatrixClient)");
    console.log("========================================\n");
    
    // 登录主账号
    console.log("1. 登录测试用户...");
    client = await login(TestConfig.testUser);
    console.log(`   ✅ 登录成功: ${client.getUserId()}\n`);
    
    // 使用 MatrixClient.getFriendManager() 获取好友管理器
    console.log("2. 获取好友管理器...");
    const friendManager = client.getFriendManager();
    await friendManager.start();
    console.log("   ✅ 好友管理器已获取并启动\n");
    
    // 测试好友功能
    console.log("3. 好友功能测试...\n");
    
    // 3.1 获取好友列表
    await runTest("getFriends - 获取好友列表", async () => {
        const friends = await friendManager.getFriends();
        console.log(`      当前好友数: ${friends.length}`);
    });
    
    // 3.2 获取收到的请求
    await runTest("getIncomingRequests - 获取收到的好友请求", async () => {
        const requests = await friendManager.getIncomingRequests();
        console.log(`      收到请求数: ${requests.length}`);
    });
    
    // 3.3 获取发出的请求
    await runTest("getOutgoingRequests - 获取发出的好友请求", async () => {
        const requests = await friendManager.getOutgoingRequests();
        console.log(`      发出请求数: ${requests.length}`);
    });
    
    // 3.4 获取好友分组
    await runTest("getFriendGroups - 获取好友分组", async () => {
        const groups = await friendManager.getFriendGroups();
        console.log(`      分组数: ${Object.keys(groups).length}`);
    });
    
    // 3.5 缓存好友列表
    await runTest("getCachedFriends - 获取缓存的好友", async () => {
        const cached = friendManager.getCachedFriends();
        console.log(`      缓存好友数: ${cached.length}`);
    });
    
    // 3.6 获取好友数量
    await runTest("getFriendCount - 获取好友数量", async () => {
        const count = friendManager.getFriendCount();
        console.log(`      好友数量: ${count}`);
    });
    
    // 3.7 检查是否是好友
    await runTest("isFriend - 检查是否是好友", async () => {
        const isFriend = await friendManager.isFriend(TestConfig.secondaryUser.userId);
        console.log(`      是否是好友: ${isFriend}`);
    });
    
    // 3.8 同步好友列表
    await runTest("sync - 同步好友列表", async () => {
        await friendManager.sync();
    });
    
    // 3.9 发送好友请求
    await runTest("sendFriendRequest - 发送好友请求", async () => {
        try {
            await friendManager.sendFriendRequest(TestConfig.secondaryUser.userId, "测试好友请求");
            console.log("      已发送好友请求");
        } catch (e: any) {
            if (e.message?.includes("already")) {
                console.log("      ⚠️ 好友请求已存在");
            } else {
                throw e;
            }
        }
    });
    
    // 3.10 获取好友信息
    await runTest("getFriendInfo - 获取好友信息", async () => {
        const friendInfo = await friendManager.getFriendInfo(TestConfig.secondaryUser.userId);
        console.log(`      好友信息: ${JSON.stringify(friendInfo)}`);
    });
    
    // 3.11 添加好友
    await runTest("addFriend - 添加好友", async () => {
        try {
            await friendManager.addFriend(TestConfig.secondaryUser.userId, "测试添加好友");
            console.log("      已发送添加好友请求");
        } catch (e: any) {
            if (e.message?.includes("already")) {
                console.log("      ⚠️ 好友请求已存在");
            } else {
                throw e;
            }
        }
    });
    
    // 清理
    console.log("\n4. 清理...");
    friendManager.stop();
    try {
        await client.logout();
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
