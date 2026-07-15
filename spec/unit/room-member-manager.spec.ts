import { describe, it, expect, beforeEach, vi } from "vitest";

import { RoomMemberManager } from "../../src/room-member";
import { Method, ClientPrefix } from "../../src/http-api";

describe("RoomMemberManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: RoomMemberManager;

    beforeEach(() => {
        mockClient = {
            baseUrl: "https://hs",
            http: {
                authedRequest: vi.fn().mockResolvedValue({ user_id: "@a:hs", membership: "join" }),
            },
        };
        manager = new RoomMemberManager(mockClient);
    });

    it("invites and invites by 3pid", async () => {
        await manager.invite("!r:hs", "@a:hs");
        await manager.inviteByThreePid("!r:hs", "email", "a@hs");
        expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
            1,
            Method.Post,
            "/rooms/!r%3Ahs/invite",
            undefined,
            { user_id: "@a:hs" },
            { prefix: ClientPrefix.V3 },
        );
    });

    it("kicks/bans/unbans and gets member", async () => {
        await manager.kick("!r:hs", "@a:hs", "r");
        await manager.ban("!r:hs", "@a:hs", "b");
        await manager.unban("!r:hs", "@a:hs");
        await expect(manager.getRoomMember("!r:hs", "@a:hs")).resolves.toEqual({
            user_id: "@a:hs",
            membership: "join",
        });
    });
});
