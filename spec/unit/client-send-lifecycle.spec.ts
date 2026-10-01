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

    // ISSUE-03: 重试复用——同 txnId 的本地回显已存在时，不得新建回显或重复
    // addPendingEvent（否则抛 "known txnId" 或产生重复回显）。
    it("reuses the existing local echo when the txnId is already pending (retry)", () => {
        const existingEcho = {
            getTxnId: vi.fn(() => "txn-dup"),
            setStatus: vi.fn(),
            status: EventStatus.NOT_SENT,
        };
        const addPendingEvent = vi.fn();
        const room = {
            getThread: vi.fn(() => undefined),
            getPendingEvents: vi.fn(() => [existingEcho]),
            addPendingEvent,
            reEmitter: { reEmit: vi.fn() },
        };
        const logger = { debug: vi.fn() };
        const reEmitter = { reEmit: vi.fn() };

        const prepared = prepareSendCompleteEventLifecycle({
            roomId: "!room:example.org",
            threadId: null,
            eventObject: { type: "m.room.message", content: { body: "hi" } },
            txnId: "txn-dup",
            userId: "@alice:example.org",
            makeTxnId: () => "generated",
            getRoom: () => room as never,
            logger,
            reEmitter,
        });

        expect(prepared.localEvent).toBe(existingEcho as never);
        expect(prepared.txnId).toBe("txn-dup");
        expect(existingEcho.setStatus).toHaveBeenCalledWith(EventStatus.SENDING);
        expect(addPendingEvent).not.toHaveBeenCalled();
        expect(reEmitter.reEmit).not.toHaveBeenCalled();
    });
});
