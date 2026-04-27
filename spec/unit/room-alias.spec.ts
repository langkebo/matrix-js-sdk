import { describe, it, expect, beforeEach, vi } from "vitest";

import { RoomAliasManager } from "../../src/room-alias/index";

describe("RoomAliasManager", () => {
    let mockClient: any;
    let roomAliasManager: RoomAliasManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
            getDomain: vi.fn().mockReturnValue("example.com"),
        };
        roomAliasManager = new RoomAliasManager(mockClient);
    });

    describe("getAliasRoom", () => {
        it("should get room ID for alias", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                room_id: "!room:example.com",
                servers: ["example.com"],
            });

            const response = await roomAliasManager.getAliasRoom("#alias:example.com");
            expect(response?.room_id).toBe("!room:example.com");
        });

        it("should return null on error when throwOnError is false", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));
            const response = await roomAliasManager.getAliasRoom("#alias:example.com", false);
            expect(response).toBeNull();
        });

        it("should throw by default", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Boom"));
            await expect(roomAliasManager.getAliasRoom("#alias:example.com")).rejects.toThrow("Boom");
        });
    });

    describe("getRoomAliases", () => {
        it("should get aliases for room", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                aliases: ["#alias1:example.com", "#alias2:example.com"],
            });

            const response = await roomAliasManager.getRoomAliases("!room:example.com");
            expect(response?.aliases).toHaveLength(2);
        });

        it("should return null on error when throwOnError is false", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));
            const response = await roomAliasManager.getRoomAliases("!room:example.com", false);
            expect(response).toBeNull();
        });

        it("should throw by default", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Boom"));
            await expect(roomAliasManager.getRoomAliases("!room:example.com")).rejects.toThrow("Boom");
        });
    });

    describe("compatible helpers", () => {
        it("resolveAlias preserves fallback behavior", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            await expect(roomAliasManager.resolveAlias("#alias:example.com")).resolves.toBeNull();
        });

        it("isAliasAvailable preserves fallback behavior", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            await expect(roomAliasManager.isAliasAvailable("#alias:example.com")).resolves.toBe(true);
        });
    });

    describe("state alias readers", () => {
        it("throws by default when canonical alias lookup fails", async () => {
            mockClient.getRoom = vi.fn(() => {
                throw new Error("Boom");
            });

            await expect(roomAliasManager.getCanonicalAlias("!room:example.com")).rejects.toThrow("Boom");
        });

        it("returns null for canonical alias when fallback mode is enabled", async () => {
            mockClient.getRoom = vi.fn(() => {
                throw new Error("Boom");
            });

            await expect(roomAliasManager.getCanonicalAlias("!room:example.com", false)).resolves.toBeNull();
        });

        it("throws by default when alt alias lookup fails", async () => {
            mockClient.getRoom = vi.fn(() => {
                throw new Error("Boom");
            });

            await expect(roomAliasManager.getAltAliases("!room:example.com")).rejects.toThrow("Boom");
        });

        it("returns an empty list for alt aliases when fallback mode is enabled", async () => {
            mockClient.getRoom = vi.fn(() => {
                throw new Error("Boom");
            });

            await expect(roomAliasManager.getAltAliases("!room:example.com", false)).resolves.toEqual([]);
        });
    });
});
