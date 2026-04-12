import { describe, expect, it } from "vitest";

import { applyThreadRelationIfNeeded } from "../../src/client-thread-relations.ts";
import type { MatrixEvent } from "../../src/models/event.ts";

describe("client thread relation helpers", () => {
    it("adds thread relation when relation is missing", () => {
        const content: Record<string, unknown> = { body: "hello" };
        applyThreadRelationIfNeeded(content, "$thread:example.org", "m.thread", () => undefined);

        expect(content["m.relates_to"]).toEqual({
            rel_type: "m.thread",
            event_id: "$thread:example.org",
            is_falling_back: true,
        });
    });

    it("uses latest thread reply for fallback in_reply_to", () => {
        const content: Record<string, unknown> = { body: "hello" };
        const replyEvent = {
            isRelation: (relType: string) => relType === "m.thread",
            status: undefined,
            getId: () => "$reply:example.org",
        } as unknown as MatrixEvent;

        applyThreadRelationIfNeeded(content, "$thread:example.org", "m.thread", () => ({
            lastReply: (predicate: (ev: MatrixEvent) => boolean) => (predicate(replyEvent) ? replyEvent : null),
        }));

        expect(content["m.relates_to"]).toEqual({
            "rel_type": "m.thread",
            "event_id": "$thread:example.org",
            "is_falling_back": true,
            "m.in_reply_to": {
                event_id: "$reply:example.org",
            },
        });
    });
});
