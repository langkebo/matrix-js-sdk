/*
Copyright 2024 The Matrix.org Foundation C.I.C.

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

/**
 * Beacon Manager - 位置信标管理
 * 
 * 提供位置信标(Beacon)相关功能
 * 对应后端: beacon_service
 */

import { MatrixClient } from "../client";
import { type MBeaconInfoEventContent } from "../@types/beacon";
import { type MatrixEvent } from "../models/event";
import { type Room } from "../models/room";
import { Beacon, type BeaconEventHandlerMap } from "../models/beacon";

export class BeaconManager {
    constructor(private client: MatrixClient) {}

    /**
     * Create a live beacon event
     * @deprecated This is an unstable API
     */
    public async createLiveBeacon(roomId: string, beaconInfoContent: MBeaconInfoEventContent): Promise<MatrixEvent> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).unstable_createLiveBeacon(roomId, beaconInfoContent);
    }

    /**
     * Set a live beacon event
     * @deprecated This is an unstable API
     */
    public async setLiveBeacon(roomId: string, beaconInfoContent: MBeaconInfoEventContent): Promise<MatrixEvent> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).unstable_setLiveBeacon(roomId, beaconInfoContent);
    }

    /**
     * Process beacon events for a room
     */
    public processBeaconEvents(room?: Room, events?: MatrixEvent[]): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).processBeaconEvents(room, events);
    }

    /**
     * Get beacons for a room
     */
    public getBeaconsForRoom(roomId: string): Beacon[] {
        const room = this.client.getRoom(roomId);
        if (!room) return [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (room.currentState as any).beacons || [];
    }

    /**
     * Get active beacons
     */
    public getActiveBeacons(): Beacon[] {
        const rooms = this.client.getRooms();
        const activeBeacons: Beacon[] = [];
        
        for (const room of rooms) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const beacons = (room.currentState as any).beacons || [];
            for (const beacon of beacons) {
                if (beacon.isLive) {
                    activeBeacons.push(beacon);
                }
            }
        }
        
        return activeBeacons;
    }

    /**
     * Stop a beacon
     */
    public async stopBeacon(roomId: string, beaconId: string): Promise<void> {
        const room = this.client.getRoom(roomId);
        if (!room) return;
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const beacons = (room.currentState as any).beacons || [];
        const beacon = beacons.find((b: Beacon) => b.identifier === beaconId);
        
        if (beacon) {
            await beacon.stop();
        }
    }

    /**
     * Get beacon by ID
     */
    public getBeacon(roomId: string, beaconId: string): Beacon | undefined {
        const room = this.client.getRoom(roomId);
        if (!room) return undefined;
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const beacons = (room.currentState as any).beacons || [];
        return beacons.find((b: Beacon) => b.identifier === beaconId);
    }

    /**
     * On beacon event
     */
    public on(event: keyof BeaconEventHandlerMap, handler: BeaconEventHandlerMap[keyof BeaconEventHandlerMap]): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).on(event, handler);
    }

    /**
     * Off beacon event
     */
    public off(event: keyof BeaconEventHandlerMap, handler: BeaconEventHandlerMap[keyof BeaconEventHandlerMap]): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).off(event, handler);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getBeaconManager(): BeaconManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getBeaconManager = function (): BeaconManager {
        return new BeaconManager(this);
    };
}

export default extendMatrixClient;
