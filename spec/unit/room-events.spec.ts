import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import { RoomEventsManager } from "../../src/room-events";
import { Method } from "../../src/http-api";

describe("RoomEventsManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: RoomEventsManager;
    const roomId = "!room:hs";

    beforeEach(() => {
        mockClient = {
            getRoomEvents: vi.fn().mockResolvedValue([{ id: 1 }]),
            getStateEventsForRoom: vi.fn().mockResolvedValue([{ id: 2 }]),
            getTimelineEvents: vi.fn().mockReturnValue([{ id: 3 }]),
            getEphemeralEvents: vi.fn().mockReturnValue([{ id: 4 }]),
            hasTimelineEvent: vi.fn().mockReturnValue(true),
            findEventById: vi.fn().mockReturnValue({ id: 5 }),
            http: {
                authedRequest: vi.fn().mockResolvedValue({ event_id: "$ok" }),
            },
        };
        manager = new RoomEventsManager(mockClient);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("delegates timeline/state helpers", async () => {
        await expect(manager.getRoomEvents(roomId, 20)).resolves.toEqual([{ id: 1 }]);
        expect(mockClient.getRoomEvents).toHaveBeenCalledWith(roomId, 20);

        await expect(manager.getStateEventsForRoom(roomId)).resolves.toEqual([{ id: 2 }]);
        expect(mockClient.getStateEventsForRoom).toHaveBeenCalledWith(roomId);

        expect(manager.getTimelineEvents(roomId)).toEqual([{ id: 3 }]);
        expect(manager.getEphemeralEvents(roomId)).toEqual([{ id: 4 }]);
        expect(manager.hasTimelineEvent(roomId, "$e")).toBe(true);
        expect(manager.findEventById(roomId, "$e")).toEqual({ id: 5 });
    });

    it("gets single event and messages", async () => {
        await manager.getEvent(roomId, "$e");
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            expect.stringContaining("/rooms/!room%3Ahs/event/%24e"),
        );

        await manager.getMessages(roomId, "b", 30, "t1");
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            expect.stringContaining("/rooms/!room%3Ahs/messages"),
            { dir: "b", limit: "30", from: "t1" },
        );

        await manager.getMessages(roomId, "f", 10);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            expect.stringContaining("/rooms/!room%3Ahs/messages"),
            { dir: "f", limit: "10" },
        );
    });

    it("sends reaction event", async () => {
        vi.spyOn(Date, "now").mockReturnValue(123);
        await manager.sendReaction(roomId, "$evt", "👍");
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Put,
            expect.stringContaining("/rooms/!room%3Ahs/send/m.reaction/m123"),
            undefined,
            {
                "m.relates_to": {
                    rel_type: "m.annotation",
                    event_id: "$evt",
                    key: "👍",
                },
            },
        );
    });
});
