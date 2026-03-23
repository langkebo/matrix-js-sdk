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
 * Room Keys Manager - 房间密钥管理
 * 
 * 提供房间密钥相关功能
 */

import { MatrixClient } from "../client";

export class RoomKeysManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get room key
     */
    public async getRoomKey(roomId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomKey(roomId);
    }

    /**
     * Add room key
     */
    public async addRoomKey(roomId: string, key: any): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).addRoomKey(roomId, key);
    }

    /**
     * Delete room key
     */
    public async deleteRoomKey(roomId: string): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).deleteRoomKey(roomId);
    }

    /**
     * Has room key
     */
    public hasRoomKey(roomId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).hasRoomKey(roomId);
    }

    /**
     * Get all room keys
     */
    public async getAllRoomKeys(): Promise<any[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getAllRoomKeys();
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getRoomKeysManager(): RoomKeysManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomKeysManager = function (): RoomKeysManager {
        return new RoomKeysManager(this);
    };
}

export default extendMatrixClient;
