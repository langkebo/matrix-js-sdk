import { describe, it, expect, beforeEach, vi } from "vitest";

import { SyncManager } from "../../src/sync-management";
import { SyncState } from "../../src/sync";

describe("SyncManager", () => {
    let mockClient: any;
    let manager: SyncManager;

    beforeEach(() => {
        const rooms = [
            { roomId: "!j:hs", getMyMembership: vi.fn().mockReturnValue("join") },
            { roomId: "!i:hs", getMyMembership: vi.fn().mockReturnValue("invite") },
            { roomId: "!l:hs", getMyMembership: vi.fn().mockReturnValue("leave") },
        ];
        mockClient = {
            syncToken: "token1",
            syncing: true,
            getSyncState: vi.fn().mockReturnValue(SyncState.Syncing),
            getSyncStateData: vi.fn().mockReturnValue({ since: "s1" }),
            getRooms: vi.fn().mockReturnValue(rooms),
            getJoinedRooms: vi.fn().mockResolvedValue({ joined_rooms: ["!j:hs"] }),
        };
        manager = new SyncManager(mockClient);
    });

    it("reads sync state data", () => {
        expect(manager.getSyncToken()).toBe("token1");
        expect(manager.getSyncState()).toBe(SyncState.Syncing);
        expect(manager.getSyncStateData()).toEqual({ since: "s1" });
        expect(manager.isSyncing()).toBe(true);
        expect(manager.getRooms()).toHaveLength(3);
    });

    it("filters joined/invited/left rooms", async () => {
        await expect(manager.getJoinedRooms()).resolves.toEqual(["!j:hs"]);
        expect(manager.getInvitedRooms()).toHaveLength(1);
        expect(manager.getLeftRooms()).toHaveLength(1);
    });
});
