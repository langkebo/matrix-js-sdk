import { describe, it, expect, vi, beforeEach } from "vitest";

import { stopClientLifecycleServices } from "../../../src/client-lifecycle-stop";
import {
    getOrCreateManager,
    clearManagerRegistry,
    getAllManagersForClient,
} from "../../../src/client-infra/manager-registry";

/**
 * ISSUE-11a regression: `stopClientLifecycleServices` must clean up
 *   1. Room-level NOT_SENT sweep timers (disposeNotSentSweepTimer)
 *   2. All registered managers (stop())
 *   3. Manager registry references (clearManagerRegistry)
 *
 * A single failing manager.stop() must not block the rest of the cleanup.
 */
describe("ISSUE-11a stop cleans up managers and room timers", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client: Record<string, any>;

    beforeEach(() => {
        client = {
            cryptoBackend: { stop: vi.fn() },
            syncApi: { stop: vi.fn() },
            peekSync: { stopPeeking: vi.fn() },
            callEventHandler: { stop: vi.fn() },
            groupCallEventHandler: { stop: vi.fn() },
            checkTurnServersIntervalID: undefined,
            clientWellKnownIntervalID: undefined,
            toDeviceMessageQueue: { stop: vi.fn() },
            matrixRTC: { stop: vi.fn() },
            serverCapabilitiesService: { stop: vi.fn() },
            getRooms: vi.fn(() => []),
        };
        // Ensure a clean registry between tests (the Symbol is shared across
        // the whole test process via Symbol.for).
        clearManagerRegistry(client as never);
    });

    it("stopClientLifecycleServices calls disposeNotSentSweepTimer on all rooms", () => {
        const room1 = { roomId: "!r1", disposeNotSentSweepTimer: vi.fn() };
        const room2 = { roomId: "!r2", disposeNotSentSweepTimer: vi.fn() };
        client.getRooms = vi.fn(() => [room1, room2]);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stopClientLifecycleServices(client as any);

        expect(room1.disposeNotSentSweepTimer).toHaveBeenCalledTimes(1);
        expect(room2.disposeNotSentSweepTimer).toHaveBeenCalledTimes(1);
    });

    it("stopClientLifecycleServices calls stop() on all registered managers", () => {
        const stopSpy = vi.fn();
        getOrCreateManager(client as never, "test-manager-a", () => ({ stop: stopSpy }));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stopClientLifecycleServices(client as any);

        expect(stopSpy).toHaveBeenCalledTimes(1);
    });

    it("stopClientLifecycleServices clears manager registry", () => {
        getOrCreateManager(client as never, "test-manager-b", () => ({ stop: vi.fn() }));
        expect(getAllManagersForClient(client as never)).toHaveLength(1);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stopClientLifecycleServices(client as any);

        expect(getAllManagersForClient(client as never)).toHaveLength(0);
    });

    it("manager stop() failure does not block other managers", () => {
        const throwingStop = vi.fn(() => {
            throw new Error("boom");
        });
        const healthyStop = vi.fn();
        // Register throwing manager first to confirm the second one still runs.
        getOrCreateManager(client as never, "test-manager-throw", () => ({ stop: throwingStop }));
        getOrCreateManager(client as never, "test-manager-healthy", () => ({ stop: healthyStop }));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(() => stopClientLifecycleServices(client as any)).not.toThrow();

        expect(throwingStop).toHaveBeenCalledTimes(1);
        expect(healthyStop).toHaveBeenCalledTimes(1);
    });
});
