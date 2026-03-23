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
 * Room Account Data Manager - 房间账户数据管理
 * 
 * 提供房间账户数据相关功能
 */

import { MatrixClient } from "../client";

export class RoomAccountDataManager {
    constructor(private client: MatrixClient) {}

    /**
     * Set room account data
     */
    public async setRoomAccountData(roomId: string, eventType: string, content: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).setRoomAccountData(roomId, eventType, content);
    }

    /**
     * Get room account data
     */
    public getRoomAccountData(roomId: string, eventType: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomAccountData(roomId, eventType);
    }

    /**
     * Get all room account data
     */
    public getAllRoomAccountData(roomId: string): Record<string, any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getAllRoomAccountData(roomId);
    }

    /**
     * Has room account data
     */
    public hasRoomAccountData(roomId: string, eventType: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).hasRoomAccountData(roomId, eventType);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getRoomAccountDataManager(): RoomAccountDataManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomAccountDataManager = function (): RoomAccountDataManager {
        return new RoomAccountDataManager(this);
    };
}

export default extendMatrixClient;
