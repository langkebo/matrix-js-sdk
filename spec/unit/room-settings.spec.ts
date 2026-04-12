import { describe, it, expect, beforeEach, vi } from "vitest";

import { RoomSettingsManager } from "../../src/room-settings";

describe("RoomSettingsManager", () => {
    let mockClient: any;
    let manager: RoomSettingsManager;

    beforeEach(() => {
        mockClient = {
            getRoomName: vi.fn().mockReturnValue("name"),
            setRoomName: vi.fn().mockResolvedValue({ event_id: "$1" }),
            getRoomTopic: vi.fn().mockReturnValue("topic"),
            setRoomTopic: vi.fn().mockResolvedValue({ event_id: "$2" }),
            getRoomAvatarUrl: vi.fn().mockReturnValue("mxc://avatar"),
            setRoomAvatar: vi.fn().mockResolvedValue(undefined),
            getRoomHistoryVisibility: vi.fn().mockReturnValue("shared"),
            setRoomHistoryVisibility: vi.fn().mockResolvedValue(undefined),
            getRoomGuestAccess: vi.fn().mockReturnValue("can_join"),
            setRoomGuestAccess: vi.fn().mockResolvedValue(undefined),
            getRoomJoinRule: vi.fn().mockReturnValue("invite"),
            setRoomJoinRule: vi.fn().mockResolvedValue(undefined),
        };
        manager = new RoomSettingsManager(mockClient);
    });

    it("gets room settings", () => {
        expect(manager.getRoomName("!r:hs")).toBe("name");
        expect(manager.getRoomTopic("!r:hs")).toBe("topic");
        expect(manager.getRoomAvatarUrl("!r:hs")).toBe("mxc://avatar");
        expect(manager.getRoomHistoryVisibility("!r:hs")).toBe("shared");
        expect(manager.getRoomGuestAccess("!r:hs")).toBe("can_join");
        expect(manager.getRoomJoinRule("!r:hs")).toBe("invite");
    });

    it("sets room settings", async () => {
        await manager.setRoomName("!r:hs", "n");
        expect(mockClient.setRoomName).toHaveBeenCalledWith("!r:hs", "n");

        await manager.setRoomTopic("!r:hs", "t");
        expect(mockClient.setRoomTopic).toHaveBeenCalledWith("!r:hs", "t");

        await manager.setRoomAvatar("!r:hs", "mxc://a");
        expect(mockClient.setRoomAvatar).toHaveBeenCalledWith("!r:hs", "mxc://a");

        await manager.setRoomHistoryVisibility("!r:hs", "world_readable");
        expect(mockClient.setRoomHistoryVisibility).toHaveBeenCalledWith("!r:hs", "world_readable");

        await manager.setRoomGuestAccess("!r:hs", true);
        expect(mockClient.setRoomGuestAccess).toHaveBeenCalledWith("!r:hs", true);

        await manager.setRoomJoinRule("!r:hs", "public");
        expect(mockClient.setRoomJoinRule).toHaveBeenCalledWith("!r:hs", "public");
    });
});
