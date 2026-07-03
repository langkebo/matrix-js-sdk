/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { describe, it, expect, beforeEach, vi } from "vitest";

import { ThreadingManager } from "../../src/threading/index";

describe("ThreadingManager", () => {
    let mockClient: any;
    let threadingManager: ThreadingManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn().mockResolvedValue({}),
                request: vi.fn().mockResolvedValue({}),
            },
            getRooms: vi.fn().mockReturnValue([]),
            getRoom: vi.fn().mockReturnValue(null),
            store: {
                getRoom: vi.fn().mockReturnValue(null),
                getRooms: vi.fn().mockReturnValue([]),
            },
        };
        threadingManager = new ThreadingManager(mockClient);
    });

    // ============ Global Thread List ============

    describe("getGlobalThreadList", () => {
        it("should fetch global thread list", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                threads: [
                    {
                        id: 1,
                        room_id: "!room:example.com",
                        thread_id: "thread1",
                        root_event_id: "$event1",
                        root_sender: "@user:example.com",
                        root_content: {},
                        root_origin_server_ts: 1,
                        latest_event_id: null,
                        latest_sender: null,
                        latest_content: null,
                        latest_origin_server_ts: null,
                        reply_count: 0,
                        participants: [],
                        is_frozen: false,
                        created_ts: 1,
                        updated_ts: 1,
                    },
                ],
                next_batch: null,
                total: 1,
            });

            const result = await threadingManager.getGlobalThreadList({ limit: 10 });

            expect(result.threads).toHaveLength(1);
            expect(result.total).toBe(1);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/threads",
                { limit: 10 },
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
        });

        it("should fetch global thread list with no params", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                threads: [],
                next_batch: null,
                total: 0,
            });

            const result = await threadingManager.getGlobalThreadList();

            expect(result.threads).toHaveLength(0);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/threads",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    // ============ Room Thread List ============

    describe("getRoomThreadList", () => {
        it("should fetch room thread list", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                threads: [],
                next_batch: null,
                total: 0,
            });

            const result = await threadingManager.getRoomThreadList("!room:example.com", { limit: 20 });

            expect(result.threads).toHaveLength(0);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/rooms/!room%3Aexample.com/threads",
                { limit: 20 },
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    // ============ Room Thread Detail ============

    describe("getRoomThread", () => {
        it("should fetch room thread detail", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                root: {
                    id: 1,
                    room_id: "!room:example.com",
                    root_event_id: "$event1",
                    sender: "@user:example.com",
                    thread_id: "thread1",
                    reply_count: 5,
                    last_reply_event_id: null,
                    last_reply_sender: null,
                    last_reply_ts: null,
                    participants: [],
                    is_fetched: true,
                    created_ts: 1,
                    updated_ts: null,
                },
                replies: [],
                reply_count: 5,
                participants: [],
                summary: null,
                user_receipt: null,
                user_subscription: null,
            });

            const result = await threadingManager.getRoomThread("!room:example.com", "thread1");

            expect(result.root.thread_id).toBe("thread1");
            expect(result.reply_count).toBe(5);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/rooms/!room%3Aexample.com/threads/thread1",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    // ============ Create Thread ============

    describe("createRoomThread", () => {
        it("should create a room thread", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                thread_id: "new-thread",
                root_event_id: "$event1",
                room_id: "!room:example.com",
                sender: "@user:example.com",
                reply_count: 0,
                last_reply_event_id: null,
                last_reply_sender: null,
                last_reply_ts: null,
                participants: [],
                is_fetched: false,
                created_ts: Date.now(),
            });

            const result = await threadingManager.createRoomThread("!room:example.com", "$event1");

            expect(result.thread_id).toBe("new-thread");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/rooms/!room%3Aexample.com/threads",
                undefined,
                { root_event_id: "$event1", content: {}, origin_server_ts: undefined },
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    // ============ Thread Replies ============

    describe("getThreadReplies", () => {
        it("should fetch thread replies", async () => {
            mockClient.http.authedRequest.mockResolvedValue([
                {
                    event_id: "$reply1",
                    thread_id: "thread1",
                    room_id: "!room:example.com",
                    sender: "@user:example.com",
                    content: { body: "Reply" },
                    origin_server_ts: 1,
                    in_reply_to_event_id: null,
                    is_edited: false,
                    is_redacted: false,
                },
            ]);

            const result = await threadingManager.getThreadReplies("!room:example.com", "thread1", { limit: 10 });

            expect(result).toHaveLength(1);
            expect(result[0].event_id).toBe("$reply1");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/rooms/!room%3Aexample.com/threads/thread1/replies",
                { limit: 10 },
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    // ============ Thread Stats ============

    describe("getThreadStats", () => {
        it("should fetch thread statistics", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                id: 1,
                room_id: "!room:example.com",
                thread_id: "thread1",
                total_replies: 10,
                total_participants: 3,
                total_edits: 2,
                total_redactions: 1,
                first_reply_ts: 1000,
                last_reply_ts: 2000,
                avg_reply_time_ms: 500,
                created_ts: 1,
                updated_ts: 1,
            });

            const result = await threadingManager.getThreadStats("!room:example.com", "thread1");

            expect(result?.total_replies).toBe(10);
            expect(result?.total_participants).toBe(3);
        });
    });

    // ============ Subscribe / Unsubscribe ============

    describe("subscribeToThread", () => {
        it("should subscribe to a thread", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                id: 1,
                room_id: "!room:example.com",
                thread_id: "thread1",
                user_id: "@user:example.com",
                notification_level: "all",
                is_muted: false,
                subscribed_ts: Date.now(),
                updated_ts: Date.now(),
            });

            const result = await threadingManager.subscribeToThread("!room:example.com", "thread1");

            expect(result.notification_level).toBe("all");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/rooms/!room%3Aexample.com/threads/thread1/subscribe",
                undefined,
                { notification_level: "all" },
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    describe("markThreadRead", () => {
        it("should mark thread as read", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                id: 1,
                room_id: "!room:example.com",
                thread_id: "thread1",
                user_id: "@user:example.com",
                last_read_event_id: "$event99",
                last_read_ts: 1234567890,
                unread_count: 0,
                updated_ts: 1234567890,
            });

            const result = await threadingManager.markThreadRead("!room:example.com", "thread1", "$event99", 1234567890);

            expect(result.unread_count).toBe(0);
            expect(result.last_read_event_id).toBe("$event99");
        });
    });

    // ============ Delete / Freeze ============

    describe("deleteRoomThread", () => {
        it("should delete a room thread", async () => {
            mockClient.http.authedRequest.mockResolvedValue(undefined);

            await threadingManager.deleteRoomThread("!room:example.com", "thread1");

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "DELETE",
                "/rooms/!room%3Aexample.com/threads/thread1",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    describe("freezeThread", () => {
        it("should freeze a thread", async () => {
            mockClient.http.authedRequest.mockResolvedValue(undefined);

            await threadingManager.freezeThread("!room:example.com", "thread1");

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/rooms/!room%3Aexample.com/threads/thread1/freeze",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
        });
    });
});
