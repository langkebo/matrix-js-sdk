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
 * Directory Manager - 目录管理
 *
 * 提供公共房间列表、房间目录等功能
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import * as utils from "../utils";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface IPublicRoom {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    aliases?: string[];
    canonical_alias?: string;
    joined_members?: number;
    joined_local_members?: number;
    num_joined_members: number;
    world_readable: boolean;
    guest_can_join: boolean;
}

export interface IPublicRoomsResponse {
    chunk: IPublicRoom[];
    next_batch?: string;
    prev_batch?: string;
    total_room_count_estimate?: number;
}

export interface IRoomAliasResponse {
    room_id: string;
    servers: string[];
}

export interface IRoomAliasesResponse {
    aliases: string[];
}

export interface DirectoryManagerEvents {
    public_rooms_updated: { rooms: IPublicRoom[] };
    alias_created: { alias: string; roomId: string };
    alias_deleted: { alias: string };
}

export class DirectoryManager extends BaseManager<keyof DirectoryManagerEvents, DirectoryManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 获取公共房间列表。
     *
     * @param opts - 可选查询参数（server / limit / since）
     * @returns 公共房间分页响应
     *
     * @example
     * ```typescript
     * const rooms = await client.getDirectoryManager().getPublicRoomsList({ limit: 20 });
     * console.log(rooms.chunk.length);
     * ```
     */
    public async getPublicRoomsList(opts?: {
        server?: string;
        limit?: number;
        since?: string;
    }): Promise<IPublicRoomsResponse> {
        return this.withRetry(() => {
            if (typeof this.client.publicRooms === "function") {
                return this.client.publicRooms(opts ?? {}) as Promise<IPublicRoomsResponse>;
            }

            const path = "/publicRooms";
            return this.request<IPublicRoomsResponse>({
                method: Method.Get,
                path: path,
                queryParams: opts as Record<string, string>,
                authenticated: false,
            });
        }, "getPublicRoomsList");
    }

    /**
     * 通过 POST 请求获取指定服务器的公共房间列表。
     *
     * @param server - 目标 homeserver 名称
     * @param limit - 可选返回数量上限
     * @param since - 可选分页 token
     * @returns 公共房间分页响应
     *
     * @example
     * ```typescript
     * const rooms = await client.getDirectoryManager().getPublicRooms("matrix.org", 20);
     * console.log(rooms.chunk.length);
     * ```
     */
    public async getPublicRooms(server: string, limit?: number, since?: string): Promise<IPublicRoomsResponse> {
        return this.withRetry(() => {
            if (typeof this.client.publicRooms === "function") {
                return this.client.publicRooms({ server, limit, since }) as Promise<IPublicRoomsResponse>;
            }

            const path = "/publicRooms";
            const reqOpts: Record<string, string | number> = { server };
            if (limit) reqOpts.limit = limit;
            if (since) reqOpts.since = since;
            return this.request<IPublicRoomsResponse>({
                method: Method.Post,
                path: path,
                body: reqOpts,
                authenticated: false,
            });
        }, "getPublicRooms");
    }

    /**
     * 根据房间别名查询房间 ID。
     *
     * @param alias - 房间别名（如 `#room:example.org`）
     * @returns 房间 ID 与可用服务器列表
     *
     * @example
     * ```typescript
     * const info = await client.getDirectoryManager().getRoomIdForAlias("#room:example.org");
     * console.log(info.room_id);
     * ```
     */
    public async getRoomIdForAlias(alias: string): Promise<IRoomAliasResponse> {
        return this.withRetry(() => {
            const path = utils.encodeUri("/directory/room/$alias", { $alias: alias });
            return this.request<IRoomAliasResponse>({
                method: Method.Get,
                path: path,
            });
        }, "getRoomIdForAlias");
    }

    /**
     * 为房间创建别名。
     *
     * @param roomId - 房间 ID
     * @param alias - 要创建的别名
     *
     * @example
     * ```typescript
     * await client.getDirectoryManager().createRoomAlias("!room:example.org", "#room:example.org");
     * ```
     */
    public async createRoomAlias(roomId: string, alias: string): Promise<void> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/directory/room/$alias", { $alias: alias });
            await this.request({
                method: Method.Put,
                path: path,
                body: { room_id: roomId },
            });
        }, "createRoomAlias");
    }

    /**
     * 删除房间别名。
     *
     * @param alias - 要删除的别名
     *
     * @example
     * ```typescript
     * await client.getDirectoryManager().deleteRoomAlias("#room:example.org");
     * ```
     */
    public async deleteRoomAlias(alias: string): Promise<void> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/directory/room/$alias", { $alias: alias });
            await this.request({
                method: Method.Delete,
                path: path,
            });
        }, "deleteRoomAlias");
    }

    /**
     * 获取房间的所有别名。
     *
     * @param roomId - 房间 ID
     * @returns 该房间的别名列表
     *
     * @example
     * ```typescript
     * const aliases = await client.getDirectoryManager().getAliasesForRoom("!room:example.org");
     * console.log(aliases);
     * ```
     */
    public async getAliasesForRoom(roomId: string): Promise<string[]> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/rooms/$roomId/aliases", { $roomId: roomId });
            const response = await this.request<IRoomAliasesResponse>({
                method: Method.Get,
                path: path,
            });
            return response.aliases || [];
        }, "getAliasesForRoom");
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getDirectoryManager = function (): DirectoryManager {
        registerManagerClass("directory", DirectoryManager);
        return getOrCreateManager(this, "directory", () => new DirectoryManager(this));
    };
}
