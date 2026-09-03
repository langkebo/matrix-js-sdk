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

// Mock the sleep function to resolve immediately so the async start() loop
// runs at full speed without real delays.
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
import { type MatrixClient, type MSC3575SlidingSyncResponse } from "../../src";

/**
 * Tests for MSC4186 txn_id idempotency on the sliding sync request body.
 *
 * The backend caches sliding sync responses keyed by (user, device, txn_id)
 * and returns the cached body on retry. For this to work, the SDK must:
 *  - reuse the SAME txn_id when retrying a request for the same pos
 *    (e.g. after a network error), and
 *  - generate a NEW txn_id once a successful response advances the pos.
 */
describe("SlidingSync txn_id idempotency", () => {
    let mockSlidingSync: ReturnType<typeof vi.fn>;
    let makeTxnId: ReturnType<typeof vi.fn>;
    let client: MatrixClient;
    let slidingSync: SlidingSync;
    let txnIdCounter: number;

    beforeEach(() => {
        sleepMock.mockClear();
        sleepMock.mockResolvedValue(undefined);
        mockSlidingSync = vi.fn();
        txnIdCounter = 0;
        makeTxnId = vi.fn(() => `m${++txnIdCounter}`);
        client = {
            slidingSync: mockSlidingSync,
            makeTxnId,
        } as unknown as MatrixClient;
        slidingSync = new SlidingSync("http://localhost:28008", new Map(), {}, client, 1);
    });

    afterEach(() => {
        slidingSync.stop();
    });

    /**
     * Run the start() loop until the mock client has been called expectedCalls
     * times, flushing microtasks so the async loop can progress.
     */
    async function runUntilCalls(expectedCalls: number, maxIterations = 100): Promise<void> {
        const startPromise = slidingSync.start();
        for (let i = 0; i < maxIterations; i++) {
            if (mockSlidingSync.mock.calls.length >= expectedCalls) {
                break;
            }
            await Promise.resolve();
            await Promise.resolve();
        }
        slidingSync.stop();
        await startPromise.catch(() => {
            // start() may reject if stopped mid-loop — that's fine
        });
    }

    it("reuses the same txn_id when retrying the same pos after a network error", async () => {
        // First attempt fails with a network error (abort-like, no backoff),
        // second attempt succeeds — both target the same (empty) pos.
        mockSlidingSync
            .mockRejectedValueOnce(new Error("fetch failed"))
            .mockResolvedValueOnce({
                pos: "p1",
                lists: {},
                rooms: {},
                extensions: {},
            } as MSC3575SlidingSyncResponse);

        await runUntilCalls(2);

        const req1 = mockSlidingSync.mock.calls[0][0] as { txn_id?: string };
        const req2 = mockSlidingSync.mock.calls[1][0] as { txn_id?: string };
        expect(req1.txn_id).toBeDefined();
        expect(req2.txn_id).toBe(req1.txn_id);
        // Only one txn_id was generated — the retry reused it.
        expect(makeTxnId).toHaveBeenCalledTimes(1);
    });

    it("generates a new txn_id after a successful response advances the pos", async () => {
        mockSlidingSync
            .mockResolvedValueOnce({
                pos: "p1",
                lists: {},
                rooms: {},
                extensions: {},
            } as MSC3575SlidingSyncResponse)
            .mockResolvedValueOnce({
                pos: "p2",
                lists: {},
                rooms: {},
                extensions: {},
            } as MSC3575SlidingSyncResponse);

        await runUntilCalls(2);

        const req1 = mockSlidingSync.mock.calls[0][0] as { txn_id?: string };
        const req2 = mockSlidingSync.mock.calls[1][0] as { txn_id?: string };
        expect(req1.txn_id).toBeDefined();
        expect(req2.txn_id).toBeDefined();
        expect(req2.txn_id).not.toBe(req1.txn_id);
        expect(makeTxnId).toHaveBeenCalledTimes(2);
    });
});
