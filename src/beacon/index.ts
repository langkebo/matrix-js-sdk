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
import { type ISendEventResponse } from "../@types/requests";
import { type MBeaconInfoEventContent } from "../@types/beacon";
import { type MatrixEvent } from "../models/event";
import { type Room } from "../models/room";
import { Beacon, type BeaconEventHandlerMap } from "../models/beacon";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface BeaconManagerEvents {
    beacon_created: { roomId: string; beacon: Beacon };
    beacon_updated: { roomId: string; beacon: Beacon };
    beacon_stopped: { roomId: string; beaconId: string };
}

export class BeaconManager extends BaseManager<keyof BeaconManagerEvents, BeaconManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public async createLiveBeacon(
        roomId: string,
        beaconInfoContent: MBeaconInfoEventContent,
    ): Promise<ISendEventResponse> {
        return this.withRetry(
            () => this.client.unstable_createLiveBeacon(roomId, beaconInfoContent),
            "createLiveBeacon",
        );
    }

    public async setLiveBeacon(
        roomId: string,
        beaconInfoContent: MBeaconInfoEventContent,
    ): Promise<ISendEventResponse> {
        return this.withRetry(() => this.client.unstable_setLiveBeacon(roomId, beaconInfoContent), "setLiveBeacon");
    }

    public processBeaconEvents(room?: Room, events?: MatrixEvent[]): void {
        this.client.processBeaconEvents(room, events);
    }

    public getBeaconsForRoom(roomId: string): Beacon[] {
        const room = this.client.getRoom(roomId);
        if (!room) return [];
        return room.currentState.beacons ? Array.from(room.currentState.beacons.values()) : [];
    }

    public getActiveBeacons(): Beacon[] {
        const rooms = this.client.getRooms();
        const activeBeacons: Beacon[] = [];

        for (const room of rooms) {
            const beacons = room.currentState.beacons ? Array.from(room.currentState.beacons.values()) : [];
            for (const beacon of beacons) {
                if (beacon.isLive) {
                    activeBeacons.push(beacon);
                }
            }
        }

        return activeBeacons;
    }

    public stopBeacon(roomId: string, beaconId: string): void {
        const room = this.client.getRoom(roomId);
        if (!room) return;

        const beacons = room.currentState.beacons ? Array.from(room.currentState.beacons.values()) : [];
        const beacon = beacons.find((b) => b.identifier === beaconId);

        if (beacon) {
            beacon.destroy();
        }
    }

    public getBeacon(roomId: string, beaconId: string): Beacon | undefined {
        const room = this.client.getRoom(roomId);
        if (!room) return undefined;

        const beacons = room.currentState.beacons ? Array.from(room.currentState.beacons.values()) : [];
        return beacons.find((b) => b.identifier === beaconId);
    }

    public subscribeToBeaconEvents(
        event: keyof BeaconEventHandlerMap,
        handler: BeaconEventHandlerMap[keyof BeaconEventHandlerMap],
    ): void {
        this.client.on(event, handler);
    }

    public unsubscribeFromBeaconEvents(
        event: keyof BeaconEventHandlerMap,
        handler: BeaconEventHandlerMap[keyof BeaconEventHandlerMap],
    ): void {
        this.client.off(event, handler);
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getBeaconManager = function (): BeaconManager {
        registerManagerClass("beacon", BeaconManager);
        return getOrCreateManager(this, "beacon", () => new BeaconManager(this));
    };
}

export default extendMatrixClient;
