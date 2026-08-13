/*
Copyright 2026 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the sleep function to track calls and resolve immediately,
// so the async start() loop runs at full speed without real delays.
// vi.hoisted ensures the mock is available when vi.mock factory runs (hoisted to top).
const { sleepMock } = vi.hoisted(() => {
    return { sleepMock: vi.fn().mockResolvedValue(undefined) };
});

vi.mock("../../src/utils", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/utils")>();
    return {
        ...actual,
        sleep: sleepMock,
    };
});

import { SlidingSync } from "../../src/sliding-sync";
import { HTTPError } from "../../src/http-api";
import { type MatrixClient, type MSC3575SlidingSyncResponse } from "../../src";

/**
 * Tests for SlidingSync exponential backoff on generic errors (5xx/network).
 *
 * The SlidingSync.start() loop catches HTTPError with status 500/502/503 etc.
 * and applies exponential backoff: delay = min(1000 * 2^consecutiveErrors, 60000).
 *
 * 429 errors use safeGetRetryAfterMs(err, 5000) — server's retry_after_ms takes priority.
 * 400 errors trigger resetup + sleep(50) — no backoff increment.
 * AbortError/needsResend continue without sleep — no backoff increment.
 *
 * Backoff sequence for consecutive 500 errors:
 *   1st → 2s, 2nd → 4s, 3rd → 8s, 4th → 16s, 5th → 32s, 6th → 60s (capped)
 */
