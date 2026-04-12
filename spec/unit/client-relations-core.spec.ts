import { describe, expect, it, vi } from "vitest";

import { EventType, RelationType } from "../../src/@types/event.ts";
import { processRelationEvents } from "../../src/client-relations-core.ts";

function createEvent(type: string, sender: string) {
    return {
        getType: () => type,
        getSender: () => sender,
    } as any;
}

describe("client relations core helpers", () => {
    it("decrypts events and filters by requested event type for encrypted relations", async () => {
        const decryptEventIfNeeded = vi.fn().mockResolvedValue(undefined);
        const events = [
            createEvent(EventType.RoomMessage, "@alice:example.org"),
            createEvent("m.reaction", "@bob:example.org"),
        ];
        const originalEvent = createEvent(EventType.RoomMessage, "@alice:example.org");

        const result = await processRelationEvents({
            events,
            originalEvent,
            fetchedEventType: EventType.RoomMessageEncrypted,
            requestedEventType: EventType.RoomMessage,
            relationType: null,
            decryptEventIfNeeded,
        });

        expect(decryptEventIfNeeded).toHaveBeenCalledTimes(3);
        expect(result).toHaveLength(1);
        expect(result[0].getType()).toBe(EventType.RoomMessage);
    });

    it("filters replacements to the same sender as original event", async () => {
        const decryptEventIfNeeded = vi.fn().mockResolvedValue(undefined);
        const events = [
            createEvent("m.room.message", "@alice:example.org"),
            createEvent("m.room.message", "@bob:example.org"),
        ];
        const originalEvent = createEvent("m.room.message", "@alice:example.org");

        const result = await processRelationEvents({
            events,
            originalEvent,
            fetchedEventType: EventType.RoomMessage,
            requestedEventType: null,
            relationType: RelationType.Replace,
            decryptEventIfNeeded,
        });

        expect(result).toHaveLength(1);
        expect(result[0].getSender()).toBe("@alice:example.org");
        expect(decryptEventIfNeeded).not.toHaveBeenCalled();
    });
});
