/*
S-15: `ServerCapabilities.start()` must be re-entrant safe.

Regression background: `start()` unconditionally called `poll()`, and `poll()` re-arms itself
with its own `setTimeout`. Two concurrent `start()` calls therefore spawned two independent,
self-perpetuating poll chains; `stop()` only ever cleared one of them, so the other kept
refreshing capabilities for the lifetime of the app.

These tests cover the `ServerCapabilities` class in `src/serverCapabilities.ts`.
*/

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { ServerCapabilities } from "../../src/serverCapabilities";
import { type IHttpOpts, type MatrixHttpApi } from "../../src/http-api/index";
import { type Logger } from "../../src/logger";
import { Method } from "../../src/http-api/method";

const CAPABILITIES_CACHE_MS = 6 * 60 * 60 * 1000;

function makeLogger(): Logger {
    return {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        getChild: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

function makeHttp(): MatrixHttpApi<IHttpOpts & { onlyData: true }> {
    return {
        authedRequest: vi.fn().mockResolvedValue({ capabilities: { "m.change_password": { enabled: true } } }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

describe("ServerCapabilities: start() re-entrancy (S-15)", () => {
    let logger: Logger;
    let http: MatrixHttpApi<IHttpOpts & { onlyData: true }>;
    let capabilities: ServerCapabilities;

    beforeEach(() => {
        vi.useFakeTimers();
        logger = makeLogger();
        http = makeHttp();
        capabilities = new ServerCapabilities(logger, http);
    });

    afterEach(() => {
        capabilities.stop();
        vi.useRealTimers();
    });

    it("only starts a single poll chain when start() is called twice", async () => {
        capabilities.start();
        capabilities.start();

        // Let the in-flight `poll()` settle.
        await vi.advanceTimersByTimeAsync(0);

        expect(http.authedRequest).toHaveBeenCalledTimes(1);
        expect(http.authedRequest).toHaveBeenCalledWith(Method.Get, "/capabilities");
    });

    it("keeps exactly one poll chain across refreshes", async () => {
        capabilities.start();
        capabilities.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(http.authedRequest).toHaveBeenCalledTimes(1);

        // With the bug, two chains would have produced 3 calls by now (1 initial + 2 refreshes).
        await vi.advanceTimersByTimeAsync(CAPABILITIES_CACHE_MS);
        expect(http.authedRequest).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(CAPABILITIES_CACHE_MS);
        expect(http.authedRequest).toHaveBeenCalledTimes(3);
    });

    it("stops polling entirely after stop()", async () => {
        capabilities.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(http.authedRequest).toHaveBeenCalledTimes(1);

        capabilities.stop();
        await vi.advanceTimersByTimeAsync(CAPABILITIES_CACHE_MS * 3);

        expect(http.authedRequest).toHaveBeenCalledTimes(1);
    });

    it("does not resurrect the chain if stop() races an in-flight fetch", async () => {
        let resolveFetch!: (value: unknown) => void;
        const pending = new Promise((resolve) => {
            resolveFetch = resolve;
        });
        (http.authedRequest as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(pending);

        capabilities.start();
        // Fetch is in flight; stop() is called before it settles.
        capabilities.stop();
        resolveFetch({ capabilities: {} });
        await vi.advanceTimersByTimeAsync(0);

        // Chain must not be re-armed once stopped.
        await vi.advanceTimersByTimeAsync(CAPABILITIES_CACHE_MS * 2);
        expect(http.authedRequest).toHaveBeenCalledTimes(1);
    });

    it("can be restarted after stop()", async () => {
        capabilities.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(http.authedRequest).toHaveBeenCalledTimes(1);

        capabilities.stop();

        capabilities.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(http.authedRequest).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(CAPABILITIES_CACHE_MS);
        expect(http.authedRequest).toHaveBeenCalledTimes(3);
    });
});
