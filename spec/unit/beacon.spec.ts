import { describe, it, expect, beforeEach, vi } from "vitest";

import { BeaconManager } from "../../src/beacon";
import { MatrixEvent } from "../../src/models/event";
import { Beacon } from "../../src/models/beacon";
import { RoomState } from "../../src/models/room-state";
import { M_BEACON } from "../../src/@types/beacon";
import type { MatrixClient } from "../../src/client";

describe("BeaconManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await manager.createLiveBeacon("!r:hs", { timeout: 1 } as any);
        expect(mockClient.unstable_createLiveBeacon).toHaveBeenCalledWith("!r:hs", { timeout: 1 });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        manager.subscribeToBeaconEvents("Beacon.new" as any, handler);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        manager.unsubscribeFromBeaconEvents("Beacon.new" as any, handler);
        expect(mockClient.on).toHaveBeenCalledWith("Beacon.new", handler);
        expect(mockClient.off).toHaveBeenCalledWith("Beacon.new", handler);
    });

    it("sendBeaconLocation sends an m.beacon event with a reference relation", async () => {
        mockClient.sendEvent = vi.fn().mockResolvedValue({ event_id: "$loc" });

        await manager.sendBeaconLocation("!r:hs", "$beacon1", "geo:1,2", 123, "desc");

        expect(mockClient.sendEvent).toHaveBeenCalledWith(
            "!r:hs",
            M_BEACON.name,
            expect.objectContaining({
                "m.relates_to": { rel_type: "m.reference", event_id: "$beacon1" },
            }),
        );
    });

    it("stopBeaconSharing sends a live:false beacon_info state event", async () => {
        await manager.stopBeaconSharing("!r:hs", 5000, "desc");

        expect(mockClient.unstable_setLiveBeacon).toHaveBeenCalledWith(
            "!r:hs",
            expect.objectContaining({ live: false, timeout: 5000, description: "desc" }),
        );
    });
});

describe("RoomState.processBeaconEvents", () => {
    const roomId = "!room:example.com";
    const userId = "@alice:example.com";

    // Build a live beacon_info root event whose event_id is `$beacon1`,
    // then register a real Beacon in the RoomState's beacon collection.
    const makeLiveBeacon = (): Beacon => {
        const beaconInfoEvent = new MatrixEvent({
            type: "org.matrix.msc3672.beacon_info",
            room_id: roomId,
            event_id: "$beacon1",
            state_key: userId,
            sender: userId,
            content: {
                live: true,
                timeout: 86400000,
                "m.ts": Date.now() - 1000,
                "m.asset": { type: "m.self" },
            },
        });
        return new Beacon(beaconInfoEvent);
    };

    it("resolves the beacon via m.relates_to.event_id and updates latestLocationState", () => {
        const roomState = new RoomState(roomId);
        const beacon = makeLiveBeacon();
        roomState.beacons.set(beacon.identifier, beacon);

        const locationEvent = new MatrixEvent({
            type: "m.beacon",
            room_id: roomId,
            event_id: "$location1",
            sender: userId,
            content: {
                "m.relates_to": { rel_type: "m.reference", event_id: "$beacon1" },
                "m.location": { uri: "geo:1,2" },
                "m.ts": Date.now(),
            },
        });

        roomState.processBeaconEvents([locationEvent], {} as MatrixClient);

        expect(beacon.latestLocationState?.uri).toBe("geo:1,2");
    });
});
