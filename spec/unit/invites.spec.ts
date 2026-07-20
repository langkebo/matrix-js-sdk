import { describe, it, expect, beforeEach, vi } from "vitest";

import { InvitesManager } from "../../src/invites";

describe("InvitesManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: InvitesManager;

    beforeEach(() => {
        mockClient = {
            inviteByThreePid: vi.fn().mockResolvedValue({ room_id: "!r:hs" }),
            inviteUserToRoom: vi.fn().mockResolvedValue({ room_id: "!r:hs" }),
            getInviteEvents: vi.fn().mockReturnValue([{ roomId: "!r:hs", sender: "@a:hs", timestamp: 1 }]),
            hasInvite: vi.fn().mockReturnValue(true),
            acceptInvite: vi.fn().mockResolvedValue({ room_id: "!a:hs" }),
            declineInvite: vi.fn().mockResolvedValue({ room_id: "!d:hs" }),
        };
        manager = new InvitesManager(mockClient);
    });

    it("invites by three-pid with correct parameter forwarding", async () => {
        await manager.inviteByThreePid("email", "a@hs", "!r:hs");
        expect(mockClient.inviteByThreePid).toHaveBeenCalledWith("email", "a@hs", "!r:hs");
    });

    it("invites user to room with correct parameter forwarding", async () => {
        await manager.inviteUserToRoom("@a:hs", "!r:hs");
        expect(mockClient.inviteUserToRoom).toHaveBeenCalledWith("@a:hs", "!r:hs");
    });

    it("lists invite events from client", () => {
        const events = manager.getInviteEvents();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ roomId: "!r:hs", sender: "@a:hs" });
    });

    it("checks for invite via client", () => {
        expect(manager.hasInvite("!r:hs")).toBe(true);
        expect(mockClient.hasInvite).toHaveBeenCalledWith("!r:hs");
    });

    it("accepts invite with correct parameter forwarding", async () => {
        const result = await manager.acceptInvite("!r:hs");
        expect(mockClient.acceptInvite).toHaveBeenCalledWith("!r:hs");
        expect(result).toHaveProperty("room_id");
    });

    it("declines invite with correct parameter forwarding", async () => {
        const result = await manager.declineInvite("!r:hs");
        expect(mockClient.declineInvite).toHaveBeenCalledWith("!r:hs");
        expect(result).toHaveProperty("room_id");
    });
});
