import { describe, it, expect, beforeEach, vi } from "vitest";

import { logger } from "../../src/logger";
import { TagManager } from "../../src/tags";

describe("TagManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        vi.spyOn(logger, "warn").mockImplementation(() => undefined);
        manager = new TagManager(mockClient);
    });

    it("gets/adds/removes tags and caches", async () => {
        await expect(manager.getRoomTags("!r1:hs")).resolves.toEqual({ "m.favourite": { order: 0.5 } });
        expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
            1,
            "GET",
            `/user/${encodeURIComponent("@me:hs")}/rooms/${encodeURIComponent("!r1:hs")}/tags`,
            undefined,
            undefined,
            expect.objectContaining({ prefix: "/_matrix/client/v3" }),
        );
        await manager.addRoomTag("!r1:hs", "m.lowpriority", 1);
        expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
            2,
            "PUT",
            `/user/${encodeURIComponent("@me:hs")}/rooms/${encodeURIComponent("!r1:hs")}/tags/${encodeURIComponent("m.lowpriority")}`,
            undefined,
            { order: 1 },
            expect.objectContaining({ prefix: "/_matrix/client/v3" }),
        );
        await manager.removeRoomTag("!r1:hs", "m.lowpriority");
        expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
            3,
            "DELETE",
            `/user/${encodeURIComponent("@me:hs")}/rooms/${encodeURIComponent("!r1:hs")}/tags/${encodeURIComponent("m.lowpriority")}`,
            undefined,
            undefined,
            expect.objectContaining({ prefix: "/_matrix/client/v3" }),
        );
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
        expect(logger.warn).toHaveBeenCalledWith("TagManager.getRoomTags failed:", expect.any(Error));
        await expect(manager.addRoomTag("", "m.favourite")).rejects.toThrow("Room ID and tag are required");
        await expect(manager.removeRoomTag("!r1:hs", "")).rejects.toThrow("Room ID and tag are required");
    });
});
