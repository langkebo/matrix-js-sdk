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
 * Admin Manager - 管理员 API 封装
 *
 * 提供服务器管理功能，包括用户管理、房间管理、服务器配置等
 * 对接后端: synapse-rust/src/web/routes/admin/
 *
 * ⚠️ URL 组装规则：
 * - HTTP 层执行 baseUrl + prefix + path 三段拼接
 * - 使用 prefix 时，path 只传相对路径（不带前缀）
 * - 例如：baseUrl=https://server.com + prefix=/_synapse/admin + path=/v1/users
 *   结果: https://server.com/_synapse/admin/v1/users
 */

import { Method } from "../http-api/method";
import { logger } from "../logger";
import { type Body } from "../http-api/interface";
import { MatrixClient } from "../client";
import { NotFoundError } from "../errors";
import { BaseManager } from "../managers/base-manager";

export enum AdminEvent {
    UserCreated = "UserCreated",
    UserDeactivated = "UserDeactivated",
    UserShadowBanned = "UserShadowBanned",
    UserUnshadowBanned = "UserUnshadowBanned",
    RoomDeleted = "RoomDeleted",
    RoomBlocked = "RoomBlocked",
    ServerStatsUpdated = "ServerStatsUpdated",
    AdminError = "AdminError",
}

export interface DeviceInfo {
    device_id: string;
    display_name?: string;
    last_seen_ip?: string;
    last_seen_ts?: number;
    user_id?: string;
}

export interface MediaInfo {
    created_ts?: number;
    last_access_ts?: number;
    media_id: string;
    media_type?: string;
    upload_name?: string;
    quarantined_by?: string;
}

export interface RoomStateEvent {
    type: string;
    state_key: string;
    content: Record<string, unknown>;
    sender: string;
    event_id: string;
}

export interface RoomMessage {
    event_id: string;
    type: string;
    content: Record<string, unknown>;
    sender: string;
    origin_server_ts: number;
}

export interface SpaceInfo {
    space_id: string;
    name?: string;
    room_id: string;
    creator?: string;
    child_rooms?: string[];
    member_count?: number;
}

export interface UserSession {
    session_id: string;
    device_id?: string;
    last_seen_ts?: number;
    last_seen_ip?: string;
    user_agent?: string;
}

export interface UserInfo {
    user_id: string;
    name?: string;
    displayname?: string;
    avatar_url?: string;
    admin?: boolean;
    deactivated?: boolean;
    suspended?: boolean;
    created_ts?: number;
    last_seen_ts?: number;
    last_seen_ip?: string;
    user_type?: string;
    is_guest?: boolean;
}

export interface RoomInfo {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    creator?: string;
    joined_members?: number;
    joined_local_members?: number;
    invited_members?: number;
    version?: string;
    created_ts?: number;
    join_rules?: string;
    public?: boolean;
    guest_access?: string;
    history_visibility?: string;
    state_events?: number;
}

export interface ServerStats {
    total_users?: number;
    total_rooms?: number;
    daily_active_users?: number;
    monthly_active_users?: number;
    total_nonlocal_users?: number;
    total_room_events?: number;
    r30_users?: number;
    r30v2_users?: number;
}

export interface ShadowBanStatus {
    user_id: string;
    banned: boolean;
    banned_at?: number;
}

export interface RateLimitConfig {
    messages_per_second?: number;
    burst_count?: number;
}

export interface RegistrationToken {
    token: string;
    uses_allowed?: number;
    pending?: number;
    completed?: number;
    expiry_ts?: number;
    created_ts?: number;
}

export interface FederationDestination {
    destination: string;
    retry_last_ts?: number;
    retry_interval?: number;
    failure_ts?: number;
    last_successful_stream_ordering?: number;
}

export interface RoomStats {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    member_count?: number;
    message_count?: number;
    last_message_ts?: number;
    is_encrypted?: boolean;
    admin_count?: number;
    created_ts?: number;
}

export interface AdminRegisterResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    device_id: string;
    user_id: string;
    home_server: string;
}

/**
 * Admin API 错误类
 */
export class AdminApiError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number,
        public readonly details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = "AdminApiError";
    }
}

interface AdminManagerEventMap {
    [AdminEvent.UserCreated]: (userId: string, user: UserInfo) => void;
    [AdminEvent.UserDeactivated]: (userId: string) => void;
    [AdminEvent.UserShadowBanned]: (userId: string) => void;
    [AdminEvent.UserUnshadowBanned]: (userId: string) => void;
    [AdminEvent.RoomDeleted]: (roomId: string) => void;
    [AdminEvent.RoomBlocked]: (roomId: string, blocked: boolean) => void;
    [AdminEvent.ServerStatsUpdated]: (stats: ServerStats) => void;
    [AdminEvent.AdminError]: (error: Error) => void;
}

