import { describe, it, expect, beforeEach, vi } from "vitest";

import { RoomSettingsManager } from "../../src/room-settings";
import { EventType } from "../../src/@types/event";

describe("RoomSettingsManager", () => {
    let mockClient: any;
    let manager: RoomSettingsManager;

    beforeEach(() => {
        const room = {
            name: "name",
            currentState: {
                getStateEvents: vi.fn((eventType: string) => ({
                    getContent: () => {
                        if (eventType === EventType.RoomTopic) return { topic: "topic" };
                        return {};
                    },
                })),
            },
            getMxcAvatarUrl: vi.fn().mockReturnValue("mxc://avatar"),
            getHistoryVisibility: vi.fn().mockReturnValue("shared"),
            getGuestAccess: vi.fn().mockReturnValue("can_join"),
            getJoinRule: vi.fn().mockReturnValue("invite"),
        };
        mockClient = {
            getRoom: vi.fn().mockReturnValue(room),
            sendStateEvent: vi.fn().mockResolvedValue({ event_id: "$1" }),
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
        expect(mockClient.sendStateEvent).toHaveBeenCalledWith("!r:hs", EventType.RoomName, { name: "n" }, "");

        await manager.setRoomTopic("!r:hs", "t");
        expect(mockClient.sendStateEvent).toHaveBeenCalledWith("!r:hs", EventType.RoomTopic, { topic: "t" }, "");

        await manager.setRoomAvatar("!r:hs", "mxc://a");
        expect(mockClient.sendStateEvent).toHaveBeenCalledWith("!r:hs", EventType.RoomAvatar, { url: "mxc://a" }, "");

        await manager.setRoomHistoryVisibility("!r:hs", "world_readable");
        expect(mockClient.sendStateEvent).toHaveBeenCalledWith(
            "!r:hs",
            EventType.RoomHistoryVisibility,
            { history_visibility: "world_readable" },
            "",
        );

        await manager.setRoomGuestAccess("!r:hs", true);
        expect(mockClient.sendStateEvent).toHaveBeenCalledWith(
            "!r:hs",
            EventType.RoomGuestAccess,
            { guest_access: "can_join" },
            "",
        );

        await manager.setRoomJoinRule("!r:hs", "public");
        expect(mockClient.sendStateEvent).toHaveBeenCalledWith(
            "!r:hs",
            EventType.RoomJoinRules,
            { join_rule: "public" },
            "",
        );
    });
});
