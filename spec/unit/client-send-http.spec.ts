import { describe, expect, it, vi } from "vitest";

import { dispatchSendEventHttpRequest } from "../../src/client-send-http.ts";
import { Method } from "../../src/http-api/method.ts";

describe("client send http helper", () => {
    it("sends a regular event request and logs the remote event id", async () => {
        const event = {
            event: {},
            getTxnId: vi.fn(() => "txn-1"),
            setTxnId: vi.fn(),
            getRoomId: vi.fn(() => "!room:example.org"),
            getWireType: vi.fn(() => "m.room.message"),
            getStateKey: vi.fn(() => undefined),
            isState: vi.fn(() => false),
            isRedaction: vi.fn(() => false),
            getWireContent: vi.fn(() => ({ body: "hi" })),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
        const http = {
            authedRequest: vi.fn().mockResolvedValue({ event_id: "$sent" }),
        };
        const logger = { debug: vi.fn() };

        await expect(
            dispatchSendEventHttpRequest({
                event,
                makeTxnId: () => "generated",
                http,
                logger,
                unstableDelayFeatureName: "org.matrix.msc4140",
            }),
        ).resolves.toEqual({ event_id: "$sent" });

        expect(http.authedRequest).toHaveBeenCalledWith(
            Method.Put,
            "/rooms/!room%3Aexample.org/send/m.room.message/txn-1",
            undefined,
            { body: "hi" },
        );
        expect(logger.debug).toHaveBeenCalledWith("Event sent to !room:example.org with event id $sent");
        expect(event.setTxnId).not.toHaveBeenCalled();
    });

    it("creates a txn id for delayed events and forwards unstable query params", async () => {
        const event = {
            event: {},
            getTxnId: vi.fn(() => undefined),
            setTxnId: vi.fn(),
            getRoomId: vi.fn(() => "!room:example.org"),
            getWireType: vi.fn(() => "m.room.message"),
            getStateKey: vi.fn(() => undefined),
            isState: vi.fn(() => false),
            isRedaction: vi.fn(() => false),
            getWireContent: vi.fn(() => ({ body: "later" })),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
        const http = {
            authedRequest: vi.fn().mockResolvedValue({ event_id: "$delayed" }),
        };
        const logger = { debug: vi.fn() };

        await dispatchSendEventHttpRequest({
            event,
            queryOrDelayOpts: { delay: 5000 },
            queryDict: { ts: 1234 },
            makeTxnId: () => "generated-txn",
            http,
            logger,
            unstableDelayFeatureName: "org.matrix.msc4140",
        });

        expect(event.setTxnId).toHaveBeenCalledWith("generated-txn");
        expect(http.authedRequest).toHaveBeenCalledWith(
            Method.Put,
            "/rooms/!room%3Aexample.org/send/m.room.message/generated-txn",
            { "org.matrix.msc4140.delay": 5000, ts: 1234 },
            { body: "later" },
        );
        expect(logger.debug).not.toHaveBeenCalled();
    });
});
