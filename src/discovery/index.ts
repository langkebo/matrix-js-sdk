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
import type { IRoomDirectoryOptions } from "../@types/requests";
import type { AuthPathPattern } from "../auth/__generated__/route-table";
import type { IClientWellKnown, IServerVersions } from "../client-api-types";
import { getOrCreateManager } from "../client-infra/manager-registry";

type StripAuthPrefix<P extends string> =
    P extends `/_matrix/client/v3${infer Rest}` ? Rest :
    P extends `/_matrix/client/r0${infer Rest}` ? Rest :
    P extends `/_matrix/client/v1${infer Rest}` ? Rest :
    P;

function ap<P extends StripAuthPrefix<AuthPathPattern>>(path: P): P {
    return path;
}

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

export interface RoomAliasListResponse {
    aliases: string[];
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

type PublicRoomsFilter = NonNullable<IRoomDirectoryOptions["filter"]>;

export interface ClientWellKnownResponse {
    "m.homeserver": { base_url: string };
    "m.identity_server"?: { base_url: string };
    [key: string]: unknown;
}

export interface ServerWellKnownResponse {
    "m.server": string;
    [key: string]: unknown;
}

export interface SupportWellKnownResponse {
    admins?: Array<{ user_id: string; role?: string }>;
    support_page?: string;
    [key: string]: unknown;
}

export interface ServerVersionResponse extends IServerVersions {
    [key: string]: unknown;
}

export interface HealthResponse {
    status?: "ok" | "error";
    [key: string]: unknown;
}

export class DiscoveryManager extends BaseManager {
    constructor(client: MatrixClient) {
        super(client);
    }

    public getHomeserverUrl(): string {
        return this.client.baseUrl;
    }

    public getClientWellKnown(): IClientWellKnown | undefined {
        if (this.client.getClientWellKnown) {
            return this.client.getClientWellKnown();
        }
        return (this.client as unknown as { clientWellKnown?: IClientWellKnown }).clientWellKnown;
    }

    public async getServerDiscoveryInfo(): Promise<ClientWellKnownResponse> {
        return this.withRetry(async () => {
            return await this.client.http.request<ClientWellKnownResponse>(
                Method.Get,
                ap("/.well-known/matrix/client"),
                undefined,
                undefined,
                { prefix: "" },
            );
        }, "getServerDiscoveryInfo");
    }

    public async getClientConfig(): Promise<{
        homeserver: { base_url: string; server_name: string };
        identity_server: { base_url: string };
        push: { enabled: boolean };
        email: { enabled: boolean };
        features: Record<string, boolean>;
        defaults: Record<string, unknown>; // Dynamic: client config defaults vary by deployment
    }> {
        return this.client.getClientConfig();
    }

    public async getServerWellKnown(): Promise<ServerWellKnownResponse> {
        return this.withRetry(async () => {
            return await this.client.http.request<ServerWellKnownResponse>(
                Method.Get,
                ap("/.well-known/matrix/server"),
                undefined,
                undefined,
                { prefix: "" },
            );
        }, "getServerWellKnown");
    }

    public async getSupportWellKnown(): Promise<SupportWellKnownResponse> {
        return this.withRetry(async () => {
            return await this.client.http.request<SupportWellKnownResponse>(
                Method.Get,
                ap("/.well-known/matrix/support"),
                undefined,
                undefined,
                { prefix: "" },
            );
        }, "getSupportWellKnown");
    }

    public async getVersions(): Promise<IServerVersions> {
        return this.client.getVersions();
    }

    public async getMatrixServerVersion(): Promise<ServerVersionResponse> {
        return this.withRetry(async () => {
            return await this.client.http.request<ServerVersionResponse>(
                Method.Get,
                ap("/_matrix/server_version"),
                undefined,
                undefined,
                { prefix: "" },
            );
        }, "getMatrixServerVersion");
    }

    public async getHealth(): Promise<HealthResponse> {
        return this.withRetry(async () => {
            return await this.client.http.request<HealthResponse>(Method.Get, ap("/health"), undefined, undefined, { prefix: "" });
        }, "getHealth");
    }

    public async getUnderscoreHealth(): Promise<HealthResponse> {
        return this.withRetry(async () => {
            return await this.client.http.request<HealthResponse>(Method.Get, ap("/_health"), undefined, undefined, { prefix: "" });
        }, "getUnderscoreHealth");
    }

    public async getRoomIdForAlias(alias: string): Promise<{ room_id: string; servers: string[] }> {
        const path = ap(`/directory/room/${encodeURIComponent(alias)}` as StripAuthPrefix<AuthPathPattern>);
        return this.withRetry(async () => {
            return await this.client.http.authedRequest<{ room_id: string; servers: string[] }>(Method.Get, path);
        }, "getRoomIdForAlias");
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
        return this.withRetry(async () => {
            return await this.client.http.authedRequest<UserDirectorySearchResponse>(
                Method.Post,
                ap("/user_directory/search"),
                undefined,
                body,
            );
        }, "searchUserDirectory");
    }

