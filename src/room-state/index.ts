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

export class RoomStateManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get room state
     */
    public async roomState(roomId: string): Promise<any> {
        const path = utils.encodeUri("/rooms/$roomId/state", { $roomId: roomId });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Get, path);
    }

    /**
     * Get state events
     */
    public async getStateEvents(roomId: string, eventType?: string, stateKey?: string): Promise<any> {
        const path = eventType
            ? utils.encodeUri("/rooms/$roomId/state/$eventType/$stateKey", {
                $roomId: roomId,
                $eventType: eventType,
                $stateKey: stateKey || "",
            })
            : utils.encodeUri("/rooms/$roomId/state", { $roomId: roomId });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Get, path);
    }

    /**
     * Get all state events for a room (returns array)
     * Gets all state events for the given room.
     * @param roomId - The room ID to get state events for
     * @returns Array of state events
     */
    public async getAllStateEvents(roomId: string): Promise<any[]> {
        try {
            const state = await this.roomState(roomId);
            return Array.isArray(state) ? state : [];
        } catch {
            return [];
        }
    }

    /**
     * Get state events by type
     * Gets all state events of a specific type for the given room.
     * @param roomId - The room ID to get state events for
     * @param eventType - The event type to filter by
     * @returns Array of state events of the specified type
     */
    public async getStateEventsByType(roomId: string, eventType: string): Promise<any[]> {
        try {
            const result = await this.getStateEvents(roomId, eventType);
            return Array.isArray(result) ? result : [result].filter(Boolean);
        } catch {
            return [];
        }
    }

    /**
     * Send state event
     */
    public async sendStateEvent(roomId: string, eventType: string, content: any, stateKey?: string): Promise<any> {
        const path = utils.encodeUri("/rooms/$roomId/state/$eventType/$stateKey", {
            $roomId: roomId,
            $eventType: eventType,
            $stateKey: stateKey || "",
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Put, path, undefined, content);
    }

    /**
     * Get room encryption
     */
    public async getRoomEncryption(roomId: string): Promise<any> {
        const path = utils.encodeUri("/rooms/$roomId/state/m.room.encryption", { $roomId: roomId });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Get, path);
    }

    /**
     * Set room encryption
     */
    public async setRoomEncryption(roomId: string, config: any): Promise<any> {
        return this.sendStateEvent(roomId, "m.room.encryption", config);
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
