/**
 * 验证 reactions 和 beacon Manager 在 initializeManagerExtensions() 后可用，
 * 以及 ReactionsManager 的 reactToMessage/redactReaction 行为正确。
 *
 * 这三个能力是前端 A2/A6 迁移的前置条件：
 * 1. getReactionsManager() / getBeaconManager() 在初始化后可用
 * 2. reactToMessage 返回 event_id（前端 addReaction 依赖此返回值）
 * 3. redactReaction 真正调用 redactEvent（而非空实现）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createClient, resetManagerExtensions, initializeManagerExtensions, MatrixClient } from "../../src";
import type { MatrixClient as MatrixClientType } from "../../src";

describe("reactions & beacon manager registration", () => {
    let client: MatrixClientType;

    beforeEach(async () => {
        resetManagerExtensions();
        await initializeManagerExtensions();
        client = createClient({
            baseUrl: "https://test.example.com",
            accessToken: "at",
            userId: "@u:hs",
            deviceId: "d1",
        });
    });

    afterEach(() => {
        resetManagerExtensions();
    });

    it("client.getReactionsManager() is available after initialization", () => {
        expect(typeof (client as unknown as { getReactionsManager?: unknown }).getReactionsManager).toBe("function");
        const manager = (client as unknown as { getReactionsManager: () => unknown }).getReactionsManager();
        expect(manager).toBeTruthy();
    });

    it("client.getBeaconManager() is available after initialization", () => {
        expect(typeof (client as unknown as { getBeaconManager?: unknown }).getBeaconManager).toBe("function");
        const manager = (client as unknown as { getBeaconManager: () => unknown }).getBeaconManager();
        expect(manager).toBeTruthy();
    });
});

describe("ReactionsManager.reactToMessage returns event_id", () => {
    it("reactToMessage resolves with the event_id returned by client.reactToMessage", async () => {
        // Arrange: stub client.reactToMessage to return an event_id
        // (after fix, client.reactToMessage returns ISendEventResponse.event_id)
        const expectedEventId = "$new_reaction:hs";
        const reactToMessage = vi.fn().mockResolvedValue(expectedEventId);
        const client = {
            reactToMessage,
        } as unknown as MatrixClientType;

        const { ReactionsManager } = await import("../../src/reactions");
        const manager = new ReactionsManager(client);

        // Act
        const result = await manager.reactToMessage("!room:hs", "$msg:hs", "👍");

        // Assert: returns the event_id, not undefined
        expect(reactToMessage).toHaveBeenCalledWith("!room:hs", "$msg:hs", "👍");
        expect(result).toBe(expectedEventId);
    });
});

describe("ReactionsManager.redactReaction delegates to client.redactReaction", () => {
    it("redactReaction calls client.redactReaction (which must call redactEvent internally)", async () => {
        // Arrange: stub client.redactReaction to verify ReactionsManager delegates correctly
        const redactReaction = vi.fn().mockResolvedValue(undefined);
        const client = {
            redactReaction,
        } as unknown as MatrixClientType;

        const { ReactionsManager } = await import("../../src/reactions");
        const manager = new ReactionsManager(client);

        // Act
        await manager.redactReaction("!room:hs", "$reaction:hs");

        // Assert: ReactionsManager delegates to client.redactReaction
        expect(redactReaction).toHaveBeenCalledWith("!room:hs", "$reaction:hs");
    });
});

describe("client.redactReaction calls redactEvent", () => {
    it("redactReaction delegates to client.redactEvent (not a no-op)", async () => {
        // This test verifies the fix at the client.ts layer:
        // redactReaction was `async redactReaction() {}` (empty), should call redactEvent
        const redactEvent = vi.fn().mockResolvedValue({ event_id: "$redact:hs" });
        const client = {
            redactEvent,
            baseUrl: "https://test.example.com",
            accessToken: "at",
            userId: "@u:hs",
            deviceId: "d1",
        } as unknown as MatrixClientType;

        // Use the real MatrixClient prototype method
        await MatrixClient.prototype.redactReaction.call(client, "!room:hs", "$reaction:hs");

        // Assert: redactEvent was actually called, not a no-op
        expect(redactEvent).toHaveBeenCalledWith("!room:hs", "$reaction:hs", undefined);
    });
});
