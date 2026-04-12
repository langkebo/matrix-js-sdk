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
 * Filtering Manager - 房间过滤管理
 *
 * 提供房间过滤、排序等功能
 */

import { BaseManager } from "../managers/base-manager";
import { MatrixClient } from "../client";
import { Room } from "../models/room";

export class FilteringManager extends BaseManager {
    constructor(client: MatrixClient) {
        super(client);
    }

    /**
     * Get room with highest unread
     */
    public getRoomWithHighestUnread(): Room | null {
        return this.client.getRoomWithHighestUnread();
    }

    /**
     * Get rooms with unread notifications
     */
    public getRoomsWithUnreadNotifications(): Room[] {
        return this.client.getRoomsWithUnreadNotifications();
    }

    /**
     * Filter rooms by type
     */
    public filterRooms(type: string): Room[] {
        return this.client.rooms.filter((room: Room) => room?.roomId?.startsWith(type));
    }

    /**
     * Get direct message rooms
     */
    public getDirectMessageRooms(): Room[] {
        return this.client.getRooms().filter((room: Room) => room.isDirect());
    }

    /**
     * Get room by alias
     */
    public getRoomByAlias(alias: string): Room | null {
        return this.client.getRoomByAlias(alias);
    }

    /**
     * Sort rooms by last message
     */
    public sortRoomsByLastMessage(): void {
        this.client.sortRoomsByLastMessage();
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getFilteringManager(): FilteringManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getFilteringManager = function (): FilteringManager {
        return new FilteringManager(this);
    };
}

export default extendMatrixClient;
