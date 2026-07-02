import "../../src/thread/index";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { ThreadManager } from "../../src/thread/index";
import { Method } from "../../src/http-api";

describe("ThreadManager", () => {
    let mockClient: any;
    let threadManager: ThreadManager;
    let mockAuthedRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockAuthedRequest = vi.fn();
        mockClient = {
            http: {
                authedRequest: mockAuthedRequest,
            },
            getUserId: vi.fn().mockReturnValue("@user:example.com"),
        };
        threadManager = new ThreadManager(mockClient);
    });

    // ============ Room-scoped thread list ============

    describe("getRoomThreads", () => {
        it("should fetch room threads", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                threads: [
                    { thread_id: "t1", room_id: "!room:example.com", root_event_id: "$ev1", reply_count: 5, participants: [], unread: false },
                ],
            });
            const result = await threadManager.getRoomThreads("!room:example.com");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/rooms/!room%3Aexample.com/threads",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
            expect(result.threads).toHaveLength(1);
            expect(result.threads[0].thread_id).toBe("t1");
        });
    });

    describe("createThread", () => {
        it("should create a thread in a room", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                thread: { thread_id: "t1", room_id: "!room:example.com", root_event_id: "$ev1", reply_count: 0, participants: [], unread: false },
            });
            const result = await threadManager.createThread("!room:example.com", { event_id: "$ev1" });
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!room%3Aexample.com/threads",
                undefined,
                { event_id: "$ev1" },
                { prefix: "/_matrix/client/v1" },
            );
            expect(result.thread.thread_id).toBe("t1");
        });

        it("should throw if event_id is missing", async () => {
            await expect(
                threadManager.createThread("!room:example.com", { event_id: "" }),
            ).rejects.toThrow("event_id is required");
        });
    });

    describe("searchThreads", () => {
        it("should search threads in a room", async () => {
            mockAuthedRequest.mockResolvedValueOnce({ threads: [] });
            await threadManager.searchThreads("!room:example.com", { term: "hello" });
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/rooms/!room%3Aexample.com/threads/search",
                { term: "hello" },
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
        });

        it("should throw if search term is missing", async () => {
            await expect(
                threadManager.searchThreads("!room:example.com", { term: "" }),
            ).rejects.toThrow("search term is required");
        });
    });

    describe("getUnreadRoomThreads", () => {
        it("should fetch unread room threads", async () => {
            mockAuthedRequest.mockResolvedValueOnce({ threads: [] });
            await threadManager.getUnreadRoomThreads("!room:example.com");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/rooms/!room%3Aexample.com/threads/unread",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    // ============ Single thread operations ============

    describe("getThread", () => {
        it("should fetch thread details", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                thread: { thread_id: "t1", room_id: "!room:example.com", root_event_id: "$ev1", reply_count: 3, participants: [], unread: true },
            });
            const result = await threadManager.getThread("!room:example.com", "t1");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/rooms/!room%3Aexample.com/threads/t1",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
            expect(result.thread.thread_id).toBe("t1");
        });

        it("should throw if thread_id is missing", async () => {
            await expect(
                threadManager.getThread("!room:example.com", ""),
            ).rejects.toThrow("thread_id is required");
        });
    });

    describe("deleteThread", () => {
        it("should delete a thread", async () => {
            mockAuthedRequest.mockResolvedValueOnce(undefined);
            await threadManager.deleteThread("!room:example.com", "t1");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/rooms/!room%3Aexample.com/threads/t1",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    describe("freezeThread", () => {
        it("should freeze a thread", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                thread: { thread_id: "t1", room_id: "!room:example.com", root_event_id: "$ev1", reply_count: 3, participants: [], unread: false, frozen: true },
            });
            await threadManager.freezeThread("!room:example.com", "t1");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!room%3Aexample.com/threads/t1/freeze",
                undefined,
                {},
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    describe("unfreezeThread", () => {
        it("should unfreeze a thread", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                thread: { thread_id: "t1", room_id: "!room:example.com", root_event_id: "$ev1", reply_count: 3, participants: [], unread: false, frozen: false },
            });
            await threadManager.unfreezeThread("!room:example.com", "t1");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!room%3Aexample.com/threads/t1/unfreeze",
                undefined,
                {},
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    describe("muteThread", () => {
        it("should mute a thread", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                thread: { thread_id: "t1", room_id: "!room:example.com", root_event_id: "$ev1", reply_count: 3, participants: [], unread: false, muted: true },
            });
            await threadManager.muteThread("!room:example.com", "t1");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!room%3Aexample.com/threads/t1/mute",
                undefined,
                {},
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    describe("markThreadRead", () => {
        it("should mark thread as read", async () => {
            mockAuthedRequest.mockResolvedValueOnce(undefined);
            await threadManager.markThreadRead("!room:example.com", "t1");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!room%3Aexample.com/threads/t1/read",
                undefined,
                {},
                { prefix: "/_matrix/client/v1" },
            );
        });

        it("should mark thread as read up to specific event", async () => {
            mockAuthedRequest.mockResolvedValueOnce(undefined);
            await threadManager.markThreadRead("!room:example.com", "t1", "$ev99");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!room%3Aexample.com/threads/t1/read",
                undefined,
                { read_up_to: "$ev99" },
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    describe("subscribeThread", () => {
        it("should subscribe to a thread", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                thread: { thread_id: "t1", room_id: "!room:example.com", root_event_id: "$ev1", reply_count: 3, participants: [], unread: false, subscribed: true },
            });
            await threadManager.subscribeThread("!room:example.com", "t1");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!room%3Aexample.com/threads/t1/subscribe",
                undefined,
                {},
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    describe("unsubscribeThread", () => {
        it("should unsubscribe from a thread", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                thread: { thread_id: "t1", room_id: "!room:example.com", root_event_id: "$ev1", reply_count: 3, participants: [], unread: false, subscribed: false },
            });
            await threadManager.unsubscribeThread("!room:example.com", "t1");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!room%3Aexample.com/threads/t1/unsubscribe",
                undefined,
                {},
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    // ============ Thread replies ============

    describe("getThreadReplies", () => {
        it("should get thread replies", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                replies: [{ event_id: "$reply1", room_id: "!room:example.com", thread_id: "t1", sender: "@user:example.com", content: {}, origin_server_ts: 1234 }],
            });
            const result = await threadManager.getThreadReplies("!room:example.com", "t1");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/rooms/!room%3Aexample.com/threads/t1/replies",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
            expect(result.replies).toHaveLength(1);
        });
    });

    describe("createThreadReply", () => {
        it("should create a reply in a thread", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                event_id: "$reply1", room_id: "!room:example.com", thread_id: "t1", sender: "@user:example.com", content: { body: "hello" }, origin_server_ts: 1234,
            });
            const result = await threadManager.createThreadReply("!room:example.com", "t1", { content: { body: "hello" } });
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!room%3Aexample.com/threads/t1/replies",
                undefined,
                { content: { body: "hello" } },
                { prefix: "/_matrix/client/v1" },
            );
            expect(result.event_id).toBe("$reply1");
        });

        it("should throw if content is missing", async () => {
            await expect(
                threadManager.createThreadReply("!room:example.com", "t1", { content: undefined as any }),
            ).rejects.toThrow("content is required");
        });
    });

    describe("redactReply", () => {
        it("should redact a reply", async () => {
            mockAuthedRequest.mockResolvedValueOnce(undefined);
            await threadManager.redactReply("!room:example.com", "$reply1");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!room%3Aexample.com/replies/%24reply1/redact",
                undefined,
                {},
                { prefix: "/_matrix/client/v1" },
            );
        });

        it("should redact a reply with reason", async () => {
            mockAuthedRequest.mockResolvedValueOnce(undefined);
            await threadManager.redactReply("!room:example.com", "$reply1", "spam");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!room%3Aexample.com/replies/%24reply1/redact",
                undefined,
                { reason: "spam" },
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    // ============ Thread stats ============

    describe("getThreadStats", () => {
        it("should get thread stats", async () => {
            mockAuthedRequest.mockResolvedValueOnce({ thread_id: "t1", reply_count: 10, participant_count: 3 });
            const result = await threadManager.getThreadStats("!room:example.com", "t1");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/rooms/!room%3Aexample.com/threads/t1/stats",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
            expect(result.reply_count).toBe(10);
        });
    });

    // ============ Global thread operations ============

    describe("getAllThreads", () => {
        it("should fetch all global threads", async () => {
            mockAuthedRequest.mockResolvedValueOnce({ threads: [] });
            await threadManager.getAllThreads();
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/threads",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    describe("createGlobalThread", () => {
        it("should create a global thread", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                thread: { thread_id: "t1", room_id: "!room:example.com", root_event_id: "$ev1", reply_count: 0, participants: [], unread: false },
            });
            const result = await threadManager.createGlobalThread({ room_id: "!room:example.com", event_id: "$ev1" });
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/threads",
                undefined,
                { room_id: "!room:example.com", event_id: "$ev1" },
                { prefix: "/_matrix/client/v1" },
            );
            expect(result.thread.thread_id).toBe("t1");
        });

        it("should throw if room_id is missing", async () => {
            await expect(
                threadManager.createGlobalThread({ room_id: "", event_id: "$ev1" }),
            ).rejects.toThrow("room_id is required");
        });
    });

    describe("getSubscribedThreads", () => {
        it("should fetch subscribed threads", async () => {
            mockAuthedRequest.mockResolvedValueOnce({ threads: [] });
            await threadManager.getSubscribedThreads();
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/threads/subscribed",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    describe("getAllUnreadThreads", () => {
        it("should fetch all unread threads", async () => {
            mockAuthedRequest.mockResolvedValueOnce({ threads: [] });
            await threadManager.getAllUnreadThreads();
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/threads/unread",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    // ============ User-scoped threads ============

    describe("getUserThreads", () => {
        it("should fetch user threads in a room", async () => {
            mockAuthedRequest.mockResolvedValueOnce({ threads: [] });
            await threadManager.getUserThreads("@user:example.com", "!room:example.com");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/user/%40user%3Aexample.com/rooms/!room%3Aexample.com/threads",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    // ============ Lifecycle ============

    describe("start/stop", () => {
        it("should start and stop without errors", () => {
            expect(() => threadManager.start()).not.toThrow();
            expect(() => threadManager.stop()).not.toThrow();
        });
    });
});
