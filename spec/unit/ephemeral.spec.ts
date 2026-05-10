import { beforeEach, describe, expect, it, vi } from "vitest";

import { EphemeralManager } from "../../src/ephemeral";
import { MatrixError } from "../../src/http-api/errors";

describe("EphemeralManager", () => {
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
        };

        manager = new EphemeralManager(mockClient);
        manager.setRetryOptions({ maxRetries: 0, retryDelay: 0, idempotent: true });
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
});
