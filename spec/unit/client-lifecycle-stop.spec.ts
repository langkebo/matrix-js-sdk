import { describe, expect, it, vi, beforeEach } from "vitest";

import { stopClientLifecycleServices } from "../../src/client-lifecycle-stop";

describe("client-lifecycle-stop", () => {
    let client: Record<string, any>;
    let syncApiMock: { stop: ReturnType<typeof vi.fn> };
    let callEventHandlerMock: { stop: ReturnType<typeof vi.fn> };
    let groupCallEventHandlerMock: { stop: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        syncApiMock = { stop: vi.fn() };
        callEventHandlerMock = { stop: vi.fn() };
        groupCallEventHandlerMock = { stop: vi.fn() };

        client = {
            cryptoBackend: { stop: vi.fn() },
            syncApi: syncApiMock,
            peekSync: { stopPeeking: vi.fn() },
            callEventHandler: callEventHandlerMock,
            groupCallEventHandler: groupCallEventHandlerMock,
            checkTurnServersIntervalID: 123,
            clientWellKnownIntervalID: undefined,
            toDeviceMessageQueue: { stop: vi.fn() },
            matrixRTC: { stop: vi.fn() },
            serverCapabilitiesService: { stop: vi.fn() },
        };
    });

    it("stops all lifecycle services", () => {
        stopClientLifecycleServices(client as any);

        expect(client.cryptoBackend.stop).toHaveBeenCalled();
        // syncApi mock reference captured before it gets reassigned to undefined
        expect(syncApiMock.stop).toHaveBeenCalled();
        expect(client.syncApi).toBeUndefined();
        expect(client.peekSync.stopPeeking).toHaveBeenCalled();
        expect(callEventHandlerMock.stop).toHaveBeenCalled();
        expect(groupCallEventHandlerMock.stop).toHaveBeenCalled();
        expect(client.callEventHandler).toBeUndefined();
        expect(client.groupCallEventHandler).toBeUndefined();
        expect(client.checkTurnServersIntervalID).toBeUndefined();
        expect(client.toDeviceMessageQueue.stop).toHaveBeenCalled();
        expect(client.matrixRTC.stop).toHaveBeenCalled();
        expect(client.serverCapabilitiesService.stop).toHaveBeenCalled();
    });

    it("clears turn server interval ID", () => {
        client.checkTurnServersIntervalID = 456;

        stopClientLifecycleServices(client as any);

        expect(client.checkTurnServersIntervalID).toBeUndefined();
    });

    it("handles missing optional services gracefully", () => {
        delete client.cryptoBackend;
        client.syncApi = undefined;
        client.callEventHandler = undefined;
        client.groupCallEventHandler = undefined;

        expect(() => stopClientLifecycleServices(client as any)).not.toThrow();
    });
});
