/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You May obtain a copy of the License at

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

export class DirectoryManager {
    constructor(private client: MatrixClient) {}

    public async getPublicRoomsList(opts?: { server?: string; limit?: number; since?: string }): Promise<IPublicRoomsResponse> {
        const path = "/publicRooms";
        return this.client.http.authedRequest<IPublicRoomsResponse>(Method.Get, path, opts as Record<string, string>);
    }

    public async getPublicRooms(server: string, limit?: number, since?: string): Promise<IPublicRoomsResponse> {
        const path = "/publicRooms";
        const opts: Record<string, string | number> = { server };
        if (limit) opts.limit = limit;
        if (since) opts.since = since;
        return this.client.http.authedRequest<IPublicRoomsResponse>(Method.Post, path, undefined, opts);
    }

    public async getRoomIdForAlias(alias: string): Promise<IRoomAliasResponse> {
        const path = utils.encodeUri("/directory/room/$alias", { $alias: alias });
        return this.client.http.authedRequest<IRoomAliasResponse>(Method.Get, path);
    }

    public async createRoomAlias(roomId: string, alias: string): Promise<void> {
        const path = utils.encodeUri("/directory/room/$alias", { $alias: alias });
        await this.client.http.authedRequest(Method.Put, path, undefined, { room_id: roomId });
    }

    public async deleteRoomAlias(alias: string): Promise<void> {
        const path = utils.encodeUri("/directory/room/$alias", { $alias: alias });
        await this.client.http.authedRequest(Method.Delete, path);
    }

    public async getAliasesForRoom(roomId: string): Promise<string[]> {
        const path = utils.encodeUri("/rooms/$roomId/aliases", { $roomId: roomId });
        const response = await this.client.http.authedRequest<IRoomAliasesResponse>(Method.Get, path);
        return response.aliases || [];
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getDirectoryManager(): DirectoryManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getDirectoryManager = function (): DirectoryManager {
        return new DirectoryManager(this);
    };
}

export default extendMatrixClient;
