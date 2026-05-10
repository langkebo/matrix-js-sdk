import { beforeEach, describe, expect, it, vi } from "vitest";

import { Method } from "../../src/http-api/index.ts";
import { ThreadingManager } from "../../src/threading/index.ts";

describe("ThreadingManager", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let getRooms: ReturnType<typeof vi.fn>;
    let manager: ThreadingManager;

    beforeEach(() => {
        authedRequest = vi.fn();
        getRooms = vi.fn().mockReturnValue([]);
        manager = new ThreadingManager({
            http: { authedRequest },
            getRooms,
            getRoom: vi.fn(),
        } as any);
        manager.setRetryOptions({ maxRetries: 0 });
    });

    describe("getGlobalThreadList", () => {
        it("GETs /threads on ClientPrefix.V1 without query when empty", async () => {
            authedRequest.mockResolvedValueOnce({ threads: [], next_batch: null, total: 0 });

            await manager.getGlobalThreadList();

            expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/threads", undefined, undefined, {
                prefix: "/_matrix/client/v1",
            });
        });

        it("includes limit/from when provided", async () => {
            authedRequest.mockResolvedValueOnce({ threads: [], next_batch: null, total: 0 });

            await manager.getGlobalThreadList({ limit: 10, from: "cursor" });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/threads",
                { limit: 10, from: "cursor" },
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
        });

        it("propagates 401 typed errors via normalizeError", async () => {
            const err = Object.assign(new Error("Unauthorized"), {
                httpStatus: 401,
                errcode: "M_UNKNOWN_TOKEN",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.getGlobalThreadList()).rejects.toMatchObject({ statusCode: 401 });
        });
    });

    describe("getRoomThreadList", () => {
        it("URL-encodes roomId and includes include_all", async () => {
            authedRequest.mockResolvedValueOnce({ threads: [], next_batch: null, total: 0 });

            await manager.getRoomThreadList("!r:e", { limit: 5, includeAll: true });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/rooms/!r%3Ae/threads",
                { limit: 5, include_all: true },
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    describe("createRoomThread", () => {
        it("POSTs to /rooms/{roomId}/threads with root_event_id body", async () => {
            authedRequest.mockResolvedValueOnce({
                thread_id: "$t",
                root_event_id: "$r",
                room_id: "!r:e",
                sender: "@u:e",
                reply_count: 0,
                last_reply_event_id: null,
                last_reply_sender: null,
                last_reply_ts: null,
                participants: [],
                is_fetched: true,
                created_ts: 0,
            });

            await manager.createRoomThread("!r:e", "$r", { content: { body: "hi" } });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!r%3Ae/threads",
                undefined,
                { root_event_id: "$r", content: { body: "hi" }, origin_server_ts: undefined },
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    describe("addThreadReply", () => {
        it("POSTs /replies with snake_case body", async () => {
            authedRequest.mockResolvedValueOnce({
                event_id: "$e",
                thread_id: "$t",
                room_id: "!r:e",
                sender: "@u:e",
                content: {},
                origin_server_ts: 0,
                in_reply_to_event_id: null,
                is_edited: false,
                is_redacted: false,
            });

            await manager.addThreadReply("!r:e", "$t", {
                eventId: "$e",
                rootEventId: "$r",
                content: { body: "ok" },
                inReplyToEventId: "$prev",
            });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!r%3Ae/threads/%24t/replies",
                undefined,
                {
                    event_id: "$e",
                    root_event_id: "$r",
                    content: { body: "ok" },
                    in_reply_to_event_id: "$prev",
                    origin_server_ts: undefined,
                },
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    describe("subscribeToThread", () => {
        it("POSTs subscribe with notification_level body", async () => {
            authedRequest.mockResolvedValueOnce({
                id: 1,
                room_id: "!r:e",
                thread_id: "$t",
                user_id: "@u:e",
                notification_level: "all",
                is_muted: false,
                subscribed_ts: 0,
                updated_ts: 0,
            });

            await manager.subscribeToThread("!r:e", "$t", "mentions");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!r%3Ae/threads/%24t/subscribe",
                undefined,
                { notification_level: "mentions" },
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    describe("markThreadRead", () => {
        it("POSTs /read with event_id + origin_server_ts", async () => {
            authedRequest.mockResolvedValueOnce({
                id: 1,
                room_id: "!r:e",
                thread_id: "$t",
                user_id: "@u:e",
                last_read_event_id: "$e",
                last_read_ts: 123,
                unread_count: 0,
                updated_ts: 123,
            });

            await manager.markThreadRead("!r:e", "$t", "$e", 123);

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!r%3Ae/threads/%24t/read",
                undefined,
                { event_id: "$e", origin_server_ts: 123 },
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    describe("deleteRoomThread", () => {
        it("DELETEs /rooms/{roomId}/threads/{threadId}", async () => {
            authedRequest.mockResolvedValueOnce(undefined);

            await manager.deleteRoomThread("!r:e", "$t");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/rooms/!r%3Ae/threads/%24t",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
        });

        it("propagates 403 typed errors", async () => {
            const err = Object.assign(new Error("Forbidden"), {
                httpStatus: 403,
                errcode: "M_FORBIDDEN",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.deleteRoomThread("!r:e", "$t")).rejects.toMatchObject({ statusCode: 403 });
        });
    });

    describe("getThreadStats", () => {
        it("GETs the /stats sub-resource", async () => {
            authedRequest.mockResolvedValueOnce({
                id: 1,
                room_id: "!r:e",
                thread_id: "$t",
                total_replies: 3,
                total_participants: 2,
                total_edits: 0,
                total_redactions: 0,
                first_reply_ts: 0,
                last_reply_ts: 0,
                avg_reply_time_ms: 0,
                created_ts: 0,
                updated_ts: 0,
            });

            await manager.getThreadStats("!r:e", "$t");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/rooms/!r%3Ae/threads/%24t/stats",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    describe("local helpers", () => {
        it("getThread aggregates across rooms", () => {
            const thread = { id: "$t" };
            getRooms.mockReturnValueOnce([{ getThread: () => null }, { getThread: () => thread }]);
            expect(manager.getThread("$t")).toBe(thread);
        });

        it("hasThread returns false when thread is missing", () => {
            getRooms.mockReturnValueOnce([{ getThread: () => null }]);
            expect(manager.hasThread("$t")).toBe(false);
        });
    });
});
