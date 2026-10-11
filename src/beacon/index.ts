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

    /**
     * 创建实时位置信标（发送 m.beacon_info state event）。
     *
     * @param roomId - 房间 ID
     * @param beaconInfoContent - 信标信息事件内容（描述、超时、live 等）
     * @returns 发送事件响应
     *
     * @example
     * ```typescript
     * const res = await client.getBeaconManager().createLiveBeacon("!room:example.org", {
     *     description: "我的位置",
     *     timeout: 3600000,
     *     live: true,
     * });
     * console.log(res.event_id);
     * ```
     */
    public async createLiveBeacon(
        roomId: string,
        beaconInfoContent: MBeaconInfoEventContent,
    ): Promise<ISendEventResponse> {
        return this.withRetry(
            () => this.client.unstable_createLiveBeacon(roomId, beaconInfoContent),
            "createLiveBeacon",
        );
    }

    /**
     * 设置/更新实时位置信标（发送 m.beacon_info state event）。
     *
     * @param roomId - 房间 ID
     * @param beaconInfoContent - 信标信息事件内容（描述、超时、live 等）
     * @returns 发送事件响应
     *
     * @example
     * ```typescript
     * const res = await client.getBeaconManager().setLiveBeacon("!room:example.org", {
     *     description: "我的位置",
     *     timeout: 3600000,
     *     live: true,
     * });
     * console.log(res.event_id);
     * ```
     */
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
     *
     * @example
     * ```typescript
     * await client.getBeaconManager().sendBeaconLocation(
     *     "!room:example.org",
     *     "$beacon_info_event",
     *     "geo:51.5008,-0.1247",
     * );
     * ```
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
     *
     * @example
     * ```typescript
     * await client.getBeaconManager().stopBeaconSharing("!room:example.org");
     * ```
     */
    public async stopBeaconSharing(
        roomId: string,
        timeout?: number,
        description?: string,
    ): Promise<ISendEventResponse> {
        return this.setLiveBeacon(roomId, makeBeaconInfoContent(timeout ?? 3600000, false, description));
    }

    /**
     * 处理房间信标事件，更新信标状态并触发相应事件。
     *
     * @param room - 可选房间对象；缺省时由底层实现推断
     * @param events - 可选需要处理的信标事件列表
     *
     * @example
     * ```typescript
     * client.getBeaconManager().processBeaconEvents(client.getRoom("!room:example.org"));
     * ```
     */
    public processBeaconEvents(room?: Room, events?: MatrixEvent[]): void {
        this.client.processBeaconEvents(room, events);
    }

    /**
     * 获取指定房间内的全部信标。
     *
     * @param roomId - 房间 ID
     * @returns 该房间的信标数组；房间不存在时返回空数组
     *
     * @example
     * ```typescript
     * const beacons = client.getBeaconManager().getBeaconsForRoom("!room:example.org");
     * ```
     */
    public getBeaconsForRoom(roomId: string): Beacon[] {
        const room = this.client.getRoom(roomId);
        if (!room) return [];
        return room.currentState.beacons ? Array.from(room.currentState.beacons.values()) : [];
    }

    /**
     * 获取当前所有活跃（isLive）的信标。
     *
     * @returns 处于活跃状态的信标数组
     *
     * @example
     * ```typescript
     * const activeBeacons = client.getBeaconManager().getActiveBeacons();
     * ```
     */
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

    /**
     * 停止指定房间内的某个信标（本地销毁信标实例）。
     *
     * @param roomId - 房间 ID
     * @param beaconId - 信标标识
     *
     * @example
     * ```typescript
     * client.getBeaconManager().stopBeacon("!room:example.org", "@alice:example.org");
     * ```
     */
    public stopBeacon(roomId: string, beaconId: string): void {
        const room = this.client.getRoom(roomId);
        if (!room) return;

        const beacons = room.currentState.beacons ? Array.from(room.currentState.beacons.values()) : [];
        const beacon = beacons.find((b) => b.identifier === beaconId);

        if (beacon) {
            beacon.destroy();
        }
    }

    /**
     * 获取指定房间内的某个信标。
     *
     * @param roomId - 房间 ID
     * @param beaconId - 信标标识
     * @returns 匹配的信标；房间不存在或未找到时返回 undefined
     *
     * @example
     * ```typescript
     * const beacon = client.getBeaconManager().getBeacon("!room:example.org", "@alice:example.org");
     * ```
     */
    public getBeacon(roomId: string, beaconId: string): Beacon | undefined {
        const room = this.client.getRoom(roomId);
        if (!room) return undefined;

        const beacons = room.currentState.beacons ? Array.from(room.currentState.beacons.values()) : [];
        return beacons.find((b) => b.identifier === beaconId);
    }

    /**
     * 订阅信标事件。
     *
     * @param event - 信标事件名
     * @param handler - 事件处理函数
     *
     * @example
     * ```typescript
     * client.getBeaconManager().subscribeToBeaconEvents("beacon_updated", ({ roomId, beacon }) => {
     *     console.log(roomId, beacon);
     * });
     * ```
     */
    public subscribeToBeaconEvents(
        event: keyof BeaconEventHandlerMap,
        handler: BeaconEventHandlerMap[keyof BeaconEventHandlerMap],
    ): void {
        this.client.on(event, handler);
    }

    /**
     * 取消订阅信标事件。
     *
     * @param event - 信标事件名
     * @param handler - 之前注册的事件处理函数
     *
     * @example
     * ```typescript
     * const handler = () => {};
     * client.getBeaconManager().unsubscribeFromBeaconEvents("beacon_updated", handler);
     * ```
     */
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
