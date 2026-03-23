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
 * Room Creation Manager - 房间创建管理
 * 
 * 提供房间创建相关功能
 */

import { MatrixClient } from "../client";

export class RoomCreationManager {
    constructor(private client: MatrixClient) {}

    /**
     * Create room
     */
    public async createRoom(options?: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).createRoom(options);
    }

    /**
     * Create direct room
     */
    public async createDirectRoom(userId: string, options?: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).createDirectRoom(userId, options);
    }

    /**
     * Find or create direct room
     */
    public async findOrCreateDirectRoom(userId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).findOrCreateDirectRoom(userId);
    }

    /**
     * Get create room options
     */
    public getCreateRoomOptions(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getCreateRoomOptions();
    }

    /**
     * Set create room options
     */
    public setCreateRoomOptions(options: any): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).setCreateRoomOptions(options);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getRoomCreationManager(): RoomCreationManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomCreationManager = function (): RoomCreationManager {
        return new RoomCreationManager(this);
    };
}

export default extendMatrixClient;
