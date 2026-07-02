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
 * Room Account Data Manager - 房间级账户数据管理 API 封装
 *
 * 提供房间级别的账户数据读写功能，支持事件类型的 CRUD 操作
 * 对接后端: Matrix 标准客户端-服务器协议
 * API 路径: /_matrix/client/v3/user/{userId}/rooms/{roomId}/account_data/{type}
 *
 * 使用方式:
 * ```typescript
 * const manager = client.getRoomAccountDataManager();
 * // 设置房间级账户数据
 * await manager.setRoomAccountData("!room:example.com", "m.fully_read", { event_id: "$event" });
 * // 获取房间级账户数据
 * const data = await manager.getRoomAccountData("!room:example.com", "m.fully_read");
 * ```
 */
import { MatrixClient } from "../client";
import { MatrixEvent, type IContent } from "../models/event";
import { BaseManager } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface RoomAccountDataManagerEvents {
    account_data_updated: { roomId: string; eventType: string; event: MatrixEvent };
}

export class RoomAccountDataManager extends BaseManager<
    keyof RoomAccountDataManagerEvents,
    RoomAccountDataManagerEvents
> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async setRoomAccountData(
        roomId: string,
        eventType: string,
        content: IContent,
    ): Promise<void> {
        await this.client.setRoomAccountData(roomId, eventType as never, content as never);
    }

    public getRoomAccountData(roomId: string, eventType: string): MatrixEvent | undefined {
        const room = this.client.getRoom(roomId);
        return room?.getAccountData(eventType);
    }

    public getAllRoomAccountData(roomId: string): Record<string, MatrixEvent> {
        const room = this.client.getRoom(roomId);
        if (!room) return {};

        const result: Record<string, MatrixEvent> = {};
        const accountDataMap = (room as unknown as { accountData: Map<string, MatrixEvent> }).accountData;
        if (!accountDataMap) return {};

        for (const eventType of accountDataMap.keys()) {
            const event = room.getAccountData(eventType);
            if (event) {
                result[eventType] = event;
            }
        }
        return result;
    }

    public hasRoomAccountData(roomId: string, eventType: string): boolean {
        const room = this.client.getRoom(roomId);
        return room?.getAccountData(eventType) !== undefined;
    }
}


export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomAccountDataManager = function (): RoomAccountDataManager {
        registerManagerClass("roomAccountData", RoomAccountDataManager);
    return getOrCreateManager(this, "roomAccountData", () => new RoomAccountDataManager(this));
    };
}

export default extendMatrixClient;
