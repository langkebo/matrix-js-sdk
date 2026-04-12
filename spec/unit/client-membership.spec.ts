import { describe, it, expect, vi } from "vitest";

import {
    normalizeInviteOptions,
    createMissingIdentityServerError,
    buildInviteByThreePidParams,
    buildRoomInvitePath,
    buildMembershipChangePath,
    buildRoomForgetPath,
    buildRoomUnbanPath,
    buildRoomKickPath,
    buildMembershipChangeBody,
    buildSingleUserBody,
    selectLeaveRoomChainTargets,
    inviteToRoomRequest,
    inviteByThreePidRequest,
    forgetRoomRequest,
    unbanRoomUserRequest,
    kickRoomUserRequest,
    membershipChangeRequest,
    leaveRoomChainRequest,
} from "../../src/client-membership";
import { Method } from "../../src/http-api";

describe("client-membership", () => {
    it("normalizes invite options", () => {
        expect(normalizeInviteOptions("r")).toEqual({ reason: "r" });
        expect(normalizeInviteOptions({ reason: "x", shareEncryptedHistory: true })).toEqual({
            reason: "x",
            shareEncryptedHistory: true,
        });
    });

    it("builds error and request params/paths/bodies", () => {
        const err = createMissingIdentityServerError();
        expect(err.errcode).toBe("ORG.MATRIX.JSSDK_MISSING_PARAM");
        expect(buildInviteByThreePidParams("id.server", "email", "a@b.c")).toEqual({
            id_server: "id.server",
            medium: "email",
            address: "a@b.c",
        });
        expect(buildInviteByThreePidParams("id.server", "email", "a@b.c", "tok")).toEqual({
            id_server: "id.server",
            medium: "email",
            address: "a@b.c",
            id_access_token: "tok",
        });
        expect(buildRoomInvitePath("!r:hs")).toContain("/rooms/!r%3Ahs/invite");
        expect(buildMembershipChangePath("!r:hs", "leave")).toContain("/rooms/!r%3Ahs/leave");
        expect(buildRoomForgetPath("!r:hs")).toContain("/rooms/!r%3Ahs/forget");
        expect(buildRoomUnbanPath("!r:hs")).toContain("/rooms/!r%3Ahs/unban");
        expect(buildRoomKickPath("!r:hs")).toContain("/rooms/!r%3Ahs/kick");
        expect(buildMembershipChangeBody("@u:hs", "why")).toEqual({ user_id: "@u:hs", reason: "why" });
        expect(buildSingleUserBody("@u:hs")).toEqual({ user_id: "@u:hs", reason: undefined });
    });

    it("selects leave chain targets", () => {
        const rooms = [{ roomId: "!a:hs" }, { roomId: "!b:hs" }, { roomId: "!c:hs" }] as any[];
        expect(selectLeaveRoomChainTargets(rooms, "!b:hs", false).map((r) => r.roomId)).toEqual(["!a:hs", "!b:hs"]);
        expect(selectLeaveRoomChainTargets(rooms, "!b:hs", true).map((r) => r.roomId)).toEqual([
            "!a:hs",
            "!b:hs",
            "!c:hs",
        ]);
    });

    it("invites to room with history-sharing flow", async () => {
        const shareRoomHistoryWithUser = vi.fn().mockResolvedValue(undefined);
        const membershipChange = vi.fn().mockResolvedValue({});
        await inviteToRoomRequest({
            roomId: "!r:hs",
            userId: "@u:hs",
            opts: { reason: "ok", shareEncryptedHistory: true },
            shareRoomHistoryWithUser,
            membershipChange,
        });
        expect(shareRoomHistoryWithUser).toHaveBeenCalledWith("!r:hs", "@u:hs");
        expect(membershipChange).toHaveBeenCalledWith("!r:hs", "@u:hs", "invite", "ok");
    });

    it("invites by threepid and handles missing identity server", async () => {
        const authedRequest = vi.fn().mockResolvedValue({});
        await inviteByThreePidRequest({
            roomId: "!r:hs",
            medium: "email",
            address: "a@b.c",
            getIdentityServerUrl: () => "id.server",
            getIdentityAccessToken: async () => "token",
            authedRequest,
        });
        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            expect.stringContaining("/rooms/!r%3Ahs/invite"),
            undefined,
            {
                id_server: "id.server",
                medium: "email",
                address: "a@b.c",
                id_access_token: "token",
            },
        );

        await expect(
            inviteByThreePidRequest({
                roomId: "!r:hs",
                medium: "email",
                address: "a@b.c",
                getIdentityServerUrl: () => undefined,
                authedRequest,
            }),
        ).rejects.toMatchObject({ errcode: "ORG.MATRIX.JSSDK_MISSING_PARAM" });
    });

    it("forgets room and optionally removes local room", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ ok: true });
        const removeRoom = vi.fn();
        const emitDeleteRoom = vi.fn();
        await forgetRoomRequest("!r:hs", true, authedRequest, removeRoom, emitDeleteRoom);
        expect(removeRoom).toHaveBeenCalledWith("!r:hs");
        expect(emitDeleteRoom).toHaveBeenCalledWith("!r:hs");

        removeRoom.mockClear();
        emitDeleteRoom.mockClear();
        await forgetRoomRequest("!r:hs", false, authedRequest, removeRoom, emitDeleteRoom);
        expect(removeRoom).not.toHaveBeenCalled();
        expect(emitDeleteRoom).not.toHaveBeenCalled();
    });

    it("builds unban/kick/membership change requests", async () => {
        const authedRequest = vi.fn().mockResolvedValue({});
        await unbanRoomUserRequest("!r:hs", "@u:hs", authedRequest);
        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            expect.stringContaining("/rooms/!r%3Ahs/unban"),
            undefined,
            { user_id: "@u:hs", reason: undefined },
        );

        await kickRoomUserRequest("!r:hs", "@u:hs", "spam", authedRequest);
        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            expect.stringContaining("/rooms/!r%3Ahs/kick"),
            undefined,
            { user_id: "@u:hs", reason: "spam" },
        );

        await membershipChangeRequest("!r:hs", "@u:hs", "ban", "x", authedRequest);
        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            expect.stringContaining("/rooms/!r%3Ahs/ban"),
            undefined,
            { user_id: "@u:hs", reason: "x" },
        );
    });

    it("leaves room chain and collects failures", async () => {
        const leave = vi.fn(async (roomId: string) => {
            if (roomId === "!b:hs") throw new Error("no");
            return {};
        });
        const getRoomUpgradeHistory = vi
            .fn()
            .mockReturnValue([{ roomId: "!a:hs" }, { roomId: "!b:hs" }, { roomId: "!c:hs" }]);

        const res = await leaveRoomChainRequest("!b:hs", false, getRoomUpgradeHistory, leave);
        expect(leave).toHaveBeenCalledTimes(2);
        expect(Object.keys(res)).toEqual(["!b:hs"]);
    });
});
