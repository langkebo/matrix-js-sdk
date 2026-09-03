import { beforeEach, describe, expect, it, vi } from "vitest";

import { Method } from "../../src/http-api/method.ts";
import { EphemeralEvent, EphemeralManager } from "../../src/ephemeral";
import { MatrixError } from "../../src/http-api/errors";
import { logger } from "../../src/logger";

describe("EphemeralManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: EphemeralManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
            getRoom: vi.fn(),
            getUserId: vi.fn().mockReturnValue("@alice:example.com"),
            sendToDevice: vi.fn(),
            getToDeviceManager: vi.fn(),
        };

        manager = new EphemeralManager(mockClient);
        manager.setRetryOptions({ maxRetries: 0, retryDelay: 0, idempotent: true });
        vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    });

    it("classifies rate limits as RetryableError with metadata", async () => {
        mockClient.http.authedRequest.mockRejectedValue(
            new MatrixError(
                { errcode: "M_LIMIT_EXCEEDED", error: "slow down", retry_after_ms: 275 },
                429,
                undefined,
                undefined,
                new Headers({ "x-trace-id": "ephemeral-trace" }),
            ),
        );

        await expect(manager.getEphemeralEventsFromServer("!room:example.com")).rejects.toMatchObject({
            name: "RetryableError",
            errorCode: "M_LIMIT_EXCEEDED",
            retryAfter: 275,
            traceId: "ephemeral-trace",
            isRetryable: true,
        });
    });

    it("uses the generated-compatible v3 room ephemeral path and maps chunk timestamps", async () => {
        mockClient.http.authedRequest.mockResolvedValueOnce({
            chunk: [
                {
                    type: "m.typing",
                    sender: "@alice:example.com",
                    content: { user_ids: ["@alice:example.com"] },
                    origin_server_ts: 1234,
                    stream_id: 9,
                    event_id: "$ephemeral_9",
                },
            ],
            start: undefined,
            end: undefined,
        });

        await expect(manager.getEphemeralEventsFromServer("!room:example.com", 50)).resolves.toEqual([
            {
                roomId: "!room:example.com",
                type: "m.typing",
                sender: "@alice:example.com",
                content: { user_ids: ["@alice:example.com"] },
                timestamp: 1234,
            },
        ]);

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/rooms/!room%3Aexample.com/ephemeral",
            { limit: 50 },
            undefined,
            { prefix: "/_matrix/client/v3" },
        );
    });

    it("returns cached results without issuing a second request", async () => {
        mockClient.http.authedRequest.mockResolvedValueOnce({
            chunk: [
                {
                    type: "m.receipt",
                    sender: "@bob:example.com",
                    content: { "$event:example.com": { "m.read": { "@bob:example.com": { ts: 1 } } } },
                    origin_server_ts: 5678,
                },
            ],
        });

        const first = await manager.getEphemeralEventsFromServer("!room:example.com");
        const second = await manager.getEphemeralEventsFromServer("!room:example.com");

        expect(first).toEqual(second);
        expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(1);
    });

    it("sendEphemeralEvent forwards room-scoped payloads through sendToDevice", async () => {
        const sendToDeviceFromContentMap = vi.fn().mockResolvedValue(undefined);
        mockClient.getToDeviceManager.mockReturnValue({ sendToDeviceFromContentMap });

        await manager.sendEphemeralEvent("!room:example.com", "m.typing", { user_ids: ["@alice:example.com"] });

        expect(sendToDeviceFromContentMap).toHaveBeenCalledWith("m.typing", expect.any(Map));

        const contentMap = sendToDeviceFromContentMap.mock.calls[0][1] as Map<
            string,
            Map<string, Record<string, unknown>>
        >;
        expect(contentMap.get("!room:example.com")?.get("@alice:example.com")).toEqual({
            user_ids: ["@alice:example.com"],
        });
    });

    it("clearEphemeralEvents clears room state events and emits a clear signal", () => {
        const setStateEvents = vi.fn();
        const clearedSpy = vi.fn();
        mockClient.getRoom.mockReturnValueOnce({
            currentState: { setStateEvents },
        });
        manager.on(EphemeralEvent.EphemeralCleared, clearedSpy);

        manager.clearEphemeralEvents("!room:example.com");

        expect(setStateEvents).toHaveBeenCalledWith([]);
        expect(clearedSpy).toHaveBeenCalledWith("!room:example.com");
    });

    it("getTypingEvents extracts the current m.typing user_ids", async () => {
        vi.spyOn(manager, "getEphemeralEventsFromServer").mockResolvedValueOnce([
            {
                roomId: "!room:example.com",
                type: "m.typing",
                sender: "@alice:example.com",
                content: { user_ids: ["@alice:example.com", "@bob:example.com"] },
                timestamp: 1234,
            },
        ]);

        await expect(manager.getTypingEvents("!room:example.com")).resolves.toEqual([
            "@alice:example.com",
            "@bob:example.com",
        ]);
    });

    it("getTypingEvents logs a warning and returns [] when the server fails", async () => {
        vi.spyOn(manager, "getEphemeralEventsFromServer").mockRejectedValueOnce(new Error("boom"));

        await expect(manager.getTypingEvents("!room:example.com")).resolves.toEqual([]);
        expect(logger.warn).toHaveBeenCalledWith("EphemeralManager.getTypingEvents failed:", expect.any(Error));
    });

    it("getReceiptEvents extracts m.read receipt mappings", async () => {
        vi.spyOn(manager, "getEphemeralEventsFromServer").mockResolvedValueOnce([
            {
                roomId: "!room:example.com",
                type: "m.receipt",
                sender: "@alice:example.com",
                content: {
                    $event1: { "m.read": { "@alice:example.com": { ts: 1 } } },
                    $event2: { "m.read": { "@bob:example.com": { ts: 2 } } },
                },
                timestamp: 5678,
            },
        ]);

        const receipts = await manager.getReceiptEvents("!room:example.com");

        expect(receipts.get("@alice:example.com")).toBe("$event1");
        expect(receipts.get("@bob:example.com")).toBe("$event2");
    });
});
