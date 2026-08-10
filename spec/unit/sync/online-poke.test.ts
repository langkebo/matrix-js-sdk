import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { SyncApi, type SyncApiOptions } from "../../../src/sync";
import { logger } from "../../../src/logger";

/**
 * Regression protection for ISSUE-10a: when the browser regains connectivity
 * (window "online" event), SyncApi should immediately poke keep-alive so that
 * reconnection happens within ~3s rather than waiting for the exponential
 * back-off (worst case 60s+).
 *
 * The implementation under test lives in src/sync.ts:
 *   - sync() registers `globalThis.window.addEventListener("online", this.onOnline, false)`
 *   - onOnline() calls `this.startKeepAlives(0)` (immediate poke, no delay)
 *   - stop() removes the listener via `globalThis.window.removeEventListener`
 *
 * These tests do not modify source code; they pin the above behaviour in place.
 */
describe("SyncApi online event poke keep-alive (ISSUE-10a regression)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let originalWindow: any;
    let addEventListenerSpy: ReturnType<typeof vi.fn>;
    let removeEventListenerSpy: ReturnType<typeof vi.fn>;
    // The listener that SyncApi registered for the "online" event, captured
    // from the addEventListener spy so we can replay it like a real browser event.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedOnlineListener: ((...args: any[]) => void) | undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function createMinimalClient(): any {
        // The constructor only touches client.getNotifTimelineSet(); sync() only
        // touches client.isGuest() before the doSync() call (which we stub).
        return {
            getNotifTimelineSet: () => null,
            isGuest: () => true,
        };
    }

    function createSyncApiOptions(): SyncApiOptions {
        return { logger };
    }

    function installWindowMock(): void {
        originalWindow = globalThis.window;
        capturedOnlineListener = undefined;
        addEventListenerSpy = vi.fn((type: string, listener: unknown) => {
            if (type === "online" && typeof listener === "function") {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                capturedOnlineListener = listener as (...args: any[]) => void;
            }
        });
        removeEventListenerSpy = vi.fn();
        // The node test environment has no globalThis.window; install a minimal one.
        globalThis.window = {
            addEventListener: addEventListenerSpy,
            removeEventListener: removeEventListenerSpy,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
    }

    beforeEach(() => {
        installWindowMock();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        globalThis.window = originalWindow;
    });

    it("registers an 'online' event listener when sync() starts", async () => {
        const client = createMinimalClient();
        const syncApi = new SyncApi(client, undefined, createSyncApiOptions());

        // Stub doSync so sync() resolves cleanly right after the listener is wired up.
        vi.spyOn(syncApi as never, "doSync").mockResolvedValue(undefined);

        await syncApi.sync();

        expect(addEventListenerSpy).toHaveBeenCalled();
        const onlineCall = addEventListenerSpy.mock.calls.find((c) => c[0] === "online");
        expect(onlineCall, "an 'online' listener must be registered on sync()").toBeDefined();
        expect(typeof onlineCall![1]).toBe("function");
        // Registered with useCapture=false, matching the implementation.
        expect(onlineCall![2]).toBe(false);
    });

    it("the registered 'online' listener triggers startKeepAlives(0) for immediate reconnection", async () => {
        const client = createMinimalClient();
        const syncApi = new SyncApi(client, undefined, createSyncApiOptions());
        vi.spyOn(syncApi as never, "doSync").mockResolvedValue(undefined);

        await syncApi.sync();

        // The listener registered in sync() must have been captured.
        expect(capturedOnlineListener, "sync() must register an 'online' listener").toBeDefined();

        // Spy on the private startKeepAlives so we can assert the poke happens
        // with no delay, without performing a real HTTP /versions request.
        const startKeepAlivesSpy = vi
            .spyOn(syncApi as never, "startKeepAlives")
            .mockResolvedValue(true);

        // Replay the browser-fired "online" event using the exact handler SyncApi registered.
        capturedOnlineListener!();

        expect(startKeepAlivesSpy).toHaveBeenCalledTimes(1);
        // delay=0 means "poke immediately" — the core of ISSUE-10a.
        expect(startKeepAlivesSpy).toHaveBeenCalledWith(0);
    });

    it("stop() removes the same 'online' event listener that sync() registered", async () => {
        const client = createMinimalClient();
        const syncApi = new SyncApi(client, undefined, createSyncApiOptions());
        vi.spyOn(syncApi as never, "doSync").mockResolvedValue(undefined);

        await syncApi.sync();
        const registeredListener = capturedOnlineListener;
        expect(registeredListener).toBeDefined();

        syncApi.stop();

        expect(removeEventListenerSpy).toHaveBeenCalled();
        const onlineCall = removeEventListenerSpy.mock.calls.find((c) => c[0] === "online");
        expect(onlineCall, "stop() must remove an 'online' listener").toBeDefined();
        // Registration and cleanup must be symmetric: same function reference, same useCapture flag.
        expect(onlineCall![1]).toBe(registeredListener);
        expect(onlineCall![2]).toBe(false);
    });
});
