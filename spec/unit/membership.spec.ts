import { describe, it, expect, beforeEach, vi } from "vitest";

import { MembershipManager } from "../../src/membership";

describe("MembershipManager", () => {
    let mockClient: any;
    let manager: MembershipManager;

    beforeEach(() => {
        const joinRoom = {
            roomId: "!j:hs",
            getMyMembership: vi.fn().mockReturnValue("join"),
            getJoinedMembers: vi.fn().mockReturnValue([{ userId: "@a:hs" }]),
        };
        const inviteRoom = {
            roomId: "!i:hs",
            getMyMembership: vi.fn().mockReturnValue("invite"),
            getJoinedMembers: vi.fn().mockReturnValue([]),
        };
        const leftRoom = {
            roomId: "!l:hs",
            getMyMembership: vi.fn().mockReturnValue("leave"),
            getJoinedMembers: vi.fn().mockReturnValue([]),
        };
        const joinRoomDetail = {
            getMyMembership: vi.fn().mockReturnValue("join"),
            getJoinedMembers: vi.fn().mockReturnValue([{ userId: "@a:hs" }]),
            getMember: vi.fn(),
        };
        const inviteRoomDetail = {
            getMyMembership: vi.fn().mockReturnValue("invite"),
            getMember: vi.fn(),
        };
        const leftRoomDetail = {
            getMyMembership: vi.fn().mockReturnValue("leave"),
            getMember: vi.fn().mockReturnValue({ userId: "@a:hs" }),
        };
        mockClient = {
            getRooms: vi.fn().mockReturnValue([joinRoom, inviteRoom, leftRoom]),
            getRoom: vi.fn((id: string) => {
                if (id === "!j:hs") return joinRoomDetail;
                if (id === "!i:hs") return inviteRoomDetail;
                return leftRoomDetail;
            }),
        };
        manager = new MembershipManager(mockClient);
    });

    it("filters rooms by membership", async () => {
        expect(manager.getInvitedRooms()).toHaveLength(1);
        await expect(manager.getJoinedRooms()).resolves.toHaveLength(1);
        expect(manager.getLeftRooms()).toHaveLength(1);
    });

    it("checks room flags and members", () => {
        expect(manager.isRoomJoined("!j:hs")).toBe(true);
        expect(manager.isRoomInvited("!i:hs")).toBe(true);
        expect(manager.isRoomLeft("!l:hs")).toBe(true);
        expect(manager.getRoomMembers("!j:hs")).toEqual([{ userId: "@a:hs" }]);
        expect(manager.getMember("!l:hs", "@a:hs")).toEqual({ userId: "@a:hs" });
    });
});
