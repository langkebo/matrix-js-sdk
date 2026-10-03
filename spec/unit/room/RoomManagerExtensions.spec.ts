/**
 * RoomManager 扩展测试 - Batch 1: Core Room Operations
 *
 * 验证新增的核心房间操作方法
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    getRoomDetails,
    getPinnedEvents,
    deletePinnedEvent,
    updatePinnedEvents,
    getRecentMembers,
    getMembership,
    getRoomKey,
    getRoomKeysCount,
    getRoomAccountData,
    setRoomAccountData,
    getTimeline,
    searchRoom,
    getRoomEvent,
} from "../../../src/room/RoomManagerExtensions";
import { validateRoomId } from "../../../src/common/validators";
import { Method } from "../../../src/http-api/method";

describe("RoomManagerExtensions", () => {
    let mockClient: any;

    beforeEach(() => {
        mockClient = {
            http: {
                authenticatedRequest: vi.fn(),
            },
            store: {
                getRoom: vi.fn(),
                getRooms: vi.fn(),
            },
            request: vi.fn(),
            withRetry: vi.fn((fn) => fn()),
        };

        vi.spyOn(mockClient.http, "authenticatedRequest").mockResolvedValue({});
    });

    describe("getRoomDetails", () => {
        it("should fetch room details with correct path", async () => {
            const roomId = "!test:example.com";
            mockClient.http.authenticatedRequest.mockResolvedValue({
                room_id: roomId,
                name: "Test Room",
            });

            const result = await getRoomDetails(mockClient, roomId);

            expect(result).toEqual({ room_id: roomId, name: "Test Room" });
            expect(mockClient.http.authenticatedRequest).toHaveBeenCalledWith({
                method: Method.Get,
                path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}`,
            });
        });
    });

    describe("pinned events operations", () => {
        it("should get pinned events", async () => {
            const roomId = "!test:example.com";
            mockClient.http.authenticatedRequest.mockResolvedValue({
                pinned: ["$event1", "$event2"],
            });

            const result = await getPinnedEvents(mockClient, roomId);

            expect(result.pinned).toEqual(["$event1", "$event2"]);
            expect(mockClient.http.authenticatedRequest).toHaveBeenCalledWith({
                method: Method.Get,
                path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/pinned_events`,
            });
        });

        it("should delete pinned event", async () => {
            const roomId = "!test:example.com";
            const eventId = "$event1";
            mockClient.http.authenticatedRequest.mockResolvedValue({});

            await deletePinnedEvent(mockClient, roomId, eventId);

            expect(mockClient.http.authenticatedRequest).toHaveBeenCalledWith({
                method: Method.Delete,
                path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/pinned_events/${encodeURIComponent(eventId)}`,
            });
        });

        it("should update pinned events", async () => {
            const roomId = "!test:example.com";
            const eventIds = ["$event1", "$event2"];
            mockClient.http.authenticatedRequest.mockResolvedValue({ event_id: "$event3" });

            const result = await updatePinnedEvents(mockClient, roomId, eventIds);

            expect(result.event_id).toBe("$event3");
            expect(mockClient.http.authenticatedRequest).toHaveBeenCalledWith({
                method: Method.Post,
                path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/pinned_events`,
                body: { pinned: eventIds },
            });
        });
    });

    describe("account data operations", () => {
        it("should get room account data", async () => {
            const roomId = "!test:example.com";
            const type = "m.tag";
            mockClient.http.authenticatedRequest.mockResolvedValue({ tag: "favourite" });

            const result = await getRoomAccountData(mockClient, roomId, type);

            expect(result).toEqual({ tag: "favourite" });
            expect(mockClient.http.authenticatedRequest).toHaveBeenCalledWith({
                method: Method.Get,
                path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/account_data/${encodeURIComponent(type)}`,
            });
        });

        it("should set room account data", async () => {
            const roomId = "!test:example.com";
            const type = "m.tag";
            const data = { tag: "favourite" };
            mockClient.http.authenticatedRequest.mockResolvedValue({});

            await setRoomAccountData(mockClient, roomId, type, data);

            expect(mockClient.http.authenticatedRequest).toHaveBeenCalledWith({
                method: Method.Put,
                path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/account_data/${encodeURIComponent(type)}`,
                body: data,
            });
        });
    });

    describe("member operations", () => {
        it("should get recent members", async () => {
            const roomId = "!test:example.com";
            mockClient.http.authenticatedRequest.mockResolvedValue({
                members: [{ event_id: "$event1", user_id: "@user1:example.com", membership: "join" }],
            });

            const result = await getRecentMembers(mockClient, roomId, 10);

            expect(result.members).toHaveLength(1);
            expect(mockClient.http.authenticatedRequest).toHaveBeenCalledWith({
                method: Method.Get,
                path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/members/recent`,
                queryParams: { limit: 10 },
            });
        });

        it("should get membership info", async () => {
            const roomId = "!test:example.com";
            const userId = "@user1:example.com";
            mockClient.http.authenticatedRequest.mockResolvedValue({
                membership: "join",
                event_id: "$event1",
                sender: "@user1:example.com",
                ts: 1234567890,
            });

            const result = await getMembership(mockClient, roomId, userId);

            expect(result.membership).toBe("join");
            expect(mockClient.http.authenticatedRequest).toHaveBeenCalledWith({
                method: Method.Get,
                path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/membership/${encodeURIComponent(userId)}`,
            });
        });
    });

    describe("key operations", () => {
        it("should get room keys count", async () => {
            const roomId = "!test:example.com";
            mockClient.http.authenticatedRequest.mockResolvedValue({ count: 5 });

            const result = await getRoomKeysCount(mockClient, roomId);

            expect(result.count).toBe(5);
        });

        it("should get room key by event ID", async () => {
            const roomId = "!test:example.com";
            const eventId = "$event1";
            mockClient.http.authenticatedRequest.mockResolvedValue({
                key: "key_data",
                algorithm: "m.megolm.v1.aes-sha2",
            });

            const result = await getRoomKey(mockClient, roomId, eventId);

            expect(result.key).toBe("key_data");
        });
    });

    describe("event operations", () => {
        it("should get room event", async () => {
            const roomId = "!test:example.com";
            const eventId = "$event1";
            mockClient.http.authenticatedRequest.mockResolvedValue({
                event_id: eventId,
                type: "m.room.message",
                content: { body: "Hello" },
            });

            const result = await getRoomEvent(mockClient, roomId, eventId);

            expect(result.event_id).toBe(eventId);
        });

        it("should search room", async () => {
            const roomId = "!test:example.com";
            const searchTerm = "hello";
            mockClient.http.authenticatedRequest.mockResolvedValue({
                results: [{ event_id: "$event1", content: { body: "Hello world" } }],
            });

            const result = await searchRoom(mockClient, roomId, searchTerm);

            expect(result.results).toHaveLength(1);
            expect(mockClient.http.authenticatedRequest).toHaveBeenCalledWith({
                method: Method.Post,
                path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/search`,
                body: { search_term: searchTerm },
            });
        });

        it("should get timeline", async () => {
            const roomId = "!test:example.com";
            mockClient.http.authenticatedRequest.mockResolvedValue({
                events: [{ event_id: "$event1", type: "m.room.message" }],
            });

            const result = await getTimeline(mockClient, roomId);

            expect(result.events).toHaveLength(1);
        });
    });

    describe("validation", () => {
        it("should validate room ID before making requests", async () => {
            // Mock validation to throw
            vi.spyOn(await import("../../../src/common/validators"), "validateRoomId").mockImplementation((id) => {
                if (id === "invalid") throw new Error("Invalid room ID");
            });

            await expect(getRoomDetails(mockClient, "invalid")).rejects.toThrow("Invalid room ID");

            // Restore
            vi.mocked(validateRoomId).mockRestore();
        });
    });
});
