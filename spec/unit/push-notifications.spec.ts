import { describe, expect, it, vi, beforeEach } from "vitest";

import { PushNotificationsManager, type IPusher, type IPusherData } from "../../src/push-notifications/index";

describe("PushNotificationsManager", () => {
    let manager: PushNotificationsManager;
    let client: {
        getPushers: ReturnType<typeof vi.fn>;
        setPushers: ReturnType<typeof vi.fn>;
        removePusher: ReturnType<typeof vi.fn>;
        getPusherData: ReturnType<typeof vi.fn>;
    };

    const mockPusher: IPusher = {
        pushkey: "key1",
        kind: "http",
        app_id: "app.id",
        app_display_name: "MyApp",
        device_display_name: "MyDevice",
        lang: "en",
        data: { url: "https://example.com/push" },
    };

    const mockPushersResponse = { pushers: [mockPusher] };

    beforeEach(() => {
        client = {
            getPushers: vi.fn(),
            setPushers: vi.fn(),
            removePusher: vi.fn(),
            getPusherData: vi.fn(),
        };
        manager = new PushNotificationsManager(client as any);
    });

    describe("getPushers", () => {
        it("delegates to client.getPushers", async () => {
            client.getPushers.mockResolvedValue(mockPushersResponse);
            const result = await manager.getPushers();
            expect(result).toBe(mockPushersResponse);
            expect(client.getPushers).toHaveBeenCalled();
        });
    });

    describe("setPushers", () => {
        it("delegates to client.setPushers", async () => {
            client.setPushers.mockResolvedValue(undefined);
            await manager.setPushers([mockPusher]);
            expect(client.setPushers).toHaveBeenCalledWith([mockPusher]);
        });
    });

    describe("removePusher", () => {
        it("delegates to client.removePusher", async () => {
            client.removePusher.mockResolvedValue(undefined);
            await manager.removePusher(mockPusher);
            expect(client.removePusher).toHaveBeenCalledWith(mockPusher);
        });
    });

    describe("getPusherData", () => {
        it("delegates to client.getPusherData", () => {
            const pusherData: IPusherData = { url: "https://push.example.com" };
            client.getPusherData.mockReturnValue(pusherData);
            const result = manager.getPusherData("!room:example.org", "@user:example.org");
            expect(result).toBe(pusherData);
            expect(client.getPusherData).toHaveBeenCalledWith("!room:example.org", "@user:example.org");
        });

        it("returns null when no data", () => {
            client.getPusherData.mockReturnValue(null);
            expect(manager.getPusherData("!room:example.org", "@user:example.org")).toBeNull();
        });
    });
});
