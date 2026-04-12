import { describe, expect, it, vi } from "vitest";

import { EventStatus } from "../../src/models/event.ts";
import { prepareSendCompleteEventLifecycle } from "../../src/client-send-lifecycle.ts";

describe("client send lifecycle helper", () => {
    it("prepares non-delayed send with local pending event", () => {
        const addPendingEvent = vi.fn();
        const room = {
            getThread: vi.fn(() => undefined),
            getPendingEvents: vi.fn(() => []),
            addPendingEvent,
            reEmitter: { reEmit: vi.fn() },
        };
        const logger = { debug: vi.fn() };
        const reEmitter = { reEmit: vi.fn() };

        const prepared = prepareSendCompleteEventLifecycle({
            roomId: "!room:example.org",
            threadId: null,
            eventObject: { type: "m.room.message", content: { body: "hi" } },
            txnId: "txn-1",
            userId: "@alice:example.org",
            makeTxnId: () => "generated",
            getRoom: () => room as never,
            logger,
            reEmitter,
        });

        expect(prepared.txnId).toBe("txn-1");
        expect(prepared.localEvent.status).toBe(EventStatus.SENDING);
        expect(addPendingEvent).toHaveBeenCalledOnce();
        expect(reEmitter.reEmit).toHaveBeenCalledOnce();
    });

    it("prepares delayed send without pending event", () => {
        const addPendingEvent = vi.fn();
        const room = {
            getThread: vi.fn(() => undefined),
            getPendingEvents: vi.fn(() => []),
            addPendingEvent,
            reEmitter: { reEmit: vi.fn() },
        };
        const logger = { debug: vi.fn() };
        const reEmitter = { reEmit: vi.fn() };

        prepareSendCompleteEventLifecycle({
            roomId: "!room:example.org",
            threadId: null,
            eventObject: { type: "m.room.message", content: { body: "hi" } },
            delayOpts: { delay: 5000 },
            userId: "@alice:example.org",
            makeTxnId: () => "generated",
            getRoom: () => room as never,
            logger,
            reEmitter,
        });

        expect(addPendingEvent).not.toHaveBeenCalled();
        expect(reEmitter.reEmit).not.toHaveBeenCalled();
    });
});
