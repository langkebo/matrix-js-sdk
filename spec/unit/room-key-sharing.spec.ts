import { describe, it, expect, beforeEach, vi } from "vitest";

import { RoomKeySharingManager } from "../../src/room-key-sharing";

describe("RoomKeySharingManager", () => {
    let mockClient: any;
    let manager: RoomKeySharingManager;

    beforeEach(() => {
        mockClient = {
            shareRoomKey: vi.fn().mockResolvedValue({}),
            requestRoomKey: vi.fn().mockResolvedValue({ request_id: "r1" }),
            getRoomKeyRequests: vi.fn().mockResolvedValue({ requests: [] }),
            deleteRoomKeyRequest: vi.fn().mockResolvedValue({}),
            getSharedWithUsers: vi.fn().mockResolvedValue({ "@a:hs": {}, "@b:hs": {} }),
            hasSharedKeyWithUser: vi.fn().mockResolvedValue(true),
            exportRoomKeys: vi.fn().mockResolvedValue([{ room_id: "!r:hs" }]),
            importRoomKeys: vi.fn().mockResolvedValue({ imported: 1 }),
        };
        manager = new RoomKeySharingManager(mockClient);
    });

    it("shares and requests keys", async () => {
        await manager.shareRoomKey("!r:hs", ["@a:hs"]);
        expect(mockClient.shareRoomKey).toHaveBeenCalledWith("!r:hs", ["@a:hs"]);

        await manager.requestRoomKey("!r:hs", "sess");
        expect(mockClient.requestRoomKey).toHaveBeenCalledWith({
            algorithm: "m.megolm.v1.aes-sha2",
            room_id: "!r:hs",
            session_id: "sess",
            request_type: "request",
        });
    });

    it("lists/deletes/shared-users checks", async () => {
        await expect(manager.getRoomKeyRequests()).resolves.toEqual({ requests: [] });
        expect(mockClient.getRoomKeyRequests).toHaveBeenCalledWith({});

        await manager.deleteRoomKeyRequest("rid");
        expect(mockClient.deleteRoomKeyRequest).toHaveBeenCalledWith("rid");

        await expect(manager.getSharedWithUsers("!r:hs")).resolves.toEqual(["@a:hs", "@b:hs"]);
        await expect(manager.hasSharedKeyWithUser("@a:hs")).resolves.toBe(true);
    });

    it("exports/imports keys", async () => {
        await expect(manager.exportRoomKeys()).resolves.toEqual([{ room_id: "!r:hs" }]);
        const keys = [{ room_id: "!r:hs", session_id: "s1", session_key: "k1" }];
        await manager.importRoomKeys(keys);
        expect(mockClient.importRoomKeys).toHaveBeenCalledWith(keys);
    });
});
