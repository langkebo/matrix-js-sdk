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
 * Federation Manager - 联邦管理
 *
 * 提供联邦服务器管理、黑名单管理功能。
 *
 * ## 后端对齐说明（synapse-rust v10，2026-06）
 *
 * - **C-1 X-Matrix 时间戳校验**: 后端已实现 ±30s 滑动窗口 + nonce 缓存校验。
 *   当通过本 manager 代理 federation 请求时，后端会自动处理 `X-Matrix-Origin` /
 *   `X-Matrix-Timestamp` 请求头，SDK 客户端无需额外设置。
 *
 * - **C-2 Canonical JSON 修复**: 后端已修复 U+2028 (行分隔符) / U+2029 (段落分隔符) /
 *   U+FFFD (替换字符) 的转义处理。SDK 端 JSON 序列化保持不变。
 *
 * - **M_SERVER_NOT_TRUSTED**: 当目标服务器不在信任列表中时，后端返回此错误
 *   (HTTP 502)。调用方可通过 `MatrixError.isServerNotTrustedError()` 检测。
 */

import { BaseManager, type ManagerOpts, type RequestSpec } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { AdminPrefix } from "../http-api/prefix";
import { MatrixClient } from "../client";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { logger } from "../logger";
import { IUserProfile } from "../user-directory/index";
import { ValidationError } from "../errors";
import { type IEvent } from "../models/event";

export enum FederationEvent {
    BlacklistUpdated = "BlacklistUpdated",
    ServerAdded = "ServerAdded",
    ServerRemoved = "ServerRemoved",
    FederationError = "FederationError",
}

export interface IFederationServer {
    serverName: string;
    addedAt?: number;
    reason?: string;
}

export interface IBlacklistEntry {
    serverName: string;
    reason?: string;
    addedAt: number;
    addedBy?: string;
}

export interface IFederationStatus {
    online: boolean;
    lastSuccessfulConnect?: number;
    latency?: number;
}

interface FederationManagerEventMap {
    [FederationEvent.BlacklistUpdated]: (blacklist: IBlacklistEntry[]) => void;
    [FederationEvent.ServerAdded]: (serverName: string) => void;
    [FederationEvent.ServerRemoved]: (serverName: string) => void;
    [FederationEvent.FederationError]: (error: Error) => void;
}

export class FederationManager extends BaseManager<FederationEvent, FederationManagerEventMap> {
    private blacklist: Map<string, IBlacklistEntry> = new Map();
    private serverCache: Map<string, IFederationServer> = new Map();
    private initialized: boolean = false;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * Federation 端点（`/_matrix/federation/v1/*`、`/_synapse/federation/v1/*`）
     * 是 server-to-server 接口，不需要用户 access token。
     *
     * 当 `prefix === ""` 时自动走 `client.http.request`（不带 token）；
     * admin 端点（`prefix === AdminPrefix.V1`）仍走默认的 `authedRequest`。
     */
    protected async request<T>(spec: RequestSpec): Promise<T> {
        if (spec.prefix === "") {
            return super.request<T>({ ...spec, authenticated: false });
        }
        return super.request<T>(spec);
    }

    /**
     * 获取联邦黑名单
     *
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 黑名单列表
     */
    async getBlacklist(throwOnError = true): Promise<IBlacklistEntry[]> {
        return this.request<{
            blacklist?: IBlacklistEntry[];
        }>({ method: Method.Get, path: "/federation/blacklist", prefix: AdminPrefix.V1 }).then(
            (response) => {
                const entries: IBlacklistEntry[] = response.blacklist || [];
                this.blacklist.clear();
                entries.forEach((e) => this.blacklist.set(e.serverName, e));
                this.emit(FederationEvent.BlacklistUpdated, entries);
                return entries;
            },
            (e) => {
                const error = this.normalizeError(e, "getBlacklist");
                if (throwOnError) {
                    throw error;
                }
                logger.warn("FederationManager.getBlacklist failed:", error);
                return Array.from(this.blacklist.values());
            },
        );
    }

