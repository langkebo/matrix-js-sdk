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
 * Room List Manager - 房间列表管理
 * 
 * 提供房间列表相关功能
 */

import { MatrixClient } from "../client";

export class RoomListManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get room list
     */
    public getRoomList(): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomList();
    }

    /**
     * Get rooms
     */
    public getRooms(): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRooms();
    }

    /**
     * Get visible rooms
     */
    public getVisibleRooms(): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getVisibleRooms();
    }

    /**
     * Get dm user map
     */
    public getDmUserMap(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getDmUserMap();
    }

    /**
     * Get room
     */
    public getRoom(roomId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoom(roomId);
    }

    /**
     * Remove room
     */
    public removeRoom(roomId: string): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).removeRoom(roomId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getRoomListManager(): RoomListManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomListManager = function (): RoomListManager {
        return new RoomListManager(this);
    };
}

export default extendMatrixClient;
