/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You May obtain a copy of the License at

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

export interface IStateEvent {
    type: string;
    state_key: string;
    content: Record<string, unknown>;
    sender: string;
    event_id: string;
    origin_server_ts: number;
}

export interface ISendStateEventResponse {
    event_id: string;
}

export interface IEncryptionConfig {
    algorithm: string;
    rotation_period_ms?: number;
    rotation_period_msgs?: number;
}

export class RoomStateManager {
    constructor(private client: MatrixClient) {}

    public async roomState(roomId: string): Promise<IStateEvent[]> {
        const path = utils.encodeUri("/rooms/$roomId/state", { $roomId: roomId });
        return this.client.http.authedRequest<IStateEvent[]>(Method.Get, path);
    }

    public async getStateEvents(roomId: string, eventType?: string, stateKey?: string): Promise<IStateEvent | IStateEvent[]> {
        const path = eventType
            ? utils.encodeUri("/rooms/$roomId/state/$eventType/$stateKey", {
                $roomId: roomId,
                $eventType: eventType,
                $stateKey: stateKey || "",
            })
            : utils.encodeUri("/rooms/$roomId/state", { $roomId: roomId });
        return this.client.http.authedRequest<IStateEvent | IStateEvent[]>(Method.Get, path);
    }

    public async getAllStateEvents(roomId: string): Promise<IStateEvent[]> {
        try {
            const state = await this.roomState(roomId);
            return Array.isArray(state) ? state : [];
        } catch {
            return [];
        }
    }

    public async getStateEventsByType(roomId: string, eventType: string): Promise<IStateEvent[]> {
        try {
            const result = await this.getStateEvents(roomId, eventType);
            return Array.isArray(result) ? result : [result].filter(Boolean);
        } catch {
            return [];
        }
    }

    public async sendStateEvent(roomId: string, eventType: string, content: Record<string, unknown>, stateKey?: string): Promise<ISendStateEventResponse> {
        const path = utils.encodeUri("/rooms/$roomId/state/$eventType/$stateKey", {
            $roomId: roomId,
            $eventType: eventType,
            $stateKey: stateKey || "",
        });
        return this.client.http.authedRequest<ISendStateEventResponse>(Method.Put, path, undefined, content);
    }

    public async getRoomEncryption(roomId: string): Promise<IEncryptionConfig | null> {
        const path = utils.encodeUri("/rooms/$roomId/state/m.room.encryption", { $roomId: roomId });
        try {
            return await this.client.http.authedRequest<IEncryptionConfig>(Method.Get, path);
        } catch {
            return null;
        }
    }

    public async setRoomEncryption(roomId: string, config: IEncryptionConfig): Promise<ISendStateEventResponse> {
        return this.sendStateEvent(roomId, "m.room.encryption", config as unknown as Record<string, unknown>);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getRoomStateManager(): RoomStateManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomStateManager = function (): RoomStateManager {
        return new RoomStateManager(this);
    };
}

export default extendMatrixClient;
