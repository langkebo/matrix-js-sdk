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
import { M_BEACON, type MBeaconInfoEventContent } from "../@types/beacon";
import { type MatrixEvent } from "../models/event";
import { type Room } from "../models/room";
import { Beacon, type BeaconEventHandlerMap } from "../models/beacon";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { makeBeaconContent, makeBeaconInfoContent } from "../content-helpers";

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

    /**
     * 发送 m.beacon 位置更新事件（MSC3672）。
     *
     * 通过 m.relates_to(m.reference) 关联到 beacon_info 事件，作为该信标的一个位置更新。
     *
     * @param roomId - 房间 ID
     * @param beaconInfoEventId - 关联的 m.beacon_info 事件 ID
     * @param geoUri - geo URI（如 `geo:51.5008,-0.1247`）
     * @param timestamp - 可选时间戳，默认 Date.now()
     * @param description - 可选位置描述
     */
    public async sendBeaconLocation(
        roomId: string,
        beaconInfoEventId: string,
        geoUri: string,
        timestamp?: number,
        description?: string,
    ): Promise<ISendEventResponse> {
        return this.withRetry(
            () =>
                this.client.sendEvent(
                    roomId,
                    M_BEACON.name,
                    makeBeaconContent(geoUri, timestamp ?? Date.now(), beaconInfoEventId, description),
                ),
            "sendBeaconLocation",
        );
    }

    /**
     * 停止共享位置（发送 live:false 的 m.beacon_info state event）。
     *
     * 本方法通过 setLiveBeacon 向服务端发送停止事件（与前端此前用 setLiveBeacon(live:false)
     * 绕过 BeaconManager.stopBeacon 仅本地 destroy 的行为一致）。
     *
     * @param roomId - 房间 ID
     * @param timeout - 可选超时，默认 3600000ms
     * @param description - 可选描述
     */
    public async stopBeaconSharing(
        roomId: string,
        timeout?: number,
        description?: string,
    ): Promise<ISendEventResponse> {
        return this.setLiveBeacon(roomId, makeBeaconInfoContent(timeout ?? 3600000, false, description));
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
