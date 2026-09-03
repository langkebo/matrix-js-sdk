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

    describe("getMembershipEvents", () => {
        it("POSTs to /rooms/{roomId}/get_membership_events on r0 prefix", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                events: [
                    {
                        event_id: "$e1",
                        type: "m.room.member",
                        sender: "@a:hs",
                        state_key: "@a:hs",
                        content: { membership: "join" },
                        origin_server_ts: 1700000000,
                    },
                ],
            });

            const res = await manager.getMembershipEvents("!r:hs", { limit: 50 });

            expect(res.events).toHaveLength(1);
            expect(res.events[0].event_id).toBe("$e1");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!r%3Ahs/get_membership_events",
                undefined,
                { limit: 50 },
                { prefix: ClientPrefix.R0 },
            );
        });

        it("works without a limit", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({ events: [] });

            const res = await manager.getMembershipEvents("!r:hs");

            expect(res.events).toEqual([]);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!r%3Ahs/get_membership_events",
                undefined,
                undefined,
                { prefix: ClientPrefix.R0 },
            );
        });
    });
});
