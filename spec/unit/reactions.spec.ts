import { describe, it, expect, beforeEach, vi } from "vitest";

import { ReactionsManager } from "../../src/reactions";

function mkReaction(opts: { sender?: string; key?: string; id?: string } = {}): any {
    return {
        getSender: vi.fn(() => opts.sender),
        getRelation: vi.fn(() => (opts.key ? { key: opts.key } : undefined)),
        getId: vi.fn(() => opts.id),
        getType: vi.fn(() => "m.reaction"),
    };
}

describe("ReactionsManager", () => {
    let mockClient: any;
    let manager: ReactionsManager;
    const roomId = "!room:hs";
    const eventId = "$event";

    beforeEach(() => {
        mockClient = {
            reactToMessage: vi.fn().mockResolvedValue(undefined),
            redactReaction: vi.fn().mockResolvedValue(undefined),
            getReactionUsers: vi.fn().mockResolvedValue([{ userId: "@a:hs" }, { userId: "@b:hs" }]),
            hasReaction: vi.fn().mockResolvedValue(false),
            getUserId: vi.fn().mockReturnValue("@me:hs"),
            getRoom: vi.fn(),
        };
        manager = new ReactionsManager(mockClient);
    });

    it("calls client wrappers", async () => {
        await manager.reactToMessage(roomId, eventId, "👍");
        expect(mockClient.reactToMessage).toHaveBeenCalledWith(roomId, eventId, "👍");

        await manager.redactReaction(roomId, "$r1");
        expect(mockClient.redactReaction).toHaveBeenCalledWith(roomId, "$r1");

        await expect(manager.getReactionUsers(roomId, eventId)).resolves.toEqual(["@a:hs", "@b:hs"]);
        await expect(manager.hasReaction(roomId, eventId, "@me:hs", "👍")).resolves.toBe(false);
    });

    it("returns reactions for event and summaries", () => {
        const reactions = [
            mkReaction({ sender: "@a:hs", key: "👍", id: "$r1" }),
            mkReaction({ sender: "@b:hs", key: "👍", id: "$r2" }),
            mkReaction({ sender: "@a:hs", key: "❤️", id: "$r3" }),
        ];
        mockClient.getRoom.mockReturnValue({
            relations: {
                getChildEventsForEvent: vi.fn(() => ({ getRelations: () => reactions })),
            },
            timeline: [
                { getType: () => "m.room.message", getId: () => "$m1" },
                { getType: () => "m.room.message", getId: () => "$m2" },
            ],
        });

        const all = manager.getReactionsForEvent(roomId, eventId);
        expect(all).toHaveLength(3);

        const summary = manager.getReactionSummary(roomId, eventId);
        expect(summary.totalReactions).toBe(3);
        expect(summary.reactions.find((r) => r.key === "👍")?.count).toBe(2);
        expect(manager.getReactionCount(roomId, eventId, "❤️")).toBe(1);
        expect(manager.getReactionsByUser(roomId, "@a:hs", eventId)).toHaveLength(2);
    });

    it("handles empty room", () => {
        mockClient.getRoom.mockReturnValue(undefined);
        expect(manager.getReactionsForEvent(roomId, eventId)).toEqual([]);
        expect(manager.getMostReactedMessages(roomId)).toEqual([]);
    });

    it("toggles reaction: redact when already reacted", async () => {
        const myReaction = mkReaction({ sender: "@me:hs", key: "👍", id: "$mine" });
        mockClient.getRoom.mockReturnValue({
            relations: {
                getChildEventsForEvent: vi.fn(() => ({ getRelations: () => [myReaction] })),
            },
            timeline: [],
        });
        mockClient.hasReaction.mockResolvedValue(true);

        await manager.toggleReaction(roomId, eventId, "👍");
        expect(mockClient.redactReaction).toHaveBeenCalledWith(roomId, "$mine");
        expect(mockClient.reactToMessage).not.toHaveBeenCalled();
    });

    it("toggles reaction: send when not reacted or no user", async () => {
        mockClient.hasReaction.mockResolvedValue(false);
        await manager.toggleReaction(roomId, eventId, "👍");
        expect(mockClient.reactToMessage).toHaveBeenCalledWith(roomId, eventId, "👍");

        mockClient.reactToMessage.mockClear();
        mockClient.getUserId.mockReturnValue(null);
        await manager.toggleReaction(roomId, eventId, "👍");
        expect(mockClient.reactToMessage).not.toHaveBeenCalled();
    });

    it("gets most reacted messages and removes all reactions", async () => {
        const reactions = [
            mkReaction({ sender: "@a:hs", key: "👍", id: "$r1" }),
            mkReaction({ sender: "@b:hs", key: "👍", id: "$r2" }),
        ];
        mockClient.getRoom.mockReturnValue({
            relations: {
                getChildEventsForEvent: vi.fn((eid: string) => ({
                    getRelations: () => (eid === "$m1" || eid === eventId ? reactions : []),
                })),
            },
            timeline: [
                { getType: () => "m.room.message", getId: () => "$m2" },
                { getType: () => "m.room.message", getId: () => "$m1" },
            ],
        });

        const top = manager.getMostReactedMessages(roomId, 1);
        expect(top).toHaveLength(1);
        expect(top[0].eventId).toBe("$m1");

        await manager.removeAllReactions(roomId, eventId);
        expect(mockClient.redactReaction).toHaveBeenCalledTimes(2);
    });
});
