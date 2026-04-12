import { describe, it, expect, beforeEach, vi } from "vitest";

import { BeaconManager } from "../../src/beacon";

describe("BeaconManager", () => {
    let mockClient: any;
    let manager: BeaconManager;

    beforeEach(() => {
        mockClient = {
            unstable_createLiveBeacon: vi.fn().mockResolvedValue({ event_id: "$1" }),
            unstable_setLiveBeacon: vi.fn().mockResolvedValue({ event_id: "$2" }),
            processBeaconEvents: vi.fn(),
            getRoom: vi.fn(),
            getRooms: vi.fn().mockReturnValue([]),
            on: vi.fn(),
            off: vi.fn(),
        };
        manager = new BeaconManager(mockClient);
    });

    it("creates/updates beacons and forwards processing", async () => {
        await manager.createLiveBeacon("!r:hs", { timeout: 1 } as any);
        expect(mockClient.unstable_createLiveBeacon).toHaveBeenCalledWith("!r:hs", { timeout: 1 });

        await manager.setLiveBeacon("!r:hs", { timeout: 2 } as any);
        expect(mockClient.unstable_setLiveBeacon).toHaveBeenCalledWith("!r:hs", { timeout: 2 });

        manager.processBeaconEvents(undefined, []);
        expect(mockClient.processBeaconEvents).toHaveBeenCalled();
    });

    it("reads and filters room beacons", () => {
        const b1 = { identifier: "b1", isLive: true, destroy: vi.fn() };
        const b2 = { identifier: "b2", isLive: false, destroy: vi.fn() };
        mockClient.getRoom.mockReturnValue({
            currentState: {
                beacons: new Map([
                    ["b1", b1],
                    ["b2", b2],
                ]),
            },
        });
        mockClient.getRooms.mockReturnValue([
            {
                currentState: {
                    beacons: new Map([
                        ["b1", b1],
                        ["b2", b2],
                    ]),
                },
            },
        ]);

        expect(manager.getBeaconsForRoom("!r:hs")).toEqual([b1, b2]);
        expect(manager.getActiveBeacons()).toEqual([b1]);
        expect(manager.getBeacon("!r:hs", "b1")).toBe(b1);
    });

    it("handles missing room and beacon stop", () => {
        const b1 = { identifier: "b1", isLive: true, destroy: vi.fn() };
        mockClient.getRoom.mockReturnValue({
            currentState: { beacons: new Map([["b1", b1]]) },
        });
        manager.stopBeacon("!r:hs", "b1");
        expect(b1.destroy).toHaveBeenCalled();

        mockClient.getRoom.mockReturnValue(undefined);
        expect(manager.getBeaconsForRoom("!missing:hs")).toEqual([]);
        expect(manager.getBeacon("!missing:hs", "b1")).toBeUndefined();
    });

    it("subscribes and unsubscribes beacon events", () => {
        const handler = vi.fn();
        manager.subscribeToBeaconEvents("Beacon.new" as any, handler);
        manager.unsubscribeFromBeaconEvents("Beacon.new" as any, handler);
        expect(mockClient.on).toHaveBeenCalledWith("Beacon.new", handler);
        expect(mockClient.off).toHaveBeenCalledWith("Beacon.new", handler);
    });
});
