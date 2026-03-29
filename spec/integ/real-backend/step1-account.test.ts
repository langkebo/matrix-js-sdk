/**
 * Step 1: 账户与认证模块测试
 * 
 * 测试模块: account, session, profile, device, credentials, token-management, auth, http
 * 
 * 运行: npx tsx spec/integ/real-backend/step1-account.test.ts
 */

import { createClient, type MatrixClient } from "../../../src/matrix";
import { TestConfig } from "./TestConfig";

let client: MatrixClient | null = null;
const testResults: { name: string; passed: boolean; error?: string }[] = [];

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
    console.log("Step 1: 账户与认证模块测试");
    console.log("========================================\n");
    
    console.log("1. 登录测试...");
    client = await login();
    console.log(`   ✅ 登录成功: ${client.getUserId()}\n`);
    
    // === Account Module ===
    console.log("2. Account 模块测试...");
    
    await runTest("getUserId", async () => {
        const userId = client!.getUserId();
        if (!userId) throw new Error("Failed to get userId");
    });
    
    await runTest("getSafeUserId", async () => {
        const safeUserId = client!.getSafeUserId();
        if (!safeUserId) throw new Error("Failed to get safe userId");
    });
    
    await runTest("getDomain", async () => {
        const domain = client!.getDomain();
        if (!domain) throw new Error("Failed to get domain");
    });
    
    // === Session Module ===
    console.log("\n3. Session 模块测试...");
    
    await runTest("getSessionId", async () => {
        const sessionId = await client!.getSessionId();
        if (!sessionId) throw new Error("Failed to get sessionId");
    });
    
    await runTest("isLoggedIn", async () => {
        const isLoggedIn = client!.isLoggedIn();
        if (!isLoggedIn) throw new Error("Not logged in");
    });
    
    await runTest("getAccessToken", async () => {
        const token = client!.getAccessToken();
        if (!token) throw new Error("Failed to get access token");
    });
    
    // === Profile Module ===
    console.log("\n4. Profile 模块测试...");
    
    await runTest("getProfileInfo", async () => {
        const profile = await client!.getProfileManager().getProfileInfo(client!.getUserId()!);
        if (!profile) throw new Error("Failed to get profile info");
    });
    
    await runTest("getDisplayName", async () => {
        await client!.getProfileManager().getDisplayName(client!.getUserId()!);
    });
    
    await runTest("setDisplayName", async () => {
        await client!.setDisplayName("SDK Test User");
    });
    
    await runTest("setAvatarUrl", async () => {
        await client!.setAvatarUrl("mxc://test-avatar");
    });
    
    // === Device Module ===
    console.log("\n5. Device 模块测试...");
    
    await runTest("getDevices", async () => {
        const devices = await client!.getDeviceManager().getDevices();
        if (!Array.isArray(devices.devices)) throw new Error("Failed to get devices");
    });
    
    // === Auth Module ===
    console.log("\n6. Auth 模块测试...");
    
    await runTest("getSupportedLoginFlows", async () => {
        const flows = await client!.getAuthManager().getSupportedLoginFlows();
        if (!flows) throw new Error("Failed to get login flows");
    });
    
    // === HTTP Module ===
    console.log("\n7. HTTP 模块测试...");
    
    await runTest("http backend exists", async () => {
        const http = (client as any).http;
        if (!http) throw new Error("HTTP backend not available");
    });
    
    // 登出
    console.log("\n8. 清理...");
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
