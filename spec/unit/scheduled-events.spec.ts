import { describe, it, expect, beforeEach, vi } from "vitest";

import { ScheduledEventsManager } from "../../src/scheduled-events";

describe("ScheduledEventsManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: ScheduledEventsManager;

    beforeEach(() => {
        mockClient = {
            _unstable_sendDelayedEvent: vi.fn().mockResolvedValue({ event_id: "$1", delay_id: "d1" }),
            _unstable_sendStickyDelayedEvent: vi.fn().mockResolvedValue({ event_id: "$2", delay_id: "d2" }),
            _unstable_sendDelayedStateEvent: vi.fn().mockResolvedValue({ event_id: "$3", delay_id: "d3" }),
            _unstable_getDelayedEvents: vi.fn().mockResolvedValue([{ delay_id: "d1", room_id: "!r:hs" }]),
            _unstable_updateDelayedEvent: vi.fn().mockResolvedValue({ event_id: "$4", delay_id: "d4" }),
            _unstable_restartScheduledDelayedEvent: vi.fn().mockResolvedValue({ event_id: "$5", delay_id: "d5" }),
            _unstable_sendScheduledDelayedEvent: vi.fn().mockResolvedValue({ event_id: "$6", delay_id: "d6" }),
        };
        manager = new ScheduledEventsManager(mockClient);
    });

    it("delegates delayed event methods", async () => {
        await manager.sendDelayedEvent("m.room.message", "!r:hs", { body: "x" }, 1000);
        expect(mockClient._unstable_sendDelayedEvent).toHaveBeenCalledWith(
            "m.room.message",
            "!r:hs",
            { body: "x" },
            1000,
        );

        await manager.sendStickyDelayedEvent("m.room.message", "!r:hs", { body: "x" }, 1000);
        expect(mockClient._unstable_sendStickyDelayedEvent).toHaveBeenCalledWith(
            "m.room.message",
            "!r:hs",
            { body: "x" },
            1000,
        );

        await manager.sendDelayedStateEvent("!r:hs", "m.room.topic", "", { topic: "t" }, 2000);
        expect(mockClient._unstable_sendDelayedStateEvent).toHaveBeenCalledWith(
            "!r:hs",
            "m.room.topic",
            "",
            { topic: "t" },
            2000,
        );
    });

    it("gets/updates/restarts/sends scheduled delayed events", async () => {
        await expect(manager.getDelayedEvents()).resolves.toEqual([{ delay_id: "d1", room_id: "!r:hs" }]);
        expect(mockClient._unstable_getDelayedEvents).toHaveBeenCalled();

        await manager.updateDelayedEvent("d1", 5000);
        expect(mockClient._unstable_updateDelayedEvent).toHaveBeenCalledWith("d1", 5000);

        await manager.restartScheduledDelayedEvent("d1");
        expect(mockClient._unstable_restartScheduledDelayedEvent).toHaveBeenCalledWith("d1");

        await manager.sendScheduledDelayedEvent("d1");
        expect(mockClient._unstable_sendScheduledDelayedEvent).toHaveBeenCalledWith("d1");
    });
});
