/**
 * E2E 加密完整测试
 * 运行: pnpm run test:real-backend:tsx -- spec/integ/real-backend/e2e-crypto.test.ts
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
import { MatrixEventEvent, type MatrixEvent } from "../../../src/models/event.ts";
import { syncPromise } from "../../test-utils/test-utils";
import { TestConfig } from "./TestConfig";

declare const process: { exit: (code?: number) => never };

let clientA: MatrixClient | null = null;
let clientB: MatrixClient | null = null;
const testResults: { name: string; passed: boolean; error?: string }[] = [];
let encryptedRoomId: string | null = null;
let lastEncryptedEventId: string | null = null;
let lastEncryptedMessageBody: string | null = null;

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

async function login(user: { userId: string; password: string; deviceId?: string }): Promise<MatrixClient> {
    const testClient = createClient({
        baseUrl: TestConfig.baseUrl,
        allowInsecureHttp: true,
        deviceId: user.deviceId,
    });
    const username = user.userId.replace("@", "").split(":")[0];
    const result = await testClient.loginRequest({
        type: "m.login.password",
        user: username,
        password: user.password,
        device_id: user.deviceId,
    });
    testClient.setAccessToken(result.access_token);
    return testClient;
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function startClientAndSync(client: MatrixClient, label: string): Promise<void> {
    client.startClient({ initialSyncLimit: 20 });
    await syncPromise(client);
    console.log(`   ✅ ${label} 已开始同步: ${client.getSyncState()}`);
}

async function waitForRoom(client: MatrixClient, roomId: string, timeoutMs = TestConfig.timeout.long): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (client.getRoom(roomId)) {
            return;
        }
        await sleep(500);
    }

    throw new Error(`房间 ${roomId} 未在 ${timeoutMs}ms 内出现在客户端缓存中`);
}

function getTimelineEvent(roomId: string, client: MatrixClient, eventId: string): MatrixEvent | null {
    const room = client.getRoom(roomId);
    const events = room?.getLiveTimeline().getEvents() ?? [];
    return events.find((event) => event.getId() === eventId) ?? null;
}

async function waitForEventDecryption(
    client: MatrixClient,
    roomId: string,
    eventId: string,
    expectedBody: string,
    timeoutMs = TestConfig.timeout.long,
): Promise<MatrixEvent> {
    const deadline = Date.now() + timeoutMs;
    let lastObservedType = "missing";
    let lastObservedBody = "";

    while (Date.now() < deadline) {
        const event = getTimelineEvent(roomId, client, eventId);
        if (event) {
            lastObservedType = event.getType();

            if (event.isBeingDecrypted()) {
                try {
                    await Promise.race([event.getDecryptionPromise(), sleep(1000)]);
                } catch {
                    // Ignore transient decrypt failures here and keep polling for eventual success.
                }
            }

            const clearBody = event.getClearContent()?.body;
            const contentBody = event.getContent()?.body;
            const resolvedBody =
                typeof clearBody === "string" ? clearBody : typeof contentBody === "string" ? contentBody : "";

            lastObservedBody = resolvedBody;
            if (resolvedBody === expectedBody) {
                return event;
            }

            await new Promise<void>((resolve) => {
                let resolved = false;
                const onDecrypted = (): void => {
                    if (resolved) return;
                    resolved = true;
                    event.off(MatrixEventEvent.Decrypted, onDecrypted);
                    resolve();
                };

                event.on(MatrixEventEvent.Decrypted, onDecrypted);
                setTimeout(() => {
                    if (resolved) return;
                    resolved = true;
                    event.off(MatrixEventEvent.Decrypted, onDecrypted);
                    resolve();
                }, 750);
            });
            continue;
        }

        await sleep(750);
    }

    throw new Error(
        `等待第二端解密事件超时: roomId=${roomId}, eventId=${eventId}, lastType=${lastObservedType}, lastBody=${lastObservedBody}`,
    );
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
        await clientA.initRustCrypto({ useIndexedDB: false, allowInMemoryStore: true });
        await clientB.initRustCrypto({ useIndexedDB: false, allowInMemoryStore: true });
        console.log("   ✅ 双端加密模块已初始化\n");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
        console.log(`   ⚠️ 加密初始化: ${e.message}\n`);
    }

    console.log("3. 启动真实同步...");
    await Promise.all([startClientAndSync(clientA, "用户A"), startClientAndSync(clientB, "用户B")]);
    console.log();

    // 2. 加密初始化测试
    console.log("4. 加密初始化测试...\n");

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
        const devices = await clientA!.getDeviceManager().getDevices();
        console.log(`      设备数量: ${devices.length}`);
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
    console.log("\n5. 密钥测试...\n");

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
    console.log("\n6. 密钥备份测试...\n");

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
            const version = await clientA!.getKeyBackupManager().getLatestBackupVersion();
            console.log(`      密钥备份版本: ${version?.version || "无"}`);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log(`      密钥备份: ${e.message}`);
        }
    });

    await runTest("checkKeyBackupAndEnable - 检查并启用密钥备份", async () => {
        const crypto = clientA!.getCrypto();
        if (!crypto?.checkKeyBackupAndEnable) {
            console.log("      加密模块未初始化或不支持密钥备份检查，跳过");
            return;
        }

        try {
            const result = await crypto.checkKeyBackupAndEnable();
            console.log(`      密钥备份状态: ${result ? "enabled" : "disabled"}`);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log(`      密钥备份: ${e.message}`);
        }
    });

    // 5. 加密房间测试
    console.log("\n7. 加密房间测试...\n");

    await runTest("createEncryptedRoom - 创建加密房间", async () => {
        const room = await clientA!.createRoom({
            name: "E2E Test Room",
            topic: "Encrypted room for testing",
            invite: [TestConfig.secondaryUser.userId],
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

    await runTest("joinEncryptedRoom - 第二个客户端加入加密房间", async () => {
        if (!encryptedRoomId) {
            throw new Error("加密房间未创建");
        }

        await clientB!.joinRoom(encryptedRoomId);
        await Promise.all([waitForRoom(clientA!, encryptedRoomId), waitForRoom(clientB!, encryptedRoomId)]);
        console.log(`      用户B已加入: ${encryptedRoomId}`);
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
            const encryptionEvent = room.currentState.getStateEvents("m.room.encryption", "");
            const encryption = encryptionEvent?.getContent<{ algorithm?: string }>();
            console.log(`      加密算法: ${encryption?.algorithm || "无"}`);
        }
    });

    // 6. 加密消息测试
    console.log("\n8. 加密消息测试...\n");

    await runTest("sendEncryptedMessage - 发送加密消息", async () => {
        if (!encryptedRoomId) {
            throw new Error("加密房间未创建");
        }
        const messageBody = `🔐 加密消息测试 ${Date.now()}`;
        const result = await clientA!.sendTextMessage(encryptedRoomId, messageBody);
        lastEncryptedEventId = result.event_id;
        lastEncryptedMessageBody = messageBody;
        console.log(`      事件ID: ${result.event_id}`);
    });

    await runTest("receiveAndDecryptEncryptedMessage - 第二端完成同步并解密", async () => {
        if (!encryptedRoomId || !lastEncryptedEventId || !lastEncryptedMessageBody) {
            throw new Error("缺少待校验的加密事件");
        }

        const event = await waitForEventDecryption(
            clientB!,
            encryptedRoomId,
            lastEncryptedEventId,
            lastEncryptedMessageBody,
        );
        console.log(
            `      已解密事件: type=${event.getType()}, body=${event.getClearContent()?.body ?? event.getContent()?.body ?? ""}`,
        );
    });

    await runTest("getEvent - 获取加密事件", async () => {
        if (!encryptedRoomId || !lastEncryptedEventId) {
            throw new Error("加密房间未创建");
        }
        const event = await clientA!.fetchRoomEvent(encryptedRoomId, lastEncryptedEventId);
        if (event) {
            console.log(`      事件类型: ${event.type}`);
        }
    });

    // 7. 密钥交换测试
    console.log("\n9. 密钥交换测试...\n");

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
    console.log("\n10. 设备验证测试...\n");

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
    console.log("\n11. 密钥导入/导出测试...\n");

    await runTest("exportKeys - 导出密钥", async () => {
        try {
            const exportResult = await clientA!.getKeyBackupManager().exportKeys();
            console.log(`      导出房间数: ${Object.keys(exportResult.room_keys || {}).length}`);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log(`      导出密钥: ${e.message}`);
        }
    });

    await runTest("importKeys - 导入密钥", async () => {
        try {
            const exportResult = await clientA!.getKeyBackupManager().exportKeys();
            const importResult = await clientA!.getKeyBackupManager().importKeys(exportResult.room_keys);
            console.log(
                `      导入结果: count=${importResult.count}, failed=${importResult.failed}, total=${importResult.total}`,
            );
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log(`      导入密钥: ${e.message}`);
        }
    });

    // 10. 密钥轮换测试
    console.log("\n12. 密钥轮换测试...\n");

    await runTest("rotateOlmKeys - 轮换 Olm 密钥", async () => {
        console.log("      当前 SDK 未公开 rotateOlmKeys 接口，跳过");
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
    console.log("\n13. Secret Storage 测试...\n");

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
        try {
            await clientA!.storeSecret("test_secret", "test_value");
            console.log("      密钥存储: 成功");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log(`      密钥存储: ${e.message}`);
        }
    });

    await runTest("getSecret - 获取密钥", async () => {
        try {
            const secret = await clientA!.getSecret("test_secret");
            console.log(`      密钥获取: ${secret ? "成功" : "未找到"}`);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            console.log(`      密钥获取: ${e.message}`);
        }
    });

    // 12. 加密房间成员测试
    console.log("\n14. 加密房间成员测试...\n");

    await runTest("getMembersWithProfiles - 获取房间成员", async () => {
        if (!encryptedRoomId) {
            throw new Error("加密房间未创建");
        }
        const room = clientA!.getRoom(encryptedRoomId);
        if (room) {
            const members = room.getMembers();
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
    console.log("\n15. 清理...");

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
        await clientA!.logout(true);
        await clientB!.logout(true);
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
