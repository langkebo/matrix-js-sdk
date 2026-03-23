import "../../src/room-summary/index";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { RoomSummaryManager } from "../../src/room-summary/index";

describe("RoomSummaryManager", () => {
    let mockClient: any;
    let summaryManager: RoomSummaryManager;

    beforeEach(() => {
        mockClient = {
            getRoomSummary: vi.fn().mockResolvedValue({
                room_id: "!room:example.com",
                name: "Test Room",
                member_count: 5,
            }),
            getRoomHierarchy: vi.fn().mockResolvedValue({
                rooms: [],
            }),
            publicRooms: vi.fn().mockResolvedValue({
                chunk: [{ room_id: "!room1:example.com", name: "Public Room" }],
            }),
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

        it("should return null for error", async () => {
            mockClient.getRoomSummary.mockRejectedValueOnce(new Error("Not found"));
            const summary = await summaryManager.getRoomSummary("!unknown:example.com");
            expect(summary).toBeNull();
        });
    });

    describe("getRoomHierarchy", () => {
        it("should get room hierarchy", async () => {
            const hierarchy = await summaryManager.getRoomHierarchy("!space:example.com");
            expect(hierarchy).toBeDefined();
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
});
