import { beforeEach, describe, expect, it, vi } from "vitest";

import { BurnAfterReadManager } from "../../src/burn-after-read/index";
import { FriendManager, FriendRelationshipStatus } from "../../src/friend/index";
import { RoomListManager } from "../../src/room-list/index";
import { SendingManager } from "../../src/sending/index";

describe("SDK alignment managers", () => {
    describe("SendingManager", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let client: any;
        let manager: SendingManager;

        beforeEach(() => {
            client = {
                sendEvent: vi.fn().mockResolvedValue({ event_id: "$event" }),
                sendTextMessage: vi.fn().mockResolvedValue({ event_id: "$event" }),
                sendEmoteMessage: vi.fn().mockResolvedValue({ event_id: "$event" }),
                sendImageMessage: vi.fn().mockResolvedValue({ event_id: "$event" }),
                sendMessage: vi.fn().mockResolvedValue({ event_id: "$event" }),
                makeTxnId: vi.fn().mockReturnValue("mock-txn-id"),
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

            // sendEmote 直接委托 client.sendEmoteMessage（3 参：roomId, text, txnId）
            expect(client.sendEmoteMessage).toHaveBeenCalledWith("!room:test", "wave", "txn-2");
            // ISSUE-03: sendImage 改走 sendMessage（内部复用 txnId），content 构造与
            // client.sendImageMessage 一致
            expect(client.sendMessage).toHaveBeenCalledWith(
                "!room:test",
                null,
                {
                    msgtype: "m.image",
                    url: "mxc://img",
                    info: { w: 10 },
                    body: "Image",
                },
                "mock-txn-id",
            );
        });
    });

    describe("FriendManager", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let authedRequest: any;
        let manager: FriendManager;

        beforeEach(() => {
            authedRequest = vi.fn().mockResolvedValue({
                friends: [{ user_id: "@alice:test", status: "mystery" }],
            });
            manager = new FriendManager({
                getUserId: vi.fn().mockReturnValue("@me:test"),
                http: { authedRequest },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
        });

        it("uses client-prefix relative paths and normalizes unknown statuses", async () => {
            const friends = await manager.getFriends();

            expect(authedRequest).toHaveBeenCalledWith(
                expect.anything(),
                "/friends",
                undefined,
                undefined,
                { prefix: "/_matrix/vendor/v1" },
            );
            expect(friends[0]?.status).toBe(FriendRelationshipStatus.Normal);
        });
    });

    describe("BurnAfterReadManager", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
        });

        it("uses relative room burn endpoints", async () => {
            await manager.enableBurn("!room:test");

            expect(authedRequest).toHaveBeenCalledWith(
                "PUT",
                "/rooms/!room%3Atest/burn",
                undefined,
                { enabled: true, burn_after_ms: 60000 },
                { prefix: "/_matrix/vendor/v1" },
            );
        });

        it("updates local config when setting burn defaults", async () => {
            await manager.setBurnConfig(90000);

            expect(manager.getBurnConfig().default_expire_time).toBe(60000);
        });
    });

    describe("RoomListManager", () => {
        it("delegates getRooms to the client", async () => {
            const client = {
                getRooms: vi.fn().mockReturnValue([{ roomId: "!room:test" }]),
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const manager = new RoomListManager(client as any);

            const result = await manager.getMyRooms();
            expect(result.rooms).toEqual([{ roomId: "!room:test" }]);
            expect(result.total).toBe(1);
            expect(client.getRooms).toHaveBeenCalled();
        });
    });
});
