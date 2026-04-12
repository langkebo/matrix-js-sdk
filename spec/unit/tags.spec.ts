import { describe, it, expect, beforeEach, vi } from "vitest";

import { TagManager } from "../../src/tags";

describe("TagManager", () => {
    let mockClient: any;
    let manager: TagManager;

    beforeEach(() => {
        mockClient = {
            getUserId: vi.fn().mockReturnValue("@me:hs"),
            getRooms: vi.fn().mockReturnValue([{ roomId: "!r1:hs" }, { roomId: "!r2:hs" }]),
            http: {
                authedRequest: vi.fn().mockResolvedValue({ tags: { "m.favourite": { order: 0.5 } } }),
            },
        };
        manager = new TagManager(mockClient);
    });

    it("gets/adds/removes tags and caches", async () => {
        await expect(manager.getRoomTags("!r1:hs")).resolves.toEqual({ "m.favourite": { order: 0.5 } });
        await manager.addRoomTag("!r1:hs", "m.lowpriority", 1);
        await manager.removeRoomTag("!r1:hs", "m.lowpriority");
        expect(manager.getCachedTags("!r1:hs")).toEqual({ "m.favourite": { order: 0.5 } });
        expect(manager.getCachedRoomsByTag("m.favourite")).toEqual(["!r1:hs"]);
    });

    it("covers helpers and start/stop", async () => {
        await manager.getRoomTags("!r1:hs");
        await manager.addToFavorites("!r1:hs");
        await expect(manager.isFavorite("!r1:hs")).resolves.toBe(true);
        await manager.removeFromFavorites("!r1:hs");

        await manager.addToLowPriority("!r1:hs");
        await expect(manager.isLowPriority("!r1:hs")).resolves.toBe(true);
        await manager.removeFromLowPriority("!r1:hs");

        await manager.setRoomTagOrder("!r1:hs", "work", 0.8);
        await manager.clearRoomTags("!r1:hs");
        await expect(manager.getTaggedRooms()).resolves.toBeInstanceOf(Map);
        await expect(manager.getFavoriteRooms()).resolves.toEqual(expect.any(Array));
        await expect(manager.getLowPriorityRooms()).resolves.toEqual(expect.any(Array));
        await manager.start();
        manager.stop();
        manager.clearCache();
    });

    it("handles missing user id and invalid inputs", async () => {
        mockClient.getUserId.mockReturnValue(null);
        await expect(manager.getRoomTags("!r1:hs")).resolves.toEqual({});
        await expect(manager.addRoomTag("", "m.favourite")).rejects.toThrow("Room ID and tag are required");
        await expect(manager.removeRoomTag("!r1:hs", "")).rejects.toThrow("Room ID and tag are required");
    });
});
