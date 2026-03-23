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
 * Room State Management Manager - 房间状态管理
 * 
 * 提供房间状态管理相关功能
 */

import { MatrixClient } from "../client";

export class RoomStateManagementManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get room state
     */
    public async getRoomState(roomId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomState(roomId);
    }

    /**
     * Get room state events
     */
    public async getRoomStateEvents(roomId: string, eventType: string, stateKey?: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomStateEvents(roomId, eventType, stateKey);
    }

    /**
     * Get state events
     */
    public getStateEvents(eventType: string, stateKey: string): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getStateEvents(eventType, stateKey);
    }

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
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getRoomStateManagementManager(): RoomStateManagementManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomStateManagementManager = function (): RoomStateManagementManager {
        return new RoomStateManagementManager(this);
    };
}

export default extendMatrixClient;
