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

    /**
     * 获取客户端已知的全部房间列表
     *
     * @returns 房间对象数组
     * @example
     * ```typescript
     * const rooms = client.getRoomListManager().getRoomList();
     * console.log(rooms.length);
     * ```
     */
    public getRoomList(): Room[] {
        return this.client.getRooms();
    }

    /**
     * 获取客户端已知的全部房间列表
     *
     * 与 `getRoomList` 行为一致，均返回客户端当前缓存的全部房间。
     *
     * @returns 房间对象数组
     * @example
     * ```typescript
     * const rooms = client.getRoomListManager().getRooms();
     * console.log(rooms.length);
     * ```
     */
    public getRooms(): Room[] {
        return this.client.getRooms();
    }

    /**
     * 获取当前用户可见的房间列表（已加入且未被隐藏的房间）
     *
     * @returns 可见房间对象数组
     * @example
     * ```typescript
     * const visibleRooms = client.getRoomListManager().getVisibleRooms();
     * console.log(visibleRooms.length);
     * ```
     */
    public getVisibleRooms(): Room[] {
        return this.client.getVisibleRooms();
    }

    /**
     * 获取私聊（DM）映射表
     *
     * 读取账号数据 `m.direct` 的内容，键为用户 ID，值为该用户对应的房间 ID 数组。
     *
     * @returns 用户 ID 到房间 ID 数组的映射；无数据时返回空对象
     * @example
     * ```typescript
     * const dmMap = client.getRoomListManager().getDmUserMap();
     * console.log(dmMap["@alice:example.com"]);
     * ```
     */
    public getDmUserMap(): Record<string, string[]> {
        return (this.client.store.getAccountData("m.direct")?.getContent() as Record<string, string[]>) || {};
    }

    /**
     * 根据房间 ID 获取房间对象
     *
     * @param roomId - 房间 ID
     * @returns 匹配的房间对象；未找到时返回 `null`
     * @example
     * ```typescript
     * const room = client.getRoomListManager().getRoom("!room:example.com");
     * console.log(room?.roomId);
     * ```
     */
    public getRoom(roomId: string): Room | null {
        return this.client.getRoom(roomId);
    }

    /**
     * 获取客户端已知的全部房间及其总数
     *
     * @returns 包含 `rooms`（房间数组）与 `total`（房间总数）的对象
     * @example
     * ```typescript
     * const { rooms, total } = await client.getRoomListManager().getMyRooms();
     * console.log(total);
     * ```
     */
    public async getMyRooms(): Promise<{ rooms: Room[]; total: number }> {
        const rooms = this.client.getRooms();
        return { rooms, total: rooms.length };
    }

    /**
     * 从本地存储中移除指定房间
     *
     * 若房间不存在则不执行任何操作。
     *
     * @param roomId - 要移除的房间 ID
     * @returns 无返回值
     * @example
     * ```typescript
     * client.getRoomListManager().removeRoom("!room:example.com");
     * ```
     */
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
