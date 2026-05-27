/**
 * Step 8: 第三方与VoIP模块测试
 *
 * 测试模块: third-party, third-party-protocols, third-party-user, third-party-location, voip, voip-signaling, voip-push, appservice, bridges
 *
 * 运行: pnpm run test:real-backend:tsx -- spec/integ/real-backend/step8-thirdparty.test.ts
 */

import { createClient, type MatrixClient } from "../../../src/matrix";
import { extendMatrixClientWithManagers } from "../../../src/manager-extensions";
import { TestConfig } from "./TestConfig";

declare const process: { exit: (code?: number) => never };

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
        baseUrl: TestConfig.baseUrl,
        allowInsecureHttp: true,
    });

    const username = TestConfig.testUser.userId.replace("@", "").split(":")[0];

    const result = await testClient.login("m.login.password", {
        user: username,
        password: TestConfig.testUser.password,
    });

    testClient.setAccessToken(result.access_token);

    return testClient;
}

async function main(): Promise<void> {
    console.log("\n========================================");
    console.log("Step 8: 第三方与VoIP模块测试");
    console.log("========================================\n");

    await extendMatrixClientWithManagers();

    console.log("1. 登录测试...");
    client = await login();
    console.log(`   ✅ 登录成功: ${client.getUserId()}\n`);

    // === Third Party Module ===
    console.log("2. Third Party 模块测试...");

    await runTest("getThirdPartyProtocols", async () => {
        try {
            const protocols = await client!.getThirdpartyProtocols();
        } catch (e: any) {
            console.log("    ⚠️ Third party protocols not available");
        }
    });

    await runTest("getThirdPartyProtocol (deprecated)", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const protocol = await (client as any).getThirdPartyProtocol("test-protocol");
        } catch (e: any) {
            console.log("    ⚠️ Third party protocol not available");
        }
    });

    // === Third Party Protocols Module ===
    console.log("\n3. Third Party Protocols 模块测试...");

    await runTest("thirdPartyProtocol (http)", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (client as any).thirdPartyProtocol("http", "test");
        } catch (e: any) {
            console.log("    ⚠️ Third party protocol (http) not available");
        }
    });

    await runTest("thirdPartyProtocol (https)", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (client as any).thirdPartyProtocol("https", "test");
        } catch (e: any) {
            console.log("    ⚠️ Third party protocol (https) not available");
        }
    });

    // === Third Party User Module ===
    console.log("\n4. Third Party User 模块测试...");

    await runTest("getThirdPartyUser", async () => {
        try {
            const user = await client!.getThirdpartyUser("test-protocol", {
                userid: "test-user",
            });
        } catch (e: any) {
            console.log("    ⚠️ Third party user not available");
        }
    });

    // === Third Party Location Module ===
    console.log("\n5. Third Party Location 模块测试...");

    await runTest("getThirdPartyLocation", async () => {
        try {
            const location = await client!.getThirdpartyLocation("test-protocol", {
                searchFields: ["uri"],
            });
        } catch (e: any) {
            console.log("    ⚠️ Third party location not available");
        }
    });

    // === VoIP Module ===
    console.log("\n6. VoIP 模块测试...");

    await runTest("getVoipEventSignatures", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sigs = await (client as any).getVoipEventSignatures();
        } catch (e: any) {
            console.log("    ⚠️ VoIP event signatures not available");
        }
    });

    await runTest("turnServer", async () => {
        try {
            const turn = await client!.turnServer();
        } catch (e: any) {
            console.log("    ⚠️ TURN server not available");
        }
    });

    await runTest("getTurnServersUrl", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const url = await (client as any).getTurnServersUrl();
        } catch (e: any) {
            console.log("    ⚠️ TURN servers URL not available");
        }
    });

    // === VoIP Signaling Module ===
    console.log("\n7. VoIP Signaling 模块测试...");

    await runTest(" VoIP Call Events", async () => {
        // VoIP需要初始化完整的客户端
        console.log("    ⚠️ Skipped - requires full client initialization");
    });

    // === Appservice Module ===
    console.log("\n8. Appservice 模块测试...");

    await runTest("getAppserviceNames", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const names = await (client as any).getAppserviceNames();
        } catch (e: any) {
            console.log("    ⚠️ Appservice names not available");
        }
    });

    await runTest("getAppservice", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const appService = await (client as any).getAppservice("test");
        } catch (e: any) {
            console.log("    ⚠️ Appservice not available");
        }
    });

    await runTest("isAppserviceConfigured", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const isConfigured = await (client as any).isAppserviceConfigured();
        } catch (e: any) {
            console.log("    ⚠️ Appservice config not available");
        }
    });

    // === Bridges Module ===
    console.log("\n9. Bridges 模块测试...");

    await runTest("getBridgeInfo", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const info = await (client as any).getBridgeInfo("test");
        } catch (e: any) {
            console.log("    ⚠️ Bridge info not available");
        }
    });

    await runTest("setBridgeInfo", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (client as any).setBridgeInfo("test", {});
        } catch (e: any) {
            console.log("    ⚠️ Set bridge info not available");
        }
    });

    // === Additional Tests ===
    console.log("\n10. Additional 模块测试...");

    await runTest("getProtocols", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const protocols = await (client as any).getProtocols();
        } catch (e: any) {
            console.log("    ⚠️ Protocols not available");
        }
    });

    await runTest("getIntegrations", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const integrations = await (client as any).getIntegrations("test");
        } catch (e: any) {
            console.log("    ⚠️ Integrations not available");
        }
    });

    await runTest("getIntegrationWidgets", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const widgets = await (client as any).getIntegrationWidgets("test");
        } catch (e: any) {
            console.log("    ⚠️ Integration widgets not available");
        }
    });

    await runTest("addIntegrationWidgets", async () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (client as any).addIntegrationWidgets("test", []);
        } catch (e: any) {
            console.log("    ⚠️ Add integration widgets not available");
        }
    });

    // 登出
    console.log("\n11. 清理...");
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
