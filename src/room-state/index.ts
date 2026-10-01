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
 * Room State Manager - 房间状态管理
 *
 * 提供房间状态获取、设置等功能
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import * as utils from "../utils";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type { IContent } from "../models/event";
import { logger } from "../logger";

export interface IStateEvent {
    type: string;
    state_key: string;
    content: IContent;
    sender: string;
    event_id: string;
    origin_server_ts: number;
}

export interface ISendStateEventResponse {
    event_id: string;
}

export interface IEncryptionConfig {
    [key: string]: unknown;
    algorithm: string;
    rotation_period_ms?: number;
    rotation_period_msgs?: number;
}

export interface RoomStateManagerEvents {
    state_event_sent: { roomId: string; eventType: string; stateKey: string };
    state_updated: { roomId: string };
}

export class RoomStateManager extends BaseManager<keyof RoomStateManagerEvents, RoomStateManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public async roomState(roomId: string, eventType?: string): Promise<IStateEvent[]> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/rooms/$roomId/state", { $roomId: roomId });
            return this.request<IStateEvent[]>({
                method: Method.Get,
                path: path,
                // MSC4497: optional `type` query param filters state events by
                // event type server-side.
                queryParams: eventType ? { type: eventType } : undefined,
            });
        }, "roomState");
    }

    public async getStateEvents(
        roomId: string,
        eventType?: string,
        stateKey?: string,
    ): Promise<IStateEvent | IStateEvent[]> {
        return this.withRetry(async () => {
            const path = eventType
                ? utils.encodeUri("/rooms/$roomId/state/$eventType/$stateKey", {
                      $roomId: roomId,
                      $eventType: eventType,
                      $stateKey: stateKey || "",
                  })
                : utils.encodeUri("/rooms/$roomId/state", { $roomId: roomId });
            return this.request<IStateEvent | IStateEvent[]>({
                method: Method.Get,
                path: path,
            });
        }, "getStateEvents");
    }

    public async getAllStateEvents(roomId: string): Promise<IStateEvent[]> {
        try {
            const state = await this.roomState(roomId);
            return Array.isArray(state) ? state : [];
            // @swallow-error { owner: "room-state", expires: "2026-12-31" }
        } catch (e) {
            logger.warn("RoomStateManager.getAllStateEvents failed:", e);
            return [];
        }
    }

    public async getStateEventsByType(roomId: string, eventType: string): Promise<IStateEvent[]> {
        try {
            const result = await this.getStateEvents(roomId, eventType);
            return Array.isArray(result) ? result : [result].filter(Boolean);
            // @swallow-error { owner: "room-state", expires: "2026-12-31" }
        } catch (e) {
            logger.warn("RoomStateManager.getStateEventsByType failed:", e);
            return [];
        }
    }

    public async sendStateEvent(
        roomId: string,
        eventType: string,
        content: IContent,
        stateKey?: string,
    ): Promise<ISendStateEventResponse> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/rooms/$roomId/state/$eventType/$stateKey", {
                $roomId: roomId,
                $eventType: eventType,
                $stateKey: stateKey || "",
            });
            return this.request<ISendStateEventResponse>({
                method: Method.Put,
                path: path,
                body: content,
            });
        }, "sendStateEvent");
    }

    public async getRoomEncryption(roomId: string): Promise<IEncryptionConfig | null> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/rooms/$roomId/state/m.room.encryption", { $roomId: roomId });
            return this.request<IEncryptionConfig>({
                method: Method.Get,
                path: path,
            });
        }, "getRoomEncryption");
    }

    public async setRoomEncryption(roomId: string, config: IEncryptionConfig): Promise<ISendStateEventResponse> {
        return this.sendStateEvent(roomId, "m.room.encryption", config);
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomStateManager = function (): RoomStateManager {
        registerManagerClass("roomState", RoomStateManager);
        return getOrCreateManager(this, "roomState", () => new RoomStateManager(this));
    };
}
