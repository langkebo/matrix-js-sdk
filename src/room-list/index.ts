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
import { Room } from "../models/room";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export class RoomListManager {
    constructor(private client: MatrixClient) {}

    public getRoomList(): Room[] {
        return this.client.getRooms();
    }

    public getRooms(): Room[] {
        return this.client.getRooms();
    }

    public getVisibleRooms(): Room[] {
        return this.client.getVisibleRooms();
    }

    public getDmUserMap(): Record<string, string[]> {
        return (this.client.store.getAccountData("m.direct")?.getContent() as Record<string, string[]>) || {};
    }

    public getRoom(roomId: string): Room | null {
        return this.client.getRoom(roomId);
    }

    public async getMyRooms(): Promise<{ rooms: Room[]; total: number }> {
        const rooms = this.client.getRooms();
        return { rooms, total: rooms.length };
    }

    public removeRoom(roomId: string): void {
        const room = this.client.getRoom(roomId);
        if (room) {
            this.client.store.removeRoom(roomId);
        }
    }
}

// Declare prototype extension

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomListManager = function (): RoomListManager {
        registerManagerClass("roomList", RoomListManager);
    return getOrCreateManager(this, "roomList", () => new RoomListManager(this));
    };
}

export default extendMatrixClient;
