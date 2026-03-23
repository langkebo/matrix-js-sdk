import { describe, it, expect, beforeEach, vi } from "vitest";

import { PresenceManager } from "../../src/presence/index";

describe("PresenceManager", () => {
    let mockClient: any;
    let presenceManager: PresenceManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn().mockImplementation((method: any, path: string) => {
                    if (path.includes("/presence/")) {
                        return Promise.resolve({
                            presence: "online",
                            last_active_ago: 5000,
                            status_msg: "Hello",
                        });
                    }
                    return Promise.resolve({});
                }),
            },
            userId: "@test:example.com",
            getUserId: vi.fn().mockReturnValue("@test:example.com"),
            credentials: {
                userId: "@test:example.com",
            },
        };
        presenceManager = new PresenceManager(mockClient);
    });

    describe("getPresence", () => {
        it("should get user presence", async () => {
            const presence = await presenceManager.getPresence("@other:example.com");
            expect(presence).toBeDefined();
            expect(presence?.presence).toBe("online");
        });

        it("should return null for error", async () => {
            mockClient.http.authedRequest = vi.fn().mockRejectedValueOnce(new Error("Not found"));
            const presence = await presenceManager.getPresence("@unknown:example.com");
            expect(presence).toBeNull();
        });
    });

    describe("setPresence", () => {
        it("should set user presence", async () => {
            await presenceManager.setPresence("online", "Available");
            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    describe("setOnline", () => {
        it("should set presence online", async () => {
            presenceManager.setOnline("Working");
            // Wait for async operation
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    describe("setOffline", () => {
        it("should set presence offline", async () => {
            presenceManager.setOffline();
            // Wait for async operation
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    describe("getPresences", () => {
        it("should get presences for multiple users", async () => {
            const presences = await presenceManager.getPresences(["@user1:example.com", "@user2:example.com"]);
            expect(presences).toBeDefined();
        });
    });

    describe("start/stop", () => {
        it("should start and stop without errors", async () => {
            expect(() => presenceManager.start()).not.toThrow();
            expect(() => presenceManager.stop()).not.toThrow();
        });
    });
});
