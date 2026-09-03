import { describe, expect, it } from "vitest";

import { BaseManager, type ManagerOpts, type RetryOptions } from "../../../src/managers/base-manager";
import type { MatrixClient } from "../../../src/client";
import { ConnectionError } from "../../../src/http-api/errors";
import { ApiError, RetryableError } from "../../../src/errors";

/**
 * TestManager exposes the protected `normalizeError` and `withRetry` so tests
 * can drive them directly. `sleep` is stubbed so retry backoff never delays
 * the test.
 */
class TestManager extends BaseManager {
    constructor(opts?: ManagerOpts) {
        super({} as unknown as MatrixClient, opts);
    }

    public testNormalizeError(error: unknown, method: string) {
        return this.normalizeError(error, method);
    }

    public async testWithRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
        return this.withRetry(fn, options);
    }

    protected sleep(_ms: number): Promise<void> {
        return Promise.resolve();
    }
}

describe("BaseManager ConnectionError retry (ISSUE-10b)", () => {
    describe("normalizeError", () => {
        it("converts ConnectionError to RetryableError", () => {
            const m = new TestManager();
            const err = new ConnectionError("network down");
            const normalized = m.testNormalizeError(err, "sendEvent");
            expect(normalized).toBeInstanceOf(RetryableError);
            expect(normalized).not.toBeInstanceOf(ApiError);
            expect(normalized.message).toContain("sendEvent");
            expect(normalized.message).toContain("network down");
        });

        it("preserves cause on the resulting RetryableError", () => {
            const m = new TestManager();
            const err = new ConnectionError("tcp reset");
            const normalized = m.testNormalizeError(err, "sendEvent") as RetryableError;
            expect(normalized.cause).toBe(err);
        });
    });

    describe("withRetry", () => {
        it("retries on ConnectionError and eventually succeeds", async () => {
            const m = new TestManager({ maxRetries: 3, retryDelay: 1, idempotent: true });
            const calls: number[] = [];
            let attempt = 0;
            const fn = async (): Promise<string> => {
                attempt++;
                calls.push(attempt);
                if (attempt < 2) {
                    throw new ConnectionError("flaky connection");
                }
                return "ok";
            };

            const result = await m.testWithRetry(fn, { maxRetries: 3, retryDelay: 1, idempotent: true });
            expect(result).toBe("ok");
            expect(calls).toEqual([1, 2]);
            // First attempt failed, second succeeded — retried counter = 1.
            expect(m.getRequestStats().retried).toBe(1);
            expect(m.getRequestStats().successful).toBe(1);
            expect(m.getRequestStats().failed).toBe(1);
        });

        it("retries ConnectionError up to maxRetries then throws RetryableError", async () => {
            const m = new TestManager({ maxRetries: 2, retryDelay: 1, idempotent: true });
            const fn = async (): Promise<string> => {
                throw new ConnectionError("persistent dropout");
            };

            await expect(
                m.testWithRetry(fn, { maxRetries: 2, retryDelay: 1, idempotent: true }),
            ).rejects.toBeInstanceOf(RetryableError);

            // 1 initial attempt + 2 retries = 3 total invocations.
            expect(m.getRequestStats().total).toBe(3);
            expect(m.getRequestStats().failed).toBe(3);
            expect(m.getRequestStats().retried).toBe(2);
            expect(m.getRequestStats().successful).toBe(0);
        });

        it("does NOT retry ConnectionError when idempotent=false and retryNonIdempotent=false", async () => {
            const m = new TestManager({ maxRetries: 3, retryDelay: 1, idempotent: false, retryNonIdempotent: false });
            const fn = async (): Promise<string> => {
                throw new ConnectionError("non-idempotent");
            };

            await expect(
                m.testWithRetry(fn, { maxRetries: 3, retryDelay: 1, idempotent: false, retryNonIdempotent: false }),
            ).rejects.toBeInstanceOf(RetryableError);

            // No retries — single failed attempt.
            expect(m.getRequestStats().total).toBe(1);
            expect(m.getRequestStats().failed).toBe(1);
            expect(m.getRequestStats().retried).toBe(0);
        });

        it("preserves txnId across retries (txnId resolved once outside withRetry)", async () => {
            // Mirrors SendingManager.resolveTxnId pattern: txnId is resolved
            // before entering withRetry and reused across all attempts.
            const m = new TestManager({ maxRetries: 3, retryDelay: 1, idempotent: true });
            const seenTxnIds: string[] = [];
            const resolvedTxnId = "txn-001-fixed"; // would be client.makeTxnId() in production

            let attempt = 0;
            const fn = async (): Promise<string> => {
                attempt++;
                seenTxnIds.push(resolvedTxnId);
                if (attempt < 3) {
                    throw new ConnectionError("retry me");
                }
                return "ok";
            };

            const result = await m.testWithRetry(fn, { maxRetries: 3, retryDelay: 1, idempotent: true });
            expect(result).toBe("ok");
            expect(attempt).toBe(3);
            // Same txnId observed on every attempt — no regeneration between retries.
            expect(seenTxnIds).toEqual(["txn-001-fixed", "txn-001-fixed", "txn-001-fixed"]);
        });
    });
});
