import { describe, it, expect, beforeEach, vi } from "vitest";

import { DirectoryManager } from "../../src/directory";
import { Method } from "../../src/http-api";

describe("DirectoryManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: DirectoryManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn().mockResolvedValue({ chunk: [], aliases: ["#r:hs"] }),
            },
        };
        manager = new DirectoryManager(mockClient);
    });

    it("gets public rooms by get/post", async () => {
        await manager.getPublicRoomsList({ server: "hs", limit: 10 });
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(Method.Get, "/publicRooms", {
            server: "hs",
            limit: 10,
        });

        await manager.getPublicRooms("hs", 20, "next");
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(Method.Post, "/publicRooms", undefined, {
            server: "hs",
            limit: 20,
            since: "next",
        });
    });

    it("handles alias create/read/delete and room aliases", async () => {
        await manager.getRoomIdForAlias("#r:hs");
        await manager.createRoomAlias("!r:hs", "#r:hs");
        await manager.deleteRoomAlias("#r:hs");
        await expect(manager.getAliasesForRoom("!r:hs")).resolves.toEqual(["#r:hs"]);
    });
});
