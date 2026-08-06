import { describe, expect, it, vi, beforeEach } from "vitest";

import { BaseManager, Transport, RequestSpec, ManagerOpts, RetryOptions } from "../../src/managers/base-manager";
import { Method } from "../../src/http-api/method";
import type { MatrixClient } from "../../src/client";

/**
 * Manager that exposes both `withRetry` (via `run`) and `request` (via `doRequest`)
 * so tests can drive the concurrency interaction between them. `sleep` is stubbed
 * so retry backoff never delays the test.
 */
class DummyConcurrentManager extends BaseManager {
    constructor(opts?: ManagerOpts) {
        super({} as unknown as MatrixClient, opts);
    }

    public run<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
        return this.withRetry(fn, options);
    }

    public doRequest<T>(spec: RequestSpec): Promise<T> {
        return this.request<T>(spec);
    }

    protected sleep(_ms: number): Promise<void> {
        return Promise.resolve();
    }
}

describe("BaseManager.withRetry concurrency (FT-115)", () => {
    let transport: Transport;
    let requestSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        requestSpy = vi.fn().mockResolvedValue({ ok: true });
        transport = { request: requestSpy } as unknown as Transport;
    });

    it("concurrent withRetry calls do not distort requestStats via a shared flag", async () => {
        const manager = new DummyConcurrentManager({ transport });

        // Gate that holds the second withRetry's fn from calling request() until
        // the first withRetry has fully completed. This makes the race
        // deterministic: by the time B calls request(), A's finally block has
        // already run.
        let releaseBRequest!: () => void;
        const bRequestGate = new Promise<void>((resolve) => {
            releaseBRequest = resolve;
        });

        const fnA = (): Promise<unknown> =>
            manager.doRequest({ method: Method.Get, path: "/a" });
        const fnB = async (): Promise<unknown> => {
            await bRequestGate; // wait until A has fully settled
            return manager.doRequest({ method: Method.Get, path: "/b" });
        };

        // Start both withRetry calls. Each fn internally calls request(), which
        // must observe "inside withRetry" and therefore skip its own stats.
        const pA = manager.run(fnA, { maxRetries: 0, idempotent: true });
        const pB = manager.run(fnB, { maxRetries: 0, idempotent: true });

        // Let A complete fully. With the boolean-flag bug its finally restores
        // _inWithRetry = false while B is still in flight.
        await expect(pA).resolves.toEqual({ ok: true });

        // Now release B's request(). With the bug, B's request() sees
        // _inWithRetry === false and runs the independent-call path, double
        // counting total/successful. With the counter fix it sees depth > 0 and
        // only withRetry touches stats.
        releaseBRequest();
        await expect(pB).resolves.toEqual({ ok: true });

        // One withRetry attempt each => total=2, successful=2. The bug yields 3/3.
        expect(manager.getRequestStats()).toEqual({
            total: 2,
            successful: 2,
            failed: 0,
            retried: 0,
        });
    });

    it("returns to a non-withRetry state after concurrent calls complete", async () => {
        const manager = new DummyConcurrentManager({ transport });

        let releaseBRequest!: () => void;
        const bRequestGate = new Promise<void>((resolve) => {
            releaseBRequest = resolve;
        });

        const fnA = (): Promise<unknown> =>
            manager.doRequest({ method: Method.Get, path: "/a" });
        const fnB = async (): Promise<unknown> => {
            await bRequestGate;
            return manager.doRequest({ method: Method.Get, path: "/b" });
        };

        const pA = manager.run(fnA, { maxRetries: 0, idempotent: true });
        const pB = manager.run(fnB, { maxRetries: 0, idempotent: true });

        await pA;
        releaseBRequest();
        await pB;

        // After all concurrent withRetry calls finish, the depth must be back to
        // 0 so a direct request() takes the independent path and records its own
        // stats. With the boolean bug the flag leaks `true` (B restored
        // prevFlag=true in its finally), so a direct request would skip stats
        // entirely. Reset first so the increment is unambiguous.
        manager.resetRequestStats();
        await manager.doRequest({ method: Method.Get, path: "/c" });

        expect(manager.getRequestStats()).toEqual({
            total: 1,
            successful: 1,
            failed: 0,
            retried: 0,
        });
    });
});
