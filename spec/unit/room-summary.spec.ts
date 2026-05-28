import "../../src/room-summary/index";
import { describe, it, expect, beforeEach, vi } from "vitest";

import {
    RoomSummaryManager,
    type RoomSummary,
    type RoomSummaryMember,
    type RoomStats,
} from "../../src/room-summary/index";
import { ClientPrefix, Method } from "../../src/http-api";
import { MatrixError } from "../../src/http-api/errors";

describe("RoomSummaryManager", () => {
    let mockClient: any;
    let summaryManager: RoomSummaryManager;
    let authedRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        authedRequest = vi.fn().mockResolvedValue({
            room_id: "!room:example.com",
            name: "Test Room",
            join_rule: "invite",
            history_visibility: "shared",
            guest_access: "forbidden",
            is_direct: false,
            is_space: false,
            is_encrypted: false,
            member_count: 5,
            joined_member_count: 5,
            invited_member_count: 0,
            heroes: [],
        });
        mockClient = {
            getRoomHierarchy: vi.fn().mockResolvedValue({
                rooms: [],
            }),
            publicRooms: vi.fn().mockResolvedValue({
                chunk: [{ room_id: "!room1:example.com", name: "Public Room" }],
            }),
            http: {
                authedRequest,
            },
            getRooms: vi.fn().mockReturnValue([
                {
                    roomId: "!room1:example.com",
                    name: "Room 1",
                    tags: { "m.favorite": {} },
                    getLastActiveTimestamp: vi.fn().mockReturnValue(1234567890),
                    getJoinedMemberCount: vi.fn().mockReturnValue(5),
                    getMyMembership: vi.fn().mockReturnValue("join"),
                },
            ]),
        };
        summaryManager = new RoomSummaryManager(mockClient);
    });

    describe("getRoomSummary", () => {
        it("should get room summary", async () => {
            const summary = await summaryManager.getRoomSummary("!room:example.com");
            expect(summary).toBeDefined();
            expect(summary?.room_id).toBe("!room:example.com");
        });

        it("should call the v3 room summary endpoint", async () => {
            await summaryManager.getRoomSummary("!room:example.com", undefined, true);

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/summary`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should return null on error by default", async () => {
            authedRequest.mockRejectedValue(new Error("Not found"));
            const summary = await summaryManager.getRoomSummary("!unknown1:example.com", undefined, true);
            expect(summary).toBeNull();
        });

        it("should throw on error when throwOnError is true", async () => {
            authedRequest.mockRejectedValue(new Error("Not found"));
            await expect(
                summaryManager.getRoomSummary("!unknown2:example.com", undefined, true, true),
            ).rejects.toThrow();
        });
    });

    describe("getRoomHierarchy", () => {
        it("should get room hierarchy", async () => {
            const hierarchy = await summaryManager.getRoomHierarchy("!space:example.com");
            expect(hierarchy).toBeDefined();
        });

        it("should throw on error by default", async () => {
            mockClient.getRoomHierarchy.mockRejectedValueOnce(new Error("Not found"));
            await expect(summaryManager.getRoomHierarchy("!space:example.com")).rejects.toThrow();
        });

        it("should return null on error when throwOnError is false", async () => {
            mockClient.getRoomHierarchy.mockRejectedValueOnce(new Error("Not found"));
            const hierarchy = await summaryManager.getRoomHierarchy("!space:example.com", undefined, false);
            expect(hierarchy).toBeNull();
        });
    });

    describe("getRoomSummaryMembers", () => {
        it("should get room summary members", async () => {
            authedRequest.mockResolvedValueOnce([
                { user_id: "@alice:example.com", membership: "join", is_hero: false },
            ]);
            const members = await summaryManager.getRoomSummaryMembers("!room:example.com");
            expect(members).toEqual([{ user_id: "@alice:example.com", membership: "join", is_hero: false }]);
        });

        it("should return RoomSummaryMember[] type", async () => {
            authedRequest.mockResolvedValueOnce([
                { user_id: "@alice:example.com", membership: "join", is_hero: false },
            ]);
            const members = await summaryManager.getRoomSummaryMembers("!room:example.com");
            expect(Array.isArray(members)).toBe(true);
            const firstMember = members[0];
            expect(firstMember).toHaveProperty("user_id");
            expect(firstMember).toHaveProperty("membership");
            expect(firstMember).toHaveProperty("is_hero");
        });

        it("should throw on error by default", async () => {
            authedRequest.mockRejectedValueOnce(new Error("boom"));
            await expect(summaryManager.getRoomSummaryMembers("!room:example.com")).rejects.toThrow();
        });

        it("should return empty array on error when throwOnError is false", async () => {
            authedRequest.mockRejectedValueOnce(new Error("boom"));
            const members = await summaryManager.getRoomSummaryMembers("!room:example.com", false, false);
            expect(members).toEqual([]);
        });
    });

    describe("getRoomSummaryStats", () => {
        it("should get room summary stats", async () => {
            authedRequest.mockResolvedValueOnce({
                room_id: "!room:example.com",
                total_events: 100,
                total_state_events: 50,
                total_messages: 40,
                total_media: 10,
                storage_size: 1024,
            });
            const stats = await summaryManager.getRoomSummaryStats("!room:example.com");
            expect(stats).toEqual({
                room_id: "!room:example.com",
                total_events: 100,
                total_state_events: 50,
                total_messages: 40,
                total_media: 10,
                storage_size: 1024,
            });
        });

        it("should return RoomStats type with required fields", async () => {
            authedRequest.mockResolvedValueOnce({
                room_id: "!room:example.com",
                total_events: 100,
                total_state_events: 50,
                total_messages: 40,
                total_media: 10,
                storage_size: 1024,
            });
            const stats = await summaryManager.getRoomSummaryStats("!room:example.com");
            expect(stats).toHaveProperty("room_id");
            expect(stats).toHaveProperty("total_events");
            expect(stats).toHaveProperty("total_state_events");
            expect(stats).toHaveProperty("total_messages");
            expect(stats).toHaveProperty("total_media");
            expect(stats).toHaveProperty("storage_size");
        });

        it("should throw on error by default", async () => {
            authedRequest.mockRejectedValueOnce(new Error("Not found"));
            await expect(summaryManager.getRoomSummaryStats("!room:example.com")).rejects.toThrow();
        });

        it("should return null on error when throwOnError is false", async () => {
            authedRequest.mockRejectedValueOnce(new Error("Not found"));
            const stats = await summaryManager.getRoomSummaryStats("!room:example.com", false, false);
            expect(stats).toBeNull();
        });
    });

    describe("write paths", () => {
        it("should get event-thread view via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({
                root: {
                    event_id: "$root",
                    room_id: "!room:example.com",
                    sender: "@alice:example.com",
                    type: "m.room.message",
                    content: { body: "root" },
                    origin_server_ts: 123,
                    state_key: undefined,
                },
                replies: [
                    {
                        event_id: "$reply",
                        thread_id: "$thread",
                        room_id: "!room:example.com",
                        sender: "@bob:example.com",
                        content: { body: "reply" },
                        origin_server_ts: 124,
                        in_reply_to_event_id: null,
                        is_edited: false,
                        is_redacted: false,
                    },
                ],
                reply_count: 1,
                participants: ["@alice:example.com", "@bob:example.com"],
            });

            const thread = await summaryManager.getRoomThread("!room:example.com", "$root");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/thread/${encodeURIComponent("$root")}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(thread.root.event_id).toBe("$root");
            expect(thread.replies[0].event_id).toBe("$reply");
            expect(thread.reply_count).toBe(1);
        });

        it("should get thread-detail view via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({
                room_id: "!room:example.com",
                thread_id: "$thread",
                root: {
                    id: 1,
                    room_id: "!room:example.com",
                    root_event_id: "$root",
                    sender: "@alice:example.com",
                    thread_id: "$thread",
                    reply_count: 1,
                    last_reply_event_id: "$reply",
                    last_reply_sender: "@bob:example.com",
                    last_reply_ts: 124,
                    participants: ["@alice:example.com", "@bob:example.com"],
                    is_fetched: false,
                    created_ts: 123,
                    updated_ts: 124,
                },
                replies: [
                    {
                        id: 2,
                        room_id: "!room:example.com",
                        thread_id: "$thread",
                        event_id: "$reply",
                        root_event_id: "$root",
                        sender: "@bob:example.com",
                        in_reply_to_event_id: null,
                        content: { body: "reply" },
                        origin_server_ts: 124,
                        is_edited: false,
                        is_redacted: false,
                        created_ts: 124,
                    },
                ],
                reply_count: 1,
                participants: ["@alice:example.com", "@bob:example.com"],
                summary: {
                    id: 1,
                    room_id: "!room:example.com",
                    thread_id: "$thread",
                    root_event_id: "$root",
                    root_sender: "@alice:example.com",
                    root_content: { body: "root" },
                    root_origin_server_ts: 123,
                    latest_event_id: "$reply",
                    latest_sender: "@bob:example.com",
                    latest_content: { body: "reply" },
                    latest_origin_server_ts: 124,
                    reply_count: 1,
                    participants: ["@alice:example.com", "@bob:example.com"],
                    is_frozen: false,
                    created_ts: 123,
                    updated_ts: 124,
                },
                user_receipt: {
                    id: 1,
                    room_id: "!room:example.com",
                    thread_id: "$thread",
                    user_id: "@alice:example.com",
                    last_read_event_id: "$reply",
                    last_read_ts: 124,
                    unread_count: 0,
                    updated_ts: 124,
                },
                user_subscription: {
                    id: 1,
                    room_id: "!room:example.com",
                    thread_id: "$thread",
                    user_id: "@alice:example.com",
                    notification_level: "all",
                    is_muted: false,
                    subscribed_ts: 123,
                    updated_ts: 124,
                },
            });

            const thread = await summaryManager.getRoomThreadById("!room:example.com", "$thread");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/threads/${encodeURIComponent("$thread")}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(thread.thread_id).toBe("$thread");
            expect(thread.root.root_event_id).toBe("$root");
            expect(thread.summary?.latest_event_id).toBe("$reply");
            expect(thread.user_receipt?.unread_count).toBe(0);
            expect(thread.user_subscription?.notification_level).toBe("all");
        });

        it("should get room capabilities with full backend fields", async () => {
            authedRequest.mockResolvedValueOnce({
                room_id: "!room:example.com",
                room_version: "10",
                capabilities: {
                    knock: false,
                    restricted: false,
                    threading: true,
                    read_receipts: true,
                    typing_notifications: true,
                },
                features: {
                    encryption: true,
                    federation: true,
                    guest_access: false,
                },
                join_rule: "invite",
            });

            const capabilities = await summaryManager.getRoomCapabilities("!room:example.com");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/capabilities`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(capabilities.room_version).toBe("10");
            expect(capabilities.features.encryption).toBe(true);
            expect(capabilities.capabilities.threading).toBe(true);
            expect(capabilities.join_rule).toBe("invite");
        });

        it("should normalize room unread count aliases while preserving backend fields", async () => {
            authedRequest.mockResolvedValueOnce({
                notification_count: 7,
                highlight_count: 2,
            });

            const unread = await summaryManager.getRoomUnreadCount("!room:example.com");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/unread_count`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(unread.notification_count).toBe(7);
            expect(unread.highlight_count).toBe(2);
            expect(unread.room_id).toBe("!room:example.com");
            expect(unread.unread_notifications).toBe(7);
            expect(unread.unread_highlight_count).toBe(2);
        });

        it("should normalize room metadata aliases while preserving backend fields", async () => {
            authedRequest.mockResolvedValueOnce({
                room_id: "!room:example.com",
                name: "Test Room",
                topic: "Topic",
                avatar_url: "mxc://example.com/avatar",
                canonical_alias: "#test:example.com",
                join_rule: "invite",
                history_visibility: "shared",
                creator: "@alice:example.com",
                room_version: "10",
                encryption: "m.megolm.v1.aes-sha2",
                is_public: false,
                member_count: 5,
                created_ts: 1234567890,
            });

            const metadata = await summaryManager.getRoomMetadata("!room:example.com");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/metadata`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(metadata.encryption).toBe("m.megolm.v1.aes-sha2");
            expect(metadata.is_encrypted).toBe(true);
            expect(metadata.created_ts).toBe(1234567890);
            expect(metadata.created_at).toBe(1234567890);
            expect(metadata.member_count).toBe(5);
            expect(metadata.is_public).toBe(false);
        });

        it("should normalize room notifications pagination and legacy aliases", async () => {
            authedRequest.mockResolvedValueOnce({
                notifications: [
                    {
                        room_id: "!room:example.com",
                        event_id: "$event",
                        notification_type: "message",
                        sender: "@system:server",
                        ts: 123,
                        content: { body: "Notification for $event" },
                        is_read: false,
                        client_action: "notify",
                    },
                ],
                next_token: "token-1",
            });

            const result = await summaryManager.getRoomNotifications("!room:example.com", {
                from: "token-0",
                limit: 20,
                only: "highlight",
            });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/notifications`,
                { from: "token-0", limit: "20", only: "highlight" },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result.next_token).toBe("token-1");
            expect(result.next_batch).toBe("token-1");
            expect(result.notifications[0].notification_type).toBe("message");
            expect(result.notifications[0].type).toBe("message");
            expect(result.notifications[0].ts).toBe(123);
            expect(result.notifications[0].timestamp).toBe(123);
            expect(result.notifications[0].is_read).toBe(false);
            expect(result.notifications[0].read).toBe(false);
            expect(result.notifications[0].highlight).toBe(false);
        });

        it("should get room permissions via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({
                can_invite: true,
                can_kick: false,
            });

            const result = await summaryManager.getRoomPermissions("!room:example.com");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/permissions`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result.can_invite).toBe(true);
            expect(result.can_kick).toBe(false);
        });

        it("should get room resolve info via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({
                room_id: "!room:example.com",
                resolved: true,
            });

            const result = await summaryManager.getRoomResolve("!room:example.com");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/resolve`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result.room_id).toBe("!room:example.com");
            expect(result.resolved).toBe(true);
        });

        it("should get room message queue via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({
                events: [{ event_id: "$e1" }],
                next_batch: "n1",
            });

            const result = await summaryManager.getRoomMessageQueue("!room:example.com", {
                from: "n0",
                limit: 20,
            });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/message_queue`,
                { from: "n0", limit: "20" },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result.events?.[0]).toMatchObject({ event_id: "$e1" });
            expect(result.next_batch).toBe("n1");
        });

        it("should get room service types via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({
                service_types: ["messaging", "encryption"],
            });

            const result = await summaryManager.getRoomServiceTypes("!room:example.com");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/service_types`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result.service_types).toEqual(["messaging", "encryption"]);
        });

        it("should get room reduced events via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({
                events: [{ event_id: "$e1" }],
                total: 1,
            });

            const result = await summaryManager.getRoomReducedEvents("!room:example.com");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/reduced_events`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result.events).toHaveLength(1);
            expect(result.total).toBe(1);
        });

        it("should get room rendered payload via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({
                rendered: true,
                html: "<p>hello</p>",
            });

            const result = await summaryManager.getRoomRendered("!room:example.com");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/rendered/`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result.rendered).toBe(true);
        });

        it("should get room fragments via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({
                fragments: [{ id: "f1" }],
            });

            const result = await summaryManager.getRoomFragments("!room:example.com", "@alice:example.com");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/fragments/${encodeURIComponent("@alice:example.com")}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result.fragments).toHaveLength(1);
        });

        it("should get room device view via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({
                device_id: "DEV1",
                room_id: "!room:example.com",
            });

            const result = await summaryManager.getRoomDevice("!room:example.com", "DEV1");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/device/${encodeURIComponent("DEV1")}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result.device_id).toBe("DEV1");
        });

        it("should get room vault data via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({
                encrypted: true,
                key_id: "vault-key",
            });

            const result = await summaryManager.getRoomVaultData("!room:example.com");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/vault_data`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result).toEqual({ encrypted: true, key_id: "vault-key" });
        });

        it("should set room vault data via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce(undefined);

            await summaryManager.setRoomVaultData("!room:example.com", {
                encrypted: true,
                key_id: "vault-key",
            });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                `/rooms/${encodeURIComponent("!room:example.com")}/vault_data`,
                undefined,
                { encrypted: true, key_id: "vault-key" },
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should get room external ids via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce([
                { provider: "slack", external_id: "room-123" },
            ]);

            const result = await summaryManager.getRoomExternalIds("!room:example.com");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/external_ids`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result).toEqual([{ provider: "slack", external_id: "room-123" }]);
        });

        it("should get room event url via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({
                url: "https://example.com/event/$evt",
            });

            const result = await summaryManager.getRoomEventUrl("!room:example.com", "$evt");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/event/${encodeURIComponent("$evt")}/url`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result.url).toContain("/event/");
        });

        it("should translate room event via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({
                room_id: "!room:example.com",
                event_id: "$evt",
                source_text: "Hello",
                translated_text: "你好",
                detected_source_lang: "en",
                target_lang: "zh",
                provider: "google",
            });

            const result = await summaryManager.translateRoomEvent("!room:example.com", "$evt", {
                target_lang: "zh",
            });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                `/rooms/${encodeURIComponent("!room:example.com")}/translate/${encodeURIComponent("$evt")}`,
                undefined,
                { target_lang: "zh" },
                { prefix: ClientPrefix.V3 },
            );
            expect(result.translated_text).toBe("你好");
            expect(result.target_lang).toBe("zh");
            expect(result.provider).toBe("google");
        });

        it("should convert room event via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({
                converted: true,
                format: "markdown",
            });

            const result = await summaryManager.convertRoomEvent("!room:example.com", "$evt", {
                format: "markdown",
            });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                `/rooms/${encodeURIComponent("!room:example.com")}/convert/${encodeURIComponent("$evt")}`,
                undefined,
                { format: "markdown" },
                { prefix: ClientPrefix.V3 },
            );
            expect(result.converted).toBe(true);
        });

        it("should sign room event via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({
                signed: true,
            });

            const result = await summaryManager.signRoomEvent("!room:example.com", "$evt", {
                signature: "abc",
            });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                `/rooms/${encodeURIComponent("!room:example.com")}/sign/${encodeURIComponent("$evt")}`,
                undefined,
                { signature: "abc" },
                { prefix: ClientPrefix.V3 },
            );
            expect(result.signed).toBe(true);
        });

        it("should verify room event via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({
                verified: true,
            });

            const result = await summaryManager.verifyRoomEvent("!room:example.com", "$evt", {
                verifier: "@alice:example.com",
            });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                `/rooms/${encodeURIComponent("!room:example.com")}/verify/${encodeURIComponent("$evt")}`,
                undefined,
                { verifier: "@alice:example.com" },
                { prefix: ClientPrefix.V3 },
            );
            expect(result.verified).toBe(true);
        });

        it("should get room account data via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({ enabled: true });

            const result = await summaryManager.getRoomAccountData("!room:example.com", "m.test");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/account_data/${encodeURIComponent("m.test")}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result.enabled).toBe(true);
        });

        it("should set room account data via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({ ok: true });

            const result = await summaryManager.setRoomAccountDataV3("!room:example.com", "m.test", { enabled: true });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                `/rooms/${encodeURIComponent("!room:example.com")}/account_data/${encodeURIComponent("m.test")}`,
                undefined,
                { enabled: true },
                { prefix: ClientPrefix.V3 },
            );
            expect(result.ok).toBe(true);
        });

        it("should get room invites via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({ invites: [] });

            const result = await summaryManager.getRoomInvites("!room:example.com");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/invites`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result.invites).toEqual([]);
        });

        it("should claim room keys via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({ one_time_keys: {} });

            const result = await summaryManager.claimRoomKeys("!room:example.com", { one_time_keys: {} });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                `/rooms/${encodeURIComponent("!room:example.com")}/keys/claim`,
                undefined,
                { timeout: 1000 },
                { prefix: ClientPrefix.V3 },
            );
            expect(result.one_time_keys).toEqual({});
        });

        it("should get room key count via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({ count: 3 });
            const result = await summaryManager.getRoomKeyCount("!room:example.com");
            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/keys/count`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result.count).toBe(3);
        });

        it("should get room keys version via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({ version: "v1" });
            const result = await summaryManager.getRoomKeysVersion("!room:example.com");
            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/keys/version`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result.version).toBe("v1");
        });

        it("should get room members recent via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({ chunk: [] });
            const result = await summaryManager.getRoomMembersRecent("!room:example.com", { from: "s1", limit: 10 });
            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/members/recent`,
                { from: "s1", limit: "10" },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result.chunk).toEqual([]);
        });

        it("should get room receipts via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({ receipts: [] });
            const result = await summaryManager.getRoomReceipts("!room:example.com", "m.read", "$evt");
            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/receipts/${encodeURIComponent("m.read")}/${encodeURIComponent("$evt")}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result.receipts).toEqual([]);
        });

        it("should forward room keys via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({ count: 1 });
            const result = await summaryManager.forwardRoomKeys("!room:example.com", { room_keys: [] });
            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                `/rooms/${encodeURIComponent("!room:example.com")}/room_keys/keys`,
                undefined,
                { room_keys: [] },
                { prefix: ClientPrefix.V3 },
            );
            expect(result.count).toBe(1);
        });

        it("should search room via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({ results: [] });
            const result = await summaryManager.searchRoom("!room:example.com", { search_term: "hi" });
            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                `/rooms/${encodeURIComponent("!room:example.com")}/search`,
                undefined,
                { search_term: "hi" },
                { prefix: ClientPrefix.V3 },
            );
            expect(result.results).toEqual([]);
        });

        it("should get room power levels via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({ users_default: 0 });
            const result = await summaryManager.getRoomPowerLevels("!room:example.com");
            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/state/m.room.power_levels/`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result.users_default).toBe(0);
        });

        it("should sync room summary via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({ ok: true });

            await summaryManager.syncSummary("!room:example.com", { since: "s1" });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                `/rooms/${encodeURIComponent("!room:example.com")}/summary/sync`,
                undefined,
                { since: "s1" },
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should update summary state via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({ membership: "join" });

            await summaryManager.updateSummaryState("!room:example.com", "m.room.member", "@alice:example.com", {
                membership: "join",
            });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                `/rooms/${encodeURIComponent("!room:example.com")}/summary/state/${encodeURIComponent("m.room.member")}/${encodeURIComponent("@alice:example.com")}`,
                undefined,
                { membership: "join" },
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should recalculate summary stats via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({
                room_id: "!room:example.com",
                total_events: 100,
                total_state_events: 50,
                total_messages: 40,
                total_media: 10,
                storage_size: 1024,
            });

            await summaryManager.recalculateSummaryStats("!room:example.com");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                `/rooms/${encodeURIComponent("!room:example.com")}/summary/stats/recalculate`,
                undefined,
                {},
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should clear unread summary via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({ ok: true });

            await summaryManager.clearSummaryUnread("!room:example.com");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                `/rooms/${encodeURIComponent("!room:example.com")}/summary/unread/clear`,
                undefined,
                {},
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should list user summaries via internal prefix", async () => {
            authedRequest.mockResolvedValueOnce({ summaries: [] });

            await summaryManager.listUserSummaries({ limit: 20 });

            expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/summaries", { limit: 20 }, undefined, {
                prefix: "/_synapse/room_summary/v1",
            });
        });

        it("should normalize bare summary arrays into a list response object", async () => {
            authedRequest.mockResolvedValueOnce([{ room_id: "!room:example.com", name: "Test Room" }]);

            const result = await summaryManager.listUserSummaries({ limit: 20 });

            expect(result).toEqual({
                summaries: [{ room_id: "!room:example.com", name: "Test Room" }],
                rooms: [{ room_id: "!room:example.com", name: "Test Room" }],
                chunk: [{ room_id: "!room:example.com", name: "Test Room" }],
            });
        });

        it("should get all summary state via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce([
                { event_type: "m.room.name", state_key: "", event_id: "$event1", content: { name: "Test" } },
                { event_type: "m.room.topic", state_key: "", event_id: "$event2", content: { topic: "Topic" } },
            ]);

            const states = await summaryManager.getAllSummaryState("!room:example.com");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/summary/state`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(states).toHaveLength(2);
            expect(states[0].event_type).toBe("m.room.name");
        });

        it("should create or refresh summary via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({ room_id: "!room:example.com", name: "New Room" });

            await summaryManager.createOrRefreshSummary("!room:example.com", { name: "New Room" });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                `/rooms/${encodeURIComponent("!room:example.com")}/summary`,
                undefined,
                { name: "New Room" },
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should update summary via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({ room_id: "!room:example.com", name: "Updated" });

            await summaryManager.updateSummary("!room:example.com", { name: "Updated" });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                `/rooms/${encodeURIComponent("!room:example.com")}/summary`,
                undefined,
                { name: "Updated" },
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should delete summary via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce(undefined);

            await summaryManager.deleteSummary("!room:example.com");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Delete,
                `/rooms/${encodeURIComponent("!room:example.com")}/summary`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should write summary members via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({
                members: [{ user_id: "@alice:example.com", membership: "join", is_hero: false }],
            });

            await summaryManager.writeSummaryMembers("!room:example.com", [
                { user_id: "@alice:example.com", membership: "join", is_hero: false },
            ]);

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                `/rooms/${encodeURIComponent("!room:example.com")}/summary/members`,
                undefined,
                { members: [{ user_id: "@alice:example.com", membership: "join", is_hero: false }] },
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should update summary member via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({ user_id: "@alice:example.com", display_name: "Alice" });

            await summaryManager.updateSummaryMember("!room:example.com", "@alice:example.com", {
                display_name: "Alice",
            });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                `/rooms/${encodeURIComponent("!room:example.com")}/summary/members/${encodeURIComponent("@alice:example.com")}`,
                undefined,
                { display_name: "Alice" },
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should delete summary member via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce(undefined);

            await summaryManager.deleteSummaryMember("!room:example.com", "@alice:example.com");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Delete,
                `/rooms/${encodeURIComponent("!room:example.com")}/summary/members/${encodeURIComponent("@alice:example.com")}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should recalculate summary heroes via v3 endpoint", async () => {
            authedRequest.mockResolvedValueOnce({ heroes: ["@alice:example.com", "@bob:example.com"] });

            await summaryManager.recalculateSummaryHeroes("!room:example.com");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                `/rooms/${encodeURIComponent("!room:example.com")}/summary/heroes/recalculate`,
                undefined,
                {},
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should create internal summary via internal prefix", async () => {
            authedRequest.mockResolvedValueOnce({ room_id: "!room:example.com" });

            await summaryManager.createInternalSummary({ room_id: "!room:example.com" });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/summaries",
                undefined,
                { room_id: "!room:example.com" },
                { prefix: "/_synapse/room_summary/v1" },
            );
        });

        it("should process summary updates via internal prefix", async () => {
            authedRequest.mockResolvedValueOnce({ processed: 10 });

            await summaryManager.processSummaryUpdates({ limit: 100 });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/updates/process",
                undefined,
                { limit: 100 },
                { prefix: "/_synapse/room_summary/v1" },
            );
        });
    });

    describe("query parameters", () => {
        it("should preserve zero-valued room notification limits", async () => {
            authedRequest.mockResolvedValueOnce({ notifications: [], next_batch: "batch" });

            await summaryManager.getRoomNotifications("!room:example.com", { limit: 0 });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/notifications`,
                { limit: "0" },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should preserve zero-valued room sync timeout", async () => {
            authedRequest.mockResolvedValueOnce({ timeline: [], state: [] });

            await summaryManager.getRoomSync("!room:example.com", { timeout_ms: 0 });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/sync`,
                { timeout_ms: "0" },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should preserve zero-valued room timeline limits", async () => {
            authedRequest.mockResolvedValueOnce({ events: [], start: "s", end: "e" });

            await summaryManager.getRoomTimeline("!room:example.com", { limit: 0, dir: "b" });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/timeline`,
                { dir: "b", limit: "0" },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should preserve zero-valued encrypted event limits", async () => {
            authedRequest.mockResolvedValueOnce({ events: [], next_batch: "n1" });

            await summaryManager.getEncryptedEvents("!room:example.com", { limit: 0 });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/encrypted_events`,
                { limit: "0" },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should preserve zero-valued room message-queue limits", async () => {
            authedRequest.mockResolvedValueOnce({ events: [], next_batch: "n1" });

            await summaryManager.getRoomMessageQueue("!room:example.com", { limit: 0 });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent("!room:example.com")}/message_queue`,
                { limit: "0" },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });
    });

    describe("getPublicRooms (error handling)", () => {
        it("should get public rooms", async () => {
            const rooms = await summaryManager.getPublicRooms("example.com");
            expect(rooms).toBeDefined();
        });
    });

    describe("searchPublicRooms", () => {
        it("should search public rooms", async () => {
            mockClient.publicRooms.mockResolvedValueOnce({
                chunk: [{ room_id: "!search:example.com", name: "Search Room" }],
            });
            const rooms = await summaryManager.searchPublicRooms("test", "example.com", 10);
            expect(rooms).toEqual([{ room_id: "!search:example.com", name: "Search Room" }]);
        });
    });

    describe("getRecommendedRooms", () => {
        it("should get recommended rooms", async () => {
            mockClient.publicRooms.mockResolvedValueOnce({
                chunk: [{ room_id: "!recommended:example.com", name: "Recommended Room" }],
            });
            const rooms = await summaryManager.getRecommendedRooms("example.com");
            expect(rooms).toEqual([{ room_id: "!recommended:example.com", name: "Recommended Room" }]);
        });
    });

    describe("getFavoriteRooms", () => {
        it("should get favorite rooms", async () => {
            const rooms = await summaryManager.getFavoriteRooms();
            expect(Array.isArray(rooms)).toBe(true);
        });
    });

    describe("getRecentRooms", () => {
        it("should get recent rooms", async () => {
            const rooms = await summaryManager.getRecentRooms(5);
            expect(Array.isArray(rooms)).toBe(true);
        });
    });

    describe("start/stop", () => {
        it("should start and stop without errors", () => {
            expect(() => {
                summaryManager.start();
                summaryManager.stop();
            }).not.toThrow();
        });
    });

    describe("Type Safety", () => {
        it("should enforce RoomSummary required fields at compile time", () => {
            const summary: RoomSummary = {
                room_id: "!room:example.com",
                join_rule: "invite",
                history_visibility: "shared",
                guest_access: "forbidden",
                is_direct: false,
                is_space: false,
                is_encrypted: false,
                member_count: 5,
                joined_member_count: 5,
                invited_member_count: 0,
                heroes: [],
            };
            expect(summary.room_id).toBe("!room:example.com");
            expect(summary.join_rule).toBe("invite");
            expect(summary.member_count).toBe(5);
        });

        it("should enforce RoomStats required fields at compile time", () => {
            const stats: RoomStats = {
                room_id: "!room:example.com",
                total_events: 100,
                total_state_events: 50,
                total_messages: 40,
                total_media: 10,
                storage_size: 1024,
            };
            expect(stats.room_id).toBe("!room:example.com");
            expect(stats.total_events).toBe(100);
            expect(stats.storage_size).toBe(1024);
        });

        it("should enforce RoomSummaryMember required fields at compile time", () => {
            const member: RoomSummaryMember = {
                user_id: "@alice:example.com",
                membership: "join",
                is_hero: false,
            };
            expect(member.user_id).toBe("@alice:example.com");
            expect(member.membership).toBe("join");
            expect(member.is_hero).toBe(false);
        });
    });

    describe("Input Validation", () => {
        it("should validate room ID format in direct HTTP methods", async () => {
            // Test validation in methods that use direct HTTP calls
            await expect(summaryManager.updateSummary("", {})).rejects.toThrow();
            await expect(summaryManager.deleteSummary("invalid")).rejects.toThrow();
        });

        it("should validate user ID format", async () => {
            // validateUserId is called synchronously but async method wraps it in Promise
            await expect(summaryManager.updateSummaryMember("!room:server", "", {})).rejects.toThrow();
        });

        it("should validate event type format", async () => {
            // validateEventType is called synchronously but async method wraps it in Promise
            await expect(summaryManager.updateSummaryState("!room:server", "invalid type", "", {})).rejects.toThrow();
        });
    });

    describe("Retry Mechanism", () => {
        it("should retry on retryable errors", async () => {
            let callCount = 0;
            authedRequest.mockImplementation(async () => {
                callCount++;
                if (callCount <= 2) {
                    throw new MatrixError({
                        errcode: "M_LIMIT_EXCEEDED",
                        httpStatus: 429,
                    } as any);
                }
                return {};
            });

            // Use a method that uses withRetry (updateSummary uses direct HTTP)
            await summaryManager.updateSummary("!room:example.com", { name: "test" });
            expect(callCount).toBe(3); // Initial + 2 retries
        });

        it("should not retry on non-retryable errors", async () => {
            authedRequest.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                } as any),
            );

            await expect(summaryManager.updateSummary("!room:example.com", { name: "test" })).rejects.toThrow();
        });
    });

    describe("getPublicRooms", () => {
        it("should get public rooms successfully", async () => {
            mockClient.publicRooms.mockResolvedValueOnce({
                chunk: [{ room_id: "!room1:example.com", name: "Public Room" }],
                next_batch: "next-token",
            });
            const result = await summaryManager.getPublicRooms();
            expect(result).toEqual({
                chunk: [{ room_id: "!room1:example.com", name: "Public Room" }],
                next_batch: "next-token",
            });
        });

        it("should return null on error when throwOnError is false", async () => {
            mockClient.publicRooms.mockRejectedValueOnce(new Error("Failed to get public rooms"));
            const result = await summaryManager.getPublicRooms("", undefined, false);
            expect(result).toBeNull();
        });

        it("should throw error by default", async () => {
            mockClient.publicRooms.mockRejectedValueOnce(new Error("Failed to get public rooms"));
            await expect(summaryManager.getPublicRooms()).rejects.toThrow();
        });
    });

    describe("Monitoring", () => {
        it("should track request stats on success", async () => {
            await summaryManager.updateSummary("!room:example.com", { name: "test" });
            const stats = summaryManager.getRequestStats();
            expect(stats.successful).toBe(1);
        });

        it("should track request stats on failure", async () => {
            authedRequest.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                } as any),
            );

            await expect(summaryManager.updateSummary("!room:example.com", { name: "test" })).rejects.toThrow();

            const stats = summaryManager.getRequestStats();
            expect(stats.failed).toBe(1);
        });
    });
});
