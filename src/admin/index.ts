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
 * - 例如：baseUrl=https://server.com + prefix=/_synapse/admin/v1 + path=/users
 *   结果: https://server.com/_synapse/admin/v1/users
 */

import { TypedEventEmitter } from "../models/typed-event-emitter";
import { Method } from "../http-api/method";
import { logger } from "../logger";
import { MatrixError } from "../http-api/errors";
import { MatrixClient } from "../client";
import { AuthError, NotFoundError, ApiError } from "../errors";

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
        public readonly details?: Record<string, unknown>
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
 * prefix 配置为 "/_synapse/admin/v1"，path 只传相对路径
 * 正确: prefix="/_synapse/admin/v1", path="/users"
 * 错误: prefix="/_synapse/admin/v1", path="/_synapse/admin/v2/users" (会导致重复前缀)
 */
const ADMIN_PREFIX = "/_synapse/admin/v1";

export class AdminManager extends TypedEventEmitter<AdminEvent, AdminManagerEventMap> {
    private client: any;
    private serverStats: ServerStats | null = null;

    constructor(client: any) {
        super();
        this.client = client;
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
        body?: unknown,
        methodName?: string
    ): Promise<T> {
        try {
            return await this.client.http.authedRequest(
                method,
                path,
                queryParams ?? {},
                body,
                { prefix: ADMIN_PREFIX }
            ) as Promise<T>;
        } catch (err) {
            if (err instanceof MatrixError) {
                const name = methodName ?? 'unknown';
                if (err.httpStatus === 401 || err.errcode === 'M_UNKNOWN_TOKEN') {
                    throw new AuthError(`AdminManager.${name} failed: ${err.message ?? 'Unknown error'}`, err);
                }
                if (err.httpStatus === 404 || err.errcode === 'M_NOT_FOUND') {
                    throw new NotFoundError(`AdminManager.${name} failed: ${err.message ?? 'Unknown error'}`, err);
                }
                throw new ApiError(`AdminManager.${name} failed: ${err.message ?? 'Unknown error'}`, err.errcode ?? 'UNKNOWN', err.httpStatus ?? 0, err);
            }
            throw err;
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
            Object.keys(queryParams).length > 0 ? queryParams : undefined
        );

        return {
            users: response.users || [],
            next_token: response.next_token,
        };
    }

    /**
     * 获取单个用户信息
     */
    async getUser(userId: string): Promise<UserInfo | null> {
        try {
            return await this.adminRequest<UserInfo>(
                Method.Get,
                `/v2/users/${encodeURIComponent(userId)}`
            );
        } catch (e) {
            if (e instanceof NotFoundError) {
                return null;
            }
            throw e;
        }
    }

    /**
     * 创建新用户
     */
    async createUser(userId: string, options?: {
        password?: string;
        displayname?: string;
        admin?: boolean;
        deactivated?: boolean;
    }): Promise<UserInfo> {
        const user = await this.adminRequest<UserInfo>(
            Method.Put,
            `/v2/users/${encodeURIComponent(userId)}`,
            undefined,
            options || {}
        );

        this.emit(AdminEvent.UserCreated, userId, user);
        return user;
    }

    /**
     * 停用用户
     */
    async deactivateUser(userId: string, erase?: boolean): Promise<void> {
        await this.adminRequest(
            Method.Post,
            `/v1/deactivate/${encodeURIComponent(userId)}`,
            undefined,
            { erase: erase ?? false }
        );
        this.emit(AdminEvent.UserDeactivated, userId);
    }

    /**
     * 重置用户密码
     */
    async resetPassword(userId: string, newPassword: string, logout?: boolean): Promise<void> {
        await this.adminRequest(
            Method.Post,
            `/v1/reset_password/${encodeURIComponent(userId)}`,
            undefined,
            { new_password: newPassword, logout_devices: logout ?? true }
        );
    }

    /**
     * 设置用户管理员权限
     */
    async setAdmin(userId: string, admin: boolean): Promise<void> {
        await this.adminRequest(
            Method.Put,
            `/v2/users/${encodeURIComponent(userId)}`,
            undefined,
            { admin }
        );
    }

    /**
     * 获取用户的设备列表
     */
    async getUserDevices(userId: string): Promise<any[]> {
        const response = await this.adminRequest<{ devices: any[] }>(
            Method.Get,
            `/v2/users/${encodeURIComponent(userId)}/devices`
        );
        return response.devices || [];
    }

    /**
     * 删除用户的设备
     */
    async deleteUserDevices(userId: string, deviceIds: string[]): Promise<void> {
        await this.adminRequest(
            Method.Post,
            `/v2/users/${encodeURIComponent(userId)}/delete_devices`,
            undefined,
            { devices: deviceIds }
        );
    }

    // ===== Shadow Ban =====

    /**
     * 对用户实施影子封禁
     */
    async shadowBanUser(userId: string): Promise<void> {
        await this.adminRequest(
            Method.Post,
            `/v1/users/${encodeURIComponent(userId)}/shadow_ban`
        );
        this.emit(AdminEvent.UserShadowBanned, userId);
    }

