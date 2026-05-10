import { describe, it, expect, beforeEach, vi } from "vitest";

import { StickyEventManager } from "../../src/sticky-event/index";

describe("StickyEventManager", () => {
    let mockClient: any;
    let manager: StickyEventManager;
    let authedRequest: ReturnType<typeof vi.fn>;
    let sendStateEvent: ReturnType<typeof vi.fn>;
    let getRoom: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        authedRequest = vi.fn().mockResolvedValue({});
        sendStateEvent = vi.fn().mockResolvedValue({});
        getRoom = vi.fn().mockReturnValue(null);
        mockClient = {
            http: { authedRequest },
            sendStateEvent,
            getRoom,
            getUserId: () => "@me:x",
        };
        manager = new StickyEventManager(mockClient);
    });

    describe("setStickyEvent", () => {
        it("sends state event when content is provided", async () => {
            const content = {
                event_id: "$e1",
                event_type: "m.room.message",
                content: { body: "pinned" },
                sender: "@me:x",
                ts: 100,
            };
            await manager.setStickyEvent("!r:x", "$e1", content as any);
            expect(sendStateEvent).toHaveBeenCalled();
            expect(sendStateEvent.mock.calls[0][0]).toBe("!r:x");
        });

        it("throws when roomId or eventId missing", async () => {
            await expect(manager.setStickyEvent("", "$e1")).rejects.toThrow();
            await expect(manager.setStickyEvent("!r:x", "")).rejects.toThrow();
        });
    });

    describe("getStickyEvent", () => {
        it("returns null when room not found", async () => {
            getRoom.mockReturnValue(null);
            const result = await manager.getStickyEvent("!r:x");
            expect(result).toBeNull();
        });

        it("reads from cache on second call (after cache populated via set)", async () => {
            const content = {
                event_id: "$e1",
                event_type: "m.room.message",
                content: { body: "x" },
                sender: "@me:x",
                ts: 100,
            };
            await manager.setStickyEvent("!r:x", "$e1", content as any);
            const fromCache = await manager.getStickyEvent("!r:x");
            expect(fromCache?.eventId).toBe("$e1");
        });
    });

    describe("hasStickyEvent", () => {
        it("true when event cached", async () => {
            await manager.setStickyEvent("!r:x", "$e1", {
                event_id: "$e1",
                event_type: "m.room.message",
                content: {},
                sender: "@me:x",
                ts: 1,
            } as any);
            expect(await manager.hasStickyEvent("!r:x")).toBe(true);
        });

        it("false when no sticky in room", async () => {
            getRoom.mockReturnValue(null);
            expect(await manager.hasStickyEvent("!empty:x")).toBe(false);
        });
    });

    describe("clearStickyEvent", () => {
        it("sends empty state event and evicts cache", async () => {
            await manager.setStickyEvent("!r:x", "$e1", {
                event_id: "$e1",
                event_type: "m.room.message",
                content: {},
                sender: "@me:x",
                ts: 1,
            } as any);
            sendStateEvent.mockClear();
            await manager.clearStickyEvent("!r:x");
            expect(sendStateEvent).toHaveBeenCalledWith("!r:x", "m.sticky_event", {}, "");
            getRoom.mockReturnValue(null);
            expect(await manager.hasStickyEvent("!r:x")).toBe(false);
        });
    });

    describe("getMetrics", () => {
        it("returns cache + request stats", () => {
            const m = manager.getMetrics();
            expect(m).toHaveProperty("cache");
            expect(m).toHaveProperty("requests");
            expect(m.requests).toHaveProperty("total");
        });
    });
});
