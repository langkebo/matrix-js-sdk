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
import { BaseManager } from "../managers/base-manager";
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
    constructor(client: MatrixClient) {
        super(client);
    }

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
            return this.client.http.authedRequest<IPublicRoomsResponse>(Method.Get, path, opts as Record<string, string>);
        }, "getPublicRoomsList");
    }

    public async getPublicRooms(server: string, limit?: number, since?: string): Promise<IPublicRoomsResponse> {
        return this.withRetry(() => {
            if (typeof this.client.publicRooms === "function") {
                return this.client.publicRooms({ server, limit, since }) as Promise<IPublicRoomsResponse>;
            }

            const path = "/publicRooms";
            const reqOpts: Record<string, string | number> = { server };
            if (limit) reqOpts.limit = limit;
            if (since) reqOpts.since = since;
            return this.client.http.authedRequest<IPublicRoomsResponse>(Method.Post, path, undefined, reqOpts);
        }, "getPublicRooms");
    }

    public async getRoomIdForAlias(alias: string): Promise<IRoomAliasResponse> {
        return this.withRetry(() => {
            const path = utils.encodeUri("/directory/room/$alias", { $alias: alias });
            return this.client.http.authedRequest<IRoomAliasResponse>(Method.Get, path);
        }, "getRoomIdForAlias");
    }

    public async createRoomAlias(roomId: string, alias: string): Promise<void> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/directory/room/$alias", { $alias: alias });
            await this.client.http.authedRequest(Method.Put, path, undefined, { room_id: roomId });
        }, "createRoomAlias");
    }

    public async deleteRoomAlias(alias: string): Promise<void> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/directory/room/$alias", { $alias: alias });
            await this.client.http.authedRequest(Method.Delete, path);
        }, "deleteRoomAlias");
    }

    public async getAliasesForRoom(roomId: string): Promise<string[]> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/rooms/$roomId/aliases", { $roomId: roomId });
            const response = await this.client.http.authedRequest<IRoomAliasesResponse>(Method.Get, path);
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

export default extendMatrixClient;
