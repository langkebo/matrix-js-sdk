import { describe, it, expect, beforeEach, vi } from "vitest";

import { RoomJoiningManager } from "../../src/room-joining";

describe("RoomJoiningManager", () => {
    let mockClient: any;
    let manager: RoomJoiningManager;

    beforeEach(() => {
        mockClient = {
            joinRoom: vi.fn().mockResolvedValue({ roomId: "!r:hs" }),
            leave: vi.fn().mockResolvedValue({}),
            invite: vi.fn().mockResolvedValue({}),
            kick: vi.fn().mockResolvedValue({}),
            ban: vi.fn().mockResolvedValue({}),
            unban: vi.fn().mockResolvedValue({}),
        };
        manager = new RoomJoiningManager(mockClient);
    });

    it("joins and accepts invitation", async () => {
        await manager.joinRoom("#alias:hs", { viaServers: ["hs"] });
        expect(mockClient.joinRoom).toHaveBeenCalledWith("#alias:hs", { viaServers: ["hs"] });

        await manager.acceptInvitation("!r:hs");
        expect(mockClient.joinRoom).toHaveBeenCalledWith("!r:hs");
    });

    it("leaves and manages membership actions", async () => {
        await manager.leaveRoom("!r:hs");
        expect(mockClient.leave).toHaveBeenCalledWith("!r:hs");

        await manager.inviteUser("@u:hs", "!r:hs");
        expect(mockClient.invite).toHaveBeenCalledWith("!r:hs", "@u:hs");

        await manager.kickUser("@u:hs", "!r:hs", "x");
        expect(mockClient.kick).toHaveBeenCalledWith("!r:hs", "@u:hs", "x");

        await manager.banUser("@u:hs", "!r:hs", "y");
        expect(mockClient.ban).toHaveBeenCalledWith("!r:hs", "@u:hs", "y");

        await manager.unbanUser("@u:hs", "!r:hs");
        expect(mockClient.unban).toHaveBeenCalledWith("!r:hs", "@u:hs");
    });
});
