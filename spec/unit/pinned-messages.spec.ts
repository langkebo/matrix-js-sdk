import { beforeEach, describe, expect, it, vi } from "vitest";

import { PinnedMessagesManager } from "../../src/pinned-messages";
import { MatrixError } from "../../src/http-api/errors";

describe("PinnedMessagesManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: PinnedMessagesManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
            getRoom: vi.fn(),
            getUserId: vi.fn().mockReturnValue("@alice:example.com"),
            sendStateEvent: vi.fn(),
        };

        manager = new PinnedMessagesManager(mockClient);
        manager.setRetryOptions({ maxRetries: 2, retryDelay: 0 });
    });

    it("classifies rate limits as RetryableError with metadata for reads", async () => {
        mockClient.http.authedRequest.mockRejectedValue(
            new MatrixError(
                { errcode: "M_LIMIT_EXCEEDED", error: "slow down", retry_after_ms: 325 },
                429,
                undefined,
                undefined,
                new Headers({ "x-trace-id": "pinned-trace" }),
            ),
        );

        await expect(manager.getPinnedEventsFromServer("!room:example.com")).rejects.toMatchObject({
            name: "RetryableError",
            errorCode: "M_LIMIT_EXCEEDED",
            retryAfter: 325,
            traceId: "pinned-trace",
            isRetryable: true,
        });

        expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(3);
    });

    it("does not retry non-idempotent writes by default", async () => {
        mockClient.http.authedRequest.mockRejectedValue(
            new MatrixError({ errcode: "M_LIMIT_EXCEEDED", error: "slow down", retry_after_ms: 325 }, 429, undefined),
        );

        await expect(manager.pinEventToServer("!room:example.com", "$event")).rejects.toMatchObject({
            name: "RetryableError",
            errorCode: "M_LIMIT_EXCEEDED",
            isRetryable: true,
        });

        expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(1);
    });
});
