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
 * Discovery Manager - 服务发现与目录管理
 *
 * 提供服务端点发现、房间别名解析、用户目录搜索等功能
 * 对应后端 API:
 * - GET/POST /publicRooms
 * - POST /user_directory/search
 * - POST /user_directory/list
 * - GET /user_directory/profiles/{user_id}
 * - GET/PUT /directory/list/room/{room_id}
 * - GET/PUT/DELETE /directory/room/{room_alias}
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import { BaseManager } from "../managers/base-manager";
import * as utils from "../utils";

export interface UserDirectorySearchResponse {
    results: Array<{
        user_id: string;
        display_name?: string;
        avatar_url?: string;
    }>;
    limited?: boolean;
}

export interface UserDirectoryListResponse {
    users: Array<{
        user_id: string;
        display_name?: string;
        avatar_url?: string;
    }>;
}

export interface UserDirectoryProfile {
    user_id: string;
    display_name?: string;
    avatar_url?: string;
}

export interface RoomVisibilityResponse {
    room_id: string;
    visibility: "public" | "private";
}

export interface PublicRoomsResponse {
    chunk: Array<{
        room_id: string;
        name?: string;
        topic?: string;
        avatar_url?: string;
        num_joined_members: number;
        join_rule?: string;
        world_readable?: boolean;
        guest_can_join?: boolean;
    }>;
    next_batch?: string;
    prev_batch?: string;
    total_room_count_estimate?: number;
}

export class DiscoveryManager extends BaseManager {
    constructor(client: MatrixClient) {
        super(client);
    }

    public getHomeserverUrl(): string {
        return this.client.baseUrl;
    }

    public getClientWellKnown(): Record<string, unknown> | undefined {
        if (this.client.getClientWellKnown) {
            return this.client.getClientWellKnown();
        }
        return (this.client as unknown as { clientWellKnown?: Record<string, unknown> }).clientWellKnown;
    }

    public async getServerDiscoveryInfo(): Promise<Record<string, unknown>> {
        return this.client.http.request<Record<string, unknown>>(
            Method.Get,
            "/.well-known/matrix/client",
            undefined,
            undefined,
            { prefix: "" },
        );
    }

    public async getRoomIdForAlias(alias: string): Promise<{ room_id: string; servers: string[] }> {
        const path = utils.encodeUri("/directory/room/$alias", { $alias: alias });
        return this.client.http.authedRequest<{ room_id: string; servers: string[] }>(Method.Get, path);
    }

    public async getAliasRoomId(alias: string): Promise<string | null> {
        try {
            const result = await this.getRoomIdForAlias(alias);
            return result.room_id;
        } catch {
            return null;
        }
    }

    public async searchUserDirectory(searchTerm: string, limit?: number): Promise<UserDirectorySearchResponse> {
        const body: Record<string, string | number> = { search_term: searchTerm };
        if (limit !== undefined) {
            body.limit = limit;
        }
        return this.client.http.authedRequest<UserDirectorySearchResponse>(
            Method.Post,
            "/user_directory/search",
            undefined,
            body,
        );
    }

    public async listUserDirectory(): Promise<UserDirectoryListResponse> {
        return this.client.http.authedRequest<UserDirectoryListResponse>(Method.Post, "/user_directory/list");
    }

    public async getUserDirectoryProfile(userId: string): Promise<UserDirectoryProfile> {
        const path = utils.encodeUri("/user_directory/profiles/$userId", { $userId: userId });
        return this.client.http.authedRequest<UserDirectoryProfile>(Method.Get, path);
    }

    public async getRoomVisibility(roomId: string): Promise<RoomVisibilityResponse> {
        const path = utils.encodeUri("/directory/list/room/$roomId", { $roomId: roomId });
        return this.client.http.authedRequest<RoomVisibilityResponse>(Method.Get, path);
    }

    public async setRoomVisibility(roomId: string, visibility: "public" | "private"): Promise<void> {
        const path = utils.encodeUri("/directory/list/room/$roomId", { $roomId: roomId });
        await this.client.http.authedRequest(Method.Put, path, undefined, { visibility });
    }

    public async getPublicRooms(limit?: number, since?: string, server?: string): Promise<PublicRoomsResponse> {
        if (typeof this.client.publicRooms === "function") {
            return this.client.publicRooms({ limit, since, server }) as Promise<PublicRoomsResponse>;
        }

        const queryParams: Record<string, string | number> = {};
        if (limit !== undefined) queryParams.limit = limit;
        if (since !== undefined) queryParams.since = since;
        if (server !== undefined) queryParams.server = server;
        return this.client.http.authedRequest<PublicRoomsResponse>(Method.Get, "/publicRooms", queryParams);
    }

    public async queryPublicRooms(
        filter: { generic_search_term?: string; room_types?: string[] },
        limit?: number,
        since?: string,
    ): Promise<PublicRoomsResponse> {
        if (typeof this.client.publicRooms === "function") {
            return this.client.publicRooms({ limit, since, filter }) as Promise<PublicRoomsResponse>;
        }

        const queryParams: Record<string, string | number> = {};
        if (limit !== undefined) queryParams.limit = limit;
        if (since !== undefined) queryParams.since = since;
        return this.client.http.authedRequest<PublicRoomsResponse>(Method.Post, "/publicRooms", queryParams, {
            filter,
        });
    }

    public async setRoomAlias(roomId: string, alias: string): Promise<void> {
        const path = utils.encodeUri("/directory/room/$alias", { $alias: alias });
        await this.client.http.authedRequest(Method.Put, path, undefined, { room_id: roomId });
    }

    public async deleteRoomAlias(alias: string): Promise<void> {
        const path = utils.encodeUri("/directory/room/$alias", { $alias: alias });
        await this.client.http.authedRequest(Method.Delete, path);
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getDiscoveryManager(): DiscoveryManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getDiscoveryManager = function (): DiscoveryManager {
        return new DiscoveryManager(this);
    };
}

export default extendMatrixClient;