describe("SlidingSync exponential backoff", () => {
    let mockSlidingSync: ReturnType<typeof vi.fn>;
    let client: MatrixClient;
    let slidingSync: SlidingSync;

    beforeEach(() => {
        sleepMock.mockClear();
        sleepMock.mockResolvedValue(undefined);
        mockSlidingSync = vi.fn();
        client = {
            slidingSync: mockSlidingSync,
            makeTxnId: vi.fn(() => "txn-mock"),
        } as unknown as MatrixClient;
        slidingSync = new SlidingSync("http://localhost:28008", new Map(), {}, client, 1);
    });

    afterEach(() => {
        slidingSync.stop();
    });

    /**
     * Helper: run the start() loop until the mock client has been called expectedCalls times,
     * or timeout after maxIterations. The sleep mock resolves immediately, so the loop
     * progresses through backoff periods without real delays.
     */
    async function runUntilCalls(expectedCalls: number, maxIterations = 100): Promise<void> {
        const startPromise = slidingSync.start();
        for (let i = 0; i < maxIterations; i++) {
            if (mockSlidingSync.mock.calls.length >= expectedCalls) {
                break;
            }
            // Flush microtasks to let the async loop progress
            await Promise.resolve();
            await Promise.resolve();
        }
        slidingSync.stop();
        await startPromise.catch(() => {
            // start() may reject if stopped mid-loop — that's fine
        });
    }

    it("should apply exponential backoff sequence 2s/4s/8s/16s/32s for consecutive 500 errors", async () => {
        mockSlidingSync
            .mockRejectedValueOnce(new HTTPError("server error 1", 500))
            .mockRejectedValueOnce(new HTTPError("server error 2", 500))
            .mockRejectedValueOnce(new HTTPError("server error 3", 500))
            .mockRejectedValueOnce(new HTTPError("server error 4", 500))
            .mockRejectedValueOnce(new HTTPError("server error 5", 500))
            .mockResolvedValueOnce({
                pos: "success",
                lists: {},
                rooms: {},
                extensions: {},
            } as MSC3575SlidingSyncResponse);

        await runUntilCalls(6);

        // 5 errors → 5 sleep calls with exponential backoff
        expect(sleepMock).toHaveBeenCalledTimes(5);
        // Expected delays: 2s, 4s, 8s, 16s, 32s
        expect(sleepMock).toHaveBeenNthCalledWith(1, 2000);
        expect(sleepMock).toHaveBeenNthCalledWith(2, 4000);
        expect(sleepMock).toHaveBeenNthCalledWith(3, 8000);
        expect(sleepMock).toHaveBeenNthCalledWith(4, 16000);
        expect(sleepMock).toHaveBeenNthCalledWith(5, 32000);
    });

    it("should use server's retry_after_ms for 429 errors, not exponential backoff", async () => {
        const headers = new Headers({ "Retry-After": "3" }); // 3 seconds

        mockSlidingSync.mockRejectedValueOnce(new HTTPError("rate limited", 429, headers)).mockResolvedValueOnce({
            pos: "after429",
            lists: {},
            rooms: {},
            extensions: {},
        } as MSC3575SlidingSyncResponse);

        await runUntilCalls(2);

        // 429 should use safeGetRetryAfterMs which reads Retry-After header (3s)
        expect(sleepMock).toHaveBeenCalledTimes(1);
        // safeGetRetryAfterMs returns the header value in ms (3 * 1000 = 3000)
        expect(sleepMock).toHaveBeenCalledWith(3000);
    });

    it("should reset consecutiveErrors after a successful response", async () => {
        mockSlidingSync
            // Two 500 errors → backoff 2s, 4s
            .mockRejectedValueOnce(new HTTPError("server error 1", 500))
            .mockRejectedValueOnce(new HTTPError("server error 2", 500))
            // Success — resets consecutiveErrors
            .mockResolvedValueOnce({
                pos: "recovered",
                lists: {},
                rooms: {},
                extensions: {},
            } as MSC3575SlidingSyncResponse)
            // Another 500 error — should use 2s backoff (consecutiveErrors=1), not 8s
            .mockRejectedValueOnce(new HTTPError("server error after recovery", 500))
            // Final success
            .mockResolvedValueOnce({
                pos: "final",
                lists: {},
                rooms: {},
                extensions: {},
            } as MSC3575SlidingSyncResponse);

        await runUntilCalls(5);

        // 3 sleep calls: 2s (1st error), 4s (2nd error), 2s (error after reset)
        expect(sleepMock).toHaveBeenCalledTimes(3);
        expect(sleepMock).toHaveBeenNthCalledWith(1, 2000);
        expect(sleepMock).toHaveBeenNthCalledWith(2, 4000);
        // After reset, consecutiveErrors=1, so delay = 1000 * 2^1 = 2000 (not 8000)
        expect(sleepMock).toHaveBeenNthCalledWith(3, 2000);
    });

    it("should cap backoff at 60s maximum", async () => {
        mockSlidingSync
            .mockRejectedValueOnce(new HTTPError("server error 1", 500))
            .mockRejectedValueOnce(new HTTPError("server error 2", 500))
            .mockRejectedValueOnce(new HTTPError("server error 3", 500))
            .mockRejectedValueOnce(new HTTPError("server error 4", 500))
            .mockRejectedValueOnce(new HTTPError("server error 5", 500))
            .mockRejectedValueOnce(new HTTPError("server error 6", 500))
            .mockResolvedValueOnce({
                pos: "capped",
                lists: {},
                rooms: {},
                extensions: {},
            } as MSC3575SlidingSyncResponse);

        await runUntilCalls(7);

        // 6 errors → 6 sleep calls
        expect(sleepMock).toHaveBeenCalledTimes(6);
        // Expected delays: 2s, 4s, 8s, 16s, 32s, 60s (capped, not 64s)
        expect(sleepMock).toHaveBeenNthCalledWith(1, 2000);
        expect(sleepMock).toHaveBeenNthCalledWith(2, 4000);
        expect(sleepMock).toHaveBeenNthCalledWith(3, 8000);
        expect(sleepMock).toHaveBeenNthCalledWith(4, 16000);
        expect(sleepMock).toHaveBeenNthCalledWith(5, 32000);
        // 6th error: 1000 * 2^6 = 64000, but capped at 60000
        expect(sleepMock).toHaveBeenNthCalledWith(6, 60000);
    });

    it("should not increment consecutiveErrors for 400 errors", async () => {
        mockSlidingSync.mockRejectedValueOnce(new HTTPError("session expired", 400)).mockResolvedValueOnce({
            pos: "after400",
            lists: {},
            rooms: {},
            extensions: {},
        } as MSC3575SlidingSyncResponse);

        await runUntilCalls(2);

        // 400 error uses sleep(50) for anti-tightloop, not exponential backoff
        expect(sleepMock).toHaveBeenCalledTimes(1);
        expect(sleepMock).toHaveBeenCalledWith(50);
    });

    it("should not call sleep for AbortError", async () => {
        const abortError = new Error("aborted");
        abortError.name = "AbortError";
        mockSlidingSync.mockRejectedValueOnce(abortError).mockResolvedValueOnce({
            pos: "afterAbort",
            lists: {},
            rooms: {},
            extensions: {},
        } as MSC3575SlidingSyncResponse);

        await runUntilCalls(2);

        // AbortError continues without sleep
        expect(sleepMock).not.toHaveBeenCalled();
    });
});
