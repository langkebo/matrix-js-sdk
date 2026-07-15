import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeTransport } from "../test-utils/FakeTransport";
import { TimelineManager } from "../../src/timeline/index";
describe("TimelineManager", () => {
    let transport: FakeTransport;
    let manager: TimelineManager;

    // Helper to create a mock room
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function createMockRoom(roomId: string, timelineSet?: any) {
        const mockTimelineSet = timelineSet ?? {
            getTimelineForEvent: vi.fn().mockReturnValue(null),
        };
        return {
            roomId,
            getUnfilteredTimelineSet: vi.fn().mockReturnValue(mockTimelineSet),
            processThreadedEvents: vi.fn(),
            processThreadRoots: vi.fn(),
            relations: { aggregateChildEvent: vi.fn() },
            currentState: { processBeaconEvents: vi.fn() },
            oldState: { paginationToken: "token" },
            getLiveTimeline: vi.fn().mockReturnValue({}),
            addEventsToTimeline: vi.fn(),
            partitionThreadedEvents: vi.fn().mockReturnValue([[], [], []]),
            findThreadForEvent: vi.fn().mockReturnValue(null),
        };
    }

    function createMockClient(customizations: Record<string, unknown> = {}) {
        return {
            getRoom: vi.fn().mockReturnValue(null),
            getRooms: vi.fn().mockReturnValue([]),
            peekInRoom: vi.fn(),
            stopPeeking: vi.fn(),
            ...customizations,
        };
    }

    beforeEach(() => {
        transport = new FakeTransport();
    });

    // ============ getTimelineForRoom ============

    describe("getTimelineForRoom", () => {
        it("should return the unfiltered timeline set for a known room", () => {
            const mockTimelineSet = { name: "timeline" };
            const room = createMockRoom("!room:example.com", mockTimelineSet);
            const client = createMockClient({ getRoom: vi.fn().mockReturnValue(room) });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });

            const result = manager.getTimelineForRoom("!room:example.com");

            expect(result).toBe(mockTimelineSet);
            expect(client.getRoom).toHaveBeenCalledWith("!room:example.com");
        });

        it("should return null for an unknown room", () => {
            const client = createMockClient({ getRoom: vi.fn().mockReturnValue(null) });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });

            const result = manager.getTimelineForRoom("!nonexistent:example.com");

            expect(result).toBeNull();
        });
    });

    // ============ getEventTimelineSync ============

    describe("getEventTimelineSync", () => {
        it("should find an event's timeline in a room", () => {
            const mockTimeline = { name: "event-timeline" };
            const mockTimelineSet = {
                getTimelineForEvent: vi.fn().mockReturnValue(mockTimeline),
            };
            const room = createMockRoom("!room:example.com", mockTimelineSet);
            const client = createMockClient({ getRoom: vi.fn().mockReturnValue(room) });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });

            const result = manager.getEventTimelineSync("!room:example.com", "$event123");

            expect(result).toBe(mockTimeline);
        });

        it("should return null when room is not found", () => {
            const client = createMockClient({ getRoom: vi.fn().mockReturnValue(null) });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });

            const result = manager.getEventTimelineSync("!unknown:example.com", "$event123");

            expect(result).toBeNull();
        });
    });

    // ============ getEventAndComments ============

    describe("getEventAndComments", () => {
        it("should find an event across all rooms", () => {
            const mockTimeline = { name: "found-timeline" };
            const mockTimelineSet = {
                getTimelineForEvent: vi.fn().mockReturnValue(mockTimeline),
            };
            const room = createMockRoom("!room:example.com", mockTimelineSet);
            const client = createMockClient({
                getRooms: vi.fn().mockReturnValue([room]),
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });

            const result = manager.getEventAndComments("$event123");

            expect(result).not.toBeNull();
            expect(result!.event).toBe(mockTimeline);
            expect(result!.comments).toEqual([]);
        });

        it("should return null when event is not found in any room", () => {
            const mockTimelineSet = {
                getTimelineForEvent: vi.fn().mockReturnValue(null),
            };
            const room = createMockRoom("!room:example.com", mockTimelineSet);
            const client = createMockClient({
                getRooms: vi.fn().mockReturnValue([room]),
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });

            const result = manager.getEventAndComments("$nonexistent");

            expect(result).toBeNull();
        });
    });

    // ============ peekRoom / stopPeeking ============

    describe("peekRoom", () => {
        it("should delegate to client.peekInRoom", async () => {
            const mockRoom = { roomId: "!peeked:example.com" };
            const client = createMockClient({
                peekInRoom: vi.fn().mockResolvedValue(mockRoom),
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });

            const result = await manager.peekRoom("!peeked:example.com");

            expect(result).toBe(mockRoom);
            expect(client.peekInRoom).toHaveBeenCalledWith("!peeked:example.com");
        });
    });

    describe("stopPeeking", () => {
        it("should delegate to client.stopPeeking", async () => {
            const stopPeeking = vi.fn();
            const client = createMockClient({ stopPeeking });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });

            await manager.stopPeeking();

            expect(stopPeeking).toHaveBeenCalledTimes(1);
        });

        it("should handle missing stopPeeking method gracefully", async () => {
            const client = createMockClient();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            delete (client as any).stopPeeking;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });

            // Should not throw
            await expect(manager.stopPeeking()).resolves.toBeUndefined();
        });
    });

    // ============ getEventTimeline ============

    describe("getEventTimeline", () => {
        it("should throw when timeline support is disabled", async () => {
            const client = createMockClient();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });
            const mockTimelineSet = {
                getTimelineForEvent: vi.fn().mockReturnValue(null),
                room: { roomId: "!r:example.com" },
            };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await expect(manager.getEventTimeline(mockTimelineSet as any, "$evt")).rejects.toThrow(
                "timeline support is disabled",
            );
        });

        it("should throw when timeline set has no room", async () => {
            const client = createMockClient();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (client as any).timelineSupport = true;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });
            const mockTimelineSet = { getTimelineForEvent: vi.fn().mockReturnValue(null), room: null };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await expect(manager.getEventTimeline(mockTimelineSet as any, "$evt")).rejects.toThrow(
                "only supports room timelines",
            );
        });

        it("should return cached timeline when event is already known", async () => {
            const mockTimeline = { name: "cached" };
            const mockTimelineSet = {
                getTimelineForEvent: vi.fn().mockReturnValue(mockTimeline),
                room: { roomId: "!r:example.com" },
            };
            const client = createMockClient();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (client as any).timelineSupport = true;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await manager.getEventTimeline(mockTimelineSet as any, "$evt");

            expect(result).toBe(mockTimeline);
        });
    });

    // ============ getLatestTimeline ============

    describe("getLatestTimeline", () => {
        it("should throw when timeline support is disabled", async () => {
            const client = createMockClient();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await expect(manager.getLatestTimeline({} as any)).rejects.toThrow("timeline support is disabled");
        });

        it("should throw when timeline set has no room", async () => {
            const client = createMockClient();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (client as any).timelineSupport = true;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await expect(manager.getLatestTimeline({ room: null } as any)).rejects.toThrow(
                "only supports room timelines",
            );
        });
    });

    // ============ processThreadEvents ============

    describe("processThreadEvents", () => {
        it("should delegate to room.processThreadedEvents", () => {
            const room = createMockRoom("!r:example.com");
            const client = createMockClient();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const events: any[] = [];

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager.processThreadEvents(room as any, events, true);

            expect(room.processThreadedEvents).toHaveBeenCalledWith(events, true);
        });
    });

    // ============ processThreadRoots ============

    describe("processThreadRoots", () => {
        it("should delegate to room.processThreadRoots when threads are supported", () => {
            const room = createMockRoom("!r:example.com");
            const client = createMockClient();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const events: any[] = [];

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager.processThreadRoots(room as any, events, true, true);

            expect(room.processThreadRoots).toHaveBeenCalledWith(events, true);
        });

        it("should be a no-op when threads are not supported", () => {
            const room = createMockRoom("!r:example.com");
            const client = createMockClient();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager.processThreadRoots(room as any, [], true, false);

            expect(room.processThreadRoots).not.toHaveBeenCalled();
        });
    });

    // ============ processAggregatedTimelineEvents ============

    describe("processAggregatedTimelineEvents", () => {
        it("should be a no-op when events array is empty", () => {
            expect.assertions(0);
            const room = createMockRoom("!r:example.com");
            const client = createMockClient();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });

            // Should not throw
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager.processAggregatedTimelineEvents(room as any, []);
        });

        it("should be a no-op when room is undefined", () => {
            expect.assertions(0);
            const client = createMockClient();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });

            // Should not throw
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager.processAggregatedTimelineEvents(undefined, [{ getId: () => "$e1" } as any]);
        });

        it("should process events through room relations and state", () => {
            const room = createMockRoom("!r:example.com");
            const client = createMockClient();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const events = [{ getId: () => "$e1" } as any];

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager.processAggregatedTimelineEvents(room as any, events);

            expect(room.relations.aggregateChildEvent).toHaveBeenCalledWith(events[0]);
            expect(room.currentState.processBeaconEvents).toHaveBeenCalledWith(events, client);
        });
    });

    // ============ processBeaconEvents ============

    describe("processBeaconEvents", () => {
        it("should delegate to processAggregatedTimelineEvents", () => {
            const room = createMockRoom("!r:example.com");
            const client = createMockClient();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const events = [{ getId: () => "$e1" } as any];
            const processAggregatedSpy = vi.spyOn(manager, "processAggregatedTimelineEvents");

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager.processBeaconEvents(room as any, events);

            expect(processAggregatedSpy).toHaveBeenCalledWith(room, events);
        });
    });

    // ============ processPaginationEvents ============

    describe("processPaginationEvents", () => {
        it("should add events to timeline and process aggregated events", () => {
            const client = createMockClient();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new TimelineManager(client as any, { transport });

            const mockTimelineSet = {
                addEventsToTimeline: vi.fn(),
            };
            const mockTimeline = {
                getTimelineSet: vi.fn().mockReturnValue(mockTimelineSet),
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const events = [{ getId: () => "$e1" } as any];

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager.processPaginationEvents(mockTimeline as any, events, true, "token");

            expect(mockTimelineSet.addEventsToTimeline).toHaveBeenCalledWith(
                events,
                true,
                false,
                mockTimeline,
                "token",
            );
        });
    });
});
