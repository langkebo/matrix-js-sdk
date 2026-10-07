import { describe, it, expect, beforeEach, vi } from "vitest";

import { InvitesManager } from "../../src/invites";
import { MatrixEvent } from "../../src/models/event";
import { EventType } from "../../src/@types/event";
import { KnownMembership } from "../../src/@types/membership";

/*
 * mockClient **故意不提供** `getInviteEvents` / `hasInvite` / `acceptInvite` /
 * `declineInvite` / `inviteUserToRoom` —— 这 5 个方法在本 fork 的 MatrixClient 上
 * 运行时并不存在，原实现的转发即 TypeError。
 *
 * 旧 spec 有两重问题：
 *   ① 把这 5 个不存在的方法 `vi.fn()` 到 mockClient 上，把事实掩盖掉；
 *   ② 断言 `inviteByThreePid` 被以 `("email", "a@hs", "!r:hs")` 调用 —— 而真实签名是
 *      `(roomId, medium, address)`。那条断言等于**把参数错位的 bug 固化成期望**。
 * 本文件对 ① 的防线是"不给假方法"，对 ② 的防线是断言**真实**参数顺序。
 */
describe("InvitesManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: InvitesManager;

    /** 造一条"邀请我入房"的 m.room.member 事件。 */
    const inviteMemberEvent = (sender: string): MatrixEvent =>
        new MatrixEvent({
            event_id: "$invite",
            type: EventType.RoomMember,
            sender,
            origin_server_ts: 123,
            content: { membership: "invite" },
        });

    beforeEach(() => {
        mockClient = {
            getUserId: () => "@me:hs",
            getRooms: () => [],
            getRoom: () => null,
            invite: vi.fn().mockResolvedValue({}),
            inviteByThreePid: vi.fn().mockResolvedValue({}),
            joinRoom: vi.fn().mockResolvedValue({ roomId: "!joined:hs" }),
            leaveRoomChain: vi.fn().mockResolvedValue({}),
        };
        manager = new InvitesManager(mockClient);
    });

    it("inviteByThreePid 按真实签名 (roomId, medium, address) 传参", async () => {
        const result = await manager.inviteByThreePid("email", "a@hs", "!r:hs");

        // 反向断言：若有人按 (medium, address, roomId) 传，这里立刻失败
        expect(mockClient.inviteByThreePid).toHaveBeenCalledWith("!r:hs", "email", "a@hs");
        expect(result).toEqual({ room_id: "!r:hs" });
    });

    it("inviteUserToRoom 按真实签名 (roomId, userId) 传参", async () => {
        const result = await manager.inviteUserToRoom("@a:hs", "!r:hs");

        expect(mockClient.invite).toHaveBeenCalledWith("!r:hs", "@a:hs");
        expect(result).toEqual({ room_id: "!r:hs" });
    });

    it("getInviteEvents 只收 membership=invite 的房间", () => {
        const event = inviteMemberEvent("@inviter:hs");
        mockClient.getRooms = () => [
            {
                roomId: "!in:hs",
                getMyMembership: () => KnownMembership.Invite,
                currentState: { getStateEvents: () => event },
            },
            {
                roomId: "!joined:hs",
                getMyMembership: () => KnownMembership.Join,
                currentState: { getStateEvents: () => inviteMemberEvent("@x:hs") },
            },
        ];

        const invites = manager.getInviteEvents();
        expect(invites).toHaveLength(1);
        expect(invites[0]).toMatchObject({ roomId: "!in:hs", sender: "@inviter:hs" });
        expect(invites[0].event).toBe(event);
    });

    it("getInviteEvents 在未登录（无 userId）时返回空数组", () => {
        mockClient.getUserId = () => null;
        expect(manager.getInviteEvents()).toEqual([]);
    });

    it("hasInvite 依据房间成员态判断（未知房间为 false）", () => {
        mockClient.getRoom = (id: string) =>
            id === "!in:hs" ? { getMyMembership: () => KnownMembership.Invite } : null;

        expect(manager.hasInvite("!in:hs")).toBe(true);
        expect(manager.hasInvite("!other:hs")).toBe(false);
    });

    it("acceptInvite 走 joinRoom 并回传加入后的 room_id", async () => {
        const result = await manager.acceptInvite("!in:hs");

        expect(mockClient.joinRoom).toHaveBeenCalledWith("!in:hs");
        expect(result).toEqual({ room_id: "!joined:hs" });
    });

    it("declineInvite 走 leaveRoomChain 并回传 room_id", async () => {
        const result = await manager.declineInvite("!in:hs");

        expect(mockClient.leaveRoomChain).toHaveBeenCalledWith("!in:hs");
        expect(result).toEqual({ room_id: "!in:hs" });
    });
});
