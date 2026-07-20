import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fetchMock from "@fetch-mock/vitest";

import { dispatchSendEventHttpRequest } from "../../src/client-send-http.ts";
import { Method } from "../../src/http-api/method.ts";
import { MatrixHttpApi } from "../../src/http-api/index.ts";
import { ClientPrefix } from "../../src/http-api/prefix.ts";
import { TypedEventEmitter } from "../../src/models/typed-event-emitter.ts";

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

    describe("full URL construction (fetchMock — Level 3)", () => {
        const baseUrl = "https://send-test.example.com";
        let http: MatrixHttpApi<{ baseUrl: string; prefix: string; onlyData: true }>;

        beforeEach(() => {
            const emitter = new TypedEventEmitter<any, any>();
            http = new MatrixHttpApi(emitter, {
                baseUrl,
                prefix: ClientPrefix.V3,
                onlyData: true,
            });
        });

        afterEach(() => {
            fetchMock.mockClear();
        });

        it("assembles full URL and sends correct body through fetch", async () => {
            const roomId = "!room:send-test.example.com";
            const eventType = "m.room.message";
            const txnId = "test-txn-1";
            const body = { msgtype: "m.text", body: "Hello via fetchMock" };

            const expectedUrl = `${baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/${eventType}/${txnId}`;
            fetchMock.putOnce(expectedUrl, { event_id: "$fetchmock-event" });

            const event = {
                event: {},
                getTxnId: vi.fn(() => txnId),
                setTxnId: vi.fn(),
                getRoomId: vi.fn(() => roomId),
                getWireType: vi.fn(() => eventType),
                getStateKey: vi.fn(() => undefined),
                isState: vi.fn(() => false),
                isRedaction: vi.fn(() => false),
                getWireContent: vi.fn(() => body),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any;

            const result = await dispatchSendEventHttpRequest({
                event,
                makeTxnId: () => "ignored",
                http,
                logger: { debug: vi.fn() },
                unstableDelayFeatureName: "org.matrix.msc4140",
            });

            expect(result).toEqual({ event_id: "$fetchmock-event" });

            // Verify fetchMock intercepted the correctly assembled full URL
            const calls = fetchMock.callHistory.calls(expectedUrl);
            expect(calls).toHaveLength(1);

            // Verify the body sent over the wire
            const lastCall = fetchMock.callHistory.lastCall(expectedUrl);
            const sentBody = JSON.parse(lastCall?.options?.body as string);
            expect(sentBody).toEqual(body);
        });
    });
});