    async addToBlacklist(serverName: string, reason?: string): Promise<void> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }

        try {
            await this.request({
                method: Method.Post,
                path: "/federation/blacklist/add",
                body: { server_name: serverName, reason },
                prefix: AdminPrefix.V1,
            });

            const entry: IBlacklistEntry = {
                serverName,
                reason,
                addedAt: Date.now(),
                addedBy: this.client.getUserId() ?? undefined,
            };

            this.blacklist.set(serverName, entry);
            this.emit(FederationEvent.BlacklistUpdated, Array.from(this.blacklist.values()));
        } catch (e) {
            const error = this.normalizeError(e, "addToBlacklist");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    async removeFromBlacklist(serverName: string): Promise<void> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }

        try {
            await this.request({
                method: Method.Post,
                path: "/federation/blacklist/remove",
                body: { server_name: serverName },
                prefix: AdminPrefix.V1,
            });

            this.blacklist.delete(serverName);
            this.emit(FederationEvent.BlacklistUpdated, Array.from(this.blacklist.values()));
        } catch (e) {
            const error = this.normalizeError(e, "removeFromBlacklist");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    async isBlacklisted(serverName: string): Promise<boolean> {
        if (this.blacklist.has(serverName)) {
            return true;
        }

        await this.getBlacklist(false);
        return this.blacklist.has(serverName);
    }

    /**
     * 获取服务器状态
     *
     * @param serverName - 服务器名称
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 服务器状态
     */
    async getServerStatus(serverName: string, throwOnError = true): Promise<IFederationStatus | null> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }

        return this.request<{
            online?: boolean;
            last_successful_connect?: number;
            latency?: number;
        }>({
            method: Method.Get,
            path: `/federation/status/${encodeURIComponent(serverName)}`,
            prefix: AdminPrefix.V1,
        }).then(
            (response) => {
                return {
                    online: response.online || false,
                    lastSuccessfulConnect: response.last_successful_connect,
                    latency: response.latency,
                };
            },
            (e) => {
                const error = this.normalizeError(e, "getServerStatus");
                if (throwOnError) {
                    throw error;
                }
                logger.warn("FederationManager.getServerStatus failed:", error);
                return null;
            },
        );
    }

    /**
     * 获取联邦目的地列表
     *
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 目的地列表
     */
    async getFederationDestinations(throwOnError = true): Promise<IFederationServer[]> {
        return this.request<{
            destinations?: IFederationServer[];
        }>({ method: Method.Get, path: "/federation/destinations", prefix: AdminPrefix.V1 }).then(
            (response) => {
                const servers: IFederationServer[] = response.destinations || [];
                servers.forEach((s) => this.serverCache.set(s.serverName, s));
                return servers;
            },
            (e) => {
                const error = this.normalizeError(e, "getFederationDestinations");
                if (throwOnError) {
                    throw error;
                }
                logger.warn("FederationManager.getFederationDestinations failed:", error);
                return Array.from(this.serverCache.values());
            },
        );
    }

    async disconnectServer(serverName: string): Promise<void> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }

        try {
            await this.request({
                method: Method.Post,
                path: `/federation/disconnect/${encodeURIComponent(serverName)}`,
                prefix: AdminPrefix.V1,
            });
        } catch (e) {
            const error = this.normalizeError(e, "disconnectServer");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    async reconnectServer(serverName: string): Promise<void> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }

        try {
            await this.request({
                method: Method.Post,
                path: `/federation/reconnect/${encodeURIComponent(serverName)}`,
                prefix: AdminPrefix.V1,
            });
        } catch (e) {
            const error = this.normalizeError(e, "reconnectServer");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 获取服务器版本
     *
     * @param serverName - 服务器名称
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 服务器版本
     */
    async getServerVersion(serverName: string, throwOnError = true): Promise<{ version: string } | null> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }

        return this.request<{
            server?: { version?: string };
        }>({ method: Method.Get, path: "/_matrix/federation/v1/version", prefix: "" }).then(
            (response) => {
                return {
                    version: response.server?.version || "unknown",
                };
            },
            (e) => {
                const error = this.normalizeError(e, "getServerVersion");
                if (throwOnError) {
                    throw error;
                }
                logger.warn("FederationManager.getServerVersion failed:", error);
                return null;
            },
        );
    }

    async getPublicRoomsOnServer(
        serverName: string,
        limit?: number,
        since?: string,
    ): Promise<{ chunk: unknown[]; next_batch?: string; prev_batch?: string }> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }

        try {
            const params: { limit?: number; since?: string; server_name: string } = {
                server_name: serverName,
            };
            if (limit !== undefined) params.limit = limit;
            if (since !== undefined) params.since = since;

            const response = await this.request<{
                chunk?: unknown[];
                next_batch?: string;
                prev_batch?: string;
            }>({
                method: Method.Get,
                path: `/_matrix/federation/v1/publicRooms`,
                queryParams: params,
                prefix: "",
            });

            const result: { chunk: unknown[]; next_batch?: string; prev_batch?: string } = {
                chunk: response.chunk || [],
            };
            if (response.next_batch) result.next_batch = response.next_batch;
            if (response.prev_batch) result.prev_batch = response.prev_batch;

            return result;
        } catch (e) {
            const error = this.normalizeError(e, "getPublicRoomsOnServer");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 通过联邦查询用户资料
     * @param userId - 用户 ID
     */
    async queryProfile(userId: string): Promise<IUserProfile> {
        if (!userId) {
            throw new ValidationError("User ID is required");
        }
        return this.request<IUserProfile>({
            method: Method.Get,
            path: `/_matrix/federation/v1/query/profile/${encodeURIComponent(userId)}`,
            prefix: "",
        });
    }

    /**
     * 通过联邦查询房间别名
     * @param roomAlias - 房间别名
     */
    async queryDirectory(roomAlias: string): Promise<{ room_id: string; servers: string[] }> {
        if (!roomAlias) {
            throw new ValidationError("Room alias is required");
        }
        return this.request<{ room_id: string; servers: string[] }>({
            method: Method.Get,
            path: `/_matrix/federation/v1/query/directory`,
            queryParams: { room_alias: roomAlias },
            prefix: "",
        });
    }

    /**
     * 通过联邦获取房间层级
     * @param roomId - 房间 ID
     */
    async getHierarchy(roomId: string): Promise<unknown> {
        if (!roomId) {
            throw new ValidationError("Room ID is required");
        }
        return this.request<unknown>({
            method: Method.Get,
            path: `/_matrix/federation/v1/hierarchy/${encodeURIComponent(roomId)}`,
            prefix: "",
        });
    }

    /**
     * 获取联邦发现信息
     */
    async getFederationInfo(): Promise<unknown> {
        return this.request<unknown>({
            method: Method.Get,
            path: "/_matrix/federation/v1",
            prefix: "",
        });
    }

    /**
     * 通过联邦查询目的地
     * @param destination - 目标 server name
     */
    async queryDestination(destination: string): Promise<unknown> {
        if (!destination) {
            throw new ValidationError("Destination is required");
        }
        return this.request<unknown>({
            method: Method.Get,
            path: "/_matrix/federation/v1/query/destination",
            queryParams: { destination },
            prefix: "",
        });
    }

    /**
     * 通过联邦获取房间事件
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     */
    async getRoomEvent(roomId: string, eventId: string): Promise<unknown> {
        if (!roomId) {
            throw new ValidationError("Room ID is required");
        }
        if (!eventId) {
            throw new ValidationError("Event ID is required");
        }
        return this.request<unknown>({
            method: Method.Get,
            path: `/_matrix/federation/v1/room/${encodeURIComponent(roomId)}/${encodeURIComponent(eventId)}`,
            prefix: "",
        });
    }

    /**
     * 通过联邦下载远端媒体
     * @param serverName - 远端 server name
     * @param mediaId - 媒体 ID
     */
    async downloadMedia(serverName: string, mediaId: string): Promise<unknown> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }
        if (!mediaId) {
            throw new ValidationError("Media ID is required");
        }
        return this.request<unknown>({
            method: Method.Get,
            path: `/_matrix/federation/v1/media/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`,
            prefix: "",
        });
    }

    /**
     * 通过联邦获取远端媒体缩略图
     * @param serverName - 远端 server name
     * @param mediaId - 媒体 ID
     */
    async getMediaThumbnail(serverName: string, mediaId: string): Promise<unknown> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }
        if (!mediaId) {
            throw new ValidationError("Media ID is required");
        }
        return this.request<unknown>({
            method: Method.Get,
            path: `/_matrix/federation/v1/media/thumbnail/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`,
            prefix: "",
        });
    }

    /**
     * 获取事件授权链
     *
     * 对应 GET /_synapse/federation/v1/event_auth
     *
     * @param roomId - 房间 ID (e.g., "!room:example.com")
     * @param eventId - 事件 ID (e.g., "$event:example.com")
     * @returns 事件授权链
     *
     * @example
     * ```typescript
     * const authChain = await manager.getEventAuth("!room:example.com", "$event:example.com");
     * ```
     *
     * @throws {ValidationError} If room ID or event ID is empty
     * @throws {Error} If the request fails
     */
    async getEventAuth(roomId: string, eventId: string): Promise<unknown> {
        if (!roomId) {
            throw new ValidationError("Room ID is required");
        }
        if (!eventId) {
            throw new ValidationError("Event ID is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Get,
                path: "/_synapse/federation/v1/event_auth",
                queryParams: { room_id: roomId, event_id: eventId },
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "getEventAuth");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 获取房间加入规则
     *
     * 对应 GET /_synapse/federation/v1/get_joining_rules/{room_id}
     *
     * @param roomId - 房间 ID (e.g., "!room:example.com")
     * @returns 房间加入规则
     *
     * @example
     * ```typescript
     * const rules = await manager.getJoiningRules("!room:example.com");
     * ```
     *
     * @throws {ValidationError} If room ID is empty
     * @throws {Error} If the request fails
     */
    async getJoiningRules(roomId: string): Promise<unknown> {
        if (!roomId) {
            throw new ValidationError("Room ID is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Get,
                path: `/_synapse/federation/v1/get_joining_rules/${encodeURIComponent(roomId)}`,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "getJoiningRules");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 申领联邦密钥
     *
     * 对应 POST /_synapse/federation/v1/keys/claim
     *
     * @param body - 申领密钥请求体
     * @returns 申领密钥响应
     *
     * @example
     * ```typescript
     * const result = await manager.claimKeys({
     *   one_time_keys: { "@user:example.com": { "device_id": "signed_curve25519" } },
     * });
     * ```
     *
     * @throws {ValidationError} If body is empty
     * @throws {Error} If the request fails
     */
    async claimKeys(
        body: Record<string, unknown> /* Dynamic: federation key claim body varies by algorithm */,
    ): Promise<unknown> {
        if (!body) {
            throw new ValidationError("Body is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Post,
                path: "/_synapse/federation/v1/keys/claim",
                body,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "claimKeys");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 查询联邦密钥
     *
     * 对应 POST /_synapse/federation/v1/keys/query
     *
     * @param body - 查询密钥请求体
     * @returns 查询密钥响应
     *
     * @example
     * ```typescript
     * const result = await manager.queryKeys({
     *   device_keys: { "@user:example.com": ["*"] },
     * });
     * ```
     *
     * @throws {ValidationError} If body is empty
     * @throws {Error} If the request fails
     */
    async queryKeys(
        body: Record<string, unknown> /* Dynamic: federation key query body varies by algorithm */,
    ): Promise<unknown> {
        if (!body) {
            throw new ValidationError("Body is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Post,
                path: "/_synapse/federation/v1/keys/query",
                body,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "queryKeys");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 上传联邦密钥
     *
     * 对应 POST /_synapse/federation/v1/keys/upload
     *
     * @param body - 上传密钥请求体
     * @returns 上传密钥响应
     *
     * @example
     * ```typescript
     * const result = await manager.uploadKeys({
     *   device_keys: { user_id: "@user:example.com", device_id: "DEVICE", keys: {} },
     *   one_time_keys: {},
     * });
     * ```
     *
     * @throws {ValidationError} If body is empty
     * @throws {Error} If the request fails
     */
    async uploadKeys(
        body: Record<string, unknown> /* Dynamic: federation key upload body varies by algorithm */,
    ): Promise<unknown> {
        if (!body) {
            throw new ValidationError("Body is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Post,
                path: "/_synapse/federation/v1/keys/upload",
                body,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "uploadKeys");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 查询联邦授权
     *
     * 对应 GET /_synapse/federation/v1/query/auth
     *
     * @returns 联邦授权信息
     *
     * @example
     * ```typescript
     * const auth = await manager.queryAuth();
     * ```
     *
     * @throws {Error} If the request fails
     */
    async queryAuth(): Promise<unknown> {
        try {
            return await this.request<unknown>({
                method: Method.Get,
                path: "/_synapse/federation/v1/query/auth",
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "queryAuth");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 获取房间联邦授权
     *
     * 对应 GET /_synapse/federation/v1/room_auth/{room_id}
     *
     * @param roomId - 房间 ID (e.g., "!room:example.com")
     * @returns 房间联邦授权信息
     *
     * @example
     * ```typescript
     * const auth = await manager.getRoomAuth("!room:example.com");
     * ```
     *
     * @throws {ValidationError} If room ID is empty
     * @throws {Error} If the request fails
     */
    async getRoomAuth(roomId: string): Promise<unknown> {
        if (!roomId) {
            throw new ValidationError("Room ID is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Get,
                path: `/_synapse/federation/v1/room_auth/${encodeURIComponent(roomId)}`,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "getRoomAuth");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 通过联邦获取房间状态
     *
     * 对应 GET /_matrix/federation/v1/state/{room_id}
     *
     * @param roomId - 房间 ID (e.g., "!room:example.com")
     * @returns 房间状态
     *
     * @example
     * ```typescript
     * const state = await manager.getState("!room:example.com");
     * ```
     *
     * @throws {ValidationError} If room ID is empty
     * @throws {Error} If the request fails
     */
    async getState(roomId: string): Promise<unknown> {
        if (!roomId) {
            throw new ValidationError("Room ID is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Get,
                path: `/_matrix/federation/v1/state/${encodeURIComponent(roomId)}`,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "getState");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 通过联邦获取房间状态 ID 列表
     *
     * 对应 GET /_matrix/federation/v1/state_ids/{room_id}
     *
     * @param roomId - 房间 ID (e.g., "!room:example.com")
     * @returns 房间状态 ID 列表
     *
     * @example
     * ```typescript
     * const stateIds = await manager.getStateIds("!room:example.com");
     * ```
     *
     * @throws {ValidationError} If room ID is empty
     * @throws {Error} If the request fails
     */
    async getStateIds(roomId: string): Promise<unknown> {
        if (!roomId) {
            throw new ValidationError("Room ID is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Get,
                path: `/_matrix/federation/v1/state_ids/${encodeURIComponent(roomId)}`,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "getStateIds");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 通过联邦获取房间成员列表
     *
     * 对应 GET /_matrix/federation/v1/members/{room_id}
     *
     * @param roomId - 房间 ID (e.g., "!room:example.com")
     * @returns 成员列表
     *
     * @example
     * ```typescript
     * const members = await manager.getMembers("!room:example.com");
     * ```
     *
     * @throws {ValidationError} If room ID is empty
     * @throws {Error} If the request fails
     */
    async getMembers(roomId: string): Promise<unknown> {
        if (!roomId) {
            throw new ValidationError("Room ID is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Get,
                path: `/_matrix/federation/v1/members/${encodeURIComponent(roomId)}`,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "getMembers");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 通过联邦获取房间已加入成员列表
     *
     * 对应 GET /_matrix/federation/v1/members/{room_id}/joined
     *
     * @param roomId - 房间 ID (e.g., "!room:example.com")
     * @returns 已加入成员列表
     *
     * @example
     * ```typescript
     * const joinedMembers = await manager.getJoinedMembers("!room:example.com");
     * ```
     *
     * @throws {ValidationError} If room ID is empty
     * @throws {Error} If the request fails
     */
    async getJoinedMembers(roomId: string): Promise<unknown> {
        if (!roomId) {
            throw new ValidationError("Room ID is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Get,
                path: `/_matrix/federation/v1/members/${encodeURIComponent(roomId)}/joined`,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "getJoinedMembers");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 通过联邦获取事件
     *
     * 对应 GET /_matrix/federation/v1/event/{event_id}
     *
     * @param eventId - 事件 ID (e.g., "$event:example.com")
     * @returns 事件数据
     *
     * @example
     * ```typescript
     * const event = await manager.getEvent("$event:example.com");
     * ```
     *
     * @throws {ValidationError} If event ID is empty
     * @throws {Error} If the request fails
     */
    async getEvent(eventId: string): Promise<unknown> {
        if (!eventId) {
            throw new ValidationError("Event ID is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Get,
                path: `/_matrix/federation/v1/event/${encodeURIComponent(eventId)}`,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "getEvent");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 通过联邦回填房间历史
     *
     * 对应 GET /_matrix/federation/v1/backfill/{room_id}
     *
     * @param roomId - 房间 ID (e.g., "!room:example.com")
     * @param opts - 可选参数
     * @param opts.limit - 最大事件数量
     * @param opts.from - 起始事件 ID
     * @returns 回填结果
     *
     * @example
     * ```typescript
     * const result = await manager.backfillRoom("!room:example.com", { limit: 10 });
     * ```
     *
     * @throws {ValidationError} If room ID is empty
     * @throws {Error} If the request fails
     */
    async backfillRoom(roomId: string, opts?: { limit?: number; from?: string }): Promise<unknown> {
        if (!roomId) {
            throw new ValidationError("Room ID is required");
        }
        try {
            const params: Record<string, string | number> = {};
            if (opts?.limit !== undefined) params.limit = opts.limit;
            if (opts?.from !== undefined) params.from = opts.from;

            const queryKeys = Object.keys(params);
            return await this.request<unknown>({
                method: Method.Get,
                path: `/_matrix/federation/v1/backfill/${encodeURIComponent(roomId)}`,
                queryParams: queryKeys.length > 0 ? params : undefined,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "backfillRoom");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 克隆联邦密钥（v2）
     *
     * 对应 POST /_synapse/federation/v2/key/clone
     *
     * @param body - 克隆密钥请求体
     * @returns 克隆密钥响应
     *
     * @example
     * ```typescript
     * const result = await manager.cloneKey({
     *   server_name: "example.com",
     *   key_id: "ed25519:0",
     * });
     * ```
     *
     * @throws {ValidationError} If body is empty
     * @throws {Error} If the request fails
     */
    async cloneKey(
        body: Record<string, unknown> /* Dynamic: federation key clone body varies by algorithm */,
    ): Promise<unknown> {
        if (!body) {
            throw new ValidationError("Body is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Post,
                path: "/_synapse/federation/v2/key/clone",
                body,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "cloneKey");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    getCachedBlacklist(): IBlacklistEntry[] {
        return Array.from(this.blacklist.values());
    }

    getCachedServer(serverName: string): IFederationServer | null {
        return this.serverCache.get(serverName) || null;
    }

    getCachedServers(): IFederationServer[] {
        return Array.from(this.serverCache.values());
    }

    /**
     * Canonical JSON 序列化：将 U+2028（行分隔符）、U+2029（段落分隔符）、
     * U+FFFD（替换字符）转义为对应的 JSON 转义序列，确保与后端 C-2 修复对齐。
     *
     * 注意：在 JSON.stringify 之后替换，避免 replacer 导致的双重转义问题。
     */
    static toCanonicalJson(value: unknown): string {
        return JSON.stringify(value)
            .replace(/\u2028/g, "\\u2028")
            .replace(/\u2029/g, "\\u2029")
            .replace(/\ufffd/g, "\\ufffd");
    }

    /**
     * 发送联邦事件（使用 Canonical JSON 序列化，对齐后端 C-2 修复）
     * 对应 PUT /_matrix/federation/v1/send/{txnId}
     */
    async sendFederationEvent(txnId: string, event: IEvent): Promise<void> {
        if (!txnId) throw new ValidationError("Transaction ID is required");
        if (!event) throw new ValidationError("Event is required");

        const canonicalJson = FederationManager.toCanonicalJson(event);

        try {
            await this.client.http.requestOtherUrl(
                Method.Put,
                `${this.client.baseUrl}/_matrix/federation/v1/send/${encodeURIComponent(txnId)}`,
                canonicalJson,
                {
                    headers: {
                        "Content-Type": "application/json",
                    },
                },
            );
        } catch (e) {
            const error = this.normalizeError(e, "sendFederationEvent");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    clearCache(): void {
        this.blacklist.clear();
        this.serverCache.clear();
    }

    async start(): Promise<void> {
        if (this.initialized) return;

        try {
            await this.getBlacklist(false);
            this.initialized = true;
        } catch (e) {
            const error = this.normalizeError(e, "start");
            logger.warn("FederationManager.start failed:", error);
        }
    }

    stop(): void {
        this.blacklist.clear();
        this.serverCache.clear();
        this.initialized = false;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getFederationManager = function (): FederationManager {
        registerManagerClass("federation", FederationManager);
        return getOrCreateManager(this, "federation", () => new FederationManager(this));
    };
}
