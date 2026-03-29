import { beforeEach, describe, expect, it, vi } from "vitest";

import { BurnAfterReadManager } from "../../src/burn-after-read/index";
import { FriendManager, FriendRelationshipStatus } from "../../src/friend/index";
import { RoomListManager } from "../../src/room-list/index";
import { SendingManager } from "../../src/sending/index";

describe("SDK alignment managers", () => {
    describe("SendingManager", () => {
        let client: any;
        let manager: SendingManager;

        beforeEach(() => {
            client = {
                sendEvent: vi.fn().mockResolvedValue({ event_id: "$event" }),
                sendTextMessage: vi.fn().mockResolvedValue({ event_id: "$event" }),
                sendEmoteMessage: vi.fn().mockResolvedValue({ event_id: "$event" }),
                sendImageMessage: vi.fn().mockResolvedValue({ event_id: "$event" }),
                sendMessage: vi.fn().mockResolvedValue({ event_id: "$event" }),
            };
            manager = new SendingManager(client);
        });

        it("passes sendEvent thread and txn arguments through unchanged", async () => {
            await manager.sendEvent("!room:test", "$thread", "m.room.message", { body: "hi" }, "txn-1");

            expect(client.sendEvent).toHaveBeenCalledWith(
                "!room:test",
                "$thread",
                "m.room.message",
                { body: "hi" },
                "txn-1",
            );
        });

        it("maps emote and image helpers to existing client methods", async () => {
            await manager.sendEmote("!room:test", "wave", "txn-2");
            await manager.sendImage("!room:test", "mxc://img", { w: 10 }, "Image");

            expect(client.sendEmoteMessage).toHaveBeenCalledWith("!room:test", "wave", "txn-2");
            expect(client.sendImageMessage).toHaveBeenCalledWith("!room:test", "mxc://img", { w: 10 }, "Image");
        });
    });

    describe("FriendManager", () => {
        let authedRequest: any;
        let manager: FriendManager;

        beforeEach(() => {
            authedRequest = vi.fn().mockResolvedValue({
                friends: [{ user_id: "@alice:test", status: "mystery" }],
            });
            manager = new FriendManager({
                getUserId: vi.fn().mockReturnValue("@me:test"),
                http: { authedRequest },
            } as any);
        });

        it("uses client-prefix relative paths and normalizes unknown statuses", async () => {
            const friends = await manager.getFriends();

            expect(authedRequest).toHaveBeenCalledWith(
                expect.anything(),
                "/friend_room/friends",
                undefined,
                undefined,
                expect.objectContaining({ prefix: "/_matrix/client/v3" }),
            );
            expect(friends[0]?.status).toBe(FriendRelationshipStatus.Normal);
        });
    });

    describe("BurnAfterReadManager", () => {
        let authedRequest: any;
        let manager: BurnAfterReadManager;

        beforeEach(() => {
            authedRequest = vi.fn().mockResolvedValue({
                enabled: true,
                burn_after_ms: 60000,
                default_burn_ms: 60000,
            });
            manager = new BurnAfterReadManager({
                getUserId: vi.fn().mockReturnValue("@me:test"),
                http: { authedRequest },
            } as any);
        });

        it("uses relative room burn endpoints", async () => {
            await manager.enableBurn("!room:test");

            expect(authedRequest).toHaveBeenCalledWith(
                expect.anything(),
                "/rooms/!room%3Atest/burn",
                undefined,
                { enabled: true, burn_after_ms: 60000 },
                expect.objectContaining({ prefix: "/_matrix/client/v1" }),
            );
        });

        it("updates local config when setting burn defaults", async () => {
            await manager.setBurnConfig(90000);

            expect(manager.getBurnConfig().default_expire_time).toBe(60000);
        });
    });

    describe("RoomListManager", () => {
        it("delegates getMyRooms to the client", async () => {
            const client = {
                getMyRooms: vi.fn().mockResolvedValue({ rooms: [{ room_id: "!room:test" }], total: 1 }),
            };
            const manager = new RoomListManager(client as any);

            await expect(manager.getMyRooms()).resolves.toEqual({ rooms: [{ room_id: "!room:test" }], total: 1 });
            expect(client.getMyRooms).toHaveBeenCalled();
        });
    });
});