    public async listUserDirectory(): Promise<UserDirectoryListResponse> {
        return this.withRetry(async () => {
            return await this.client.http.authedRequest<UserDirectoryListResponse>(Method.Post, ap("/user_directory/list"));
        }, "listUserDirectory");
    }

    public async getUserDirectoryProfile(userId: string): Promise<UserDirectoryProfile> {
        const path = ap(`/user_directory/profiles/${encodeURIComponent(userId)}` as StripAuthPrefix<AuthPathPattern>);
        return this.withRetry(async () => {
            return await this.client.http.authedRequest<UserDirectoryProfile>(Method.Get, path);
        }, "getUserDirectoryProfile");
    }

    public async getRoomVisibility(roomId: string): Promise<RoomVisibilityResponse> {
        const path = ap(`/directory/list/room/${encodeURIComponent(roomId)}` as StripAuthPrefix<AuthPathPattern>);
        return this.withRetry(async () => {
            return await this.client.http.authedRequest<RoomVisibilityResponse>(Method.Get, path);
        }, "getRoomVisibility");
    }

    public async setRoomVisibility(roomId: string, visibility: "public" | "private"): Promise<void> {
        const path = ap(`/directory/list/room/${encodeURIComponent(roomId)}` as StripAuthPrefix<AuthPathPattern>);
        await this.withRetry(async () => {
            await this.client.http.authedRequest(Method.Put, path, undefined, { visibility });
        }, "setRoomVisibility");
    }

    public async getPublicRooms(limit?: number, since?: string, server?: string): Promise<PublicRoomsResponse> {
        if (typeof this.client.publicRooms === "function") {
            return this.client.publicRooms({ limit, since, server }) as Promise<PublicRoomsResponse>;
        }

        const queryParams: Record<string, string | number> = {};
        if (limit !== undefined) queryParams.limit = limit;
        if (since !== undefined) queryParams.since = since;
        if (server !== undefined) queryParams.server = server;
        return this.withRetry(async () => {
            return await this.client.http.request<PublicRoomsResponse>(Method.Get, ap("/publicRooms"), queryParams);
        }, "getPublicRooms");
    }

    public async queryPublicRooms(
        filter: PublicRoomsFilter,
        limit?: number,
        since?: string,
    ): Promise<PublicRoomsResponse> {
        if (typeof this.client.publicRooms === "function") {
            return this.client.publicRooms({ limit, since, filter }) as Promise<PublicRoomsResponse>;
        }

        const queryParams: Record<string, string | number> = {};
        if (limit !== undefined) queryParams.limit = limit;
        if (since !== undefined) queryParams.since = since;
        return this.withRetry(async () => {
            return await this.client.http.request<PublicRoomsResponse>(Method.Post, ap("/publicRooms"), queryParams, {
                filter,
            });
        }, "queryPublicRooms");
    }

    public async setRoomAlias(roomId: string, alias: string): Promise<void> {
        const path = ap(`/directory/room/${encodeURIComponent(alias)}` as StripAuthPrefix<AuthPathPattern>);
        await this.withRetry(async () => {
            await this.client.http.authedRequest(Method.Put, path, undefined, { room_id: roomId });
        }, "setRoomAlias");
    }

    public async getAliasesForRoom(roomId: string): Promise<RoomAliasListResponse> {
        const path = ap(`/directory/room/${encodeURIComponent(roomId)}/alias` as StripAuthPrefix<AuthPathPattern>);
        return this.withRetry(async () => {
            return await this.client.http.authedRequest<RoomAliasListResponse>(Method.Get, path);
        }, "getAliasesForRoom");
    }

    public async addRoomAliasForRoom(roomId: string, alias: string): Promise<void> {
        const path = ap(
            `/directory/room/${encodeURIComponent(roomId)}/alias/${encodeURIComponent(alias)}` as StripAuthPrefix<AuthPathPattern>,
        );
        await this.withRetry(async () => {
            await this.client.http.authedRequest(Method.Put, path);
        }, "addRoomAliasForRoom");
    }

    public async deleteRoomAliasForRoom(roomId: string, alias: string): Promise<void> {
        const path = ap(
            `/directory/room/${encodeURIComponent(roomId)}/alias/${encodeURIComponent(alias)}` as StripAuthPrefix<AuthPathPattern>,
        );
        await this.withRetry(async () => {
            await this.client.http.authedRequest(Method.Delete, path);
        }, "deleteRoomAliasForRoom");
    }

    public async deleteRoomAlias(alias: string): Promise<void> {
        const path = ap(`/directory/room/${encodeURIComponent(alias)}` as StripAuthPrefix<AuthPathPattern>);
        await this.withRetry(async () => {
            await this.client.http.authedRequest(Method.Delete, path);
        }, "deleteRoomAlias");
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getDiscoveryManager(): DiscoveryManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getDiscoveryManager = function (): DiscoveryManager {
        return getOrCreateManager(this, "discovery", () => new DiscoveryManager(this));
    };
}

export default extendMatrixClient;
