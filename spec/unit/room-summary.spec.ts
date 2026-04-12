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

        it("should return null for error when throwOnError is false", async () => {
            authedRequest.mockRejectedValueOnce(new Error("Not found"));
            const summary = await summaryManager.getRoomSummary("!unknown1:example.com");
            expect(summary).toBeNull();
        });

        it("should throw error when throwOnError is true", async () => {
            authedRequest.mockRejectedValueOnce(new Error("Not found"));
            await expect(summaryManager.getRoomSummary("!unknown2:example.com", undefined, true, true)).rejects.toThrow();
        });
    });

    describe("getRoomHierarchy", () => {
        it("should get room hierarchy", async () => {
            const hierarchy = await summaryManager.getRoomHierarchy("!space:example.com");
            expect(hierarchy).toBeDefined();
        });

        it("should return null on error when throwOnError is false", async () => {
            mockClient.getRoomHierarchy.mockRejectedValueOnce(new Error("Not found"));
            const hierarchy = await summaryManager.getRoomHierarchy("!space:example.com");
            expect(hierarchy).toBeNull();
        });

        it("should throw error when throwOnError is true", async () => {
            mockClient.getRoomHierarchy.mockRejectedValueOnce(new Error("Not found"));
            await expect(summaryManager.getRoomHierarchy("!space:example.com", undefined, true)).rejects.toThrow();
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

        it("should return empty array on error when throwOnError is false", async () => {
            authedRequest.mockRejectedValueOnce(new Error("boom"));
            const members = await summaryManager.getRoomSummaryMembers("!room:example.com");
            expect(members).toEqual([]);
        });

        it("should throw on error when throwOnError is true", async () => {
            authedRequest.mockRejectedValueOnce(new Error("boom"));
            await expect(summaryManager.getRoomSummaryMembers("!room:example.com", false, true)).rejects.toThrow();
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

        it("should return null on error when throwOnError is false", async () => {
            authedRequest.mockRejectedValueOnce(new Error("Not found"));
            const stats = await summaryManager.getRoomSummaryStats("!room:example.com");
            expect(stats).toBeNull();
        });

        it("should throw error when throwOnError is true", async () => {
            authedRequest.mockRejectedValueOnce(new Error("Not found"));
            await expect(summaryManager.getRoomSummaryStats("!room:example.com", false, true)).rejects.toThrow();
        });
    });

    describe("write paths", () => {
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

    describe("getPublicRooms", () => {
        it("should get public rooms", async () => {
            const rooms = await summaryManager.getPublicRooms("example.com");
            expect(rooms).toBeDefined();
        });
    });

    describe("searchPublicRooms", () => {
        it("should search public rooms", async () => {
            const rooms = await summaryManager.searchPublicRooms("test", "example.com", 10);
            expect(Array.isArray(rooms)).toBe(true);
        });
    });

    describe("getRecommendedRooms", () => {
        it("should get recommended rooms", async () => {
            const rooms = await summaryManager.getRecommendedRooms("example.com");
            expect(Array.isArray(rooms)).toBe(true);
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
            });
            const result = await summaryManager.getPublicRooms();
            expect(result).toBeDefined();
        });

        it("should return null on error when throwOnError is false", async () => {
            mockClient.publicRooms.mockRejectedValueOnce(new Error("Failed to get public rooms"));
            const result = await summaryManager.getPublicRooms("", undefined, false);
            expect(result).toBeNull();
        });

        it("should throw error when throwOnError is true", async () => {
            mockClient.publicRooms.mockRejectedValueOnce(new Error("Failed to get public rooms"));
            await expect(summaryManager.getPublicRooms("", undefined, true)).rejects.toThrow();
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
