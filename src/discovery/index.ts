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
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import type { IRoomDirectoryOptions } from "../@types/requests";
import type { AuthPath } from "../auth/__generated__/route-table";
import type { IClientWellKnown, IServerVersions } from "../client-api-types";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { logger } from "../logger";
import type { PathAssert, StripAuthPrefix } from "../http-api/strip-prefix";

function ap<const P extends string>(path: P & PathAssert<P, StripAuthPrefix<AuthPath>>): P {
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
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 获取当前客户端使用的 homeserver 基础 URL。
     *
     * @returns homeserver 基础 URL
     *
     * @example
     * ```typescript
     * const url = client.getDiscoveryManager().getHomeserverUrl();
     * console.log(url);
     * ```
     */
    public getHomeserverUrl(): string {
        return this.client.baseUrl;
    }

    /**
     * 获取客户端 well-known 配置。
     *
     * @returns 客户端 well-known 配置，未获取到时返回 undefined
     *
     * @example
     * ```typescript
     * const wellKnown = client.getDiscoveryManager().getClientWellKnown();
     * console.log(wellKnown?.["m.homeserver"].base_url);
     * ```
     */
    public getClientWellKnown(): IClientWellKnown | undefined {
        if (this.client.getClientWellKnown) {
            return this.client.getClientWellKnown();
        }
        return this.internalClient.clientWellKnown;
    }

    /**
     * 获取服务器的客户端发现信息（/.well-known/matrix/client）。
     *
     * @returns 客户端发现文档
     *
     * @example
     * ```typescript
     * const info = await client.getDiscoveryManager().getServerDiscoveryInfo();
     * console.log(info["m.homeserver"].base_url);
     * ```
     */
    public async getServerDiscoveryInfo(): Promise<ClientWellKnownResponse> {
        return this.withRetry(async () => {
            return await this.request<ClientWellKnownResponse>({
                method: Method.Get,
                path: ap("/.well-known/matrix/client"),
                prefix: "",
                authenticated: false,
            });
        }, "getServerDiscoveryInfo");
    }

    /**
     * 获取客户端配置。
     *
     * @returns 客户端配置对象
     *
     * @example
     * ```typescript
     * const config = await client.getDiscoveryManager().getClientConfig();
     * console.log(config.homeserver.server_name);
     * ```
     */
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

    /**
     * 获取服务器 well-known 配置（/.well-known/matrix/server）。
     *
     * @returns 服务器 well-known 文档
     *
     * @example
     * ```typescript
     * const server = await client.getDiscoveryManager().getServerWellKnown();
     * console.log(server["m.server"]);
     * ```
     */
    public async getServerWellKnown(): Promise<ServerWellKnownResponse> {
        return this.withRetry(async () => {
            return await this.request<ServerWellKnownResponse>({
                method: Method.Get,
                path: ap("/.well-known/matrix/server"),
                prefix: "",
                authenticated: false,
            });
        }, "getServerWellKnown");
    }

    /**
     * 获取支持信息 well-known 配置（/.well-known/matrix/support）。
     *
     * @returns 支持信息文档
     *
     * @example
     * ```typescript
     * const support = await client.getDiscoveryManager().getSupportWellKnown();
     * console.log(support.support_page);
     * ```
     */
    public async getSupportWellKnown(): Promise<SupportWellKnownResponse> {
        return this.withRetry(async () => {
            return await this.request<SupportWellKnownResponse>({
                method: Method.Get,
                path: ap("/.well-known/matrix/support"),
                prefix: "",
                authenticated: false,
            });
        }, "getSupportWellKnown");
    }

    /**
     * 获取服务器支持的 Matrix 版本列表。
     *
     * @returns 服务器版本信息
     *
     * @example
     * ```typescript
     * const versions = await client.getDiscoveryManager().getVersions();
     * console.log(versions.versions);
     * ```
     */
    public async getVersions(): Promise<IServerVersions> {
        return this.client.getVersions();
    }

    /**
     * 获取服务器版本信息（/_matrix/server_version）。
     *
     * @returns 服务器版本响应
     *
     * @example
     * ```typescript
     * const version = await client.getDiscoveryManager().getMatrixServerVersion();
     * console.log(version);
     * ```
     */
    public async getMatrixServerVersion(): Promise<ServerVersionResponse> {
        return this.withRetry(async () => {
            return await this.request<ServerVersionResponse>({
                method: Method.Get,
                path: ap("/_matrix/server_version"),
                prefix: "",
                authenticated: false,
            });
        }, "getMatrixServerVersion");
    }

    /**
     * 获取服务健康状态（/health）。
     *
     * @returns 健康状态响应
     *
     * @example
     * ```typescript
     * const health = await client.getDiscoveryManager().getHealth();
     * console.log(health.status);
     * ```
     */
    public async getHealth(): Promise<HealthResponse> {
        return this.withRetry(async () => {
            return await this.request<HealthResponse>({
                method: Method.Get,
                path: ap("/health"),
                prefix: "",
                authenticated: false,
            });
        }, "getHealth");
    }

    /**
     * 获取服务健康状态（/_health）。
     *
     * @returns 健康状态响应
     *
     * @example
     * ```typescript
     * const health = await client.getDiscoveryManager().getUnderscoreHealth();
     * console.log(health.status);
     * ```
     */
    public async getUnderscoreHealth(): Promise<HealthResponse> {
        return this.withRetry(async () => {
            return await this.request<HealthResponse>({
                method: Method.Get,
                path: ap("/_health"),
                prefix: "",
                authenticated: false,
            });
        }, "getUnderscoreHealth");
    }

    /**
     * 根据房间别名解析出房间 ID。
     *
     * @param alias - 房间别名（如 "#room:example.org"）
     * @returns 包含房间 ID 与服务器的结果
     *
     * @example
     * ```typescript
     * const result = await client.getDiscoveryManager().getRoomIdForAlias("#room:example.org");
     * console.log(result.room_id);
     * ```
     */
    public async getRoomIdForAlias(alias: string): Promise<{ room_id: string; servers: string[] }> {
        const path = ap(`/directory/room/${encodeURIComponent(alias)}`);
        return this.withRetry(async () => {
            return await this.request<{ room_id: string; servers: string[] }>({
                method: Method.Get,
                path: path,
            });
        }, "getRoomIdForAlias");
    }

    /**
     * 根据别名获取房间 ID，解析失败时返回 null。
     *
     * @param alias - 房间别名（如 "#room:example.org"）
     * @returns 房间 ID，解析失败时为 null
     *
     * @example
     * ```typescript
     * const roomId = await client.getDiscoveryManager().getAliasRoomId("#room:example.org");
     * console.log(roomId);
     * ```
     */
    public async getAliasRoomId(alias: string): Promise<string | null> {
        try {
            const result = await this.getRoomIdForAlias(alias);
            return result.room_id;
        } catch (e) {
            logger.warn("DiscoveryManager.getAliasRoomId failed:", e);
        }
        return null;
    }

    /**
     * 搜索用户目录。
     *
     * @param searchTerm - 搜索关键词
     * @param limit - 可选，返回结果数量上限
     * @returns 用户目录搜索结果
     *
     * @example
     * ```typescript
     * const results = await client.getDiscoveryManager().searchUserDirectory("alice", 10);
     * console.log(results.results);
     * ```
     */
    public async searchUserDirectory(searchTerm: string, limit?: number): Promise<UserDirectorySearchResponse> {
        const body: Record<string, string | number> = { search_term: searchTerm };
        if (limit !== undefined) {
            body.limit = limit;
        }
        return this.withRetry(async () => {
            return await this.request<UserDirectorySearchResponse>({
                method: Method.Post,
                path: ap("/user_directory/search"),
                body: body,
            });
        }, "searchUserDirectory");
    }

    /**
     * 列出用户目录中的用户。
     *
     * @returns 用户目录列表
     *
     * @example
     * ```typescript
     * const list = await client.getDiscoveryManager().listUserDirectory();
     * console.log(list.users);
     * ```
     */
    public async listUserDirectory(): Promise<UserDirectoryListResponse> {
        return this.withRetry(async () => {
            return await this.request<UserDirectoryListResponse>({
                method: Method.Post,
                path: ap("/user_directory/list"),
            });
        }, "listUserDirectory");
    }

    /**
     * 获取用户目录中的用户资料。
     *
     * @param userId - 用户 ID
     * @returns 用户资料
     *
     * @example
     * ```typescript
     * const profile = await client.getDiscoveryManager().getUserDirectoryProfile("@alice:example.org");
     * console.log(profile.display_name);
     * ```
     */
    public async getUserDirectoryProfile(userId: string): Promise<UserDirectoryProfile> {
        const path = ap(`/user_directory/profiles/${encodeURIComponent(userId)}`);
        return this.withRetry(async () => {
            return await this.request<UserDirectoryProfile>({
                method: Method.Get,
                path: path,
            });
        }, "getUserDirectoryProfile");
    }

    /**
     * 获取房间的可见性设置。
     *
     * @param roomId - 房间 ID
     * @returns 房间可见性
     *
     * @example
     * ```typescript
     * const visibility = await client.getDiscoveryManager().getRoomVisibility("!room:example.org");
     * console.log(visibility.visibility);
     * ```
     */
    public async getRoomVisibility(roomId: string): Promise<RoomVisibilityResponse> {
        const path = ap(`/directory/list/room/${encodeURIComponent(roomId)}`);
        return this.withRetry(async () => {
            return await this.request<RoomVisibilityResponse>({
                method: Method.Get,
                path: path,
            });
        }, "getRoomVisibility");
    }

    /**
     * 设置房间的可见性。
     *
     * @param roomId - 房间 ID
     * @param visibility - 目标可见性
     *
     * @example
     * ```typescript
     * await client.getDiscoveryManager().setRoomVisibility("!room:example.org", "public");
     * ```
     */
    public async setRoomVisibility(roomId: string, visibility: "public" | "private"): Promise<void> {
        const path = ap(`/directory/list/room/${encodeURIComponent(roomId)}`);
        await this.withRetry(async () => {
            await this.request({
                method: Method.Put,
                path: path,
                body: { visibility },
            });
        }, "setRoomVisibility");
    }

    /**
     * 获取公开房间列表。
     *
     * @param limit - 可选，返回数量上限
     * @param since - 可选，分页游标
     * @param server - 可选，指定查询的服务器
     * @returns 公开房间列表
     *
     * @example
     * ```typescript
     * const rooms = await client.getDiscoveryManager().getPublicRooms(20);
     * console.log(rooms.chunk);
     * ```
     */
    public async getPublicRooms(limit?: number, since?: string, server?: string): Promise<PublicRoomsResponse> {
        if (typeof this.client.publicRooms === "function") {
            return this.client.publicRooms({ limit, since, server }) as Promise<PublicRoomsResponse>;
        }

        const queryParams: Record<string, string | number> = {};
        if (limit !== undefined) queryParams.limit = limit;
        if (since !== undefined) queryParams.since = since;
        if (server !== undefined) queryParams.server = server;
        return this.withRetry(async () => {
            return await this.request<PublicRoomsResponse>({
                method: Method.Get,
                path: ap("/publicRooms"),
                queryParams: queryParams,
                authenticated: false,
            });
        }, "getPublicRooms");
    }

    /**
     * 按过滤条件查询公开房间。
     *
     * @param filter - 房间目录过滤条件
     * @param limit - 可选，返回数量上限
     * @param since - 可选，分页游标
     * @returns 公开房间列表
     *
     * @example
     * ```typescript
     * const rooms = await client.getDiscoveryManager().queryPublicRooms({ generic_search_term: "matrix" }, 20);
     * console.log(rooms.chunk);
     * ```
     */
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
            return await this.request<PublicRoomsResponse>({
                method: Method.Post,
                path: ap("/publicRooms"),
                queryParams: queryParams,
                body: {
                    filter,
                },
                authenticated: false,
            });
        }, "queryPublicRooms");
    }

    /**
     * 为房间设置别名。
     *
     * @param roomId - 房间 ID
     * @param alias - 要设置的别名（如 "#room:example.org"）
     *
     * @example
     * ```typescript
     * await client.getDiscoveryManager().setRoomAlias("!room:example.org", "#room:example.org");
     * ```
     */
    public async setRoomAlias(roomId: string, alias: string): Promise<void> {
        const path = ap(`/directory/room/${encodeURIComponent(alias)}`);
        await this.withRetry(async () => {
            await this.request({
                method: Method.Put,
                path: path,
                body: { room_id: roomId },
            });
        }, "setRoomAlias");
    }

    /**
     * 获取房间的别名列表。
     *
     * @param roomId - 房间 ID
     * @returns 房间别名列表
     *
     * @example
     * ```typescript
     * const { aliases } = await client.getDiscoveryManager().getAliasesForRoom("!room:example.org");
     * console.log(aliases);
     * ```
     */
    public async getAliasesForRoom(roomId: string): Promise<RoomAliasListResponse> {
        const path = ap(`/directory/room/${encodeURIComponent(roomId)}/alias`);
        return this.withRetry(async () => {
            return await this.request<RoomAliasListResponse>({
                method: Method.Get,
                path: path,
            });
        }, "getAliasesForRoom");
    }

    /**
     * 为房间新增一个别名。
     *
     * @param roomId - 房间 ID
     * @param alias - 要新增的别名
     *
     * @example
     * ```typescript
     * await client.getDiscoveryManager().addRoomAliasForRoom("!room:example.org", "#room:example.org");
     * ```
     */
    public async addRoomAliasForRoom(roomId: string, alias: string): Promise<void> {
        const path = ap(`/directory/room/${encodeURIComponent(roomId)}/alias/${encodeURIComponent(alias)}`);
        await this.withRetry(async () => {
            await this.request({
                method: Method.Put,
                path: path,
            });
        }, "addRoomAliasForRoom");
    }

    /**
     * 删除房间的指定别名。
     *
     * @param roomId - 房间 ID
     * @param alias - 要删除的别名
     *
     * @example
     * ```typescript
     * await client.getDiscoveryManager().deleteRoomAliasForRoom("!room:example.org", "#room:example.org");
     * ```
     */
    public async deleteRoomAliasForRoom(roomId: string, alias: string): Promise<void> {
        const path = ap(`/directory/room/${encodeURIComponent(roomId)}/alias/${encodeURIComponent(alias)}`);
        await this.withRetry(async () => {
            await this.request({
                method: Method.Delete,
                path: path,
            });
        }, "deleteRoomAliasForRoom");
    }

    /**
     * 删除房间别名。
     *
     * @param alias - 要删除的别名（如 "#room:example.org"）
     *
     * @example
     * ```typescript
     * await client.getDiscoveryManager().deleteRoomAlias("#room:example.org");
     * ```
     */
    public async deleteRoomAlias(alias: string): Promise<void> {
        const path = ap(`/directory/room/${encodeURIComponent(alias)}`);
        await this.withRetry(async () => {
            await this.request({
                method: Method.Delete,
                path: path,
            });
        }, "deleteRoomAlias");
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getDiscoveryManager = function (): DiscoveryManager {
        registerManagerClass("discovery", DiscoveryManager);
        return getOrCreateManager(this, "discovery", () => new DiscoveryManager(this));
    };
}
