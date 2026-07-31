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
import { logger } from "../../src/logger";

/**
 * Tests for SlidingSync log level optimization.
 *
 * Per-request logs are downgraded from info to debug to reduce production log noise.
 * A summary log is emitted at info level every 10 successful requests, including
 * the request count and current pos for monitoring.
 */
describe("SlidingSync log level optimization", () => {
    let mockSlidingSync: ReturnType<typeof vi.fn>;
    let client: MatrixClient;
    let slidingSync: SlidingSync;
    let infoSpy: ReturnType<typeof vi.spyOn>;
    let debugSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        sleepMock.mockClear();
        sleepMock.mockResolvedValue(undefined);

        infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);
        debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => undefined);

        mockSlidingSync = vi.fn();
        client = {
            slidingSync: mockSlidingSync,
        } as unknown as MatrixClient;
        slidingSync = new SlidingSync("http://localhost:28008", new Map(), {}, client, 1);
    });

    afterEach(() => {
        slidingSync.stop();
        infoSpy.mockRestore();
        debugSpy.mockRestore();
    });

    /** Helper: create a successful sync response with the given pos */
    function makeResponse(pos: string): MSC3575SlidingSyncResponse {
        return {
            pos,
            lists: {},
            rooms: {},
            extensions: {},
        } as MSC3575SlidingSyncResponse;
    }

    /** Helper: run the start() loop until the mock client has been called expectedCalls times */
    async function runUntilCalls(expectedCalls: number, maxIterations = 200): Promise<void> {
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

    it("per-request log should be at debug level, not info", async () => {
        mockSlidingSync.mockResolvedValueOnce(makeResponse("pos-1"));

        await runUntilCalls(1);

        // The "Sending request" log should be at debug level
        const debugCalls = debugSpy.mock.calls.filter(
            (call: unknown[]) =>
                typeof call[0] === "string" && (call[0] as string).includes("[SlidingSync] Sending request"),
        );
        expect(debugCalls.length).toBeGreaterThan(0);

        // The "Sending request" log should NOT appear at info level
        const infoCallsForRequest = infoSpy.mock.calls.filter(
            (call: unknown[]) =>
                typeof call[0] === "string" && (call[0] as string).includes("[SlidingSync] Sending request"),
        );
        expect(infoCallsForRequest).toHaveLength(0);
    });

    it("summary log should be emitted at info level every 10 requests", async () => {
        // Mock 10 successful responses
        for (let i = 1; i <= 10; i++) {
            mockSlidingSync.mockResolvedValueOnce(makeResponse(`pos-${i}`));
        }

        await runUntilCalls(10);

        // Should have exactly 1 summary log at info level (after 10th request)
        const summaryCalls = infoSpy.mock.calls.filter(
            (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("requests processed"),
        );
        expect(summaryCalls).toHaveLength(1);
        expect(summaryCalls[0][0]).toContain("10 requests processed");
        expect(summaryCalls[0][0]).toContain("pos=pos-10..."); // pos-10 sliced to 8 chars = "pos-10"
    });

    it("summary log should be emitted after 20 requests (2 summaries)", async () => {
        for (let i = 1; i <= 20; i++) {
            mockSlidingSync.mockResolvedValueOnce(makeResponse(`pos-${i}`));
        }

        await runUntilCalls(20);

        const summaryCalls = infoSpy.mock.calls.filter(
            (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("requests processed"),
        );
        expect(summaryCalls).toHaveLength(2);
        expect(summaryCalls[0][0]).toContain("10 requests processed");
        expect(summaryCalls[1][0]).toContain("20 requests processed");
    });

    it("no summary log before 10 requests", async () => {
        for (let i = 1; i <= 9; i++) {
            mockSlidingSync.mockResolvedValueOnce(makeResponse(`pos-${i}`));
        }

        await runUntilCalls(9);

        const summaryCalls = infoSpy.mock.calls.filter(
            (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("requests processed"),
        );
        expect(summaryCalls).toHaveLength(0);
    });

    it("start() startup log remains at info level (one-time)", async () => {
        mockSlidingSync.mockResolvedValueOnce(makeResponse("pos-1"));

        await runUntilCalls(1);

        // The startup log "start() called" should still be at info level
        const startupCalls = infoSpy.mock.calls.filter(
            (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("start() called"),
        );
        expect(startupCalls.length).toBeGreaterThan(0);
    });

    it("summary log includes pos for monitoring", async () => {
        for (let i = 1; i <= 10; i++) {
            mockSlidingSync.mockResolvedValueOnce(makeResponse("pos-abcdef123456"));
        }

        await runUntilCalls(10);

        const summaryCalls = infoSpy.mock.calls.filter(
            (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("requests processed"),
        );
        expect(summaryCalls).toHaveLength(1);
        // pos should be included and sliced to 8 chars for brevity
        expect(summaryCalls[0][0]).toContain("pos=pos-abcd...");
    });
});
