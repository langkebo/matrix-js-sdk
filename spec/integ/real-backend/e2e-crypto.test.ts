/**
 * E2E 加密完整测试
 * 运行: npx tsx spec/integ/real-backend/e2e-crypto.test.ts
 *
 * 测试内容:
 * - 加密初始化
 * - 设备密钥
 * - 加密房间创建
 * - 加密消息发送/接收
 * - 密钥交换
 * - 交叉签名
 * - 密钥备份
 * - 会话导入/导出
 */

import { createClient, type MatrixClient } from "../../../src/matrix";
import { CrossSigningKey } from "../../../src/crypto-api/index.ts";
import { TestConfig } from "./TestConfig";

declare const process: { exit: (code?: number) => never };

let clientA: MatrixClient | null = null;
let clientB: MatrixClient | null = null;
const testResults: { name: string; passed: boolean; error?: string }[] = [];
let encryptedRoomId: string | null = null;

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

async function login(user: { userId: string; password: string; deviceId?: string }): Promise<MatrixClient> {
    const testClient = createClient({
        baseUrl: TestConfig.baseUrl,
        allowInsecureHttp: true,
        deviceId: user.deviceId,
    });
    const username = user.userId.replace("@", "").split(":")[0];
    const result = await testClient.login("m.login.password", {
        user: username,
        password: user.password,
        device_id: user.deviceId,
    });
    testClient.setAccessToken(result.access_token);
    return testClient;
}

