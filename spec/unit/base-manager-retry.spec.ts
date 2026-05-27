import { describe, expect, it, vi } from "vitest";

import { BaseManager } from "../../src/managers/base-manager";
import type { MatrixClient } from "../../src/client";
import { HTTPError, MatrixError } from "../../src/http-api/errors";
import { RetryableError } from "../../src/errors";

class DummyRetryManager extends BaseManager {
    constructor() {
        super({} as unknown as MatrixClient);
    }

    public run<T>(fn: () => Promise<T>, options = {}) {
        return this.withRetry(fn, options);
    }

    protected sleep(_ms: number): Promise<void> {
        return Promise.resolve();
    }
}

describe("BaseManager.withRetry", () => {
    it("retries retryable failures and eventually succeeds", async () => {
        const manager = new DummyRetryManager();
        const fn = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(new RetryableError("temporary"))
            .mockResolvedValueOnce("ok");

        await expect(
            manager.run(fn, { maxRetries: 1, retryDelay: 10, jitterRatio: 0, idempotent: true }),
        ).resolves.toBe("ok");

        expect(fn).toHaveBeenCalledTimes(2);
        expect(manager.getRequestStats().retried).toBe(1);
    });

    it("does not retry non-idempotent requests unless explicitly enabled", async () => {
        const manager = new DummyRetryManager();
        const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new RetryableError("temporary"));

        await expect(
            manager.run(fn, { maxRetries: 3, retryDelay: 10, jitterRatio: 0, idempotent: false }),
        ).rejects.toBeInstanceOf(RetryableError);

        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("uses retry_after_ms when rate limited", async () => {
        const manager = new DummyRetryManager();
        const fn = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(new MatrixError({ errcode: "M_LIMIT_EXCEEDED", retry_after_ms: 1234 }, 429))
            .mockResolvedValueOnce("ok");

        const sleepSpy = vi.spyOn(manager as any, "sleep");

        await expect(
            manager.run(fn, { maxRetries: 1, retryDelay: 10, jitterRatio: 0, idempotent: true }),
        ).resolves.toBe("ok");

        expect(sleepSpy).toHaveBeenCalledWith(1234);
    });

    it("retries HTTPError 429 responses with the default delay", async () => {
        const manager = new DummyRetryManager();
        const fn = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(new HTTPError("rate limited", 429))
            .mockResolvedValueOnce("ok");

        const sleepSpy = vi.spyOn(manager as any, "sleep");

        await expect(manager.run(fn, { maxRetries: 1, retryDelay: 10, idempotent: true })).resolves.toBe("ok");

        expect(fn).toHaveBeenCalledTimes(2);
        expect(sleepSpy).toHaveBeenCalledWith(10);
    });
});
