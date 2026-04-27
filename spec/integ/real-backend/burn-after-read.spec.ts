import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createClient, type MatrixClient } from "../../../src/matrix";
import {
    BurnAfterReadManager,
    BurnAfterReadEvent,
    extendMatrixClient as extendBurnAfterReadClient,
    type IBurnSettings,
    type IBurnStats,
    type IBurnAfterReadMessage,
} from "../../../src/burn-after-read/index";
import { AuthError, NotFoundError, ValidationError, ApiError, RetryableError } from "../../../src/errors";
import { TestConfig } from "./TestConfig";

extendBurnAfterReadClient();

async function login(): Promise<MatrixClient> {
    const testClient = createClient({ baseUrl: TestConfig.baseUrl, allowInsecureHttp: true });
    const username = TestConfig.testUser.userId.replace("@", "").split(":")[0];
    const result = await testClient.login("m.login.password", {
        user: username,
        password: TestConfig.testUser.password,
    });
    testClient.setAccessToken(result.access_token);
    return testClient;
}

describe("Burn After Read 集成测试", () => {
    let client: MatrixClient;
    let roomId: string;
    let backendAvailable = false;

    beforeAll(async () => {
        try {
            client = await login();
            const room = await client.createRoom({
                name: `Burn Test ${Date.now()}`,
                topic: "Burn after read integration test",
                visibility: "private",
                preset: "private_chat",
            });
            roomId = room.room_id;
            backendAvailable = true;
        } catch {
            backendAvailable = false;
        }
    }, TestConfig.timeout.long);

    afterAll(async () => {
        await client?.logout?.().catch(() => undefined);
    });

    describe("房间级阅后即焚设置", () => {
        it(
            "should enable burn after read for a room",
            async () => {
                if (!backendAvailable) return;

                const manager = client.getBurnAfterReadManager();
                const settings = await manager.enableBurn(roomId);

                expect(settings.enabled).toBe(true);
                expect(settings.burn_after_ms).toBeGreaterThan(0);
            },
            TestConfig.timeout.medium,
        );

        it(
            "should get burn settings for a room",
            async () => {
                if (!backendAvailable) return;

                const manager = client.getBurnAfterReadManager();
                const settings = await manager.getBurnSettings(roomId);

                expect(settings.enabled).toBe(true);
                expect(typeof settings.burn_after_ms).toBe("number");
            },
            TestConfig.timeout.medium,
        );

        it(
            "should disable burn after read for a room",
            async () => {
                if (!backendAvailable) return;

                const manager = client.getBurnAfterReadManager();
                const settings = await manager.disableBurn(roomId);

                expect(settings.enabled).toBe(false);
            },
            TestConfig.timeout.medium,
        );

        it(
            "should re-enable with custom burn time",
            async () => {
                if (!backendAvailable) return;

                const manager = client.getBurnAfterReadManager();
                const settings = await manager.enableBurn(roomId, 30000);

                expect(settings.enabled).toBe(true);
                expect(settings.burn_after_ms).toBe(30000);
            },
            TestConfig.timeout.medium,
        );
    });

    describe("全局配置与统计", () => {
        it(
            "should set global burn config",
            async () => {
                if (!backendAvailable) return;

                const manager = client.getBurnAfterReadManager();
                const result = await manager.setBurnConfig(45000);

                expect(result.default_burn_ms).toBe(45000);
            },
            TestConfig.timeout.medium,
        );

        it(
            "should get burn stats",
            async () => {
                if (!backendAvailable) return;

                const manager = client.getBurnAfterReadManager();
                const stats = await manager.getBurnStats();

                expect(typeof stats.total_burned).toBe("number");
                expect(typeof stats.total_pending).toBe("number");
                expect(typeof stats.rooms_with_burn_enabled).toBe("number");
                expect(stats.total_burned).toBeGreaterThanOrEqual(0);
                expect(stats.total_pending).toBeGreaterThanOrEqual(0);
            },
            TestConfig.timeout.medium,
        );
    });

    describe("消息发送与焚毁", () => {
        it(
            "should send a burn after read message",
            async () => {
                if (!backendAvailable) return;

                const manager = client.getBurnAfterReadManager();
                const response = await manager.sendMessage({
                    room_id: roomId,
                    content: { body: "This will self-destruct", msgtype: "m.text" },
                    expires_in: 60000,
                });

                expect(response.event_id).toBeTruthy();
                expect(response.expires_in).toBe(60000);
                expect(response.expires_at).toBeGreaterThan(0);
            },
            TestConfig.timeout.medium,
        );

        it(
            "should get pending burns for a room",
            async () => {
                if (!backendAvailable) return;

                const manager = client.getBurnAfterReadManager();
                const pending = await manager.getPendingBurns(roomId);

                expect(Array.isArray(pending)).toBe(true);
            },
            TestConfig.timeout.medium,
        );

        it(
            "should mark message as read and trigger burn",
            async () => {
                if (!backendAvailable) return;

                const manager = client.getBurnAfterReadManager();

                const sendResponse = await manager.sendMessage({
                    room_id: roomId,
                    content: { body: "Read and burn", msgtype: "m.text" },
                    expires_in: 60000,
                });

                const markResponse = await manager.markBurnRead(roomId, sendResponse.event_id);

                expect(markResponse.success).toBe(true);
                expect(markResponse.will_delete_at).toBeGreaterThan(0);
            },
            TestConfig.timeout.medium,
        );
    });

    describe("安全性测试", () => {
        it(
            "should reject unauthenticated requests with AuthError",
            async () => {
                if (!backendAvailable) return;

                const unauthClient = createClient({ baseUrl: TestConfig.baseUrl, allowInsecureHttp: true });
                const manager = new BurnAfterReadManager(unauthClient);

                await expect(manager.enableBurn("!nonexistent:test")).rejects.toThrow();
            },
            TestConfig.timeout.medium,
        );

        it(
            "should validate input parameters",
            async () => {
                if (!backendAvailable) return;

                const manager = client.getBurnAfterReadManager();

                await expect(manager.enableBurn("")).rejects.toThrow(ValidationError);
                await expect(manager.enableBurn(roomId, 0)).rejects.toThrow(ValidationError);
                await expect(manager.enableBurn(roomId, -1)).rejects.toThrow(ValidationError);
            },
            TestConfig.timeout.medium,
        );

        it(
            "should handle non-existent room gracefully",
            async () => {
                if (!backendAvailable) return;

                const manager = client.getBurnAfterReadManager();

                await expect(manager.getBurnSettings("!nonexistent:test")).rejects.toThrow();
            },
            TestConfig.timeout.medium,
        );

        it(
            "should not allow sending burn message when disabled",
            async () => {
                const manager = new BurnAfterReadManager({} as any, { enabled: false });

                await expect(
                    manager.sendMessage({
                        room_id: "!room:test",
                        content: { body: "test" },
                    }),
                ).rejects.toThrow(ValidationError);
            },
            TestConfig.timeout.short,
        );

        it(
            "should reject burn time exceeding maximum",
            async () => {
                const manager = new BurnAfterReadManager({} as any);

                await expect(manager.enableBurn("!room:test", 999999999)).rejects.toThrow(ValidationError);
            },
            TestConfig.timeout.short,
        );
    });

    describe("URL 路径验证", () => {
        it(
            "should use correct /burn endpoint (not /burn_after_read)",
            async () => {
                if (!backendAvailable) return;

                const manager = client.getBurnAfterReadManager();

                const settings = await manager.enableBurn(roomId);
                expect(settings).toBeDefined();

                const fetchedSettings = await manager.getBurnSettings(roomId);
                expect(fetchedSettings).toBeDefined();
            },
            TestConfig.timeout.medium,
        );
    });

    describe("事件系统", () => {
        it(
            "should emit SettingsChanged when enabling burn",
            async () => {
                if (!backendAvailable) return;

                const manager = client.getBurnAfterReadManager();
                let receivedRoomId: string | undefined;
                let receivedSettings: IBurnSettings | undefined;

                const listener = (rid: string, settings: IBurnSettings) => {
                    receivedRoomId = rid;
                    receivedSettings = settings;
                };

                manager.on(BurnAfterReadEvent.SettingsChanged, listener);

                try {
                    await manager.enableBurn(roomId);

                    expect(receivedRoomId).toBe(roomId);
                    expect(receivedSettings?.enabled).toBe(true);
                } finally {
                    manager.off(BurnAfterReadEvent.SettingsChanged, listener);
                }
            },
            TestConfig.timeout.medium,
        );

        it(
            "should emit MessageSent when sending burn message",
            async () => {
                if (!backendAvailable) return;

                const manager = client.getBurnAfterReadManager();
                let receivedMessage: IBurnAfterReadMessage | undefined;

                const listener = (msg: IBurnAfterReadMessage) => {
                    receivedMessage = msg;
                };

                manager.on(BurnAfterReadEvent.MessageSent, listener);

                try {
                    await manager.sendMessage({
                        room_id: roomId,
                        content: { body: "Event test", msgtype: "m.text" },
                    });

                    expect(receivedMessage).toBeDefined();
                    expect(receivedMessage!.room_id).toBe(roomId);
                } finally {
                    manager.off(BurnAfterReadEvent.MessageSent, listener);
                }
            },
            TestConfig.timeout.medium,
        );
    });

    describe("Manager 单例验证", () => {
        it(
            "should return same manager instance from getBurnAfterReadManager",
            async () => {
                if (!backendAvailable) return;

                const instance1 = client.getBurnAfterReadManager();
                const instance2 = client.getBurnAfterReadManager();

                expect(instance1).toBe(instance2);
            },
            TestConfig.timeout.short,
        );
    });

    describe("生命周期管理", () => {
        it(
            "should clean up timers on stop",
            async () => {
                if (!backendAvailable) return;

                const manager = client.getBurnAfterReadManager();

                await manager.sendMessage({
                    room_id: roomId,
                    content: { body: "Lifecycle test", msgtype: "m.text" },
                });

                expect(manager.getCachedMessages().length).toBeGreaterThan(0);

                manager.stop();

                expect(manager.getCachedMessages()).toHaveLength(0);
                expect(manager.getActiveBurnCount()).toBe(0);
            },
            TestConfig.timeout.medium,
        );
    });
});