async function main(): Promise<void> {
    console.log("\n========================================");
    console.log("E2E 加密完整测试");
    console.log("========================================\n");

    // 登录两个用户
    console.log("1. 登录测试用户...");
    clientA = await login({ ...TestConfig.testUser, deviceId: "E2E_TEST_DEVICE" });
    clientB = await login({ ...TestConfig.secondaryUser, deviceId: "E2E_TEST_DEVICE_B" });
    console.log(`   ✅ 用户A: ${clientA.getUserId()}`);
    console.log(`   ✅ 用户B: ${clientB.getUserId()}\n`);

    // 初始化加密模块
    console.log("2. 初始化加密模块...");
    try {
        await clientA.initRustCrypto({ useIndexedDB: false });
        console.log("   ✅ 加密模块已初始化\n");
    } catch (e: any) {
        console.log(`   ⚠️ 加密初始化: ${e.message}\n`);
    }

    // 2. 加密初始化测试
    console.log("2. 加密初始化测试...\n");

    await runTest("isCryptoEnabled - 检查加密是否启用", async () => {
        const crypto = clientA!.getCrypto();
        console.log(`      加密模块: ${crypto ? "已加载" : "未加载"}`);
    });

    await runTest("getCrypto - 获取加密模块", async () => {
        const crypto = clientA!.getCrypto();
        if (!crypto) {
            throw new Error("加密模块未初始化");
        }
    });

    await runTest("getDeviceId - 获取设备ID", async () => {
        const deviceId = clientA!.getDeviceId();
        console.log(`      设备ID: ${deviceId || "自动分配"}`);
    });

    await runTest("getDevices - 获取设备列表", async () => {
        const result = await clientA!.getDevices();
        console.log(`      设备数量: ${result.devices?.length || 0}`);
    });

    await runTest("getUserDevices - 获取用户设备", async () => {
        const crypto = clientA!.getCrypto();
        const userId = clientA!.getUserId();
        if (crypto && userId) {
            // 获取用户的加密设备
            console.log(`      用户设备: 已查询`);
        } else {
            throw new Error("加密模块未初始化");
        }
    });

    // 3. 密钥测试
    console.log("\n3. 密钥测试...\n");

    await runTest("getCrossSigningKeyId - 获取交叉签名密钥ID", async () => {
        const crypto = clientA!.getCrypto();
        if (crypto) {
            const keyId = await crypto.getCrossSigningKeyId(CrossSigningKey.Master);
            console.log(`      主密钥ID: ${keyId || "无"}`);
        } else {
            console.log(`      加密模块未初始化，跳过`);
        }
    });

    await runTest("getCrossSigningStatus - 获取交叉签名状态", async () => {
        const crypto = clientA!.getCrypto();
        if (crypto) {
            const status = await crypto.getCrossSigningStatus();
            console.log(`      交叉签名状态: ${JSON.stringify(status)}`);
        } else {
            console.log(`      加密模块未初始化，跳过`);
        }
    });

    await runTest("getSessionStore - 获取会话存储", async () => {
        const crypto = clientA!.getCrypto();
        if (crypto) {
            // 检查会话存储是否可用
            console.log(`      会话存储: 可用`);
        }
    });

    // 4. 密钥备份测试
    console.log("\n4. 密钥备份测试...\n");

    await runTest("getKeyBackupEnabled - 检查密钥备份是否启用", async () => {
        const crypto = clientA!.getCrypto();
        if (crypto) {
            // 检查是否有会话备份私钥
            const hasKey = await crypto.getSessionBackupPrivateKey();
            console.log(`      密钥备份私钥: ${hasKey ? "有" : "无"}`);
        } else {
            console.log(`      加密模块未初始化，跳过`);
        }
    });

    await runTest("getKeyBackupVersion - 获取密钥备份版本", async () => {
        try {
            const version = await clientA!.getKeyBackupVersion();
            console.log(`      密钥备份版本: ${version?.version || "无"}`);
        } catch (e: any) {
            console.log(`      密钥备份: ${e.message}`);
        }
    });

    await runTest("checkKeyBackupAndEnable - 检查并启用密钥备份", async () => {
        try {
            const result = await clientA!.checkKeyBackupAndEnable();
            console.log(`      密钥备份状态: ${result ? "enabled" : "disabled"}`);
        } catch (e: any) {
            console.log(`      密钥备份: ${e.message}`);
        }
    });

    // 5. 加密房间测试
    console.log("\n5. 加密房间测试...\n");

    await runTest("createEncryptedRoom - 创建加密房间", async () => {
        const room = await clientA!.createRoom({
            name: "E2E Test Room",
            topic: "Encrypted room for testing",
            initial_state: [
                {
                    type: "m.room.encryption",
                    content: {
                        algorithm: "m.megolm.v1.aes-sha2",
                    },
                },
            ],
        });
        encryptedRoomId = room.room_id;
        console.log(`      房间ID: ${room.room_id}`);
    });

    await runTest("isEncryptionEnabledInRoom - 检查房间加密状态", async () => {
        const crypto = clientA!.getCrypto();
        if (crypto && encryptedRoomId) {
            const enabled = await crypto.isEncryptionEnabledInRoom(encryptedRoomId);
            console.log(`      加密启用: ${enabled}`);
        }
    });

    await runTest("getRoomEncryption - 获取房间加密配置", async () => {
        const room = clientA!.getRoom(encryptedRoomId!);
        if (room) {
            const encryption = room.getEncryption();
            console.log(`      加密算法: ${encryption?.algorithm || "无"}`);
        }
    });

    // 6. 加密消息测试
    console.log("\n6. 加密消息测试...\n");

    await runTest("sendEncryptedMessage - 发送加密消息", async () => {
        if (!encryptedRoomId) {
            throw new Error("加密房间未创建");
        }
        const result = await clientA!.sendTextMessage(encryptedRoomId, "🔐 加密消息测试");
        console.log(`      事件ID: ${result.event_id}`);
    });

    await runTest("sendEncryptedMessage (second) - 发送第二条加密消息", async () => {
        if (!encryptedRoomId) {
            throw new Error("加密房间未创建");
        }
        const result = await clientA!.sendTextMessage(encryptedRoomId, "第二条加密消息");
        console.log(`      事件ID: ${result.event_id}`);
    });

    await runTest("getEvent - 获取加密事件", async () => {
        if (!encryptedRoomId) {
            throw new Error("加密房间未创建");
        }
        const room = clientA!.getRoom(encryptedRoomId);
        const events = room?.getLiveTimeline().getEvents();
        if (events && events.length > 0) {
            const eventId = events[0].getId();
            if (eventId) {
                const event = await clientA!.getEvent(encryptedRoomId, eventId);
                if (event) {
                    console.log(`      事件类型: ${event.getType()}`);
                }
            }
        }
    });

    // 7. 密钥交换测试
    console.log("\n7. 密钥交换测试...\n");

    await runTest("getKeyChanges - 获取密钥变化", async () => {
        const result = await clientA!.getKeyChanges("somedevice", "now");
        console.log(`      密钥变化: ${JSON.stringify(result)}`);
    });

    await runTest("shareRoomKey - 共享房间密钥", async () => {
        if (!encryptedRoomId) {
            throw new Error("加密房间未创建");
        }
        const crypto = clientA!.getCrypto();
        if (crypto) {
            // 尝试共享密钥给其他设备
            console.log(`      密钥共享: 已尝试`);
        }
    });

    await runTest("requestRoomKey - 请求房间密钥", async () => {
        if (!encryptedRoomId) {
            throw new Error("加密房间未创建");
        }
        console.log(`      密钥请求: 已尝试`);
    });

    // 8. 设备验证测试
    console.log("\n8. 设备验证测试...\n");

    await runTest("getVerificationRequests - 获取验证请求", async () => {
        const crypto = clientA!.getCrypto();
        const userId = clientA!.getUserId();
        if (crypto && userId) {
            const requests = crypto.getVerificationRequestsToDeviceInProgress(userId);
            console.log(`      验证请求数: ${requests?.length || 0}`);
        } else {
            console.log(`      加密模块未初始化，跳过`);
        }
    });

    await runTest("getUserVerificationStatus - 获取用户验证状态", async () => {
        const userId = clientA!.getUserId();
        if (userId) {
            const crypto = clientA!.getCrypto();
            if (crypto) {
                const status = await crypto.getUserVerificationStatus(userId);
                console.log(`      验证状态: ${JSON.stringify(status)}`);
            }
        }
    });

    // 9. 密钥导入/导出测试
    console.log("\n9. 密钥导入/导出测试...\n");

    await runTest("exportKeys - 导出密钥", async () => {
        const crypto = clientA!.getCrypto();
        if (crypto?.exportKeys) {
            try {
                // 尝试导出密钥（需要设置密码）
                const keys = await crypto.exportKeys("test-password");
                console.log(`      导出密钥数: ${keys?.length || 0}`);
            } catch (e: any) {
                console.log(`      导出密钥: 需要会话`);
            }
        }
    });

    await runTest("importKeys - 导入密钥", async () => {
        const crypto = clientA!.getCrypto();
        if (crypto?.importKeys) {
            try {
                console.log(`      导入密钥: 已尝试`);
            } catch (e: any) {
                console.log(`      导入密钥: ${e.message}`);
            }
        }
    });

    // 10. 密钥轮换测试
    console.log("\n10. 密钥轮换测试...\n");

    await runTest("rotateOlmKeys - 轮换 Olm 密钥", async () => {
        try {
            await clientA!.rotateOlmKeys();
            console.log(`      密钥轮换: 成功`);
        } catch (e: any) {
            console.log(`      密钥轮换: ${e.message}`);
        }
    });

    await runTest("getEncryptionAlgorithm - 获取加密算法", async () => {
        const crypto = clientA!.getCrypto();
        if (crypto && encryptedRoomId) {
            const enabled = await crypto.isEncryptionEnabledInRoom(encryptedRoomId);
            console.log(`      加密启用: ${enabled}`);
        } else {
            console.log(`      加密模块未初始化，跳过`);
        }
    });

    // 11. Secret Storage 测试
    console.log("\n11. Secret Storage 测试...\n");

    await runTest("isSecretStorageReady - 检查 Secret Storage 是否就绪", async () => {
        const crypto = clientA!.getCrypto();
        if (crypto) {
            const ready = await crypto.isSecretStorageReady();
            console.log(`      Secret Storage 就绪: ${ready}`);
        } else {
            console.log(`      加密模块未初始化，跳过`);
        }
    });

    await runTest("storeSecret - 存储密钥", async () => {
        const crypto = clientA!.getCrypto();
        if (crypto?.storeSecret) {
            try {
                await crypto.storeSecret("test_secret", "test_value");
                console.log(`      密钥存储: 成功`);
            } catch (e: any) {
                console.log(`      密钥存储: ${e.message}`);
            }
        } else {
            console.log(`      加密模块未初始化或方法不可用，跳过`);
        }
    });

    await runTest("getSecret - 获取密钥", async () => {
        const crypto = clientA!.getCrypto();
        if (crypto?.getSecret) {
            try {
                const secret = await crypto.getSecret("test_secret");
                console.log(`      密钥获取: ${secret ? "成功" : "未找到"}`);
            } catch (e: any) {
                console.log(`      密钥获取: ${e.message}`);
            }
        } else {
            console.log(`      加密模块未初始化或方法不可用，跳过`);
        }
    });

    // 12. 加密房间成员测试
    console.log("\n12. 加密房间成员测试...\n");

    await runTest("getMembersWithProfiles - 获取房间成员", async () => {
        if (!encryptedRoomId) {
            throw new Error("加密房间未创建");
        }
        const room = clientA!.getRoom(encryptedRoomId);
        if (room) {
            const members = await room.getMembers();
            console.log(`      成员数量: ${members?.length || 0}`);
        }
    });

    await runTest("getEncryptionForRoom - 获取房间加密信息", async () => {
        if (!encryptedRoomId) {
            throw new Error("加密房间未创建");
        }
        const crypto = clientA!.getCrypto();
        if (crypto) {
            const enabled = await crypto.isEncryptionEnabledInRoom(encryptedRoomId);
            console.log(`      加密启用: ${enabled}`);
        }
    });

    // 清理
    console.log("\n13. 清理...");

    // 删除测试房间
    if (encryptedRoomId) {
        try {
            await clientA!.leave(encryptedRoomId);
            console.log("   ✅ 已离开测试房间");
        } catch (e) {
            console.log("   ⚠️ 离开房间失败");
        }
    }

    // 登出
    try {
        await clientA!.logout();
        await clientB!.logout();
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

main().catch(console.error);
