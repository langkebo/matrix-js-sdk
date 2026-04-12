// eslint-disable-next-line no-restricted-imports
import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    AccountDataManager,
    AIConnectionManager,
    CapabilitiesManager,
    CryptoKeysManager,
    createClient,
    createRoomWidgetClient,
    DeviceTrustManager,
    ExternalServiceManager,
    FederationBlacklistManager,
    GuestManager,
    initializeManagerExtensions,
    InviteBlocklistManager,
    isManagerExtensionsInitialized,
    offManagerExtensionsLifecycle,
    MediaManager,
    onManagerExtensionsLifecycle,
    MessageManager,
    resetManagerExtensions,
    RenderingManager,
    RoomListManager,
    RoomManager,
    SamlAuthManager,
    SendingManager,
    SecurityManager,
    StickyEventManager,
    ThirdPartyManager,
    TypingManager,
    UserManager,
    VoiceMessageManager,
    WidgetManager,
} from "../../src/matrix";

async function waitForCondition(condition: () => boolean, timeoutMs = 15000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error("Condition not met within timeout");
}

describe("matrix manager extension defaults", () => {
    beforeEach(() => {
        resetManagerExtensions();
    });

    afterEach(() => {
        resetManagerExtensions();
    });

    it("createClient should auto-trigger manager extension initialization", async () => {
        expect(isManagerExtensionsInitialized()).toBe(false);

        const client = createClient({
            baseUrl: "https://example.com",
            userId: "@alice:example.com",
            accessToken: "test_token",
        });
        expect(client).toBeTruthy();

        await waitForCondition(() => isManagerExtensionsInitialized());
        expect(isManagerExtensionsInitialized()).toBe(true);
    });

    it("manager lifecycle should emit register/init/start and stop phases", async () => {
        const phaseHistory: string[] = [];
        const unsubscribe = onManagerExtensionsLifecycle((event) => {
            if (event.status === "success") {
                phaseHistory.push(event.phase);
            }
        });

        await initializeManagerExtensions();
        resetManagerExtensions();
        unsubscribe();

        expect(phaseHistory).toEqual(expect.arrayContaining(["register", "init", "start", "stop"]));
    });

    it("createClient should skip dynamic manager extension initialization when disabled", async () => {
        expect(isManagerExtensionsInitialized()).toBe(false);

        const client = createClient({
            baseUrl: "https://example.com",
            userId: "@alice:example.com",
            accessToken: "test_token",
            disableDynamicExtensions: true,
        });
        expect(client).toBeTruthy();

        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(isManagerExtensionsInitialized()).toBe(false);
    });

    it("matrix entry should export key manager classes", () => {
        expect(typeof TypingManager).toBe("function");
        expect(typeof WidgetManager).toBe("function");
        expect(typeof SecurityManager).toBe("function");
        expect(typeof SamlAuthManager).toBe("function");
        expect(typeof AccountDataManager).toBe("function");
        expect(typeof AIConnectionManager).toBe("function");
        expect(typeof CapabilitiesManager).toBe("function");
        expect(typeof CryptoKeysManager).toBe("function");
        expect(typeof DeviceTrustManager).toBe("function");
        expect(typeof ExternalServiceManager).toBe("function");
        expect(typeof FederationBlacklistManager).toBe("function");
        expect(typeof GuestManager).toBe("function");
        expect(typeof InviteBlocklistManager).toBe("function");
        expect(typeof MediaManager).toBe("function");
        expect(typeof MessageManager).toBe("function");
        expect(typeof RenderingManager).toBe("function");
        expect(typeof RoomManager).toBe("function");
        expect(typeof RoomListManager).toBe("function");
        expect(typeof SendingManager).toBe("function");
        expect(typeof StickyEventManager).toBe("function");
        expect(typeof ThirdPartyManager).toBe("function");
        expect(typeof UserManager).toBe("function");
        expect(typeof VoiceMessageManager).toBe("function");
    });

    it("matrix entry should export manager lifecycle subscription APIs", () => {
        expect(typeof onManagerExtensionsLifecycle).toBe("function");
        expect(typeof offManagerExtensionsLifecycle).toBe("function");
    });

    it("createRoomWidgetClient should also trigger manager extension initialization", async () => {
        expect(isManagerExtensionsInitialized()).toBe(false);

        const widgetApi = new EventEmitter() as any;
        widgetApi.transport = {
            send: async () => ({}),
            sendComplete: async () => ({}),
        };
        widgetApi.start = () => undefined;
        widgetApi.sendContentLoaded = () => undefined;

        const capabilities = {} as any;
        const roomId = "!room:example.com";
        const opts = {
            baseUrl: "https://example.com",
            userId: "@alice:example.com",
            accessToken: "test_token",
        };

        const client = createRoomWidgetClient(widgetApi, capabilities, roomId, opts);
        expect(client).toBeTruthy();

        await waitForCondition(() => isManagerExtensionsInitialized());
        expect(isManagerExtensionsInitialized()).toBe(true);
    });

    it("createRoomWidgetClient should skip dynamic manager extension initialization when disabled", async () => {
        expect(isManagerExtensionsInitialized()).toBe(false);

        const widgetApi = new EventEmitter() as any;
        widgetApi.transport = {
            send: async () => ({}),
            sendComplete: async () => ({}),
        };
        widgetApi.start = () => undefined;
        widgetApi.sendContentLoaded = () => undefined;

        const capabilities = {} as any;
        const roomId = "!room:example.com";
        const opts = {
            baseUrl: "https://example.com",
            userId: "@alice:example.com",
            accessToken: "test_token",
            disableDynamicExtensions: true,
        };

        const client = createRoomWidgetClient(widgetApi, capabilities, roomId, opts);
        expect(client).toBeTruthy();

        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(isManagerExtensionsInitialized()).toBe(false);
    });
});
