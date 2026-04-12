import { describe, it, expect, beforeEach, vi } from "vitest";

import { InvitesManager } from "../../src/invites";

describe("InvitesManager", () => {
    let mockClient: any;
    let manager: InvitesManager;

    beforeEach(() => {
        mockClient = {
            inviteByThreePid: vi.fn().mockResolvedValue({ room_id: "!r:hs" }),
            inviteUserToRoom: vi.fn().mockResolvedValue({ room_id: "!r:hs" }),
            getInviteEvents: vi.fn().mockReturnValue([{ roomId: "!r:hs", sender: "@a:hs", timestamp: 1 }]),
            hasInvite: vi.fn().mockReturnValue(true),
            acceptInvite: vi.fn().mockResolvedValue({ room_id: "!r:hs" }),
            declineInvite: vi.fn().mockResolvedValue({ room_id: "!r:hs" }),
        };
        manager = new InvitesManager(mockClient);
    });

    it("invites and lists invite info", async () => {
        await expect(manager.inviteByThreePid("email", "a@hs", "!r:hs")).resolves.toEqual({ room_id: "!r:hs" });
        await expect(manager.inviteUserToRoom("@a:hs", "!r:hs")).resolves.toEqual({ room_id: "!r:hs" });
        expect(manager.getInviteEvents()).toHaveLength(1);
        expect(manager.hasInvite("!r:hs")).toBe(true);
    });

    it("accepts and declines invites", async () => {
        await expect(manager.acceptInvite("!r:hs")).resolves.toEqual({ room_id: "!r:hs" });
        await expect(manager.declineInvite("!r:hs")).resolves.toEqual({ room_id: "!r:hs" });
    });
});
