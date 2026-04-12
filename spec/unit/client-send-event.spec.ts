import { describe, expect, it } from "vitest";

import { prepareSendEventParams } from "../../src/client-send-event.ts";
import { THREAD_RELATION_TYPE } from "../../src/models/thread.ts";

describe("client send event helper", () => {
    it("normalizes the legacy sendEvent overload without a thread id", () => {
        const content = { body: "hello" };

        expect(
            prepareSendEventParams({
                roomId: "!room:example.org",
                threadIdOrEventType: "m.room.message",
                eventTypeOrContent: content,
                contentOrTxnId: "txn-1",
                eventIdPrefix: "$",
                threadRelationTypeName: THREAD_RELATION_TYPE.name,
                getThread: () => undefined,
            }),
        ).toEqual({
            threadId: null,
            eventObject: {
                type: "m.room.message",
                content,
            },
            txnId: "txn-1",
        });
    });

    it("applies the thread relation fallback when the event belongs to a thread", () => {
        const content = { body: "hello" };

        const prepared = prepareSendEventParams({
            roomId: "!room:example.org",
            threadIdOrEventType: "$thread:example.org",
            eventTypeOrContent: "m.room.message",
            contentOrTxnId: content,
            txnIdOrVoid: "txn-2",
            eventIdPrefix: "$",
            threadRelationTypeName: THREAD_RELATION_TYPE.name,
            getThread: () =>
                ({
                    lastReply: () => null,
                }) as any,
        });

        expect(prepared.threadId).toBe("$thread:example.org");
        expect(prepared.txnId).toBe("txn-2");
        expect(prepared.eventObject).toEqual({
            type: "m.room.message",
            content: {
                "body": "hello",
                "m.relates_to": {
                    "event_id": "$thread:example.org",
                    "rel_type": "m.thread",
                    "is_falling_back": true,
                    "m.in_reply_to": {
                        event_id: "$thread:example.org",
                    },
                },
            },
        });
    });
});
