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

import { MatrixClient } from "../client";
import { Room } from "../models/room";

export class FilteringManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get room with highest unread
     */
    public getRoomWithHighestUnread(): Room | null {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomWithHighestUnread();
    }

    /**
     * Get rooms with unread notifications
     */
    public getRoomsWithUnreadNotifications(): Room[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomsWithUnreadNotifications();
    }

    /**
     * Filter rooms by type
     */
    public filterRooms(type: string): Room[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).rooms.filter((room: Room) => room?.roomId?.startsWith(type));
    }

    /**
     * Get direct message rooms
     */
    public getDirectMessageRooms(): Room[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRooms().filter((room: Room) => (room as any).isDirect());
    }

    /**
     * Get room by alias
     */
    public getRoomByAlias(alias: string): Room | null {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomByAlias(alias);
    }

    /**
     * Sort rooms by last message
     */
    public sortRoomsByLastMessage(): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).sortRoomsByLastMessage();
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