    /**
     * 取消用户的影子封禁
     */
    async unshadowBanUser(userId: string): Promise<void> {
        await this.adminRequest(
            Method.Delete,
            `/v1/users/${encodeURIComponent(userId)}/shadow_ban`
        );
        this.emit(AdminEvent.UserUnshadowBanned, userId);
    }

    /**
     * 获取用户的影子封禁状态
     */
    async getShadowBanStatus(userId: string): Promise<ShadowBanStatus | null> {
        try {
            return await this.adminRequest<ShadowBanStatus>(
                Method.Get,
                `/v1/users/${encodeURIComponent(userId)}/shadow_ban`
            );
        } catch (e) {
            if (e instanceof NotFoundError) {
                return null;
            }
            throw e;
        }
    }

    // ===== Rate Limit =====

    /**
     * 获取用户的速率限制配置
     */
    async getRateLimit(userId: string): Promise<RateLimitConfig | null> {
        try {
            return await this.adminRequest<RateLimitConfig>(
                Method.Get,
                `/v1/users/${encodeURIComponent(userId)}/rate_limit`
            );
        } catch (e) {
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
        await this.adminRequest(
            Method.Put,
            `/v1/users/${encodeURIComponent(userId)}/rate_limit`,
            undefined,
            config
        );
    }

    /**
     * 删除用户的速率限制配置（使用默认配置）
     */
    async deleteRateLimit(userId: string): Promise<void> {
        await this.adminRequest(
            Method.Delete,
            `/v1/users/${encodeURIComponent(userId)}/rate_limit`
        );
    }

    // ===== 房间管理 =====

    /**
     * 获取房间列表（支持分页和搜索）
     */
    async getRooms(from?: string, limit?: number, searchTerm?: string): Promise<{ rooms: RoomInfo[]; next_token?: string }> {
        const queryParams: Record<string, string> = {};
        if (from) queryParams["from"] = from;
        if (limit) queryParams["limit"] = String(limit);
        if (searchTerm) queryParams["search_term"] = searchTerm;

        const response = await this.adminRequest<{ rooms: RoomInfo[]; next_token?: string }>(
            Method.Get,
            "/v1/rooms",
            Object.keys(queryParams).length > 0 ? queryParams : undefined
        );

        return {
            rooms: response.rooms || [],
            next_token: response.next_token,
        };
    }

    /**
     * 获取单个房间信息
     */
    async getRoom(roomId: string): Promise<RoomInfo | null> {
        try {
            return await this.adminRequest<RoomInfo>(
                Method.Get,
                `/v1/rooms/${encodeURIComponent(roomId)}`
            );
        } catch (e) {
            if (e instanceof NotFoundError) {
                return null;
            }
            throw e;
        }
    }

    /**
     * 删除房间
     */
    async deleteRoom(roomId: string, options?: {
        purge?: boolean;
        force_purge?: boolean;
    }): Promise<void> {
        await this.adminRequest(
            Method.Delete,
            `/v1/rooms/${encodeURIComponent(roomId)}`,
            undefined,
            options || {}
        );
        this.emit(AdminEvent.RoomDeleted, roomId);
    }

    /**
     * 封禁/解封房间
     */
    async blockRoom(roomId: string, block: boolean): Promise<void> {
        await this.adminRequest(
            Method.Post,
            `/v1/rooms/${encodeURIComponent(roomId)}/block`,
            undefined,
            { block }
        );
        this.emit(AdminEvent.RoomBlocked, roomId, block);
    }

    /**
     * 获取房间成员列表
     */
    async getRoomMembers(roomId: string): Promise<string[]> {
        const response = await this.adminRequest<{ members: string[] }>(
            Method.Get,
            `/v1/rooms/${encodeURIComponent(roomId)}/members`
        );
        return response.members || [];
    }

    /**
     * 强制用户加入房间（管理员操作）
     */
    async joinRoom(roomId: string, userId: string): Promise<void> {
        await this.adminRequest(
            Method.Post,
            `/v1/join/${encodeURIComponent(roomId)}`,
            undefined,
            { user_id: userId }
        );
    }

    // ===== 服务器管理 =====

    /**
     * 获取服务器版本信息
     */
    async getServerVersion(): Promise<{ server_version: string; python_version: string }> {
        try {
            return await this.adminRequest<{ server_version: string; python_version: string }>(
                Method.Get,
                "/v1/server_version"
            );
        } catch (e) {
            logger.warn('AdminManager.getServerVersion failed:', e);
            return { server_version: 'unknown', python_version: 'unknown' };
        }
    }

    /**
     * 获取服务器统计信息
     */
    async getServerStats(): Promise<ServerStats> {
        const stats = await this.adminRequest<ServerStats>(
            Method.Get,
            "/v1/statistics"
        );
        this.serverStats = stats;
        this.emit(AdminEvent.ServerStatsUpdated, this.serverStats);
        return this.serverStats;
    }

    /**
     * 获取服务器配置
     */
    async getServerConfig(): Promise<Record<string, unknown>> {
        try {
            return await this.adminRequest<Record<string, unknown>>(
                Method.Get,
                "/v1/config"
            );
        } catch (e) {
            logger.warn('AdminManager.getServerConfig failed:', e);
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
            "/v1/registration_tokens"
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
            options || {}
        );
    }

    /**
     * 更新注册令牌
     */
    async updateRegistrationToken(token: string, options: {
        uses_allowed?: number;
        expiry_ts?: number;
    }): Promise<void> {
        await this.adminRequest(
            Method.Post,
            `/v1/registration_tokens/${encodeURIComponent(token)}`,
            undefined,
            options
        );
    }

    /**
     * 删除注册令牌
     */
    async deleteRegistrationToken(token: string): Promise<void> {
        await this.adminRequest(
            Method.Delete,
            `/v1/registration_tokens/${encodeURIComponent(token)}`
        );
    }

    // ===== 联邦管理 =====

    /**
     * 获取联邦目的地列表
     */
    async getFederationDestinations(): Promise<FederationDestination[]> {
        const response = await this.adminRequest<{ destinations: FederationDestination[] }>(
            Method.Get,
            "/v1/federation/destinations"
        );
        return response.destinations || [];
    }

    /**
     * 获取单个联邦目的地状态
     */
    async getFederationDestination(destination: string): Promise<FederationDestination | null> {
        try {
            return await this.adminRequest<FederationDestination>(
                Method.Get,
                `/v1/federation/destinations/${encodeURIComponent(destination)}`
            );
        } catch (e) {
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
            `/v1/federation/destinations/${encodeURIComponent(destination)}/reset_connection`
        );
    }

    // ===== 媒体管理 =====

    /**
     * 获取媒体列表
     */
    async getMedia(limit?: number, from?: string): Promise<{ media: any[]; next_token?: string }> {
        const queryParams: Record<string, string> = {};
        if (limit) queryParams["limit"] = String(limit);
        if (from) queryParams["from"] = from;

        const response = await this.adminRequest<{ media: any[]; next_token?: string }>(
            Method.Get,
            "/v1/media",
            Object.keys(queryParams).length > 0 ? queryParams : undefined
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
        await this.adminRequest(
            Method.Delete,
            `/v1/media/${encodeURIComponent(mediaId)}`
        );
    }

    /**
     * 隔离媒体（防止下载）
     */
    async quarantineMedia(mediaId: string): Promise<void> {
        await this.adminRequest(
            Method.Post,
            `/v1/media/quarantine/${encodeURIComponent(mediaId)}`
        );
    }

    /**
     * 清理媒体缓存
     */
    async purgeMediaCache(beforeTs?: number): Promise<{ deleted: number }> {
        const response = await this.adminRequest<{ deleted: number }>(
            Method.Post,
            "/v1/purge_media_cache",
            undefined,
            beforeTs ? { before_ts: beforeTs } : {}
        );
        return { deleted: response.deleted || 0 };
    }

    // ===== 便捷方法 =====

    /**
     * 获取缓存的服务器统计
     */
    getCachedServerStats(): ServerStats | null {
        return this.serverStats;
    }

    /**
     * 获取用户的 WHOIS 信息
     */
    async whois(userId: string): Promise<any | null> {
        try {
            return await this.adminRequest(
                Method.Get,
                `/v1/whois/${encodeURIComponent(userId)}`
            );
        } catch (e) {
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
            `/v1/rooms/${encodeURIComponent(roomId)}/make_room_admin`,
            undefined,
            userId ? { user_id: userId } : {}
        );
    }

    // ===== 房间统计 =====

    /**
     * 获取房间统计数据
     *
     * @param roomId - 房间 ID
     * @returns 房间统计信息
     */
    async getRoomStats(roomId: string): Promise<RoomStats | null> {
        try {
            return await this.adminRequest<RoomStats>(
                Method.Get,
                `/v1/room_stats/${encodeURIComponent(roomId)}`
            );
        } catch (e) {
            if (e instanceof NotFoundError) {
                return null;
            }
            throw e;
        }
    }

    // ===== 管理员注册 =====

    /**
     * 获取管理员注册 Nonce
     *
     * @returns Nonce 字符串
     */
    async registerNonce(): Promise<string> {
        const response = await this.adminRequest<{ nonce: string }>(
            Method.Get,
            "/v1/register/nonce"
        );
        return response.nonce;
    }

    /**
     * 管理员注册新用户
     *
     * @param options - 注册选项
     * @param options.username - 用户名
     * @param options.password - 密码
     * @param options.admin - 是否为管理员
     * @param options.displayname - 显示名称
     * @param options.nonce - Nonce (可选，如果未提供会自动获取)
     * @param options.mac - HMAC-SHA256 签名 (可选)
     * @returns 注册响应
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

        return await this.adminRequest<AdminRegisterResponse>(
            Method.Post,
            "/v1/register",
            undefined,
            body
        );
    }

    start(): void {
        // Initialization if needed
    }

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