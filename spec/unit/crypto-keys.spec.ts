import { beforeEach, describe, expect, it, vi } from "vitest";

import { CryptoKeysManager } from "../../src/crypto-keys";
import { MatrixError } from "../../src/http-api/errors";

describe("CryptoKeysManager", () => {
    let mockClient: any;
    let manager: CryptoKeysManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };
        manager = new CryptoKeysManager(mockClient);
        (manager as any).maxRetries = 0;
        (manager as any).retryDelay = 0;
    });

    it("classifies rate limits as RetryableError with metadata", async () => {
        mockClient.http.authedRequest.mockRejectedValue(
            new MatrixError(
                { errcode: "M_LIMIT_EXCEEDED", error: "slow down", retry_after_ms: 640 },
                429,
                undefined,
                undefined,
                new Headers({ "x-trace-id": "crypto-keys-trace" }),
            ),
        );

        await expect(manager.uploadKeys({})).rejects.toMatchObject({
            name: "RetryableError",
            errorCode: "M_LIMIT_EXCEEDED",
            retryAfter: 640,
            traceId: "crypto-keys-trace",
            isRetryable: true,
        });
    });
});
