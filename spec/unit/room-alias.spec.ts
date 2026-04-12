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

        it("should return null on error", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));
            const response = await roomAliasManager.getAliasRoom("#alias:example.com");
            expect(response).toBeNull();
        });

        it("should throw when throwOnError is true", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Boom"));
            await expect(roomAliasManager.getAliasRoom("#alias:example.com", true)).rejects.toThrow("Boom");
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

        it("should return null on error", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));
            const response = await roomAliasManager.getRoomAliases("!room:example.com");
            expect(response).toBeNull();
        });

        it("should throw when throwOnError is true", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Boom"));
            await expect(roomAliasManager.getRoomAliases("!room:example.com", true)).rejects.toThrow("Boom");
        });
    });
});
