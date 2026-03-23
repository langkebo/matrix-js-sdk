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
 * Room Key Sharing Manager - 房间密钥分享管理
 * 
 * 提供房间密钥分享相关功能
 */

import { MatrixClient } from "../client";

export class RoomKeySharingManager {
    constructor(private client: MatrixClient) {}

    /**
     * Share room key
     */
    public async shareRoomKey(roomId: string, users: string[]): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).shareRoomKey(roomId, users);
    }

    /**
     * Request room key
     */
    public async requestRoomKey(roomId: string, eventId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).requestRoomKey(roomId, eventId);
    }

    /**
     * Get shared with users
     */
    public async getSharedWithUsers(roomId: string): Promise<string[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getSharedWithUsers(roomId);
    }

    /**
     * Has shared key with user
     */
    public async hasSharedKeyWithUser(userId: string): Promise<boolean> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).hasSharedKeyWithUser(userId);
    }

    /**
     * Export room keys
     */
    public async exportRoomKeys(): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).exportRoomKeys();
    }

    /**
     * Import room keys
     */
    public async importRoomKeys(keys: any[]): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).importRoomKeys(keys);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getRoomKeySharingManager(): RoomKeySharingManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomKeySharingManager = function (): RoomKeySharingManager {
        return new RoomKeySharingManager(this);
    };
}

export default extendMatrixClient;