/**
 * Admin Manager - 管理员 API 封装
 *
 * ⚠️ 重要：URL 组装规则
 * prefix 配置为 "/_synapse/admin"，path 传版本化相对路径（如 /v1/...、/v2/...）
 * 正确: prefix="/_synapse/admin", path="/v1/users"
 * 错误: prefix="/_synapse/admin/v1", path="/v2/users" (会拼成 /v1/v2/...)
 */
const ADMIN_PREFIX = "/_synapse/admin";

export class AdminManager extends BaseManager<AdminEvent, AdminManagerEventMap> {
    private serverStats: ServerStats | null = null;

    constructor(client: MatrixClient) {
        super(client);
    }

    /**
     * 发起带前缀的 Admin API 请求
     *
     * @param method - HTTP 方法
     * @param path - 相对路径（不带前缀）
     * @param queryParams - 查询参数
     * @param body - 请求体
     * @returns 响应数据
     */
    private async adminRequest<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, string | string[]>,
        body?: Body,
        methodName?: string,
    ): Promise<T> {
        try {
            return (await this.client.http.authedRequest(method, path, queryParams ?? {}, body, {
                prefix: ADMIN_PREFIX,
            })) as Promise<T>;
        } catch (err) {
            throw this.normalizeError(err, methodName ?? "unknown");
        }
    }

    // ===== 用户管理 =====

    /**
     * 获取用户列表（支持分页）
     */
    async getUsers(from?: string, limit?: number): Promise<{ users: UserInfo[]; next_token?: string }> {
        const queryParams: Record<string, string> = {};
        if (from) queryParams["from"] = from;
        if (limit) queryParams["limit"] = String(limit);

        const response = await this.adminRequest<{ users: UserInfo[]; next_token?: string }>(
            Method.Get,
            "/v2/users",
            Object.keys(queryParams).length > 0 ? queryParams : undefined,
        );

        return {
            users: response.users || [],
            next_token: response.next_token,
        };
    }

    /**
     * Get user details
     *
     * @param userId - User ID
     * @param throwOnError - Whether to throw on error (default false)
     * @returns User details
     */
    async getUser(userId: string, throwOnError = false): Promise<UserInfo | null> {
        if (!userId) {
            throw new Error("User ID is required");
        }

        try {
            return await this.adminRequest<UserInfo>(
                Method.Get,
                `/v2/users/${encodeURIComponent(userId)}`,
                undefined,
                undefined,
                "getUser",
            );
            // @swallow-error { owner: "admin", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            if (e instanceof NotFoundError) {
                logger.warn(`AdminManager.getUser failed for ${userId}:`, e);
                return null;
            }
            throw e;
        }
    }

    /**
     * 创建新用户
     */
    async createUser(
        userId: string,
        options?: {
            password?: string;
            displayname?: string;
            admin?: boolean;
            deactivated?: boolean;
        },
    ): Promise<UserInfo> {
        const user = await this.adminRequest<UserInfo>(
            Method.Put,
            `/v2/users/${encodeURIComponent(userId)}`,
            undefined,
            options || {},
        );

        this.emit(AdminEvent.UserCreated, userId, user);
        return user;
    }

    /**
     * 停用用户
     */
    async deactivateUser(userId: string, erase?: boolean): Promise<void> {
        await this.adminRequest(Method.Post, `/v1/users/${encodeURIComponent(userId)}/deactivate`, undefined, {
            erase: erase ?? false,
        });
        this.emit(AdminEvent.UserDeactivated, userId);
    }

    /**
     * 重置用户密码
     */
    async resetPassword(userId: string, newPassword: string, logout?: boolean): Promise<void> {
        await this.adminRequest(Method.Post, `/v1/users/${encodeURIComponent(userId)}/password`, undefined, {
            new_password: newPassword,
            logout_devices: logout ?? true,
        });
    }

    /**
     * 设置用户管理员权限
     */
    async setAdmin(userId: string, admin: boolean): Promise<void> {
        await this.adminRequest(Method.Put, `/v2/users/${encodeURIComponent(userId)}`, undefined, { admin });
    }

    /**
     * 获取用户的设备列表
     */
    async getUserDevices(userId: string): Promise<DeviceInfo[]> {
        const response = await this.adminRequest<{ devices: DeviceInfo[] }>(
            Method.Get,
            `/v2/users/${encodeURIComponent(userId)}/devices`,
        );
        return response.devices || [];
    }

    /**
     * 删除用户的设备
     */
    async deleteUserDevices(userId: string, deviceIds: string[]): Promise<void> {
        await this.adminRequest(Method.Post, `/v1/users/${encodeURIComponent(userId)}/devices/delete`, undefined, {
            devices: deviceIds,
        });
    }

    // ===== Shadow Ban =====

    /**
     * 对用户实施影子封禁
     */
    async shadowBanUser(userId: string): Promise<void> {
        await this.adminRequest(Method.Post, `/v1/users/${encodeURIComponent(userId)}/shadow_ban`);
        this.emit(AdminEvent.UserShadowBanned, userId);
    }

    /**
     * 取消用户的影子封禁
     */
    async unshadowBanUser(userId: string): Promise<void> {
        await this.adminRequest(Method.Delete, `/v1/users/${encodeURIComponent(userId)}/shadow_ban`);
        this.emit(AdminEvent.UserUnshadowBanned, userId);
    }

    /**
     * 获取用户影子封禁状态
     *
     * @param userId - 用户 ID
     * @param throwOnError - 是否抛出错误（默认 false）
     * @returns 封禁状态
     */
    async getShadowBanStatus(userId: string, throwOnError = false): Promise<ShadowBanStatus | null> {
        try {
            return await this.adminRequest<ShadowBanStatus>(
                Method.Get,
                `/v1/users/${encodeURIComponent(userId)}/shadow_ban`,
            );
            // @swallow-error { owner: "admin", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            if (e instanceof NotFoundError) {
                return null;
            }
            throw e;
        }
    }

    // ===== Rate Limit =====

    /**
     * 获取用户的速率限制配置
     *
     * @param userId - 用户 ID
     * @param throwOnError - 是否抛出错误（默认 false）
     * @returns 速率限制配置
     */
    async getRateLimit(userId: string, throwOnError = false): Promise<RateLimitConfig | null> {
        try {
            return await this.adminRequest<RateLimitConfig>(
                Method.Get,
                `/v1/users/${encodeURIComponent(userId)}/rate_limit`,
            );
            // @swallow-error { owner: "admin", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            if (e instanceof NotFoundError) {
                return null;
            }
            throw e;
        }
    }

    /**
     * 设置用户的速率限制配置
     */
    async setRateLimit(userId: string, config: RateLimitConfig): Promise<void> {
        await this.adminRequest(Method.Put, `/v1/users/${encodeURIComponent(userId)}/rate_limit`, undefined, config);
    }

    /**
     * 删除用户的速率限制配置（使用默认配置）
     */
    async deleteRateLimit(userId: string): Promise<void> {
        await this.adminRequest(Method.Delete, `/v1/users/${encodeURIComponent(userId)}/rate_limit`);
    }

    // ===== 房间管理 =====

    /**
     * 获取房间列表（支持分页和搜索）
     */
    async getRooms(
        from?: string,
        limit?: number,
        searchTerm?: string,
    ): Promise<{ rooms: RoomInfo[]; next_token?: string }> {
        const queryParams: Record<string, string> = {};
        if (from) queryParams["from"] = from;
        if (limit) queryParams["limit"] = String(limit);
        if (searchTerm) queryParams["search_term"] = searchTerm;

        const response = await this.adminRequest<{ rooms: RoomInfo[]; next_token?: string }>(
            Method.Get,
            "/v1/rooms",
            Object.keys(queryParams).length > 0 ? queryParams : undefined,
        );

        return {
            rooms: response.rooms || [],
            next_token: response.next_token,
        };
    }

    /**
     * 获取房间详情
     *
     * @param roomId - 房间 ID
     * @param throwOnError - 是否抛出错误（默认 false）
     * @returns 房间详情
     */
    async getRoom(roomId: string, throwOnError = false): Promise<RoomInfo | null> {
        try {
            return await this.adminRequest<RoomInfo>(Method.Get, `/v1/rooms/${encodeURIComponent(roomId)}`);
            // @swallow-error { owner: "admin", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            if (e instanceof NotFoundError) {
                return null;
            }
            throw e;
        }
    }

    /**
     * 删除房间
     */
    async deleteRoom(
        roomId: string,
        options?: {
            purge?: boolean;
            force_purge?: boolean;
        },
    ): Promise<void> {
        await this.adminRequest(Method.Delete, `/v1/rooms/${encodeURIComponent(roomId)}`, undefined, options || {});
        this.emit(AdminEvent.RoomDeleted, roomId);
    }

    /**
     * 封禁/解封房间
     */
    async blockRoom(roomId: string, block: boolean): Promise<void> {
        await this.adminRequest(Method.Post, `/v1/rooms/${encodeURIComponent(roomId)}/block`, undefined, { block });
        this.emit(AdminEvent.RoomBlocked, roomId, block);
    }

    /**
     * 获取房间成员列表
     */
    async getRoomMembers(roomId: string): Promise<string[]> {
        const response = await this.adminRequest<{ members: string[] }>(
            Method.Get,
            `/v1/rooms/${encodeURIComponent(roomId)}/members`,
        );
        return response.members || [];
    }

    /**
     * 强制用户加入房间（管理员操作）
     */
    async joinRoom(roomId: string, userId: string): Promise<void> {
        await this.adminRequest(Method.Post, `/v1/join/${encodeURIComponent(roomId)}`, undefined, { user_id: userId });
    }

    // ===== 服务器管理 =====

    /**
     * 获取服务器版本信息
     *
     * @param throwOnError - 是否抛出错误（默认 false）
     * @returns 服务器版本信息
     */
    async getServerVersion(throwOnError = false): Promise<{ server_version: string; python_version: string }> {
        try {
            return await this.adminRequest<{ server_version: string; python_version: string }>(
                Method.Get,
                "/v1/server_version",
            );
            // @swallow-error { owner: "admin", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            logger.warn("AdminManager.getServerVersion failed:", e);
            return { server_version: "unknown", python_version: "unknown" };
        }
    }

    /**
     * 获取服务器统计信息
     */
    async getServerStats(): Promise<ServerStats> {
        const stats = await this.adminRequest<ServerStats>(Method.Get, "/v1/statistics");
        this.serverStats = stats;
        this.emit(AdminEvent.ServerStatsUpdated, this.serverStats);
        return this.serverStats;
    }

    /**
     * 获取服务器配置
     *
     * @param throwOnError - 是否抛出错误（默认 false）
     * @returns 配置信息
     */
    async getServerConfig(throwOnError = false): Promise<Record<string, unknown>> {
        try {
            return await this.adminRequest<Record<string, unknown>>(Method.Get, "/v1/config");
            // @swallow-error { owner: "admin", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            logger.warn("AdminManager.getServerConfig failed:", e);
            return {};
        }
    }

    // ===== 注册令牌 =====

    /**
     * 获取注册令牌列表
     */
    async getRegistrationTokens(): Promise<RegistrationToken[]> {
        const response = await this.adminRequest<{ registration_tokens: RegistrationToken[] }>(
            Method.Get,
            "/v1/registration_tokens",
        );
        return response.registration_tokens || [];
    }

    /**
     * 创建注册令牌
     */
    async createRegistrationToken(options?: {
        token?: string;
        uses_allowed?: number;
        expiry_ts?: number;
    }): Promise<RegistrationToken> {
        return await this.adminRequest<RegistrationToken>(
            Method.Post,
            "/v1/registration_tokens",
            undefined,
            options || {},
        );
    }

    /**
     * 更新注册令牌
     */
    async updateRegistrationToken(
        token: string,
        options: {
            uses_allowed?: number;
            expiry_ts?: number;
        },
    ): Promise<void> {
        await this.adminRequest(
            Method.Post,
            `/v1/registration_tokens/${encodeURIComponent(token)}`,
            undefined,
            options,
        );
    }

    /**
     * 删除注册令牌
     */
    async deleteRegistrationToken(token: string): Promise<void> {
        await this.adminRequest(Method.Delete, `/v1/registration_tokens/${encodeURIComponent(token)}`);
    }

    // ===== 联邦管理 =====

    /**
     * 获取联邦目的地列表
     */
    async getFederationDestinations(): Promise<FederationDestination[]> {
        const response = await this.adminRequest<{ destinations: FederationDestination[] }>(
            Method.Get,
            "/v1/federation/destinations",
        );
        return response.destinations || [];
    }

    /**
     * 获取联邦目的地详情
     *
     * @param destination - 目的地
     * @param throwOnError - 是否抛出错误（默认 false）
     * @returns 详情
     */
    async getFederationDestination(destination: string, throwOnError = false): Promise<FederationDestination | null> {
        try {
            return await this.adminRequest<FederationDestination>(
                Method.Get,
                `/v1/federation/destinations/${encodeURIComponent(destination)}`,
            );
            // @swallow-error { owner: "admin", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            if (e instanceof NotFoundError) {
                return null;
            }
            throw e;
        }
    }

    /**
     * 重置联邦连接
     */
    async resetFederationConnection(destination: string): Promise<void> {
        await this.adminRequest(
            Method.Post,
            `/v1/federation/destinations/${encodeURIComponent(destination)}/reset_connection`,
        );
    }

    // ===== 媒体管理 =====

    /**
     * 获取媒体列表
     */
    async getMedia(limit?: number, from?: string): Promise<{ media: MediaInfo[]; next_token?: string }> {
        const queryParams: Record<string, string> = {};
        if (limit) queryParams["limit"] = String(limit);
        if (from) queryParams["from"] = from;

        const response = await this.adminRequest<{ media: MediaInfo[]; next_token?: string }>(
            Method.Get,
            "/v1/media",
            Object.keys(queryParams).length > 0 ? queryParams : undefined,
        );

        return {
            media: response.media || [],
            next_token: response.next_token,
        };
    }

    /**
     * 删除单个媒体
     */
    async deleteMedia(mediaId: string): Promise<void> {
        await this.adminRequest(Method.Delete, `/v1/media/${encodeURIComponent(mediaId)}`);
    }

    /**
     * 隔离媒体（防止下载）
     */
    async quarantineMedia(mediaId: string): Promise<void> {
        await this.adminRequest(Method.Post, `/v1/media/quarantine/${encodeURIComponent(mediaId)}`);
    }

    /**
     * 清理媒体缓存
     */
    async purgeMediaCache(beforeTs?: number): Promise<{ deleted: number }> {
        const response = await this.adminRequest<{ deleted: number }>(
            Method.Post,
            "/v1/purge_media_cache",
            undefined,
            beforeTs ? { before_ts: beforeTs } : {},
        );
        return { deleted: response.deleted || 0 };
    }

    // ===== 房间高级管理 =====

    /**
     * 获取房间状态事件
     */
    async getRoomState(roomId: string): Promise<{ state: RoomStateEvent[] }> {
        const response = await this.adminRequest<{ state: RoomStateEvent[] }>(
            Method.Get,
            `/v1/rooms/${encodeURIComponent(roomId)}/state`,
        );
        return { state: response.state || [] };
    }

    /**
     * 获取房间消息
     */
    async getRoomMessages(
        roomId: string,
        options?: {
            limit?: number;
            from?: string;
            dir?: "f" | "b";
        },
    ): Promise<{ chunk: RoomMessage[]; start?: string; end?: string }> {
        const queryParams: Record<string, string> = {};
        if (options?.limit) queryParams["limit"] = String(options.limit);
        if (options?.from) queryParams["from"] = options.from;
        if (options?.dir) queryParams["dir"] = options.dir;

        return await this.adminRequest<{ chunk: RoomMessage[]; start?: string; end?: string }>(
            Method.Get,
            `/v1/rooms/${encodeURIComponent(roomId)}/messages`,
            Object.keys(queryParams).length > 0 ? queryParams : undefined,
        );
    }

    /**
     * 获取房间别名
     */
    async getRoomAliases(roomId: string): Promise<{ aliases: string[] }> {
        return await this.adminRequest<{ aliases: string[] }>(
            Method.Get,
            `/v1/rooms/${encodeURIComponent(roomId)}/aliases`,
        );
    }

    /**
     * 获取房间版本
     *
     * @param roomId - 房间 ID
     * @param throwOnError - 是否抛出错误（默认 false）
     * @returns 版本信息
     */
    async getRoomVersion(
        roomId: string,
        throwOnError = false,
    ): Promise<{ room_id: string; room_version: string } | null> {
        try {
            return await this.adminRequest<{ room_id: string; room_version: string }>(
                Method.Get,
                `/v1/rooms/${encodeURIComponent(roomId)}/version`,
            );
            // @swallow-error { owner: "admin", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            if (e instanceof NotFoundError) {
                return null;
            }
            throw e;
        }
    }

    /**
     * 获取房间封禁状态
     */
    async getRoomBlockStatus(roomId: string): Promise<{ block: boolean; blocked_at?: number }> {
        return await this.adminRequest<{ block: boolean; blocked_at?: number }>(
            Method.Get,
            `/v1/rooms/${encodeURIComponent(roomId)}/block`,
        );
    }

    /**
     * 解封房间
     */
    async unblockRoom(roomId: string): Promise<void> {
        await this.adminRequest(Method.Post, `/v1/rooms/${encodeURIComponent(roomId)}/unblock`);
    }

    /**
     * 清除房间历史
     */
    async purgeRoomHistory(
        roomId: string,
        options?: {
            purge_up_to_ts?: number;
        },
    ): Promise<{ success: boolean; deleted_events: number }> {
        return await this.adminRequest<{ success: boolean; deleted_events: number }>(
            Method.Post,
            `/v1/rooms/${encodeURIComponent(roomId)}/purge_history`,
            undefined,
            options || {},
        );
    }

    /**
     * 清除房间（保留房间但清除数据）
     */
    async purgeRoom(roomId: string): Promise<{ purge_id: string; success: boolean }> {
        return await this.adminRequest<{ purge_id: string; success: boolean }>(
            Method.Post,
            "/v1/purge_room",
            undefined,
            { room_id: roomId },
        );
    }

    /**
     * 关闭房间（踢出所有成员并关闭）
     */
    async shutdownRoom(roomId: string): Promise<{
        kicked_users: string[];
        failed_to_kick_users: string[];
        closed_room: boolean;
    }> {
        return await this.adminRequest<{
            kicked_users: string[];
            failed_to_kick_users: string[];
            closed_room: boolean;
        }>(Method.Post, "/v1/shutdown_room", undefined, { room_id: roomId });
    }

    // ===== 房间成员管理 =====

    /**
     * 强制用户加入房间
     */
    async forceJoinRoom(
        roomId: string,
        userId: string,
    ): Promise<{ user_id: string; room_id: string; membership: string }> {
        return await this.adminRequest<{ user_id: string; room_id: string; membership: string }>(
            Method.Put,
            `/v1/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}`,
        );
    }

    /**
     * 强制用户离开房间
     */
    async forceLeaveRoom(
        roomId: string,
        userId: string,
    ): Promise<{ user_id: string; room_id: string; removed: boolean }> {
        return await this.adminRequest<{ user_id: string; room_id: string; removed: boolean }>(
            Method.Delete,
            `/v1/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}`,
        );
    }

    /**
     * 封禁用户
     */
    async banUser(
        roomId: string,
        userId: string,
        reason?: string,
    ): Promise<{ user_id: string; room_id: string; membership: string }> {
        return await this.adminRequest<{ user_id: string; room_id: string; membership: string }>(
            Method.Post,
            `/v1/rooms/${encodeURIComponent(roomId)}/ban/${encodeURIComponent(userId)}`,
            undefined,
            reason ? { reason } : {},
        );
    }

    /**
     * 解封用户
     */
    async unbanUser(roomId: string, userId: string): Promise<{ user_id: string; room_id: string; unbanned: boolean }> {
        return await this.adminRequest<{ user_id: string; room_id: string; unbanned: boolean }>(
            Method.Post,
            `/v1/rooms/${encodeURIComponent(roomId)}/unban/${encodeURIComponent(userId)}`,
        );
    }

    /**
     * 踢出用户
     */
    async kickUser(
        roomId: string,
        userId: string,
        reason?: string,
    ): Promise<{ user_id: string; room_id: string; kicked: boolean }> {
        return await this.adminRequest<{ user_id: string; room_id: string; kicked: boolean }>(
            Method.Post,
            `/v1/rooms/${encodeURIComponent(roomId)}/kick/${encodeURIComponent(userId)}`,
            undefined,
            reason ? { reason } : {},
        );
    }

    // ===== 房间列表管理 =====

    /**
     * 获取房间列表状态
     */
    async getRoomListings(roomId: string): Promise<{ room_id: string; public: boolean; in_directory: boolean }> {
        return await this.adminRequest<{ room_id: string; public: boolean; in_directory: boolean }>(
            Method.Get,
            `/v1/rooms/${encodeURIComponent(roomId)}/listings`,
        );
    }

    /**
     * 设置房间为公开
     */
    async setRoomPublic(roomId: string): Promise<{ room_id: string; public: boolean }> {
        return await this.adminRequest<{ room_id: string; public: boolean }>(
            Method.Put,
            `/v1/rooms/${encodeURIComponent(roomId)}/listings/public`,
        );
    }

    /**
     * 设置房间为私有
     */
    async setRoomPrivate(roomId: string): Promise<{ room_id: string; public: boolean }> {
        return await this.adminRequest<{ room_id: string; public: boolean }>(
            Method.Delete,
            `/v1/rooms/${encodeURIComponent(roomId)}/listings/public`,
        );
    }

    // ===== 房间搜索与事件 =====

    /**
     * 搜索房间消息
     */
    async searchRoomMessages(
        roomId: string,
        searchTerm: string,
        options?: {
            limit?: number;
            start_date?: number;
            end_date?: number;
        },
    ): Promise<{ results: RoomMessage[]; count: number }> {
        return await this.adminRequest<{ results: RoomMessage[]; count: number }>(
            Method.Post,
            `/v1/rooms/${encodeURIComponent(roomId)}/search`,
            undefined,
            { search_term: searchTerm, ...options },
        );
    }

    async searchAllRooms(options?: {
        search_term?: string;
        limit?: number;
        offset?: number;
        order_by?: string;
        is_public?: boolean;
        is_encrypted?: boolean;
    }): Promise<{ results: RoomInfo[]; count: number; total: number }> {
        return await this.adminRequest<{ results: RoomInfo[]; count: number; total: number }>(
            Method.Post,
            "/v1/rooms/search",
            undefined,
            options || {},
        );
    }

    async getEventContext(
        roomId: string,
        eventId: string,
    ): Promise<{
        event: RoomMessage;
        events_before: RoomMessage[];
        events_after: RoomMessage[];
    }> {
        return await this.adminRequest<{
            event: RoomMessage;
            events_before: RoomMessage[];
            events_after: RoomMessage[];
        }>(Method.Get, `/v1/rooms/${encodeURIComponent(roomId)}/event_context/${encodeURIComponent(eventId)}`);
    }

    /**
     * 获取房间前向极值
     */
    async getRoomForwardExtremities(roomId: string): Promise<{ room_id: string; forward_extremities: number }> {
        return await this.adminRequest<{ room_id: string; forward_extremities: number }>(
            Method.Get,
            `/v1/rooms/${encodeURIComponent(roomId)}/forward_extremities`,
        );
    }

    // ===== 空间管理 =====

    /**
     * 获取所有空间
     */
    async getSpaces(): Promise<{ spaces: SpaceInfo[]; total: number }> {
        return await this.adminRequest<{ spaces: SpaceInfo[]; total: number }>(Method.Get, "/v1/spaces");
    }

    /**
     * 获取空间详情
     *
     * @param spaceId - 空间 ID
     * @param throwOnError - 是否抛出错误（默认 false）
     * @returns 空间详情
     */
    async getSpace(spaceId: string, throwOnError = false): Promise<SpaceInfo | null> {
        try {
            return await this.adminRequest<SpaceInfo>(Method.Get, `/v1/spaces/${encodeURIComponent(spaceId)}`);
            // @swallow-error { owner: "admin", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            if (e instanceof NotFoundError) {
                return null;
            }
            throw e;
        }
    }

    /**
     * 删除空间
     */
    async deleteSpace(spaceId: string): Promise<{ deleted: boolean }> {
        return await this.adminRequest<{ deleted: boolean }>(
            Method.Delete,
            `/v1/spaces/${encodeURIComponent(spaceId)}`,
        );
    }

    /**
     * 获取空间成员
     */
    async getSpaceUsers(spaceId: string): Promise<{ users: string[]; total: number }> {
        return await this.adminRequest<{ users: string[]; total: number }>(
            Method.Get,
            `/v1/spaces/${encodeURIComponent(spaceId)}/users`,
        );
    }

    /**
     * 获取空间房间
     */
    async getSpaceRooms(spaceId: string): Promise<{ rooms: string[]; total: number }> {
        return await this.adminRequest<{ rooms: string[]; total: number }>(
            Method.Get,
            `/v1/spaces/${encodeURIComponent(spaceId)}/rooms`,
        );
    }

    /**
     * 获取空间统计
     */
    async getSpaceStats(spaceId: string): Promise<{
        space_id: string;
        member_count: number;
        child_room_count: number;
    }> {
        return await this.adminRequest<{
            space_id: string;
            member_count: number;
            child_room_count: number;
        }>(Method.Get, `/v1/spaces/${encodeURIComponent(spaceId)}/stats`);
    }

    // ===== 用户批量操作 =====

    /**
     * 批量创建用户
     */
    async batchCreateUsers(
        users: Array<{
            username: string;
            password?: string;
            displayname?: string;
            admin?: boolean;
        }>,
    ): Promise<{ created: string[]; failed: string[]; total: number }> {
        return await this.adminRequest<{ created: string[]; failed: string[]; total: number }>(
            Method.Post,
            "/v1/users/batch",
            undefined,
            { users },
        );
    }

    /**
     * 批量停用用户
     */
    async batchDeactivateUsers(users: string[], erase?: boolean): Promise<{ deactivated: string[]; total: number }> {
        return await this.adminRequest<{ deactivated: string[]; total: number }>(
            Method.Post,
            "/v1/users/batch_deactivate",
            undefined,
            { users, erase },
        );
    }

    // ===== 用户会话管理 =====

    /**
     * 获取用户会话
     */
    async getUserSessions(userId: string): Promise<{
        user_id: string;
        sessions: UserSession[];
        total: number;
    }> {
        return await this.adminRequest<{
            user_id: string;
            sessions: UserSession[];
            total: number;
        }>(Method.Get, `/v1/user_sessions/${encodeURIComponent(userId)}`);
    }

    /**
     * 使所有用户会话失效
     */
    async invalidateUserSessions(userId: string): Promise<{
        invalidated: boolean;
        sessions_removed: number;
    }> {
        return await this.adminRequest<{
            invalidated: boolean;
            sessions_removed: number;
        }>(Method.Post, `/v1/user_sessions/${encodeURIComponent(userId)}/invalidate`);
    }

    // ===== 账户管理 =====

    /**
     * 获取账户详情
     *
     * @param userId - 用户 ID
     * @param throwOnError - 是否抛出错误（默认 false）
     * @returns 账户详情
     */
    async getAccountDetails(
        userId: string,
        throwOnError = false,
    ): Promise<{
        name: string;
        user_id: string;
        displayname?: string;
        admin: boolean;
        deactivated: boolean;
        creation_ts: number;
        device_count: number;
        room_count: number;
    } | null> {
        try {
            return await this.adminRequest<{
                name: string;
                user_id: string;
                displayname?: string;
                admin: boolean;
                deactivated: boolean;
                creation_ts: number;
                device_count: number;
                room_count: number;
            }>(Method.Get, `/v1/account/${encodeURIComponent(userId)}`);
            // @swallow-error { owner: "admin", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            if (e instanceof NotFoundError) {
                return null;
            }
            throw e;
        }
    }

    /**
     * 更新账户
     */
    async updateAccount(
        userId: string,
        options: {
            displayname?: string;
            avatar_url?: string;
            admin?: boolean;
        },
    ): Promise<{ user_id: string; updated: boolean }> {
        return await this.adminRequest<{ user_id: string; updated: boolean }>(
            Method.Post,
            `/v1/account/${encodeURIComponent(userId)}`,
            undefined,
            options,
        );
    }

    /**
     * 获取用户统计
     */
    async getUserStats(userId: string): Promise<{
        user_id: string;
        rooms_joined: number;
        messages_sent: number;
        last_seen_ts?: number;
        creation_ts: number;
        is_admin: boolean;
    }> {
        return await this.adminRequest<{
            user_id: string;
            rooms_joined: number;
            messages_sent: number;
            last_seen_ts?: number;
            creation_ts: number;
            is_admin: boolean;
        }>(Method.Get, `/v1/users/${encodeURIComponent(userId)}/stats`);
    }

    /**
     * 获取用户房间
     */
    async getUserRooms(userId: string): Promise<{ rooms: string[] }> {
        return await this.adminRequest<{ rooms: string[] }>(
            Method.Get,
            `/v1/users/${encodeURIComponent(userId)}/rooms`,
        );
    }

    /**
     * 以用户身份登录
     */
    async loginAsUser(userId: string): Promise<{
        access_token: string;
        device_id: string;
        user_id: string;
    }> {
        return await this.adminRequest<{
            access_token: string;
            device_id: string;
            user_id: string;
        }>(Method.Post, `/v1/users/${encodeURIComponent(userId)}/login`);
    }

    /**
     * 登出用户所有设备
     */
    async logoutUserDevices(userId: string): Promise<{ devices_deleted: number }> {
        return await this.adminRequest<{ devices_deleted: number }>(
            Method.Post,
            `/v1/users/${encodeURIComponent(userId)}/logout`,
        );
    }

    /**
     * 驱逐用户（从所有房间移除）
     */
    async evictUser(userId: string): Promise<{
        user_id: string;
        rooms_evicted: number;
        rooms: string[];
        failures: Array<{ room_id: string; error: string }>;
    }> {
        return await this.adminRequest<{
            user_id: string;
            rooms_evicted: number;
            rooms: string[];
            failures: Array<{ room_id: string; error: string }>;
        }>(Method.Post, `/v1/users/${encodeURIComponent(userId)}/evict`);
    }

    // ===== 便捷方法 =====

    /**
     * 获取缓存的服务器统计
     */
    getCachedServerStats(): ServerStats | null {
        return this.serverStats;
    }

    /**
     * 查询用户信息
     *
     * @param userId - 用户 ID
     * @param throwOnError - 是否抛出错误（默认 false）
     * @returns 用户信息
     */
    async whois(userId: string, throwOnError = false): Promise<any | null> {
        try {
            return await this.adminRequest<any>(Method.Get, `/v1/whois/${encodeURIComponent(userId)}`);
            // @swallow-error { owner: "admin", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            if (e instanceof NotFoundError) {
                return null;
            }
            throw e;
        }
    }

    /**
     * 使某个用户成为房间的管理员
     */
    async makeRoomAdmin(roomId: string, userId?: string): Promise<void> {
        await this.adminRequest(
            Method.Post,
            `/v1/rooms/${encodeURIComponent(roomId)}/make_admin`,
            undefined,
            userId ? { user_id: userId } : {},
        );
    }

    // ===== 房间统计 =====

    /**
     * 获取所有房间统计
     */
    async getAllRoomStats(): Promise<{
        total_rooms: number;
        encrypted_rooms: number;
        public_rooms: number;
        total_messages: number;
        total_members: number;
        active_rooms: number;
        average_messages_per_room: number;
    }> {
        return await this.adminRequest<{
            total_rooms: number;
            encrypted_rooms: number;
            public_rooms: number;
            total_messages: number;
            total_members: number;
            active_rooms: number;
            average_messages_per_room: number;
        }>(Method.Get, "/v1/room_stats");
    }

    /**
     * 获取房间统计信息
     *
     * @param roomId - 房间 ID
     * @param throwOnError - 是否抛出错误（默认 false）
     * @returns 统计信息
     */
    async getRoomStats(roomId: string, throwOnError = false): Promise<RoomStats | null> {
        try {
            return await this.adminRequest<RoomStats>(Method.Get, `/v1/rooms/${encodeURIComponent(roomId)}/statistics`);
            // @swallow-error { owner: "admin", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            if (e instanceof NotFoundError) {
                return null;
            }
            throw e;
        }
    }

    // ===== 管理员注册 =====

    /**
     * 获取管理员注册 Nonce
     */
    async registerNonce(): Promise<string> {
        const response = await this.adminRequest<{ nonce: string }>(Method.Get, "/v1/register/nonce");
        return response.nonce;
    }

    /**
     * 管理员注册新用户
     */
    async adminRegister(options: {
        username: string;
        password: string;
        admin?: boolean;
        displayname?: string;
        nonce?: string;
        mac?: string;
    }): Promise<AdminRegisterResponse> {
        let nonce = options.nonce;
        if (!nonce) {
            nonce = await this.registerNonce();
        }

        const body: Record<string, unknown> = {
            nonce,
            username: options.username,
            password: options.password,
            admin: options.admin ?? false,
        };

        if (options.displayname) {
            body.displayname = options.displayname;
        }

        if (options.mac) {
            body.mac = options.mac;
        }

        return await this.adminRequest<AdminRegisterResponse>(Method.Post, "/v1/register", undefined, body);
    }

    start(): void {}

    stop(): void {
        this.serverStats = null;
    }
}

// Type declaration for MatrixClient extension
declare module "../client.ts" {
    interface MatrixClient {
        getAdminManager(): AdminManager;
    }
}

/**
 * 扩展 MatrixClient 原型
 */
export function extendMatrixClient(): void {
    MatrixClient.prototype.getAdminManager = function (): AdminManager {
        return new AdminManager(this);
    };
}

export default extendMatrixClient;
