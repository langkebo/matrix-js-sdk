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
import { NotFoundError, ValidationError } from "../errors";
import { BaseManager } from "../managers/base-manager";
import { AdminValidators } from "./validators";
import { buildPaginationParams, buildSearchParams, buildQueryParams } from "./utils";

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
    user_count?: number;
    room_count?: number;
    daily_active_users?: number;
    monthly_active_users?: number;
    total_nonlocal_users?: number;
    total_room_events?: number;
    server_start_time?: number;
    r30_users?: number;
    r30v2_users?: number;
}

export interface ServerStatus {
    status: "online" | "offline" | "degraded";
    uptime?: number;
    version?: string;
    timestamp?: number;
}

export interface ServerHealth {
    healthy: boolean;
    checks?: Record<string, { status: string; message?: string }>;
}

export interface ServerInfo {
    server_name?: string;
    version?: string;
    python_version?: string;
    uptime?: number;
    federation_enabled?: boolean;
    registration_enabled?: boolean;
}

export interface AccountStatus {
    user_id: string;
    exists: boolean;
    deactivated?: boolean;
    locked?: boolean;
    suspended?: boolean;
}

export interface ServerNotice {
    event_id: string;
    user_id: string;
    content: Record<string, unknown>;
    sent_ts: number;
}

export interface FederationBlacklistEntry {
    server_name: string;
    added_ts?: number;
    reason?: string;
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
    status?: "pending" | "active" | "rejected";
    updated_ts?: number;
}

export interface FederationAdmissionResult {
    server_name: string;
    status: "active" | "rejected";
    previous_status: string;
    updated_ts: number;
    confirmed_by: string;
}

export interface PendingFederationServer {
    server_name: string;
    failure_count: number;
    last_failed_connect_at?: number;
    last_successful_connect_at?: number;
    status: "pending";
    updated_ts?: number;
}

export interface PendingFederationList {
    servers: PendingFederationServer[];
    total: number;
    limit: number;
    offset: number;
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

export interface WhoisResponse {
    user_id: string;
    devices: Record<string, {
        sessions: Array<{
            connections: Array<{
                ip: string;
                last_seen: number;
                user_agent: string;
            }>;
        }>;
    }>;
}

// ===== Retention / Audit / Feature flags =====

export interface RetentionPolicy {
    max_lifetime: number | null;
    min_lifetime: number | null;
    expire_on_clients: boolean;
}

export interface RoomRetentionPolicy extends RetentionPolicy {
    room_id: string;
}

export interface RetentionRunResult {
    started: boolean;
    room_id?: string;
    scope?: string;
    events_deleted?: number;
    status?: string;
    completed_ts?: number;
}

export interface RetentionStatus {
    server_policy_enabled: boolean;
    rooms_with_custom_policy: number;
    lifecycle_cleanup_enabled: boolean;
    cleanup_batch_size: number;
    audit_retention_days: number;
    queue_retention_days: number;
    last_run: {
        started_ts: number;
        completed_ts: number;
        duration_ms: number;
        expired_events_deleted: number;
        expired_beacons_deleted: number;
        expired_uploads_deleted: number;
        expired_audit_events_deleted: number;
        cleanup_queue_items_processed: number;
        cleanup_queue_rows_pruned: number;
        failed_tasks: number;
    } | null;
}

export interface AuditEvent {
    event_id: string;
    actor_id: string;
    action: string;
    resource_type: string;
    resource_id: string;
    result: string;
    request_id: string;
    ts: number;
    details?: Record<string, unknown>;
}

export interface AuditEventPage {
    events: AuditEvent[];
    total: number;
    next_token: number | null;
}

export interface FeatureFlagTarget {
    subject_type: string;
    subject_id: string;
}

export interface FeatureFlag {
    flag_key: string;
    target_scope: string;
    rollout_percent: number;
    expires_at: number | null;
    reason: string;
    status: string;
    created_by: string;
    created_ts: number;
    updated_ts: number;
    targets: FeatureFlagTarget[];
}

export interface FeatureFlagPage {
    flags: FeatureFlag[];
    total: number;
}

// ===== SAML / Appservices / System notifications / User pushers =====

export interface SamlMapping {
    name_id: string;
    user_id?: string;
    [key: string]: unknown;
}

export interface SamlMappingPage {
    mappings: SamlMapping[];
    next_token?: string;
}

export interface SamlMetadata {
    entity_id: string;
    sso_url: string;
    slo_url?: string | null;
    certificate?: string | null;
    [key: string]: unknown;
}

export interface ApplicationServiceInfo {
    id: string;
    as_token?: string;
    hs_token?: string;
    url?: string;
    sender_localpart?: string;
    [key: string]: unknown;
}

export interface ApplicationServicePage {
    services: ApplicationServiceInfo[];
    next_token?: string;
}

export interface ApplicationServicePingResult {
    ok: boolean;
    duration_ms?: number;
}

export interface SystemNotificationInfo {
    notification_id: string;
    content?: string;
    type?: string;
    target_users?: string[];
    created_ts?: number;
    [key: string]: unknown;
}

export interface SystemNotificationPage {
    notifications: SystemNotificationInfo[];
    next_token?: string;
}

export interface UserPusher {
    pushkey: string;
    app_id: string;
    kind?: string;
    app_display_name?: string;
    device_display_name?: string;
    profile_tag?: string;
    lang?: string;
    data?: Record<string, unknown>;
}

// ===== Spaces / Security / Server ops =====

export interface SpaceInfo {
    space_id: string;
    name?: string;
    [key: string]: unknown;
}

export interface SpacePage {
    spaces: SpaceInfo[];
    next_batch?: string;
}

export interface SpaceUser {
    user_id: string;
    [key: string]: unknown;
}

export interface SpaceRoom {
    room_id: string;
    [key: string]: unknown;
}

export interface SecurityEvent {
    event_id?: string;
    event_type?: string;
    user_id?: string;
    ts?: number;
    [key: string]: unknown;
}

export interface SecurityEventPage {
    events: SecurityEvent[];
    next_token?: string;
}

export interface IpBlock {
    ip: string;
    cidr?: number;
    reason?: string;
    expire_at?: number;
    [key: string]: unknown;
}

export interface ServerLogEntry {
    level: string;
    ts: number;
    message: string;
    [key: string]: unknown;
}

/**
 * Paginated response wrapper
 * Provides a consistent structure for paginated API responses
 */
export interface PaginatedResponse<T> {
    /** Array of items in the current page */
    items: T[];
    /** Token for fetching the next page (if available) */
    nextToken?: string;
    /** Total number of items (if available) */
    total?: number;
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

    /**
     * 发起不追加 Admin 前缀的认证请求。
     *
     * 用于访问完整路径形式的 Matrix Client API / Federation API 等端点。
     */
    private async rawRequest<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, string | string[]>,
        body?: Body,
        methodName?: string,
        rawResponseBody = false,
    ): Promise<T> {
        try {
            return (await this.client.http.authedRequest(method, path, queryParams ?? {}, body, {
                prefix: "",
                rawResponseBody,
            })) as Promise<T>;
        } catch (err) {
            throw this.normalizeError(err, methodName ?? "unknown");
        }
    }

    // ===== 用户管理 =====

    /**
     * 获取用户列表（支持分页）
     *
     * @param from - 分页起点 token
     * @param limit - 返回用户数量限制（1-10000）
     * @returns 用户列表和下一页 token
     *
     * @example
     * ```typescript
     * // 获取前 50 个用户
     * const result = await adminManager.getUsers(undefined, 50);
     * console.log(`获取 ${result.users.length} 个用户`);
     *
     * // 分页获取所有用户
     * let from: string | undefined;
     * do {
     *   const result = await adminManager.getUsers(from, 50);
     *   result.users.forEach(user => console.log(user.user_id));
     *   from = result.next_token;
     * } while (from);
     * ```
     *
     * @throws {ValidationError} 如果 limit 参数无效（< 1 或 > 10000）
     * @throws {AuthError} 如果没有管理员权限
     * @throws {ApiError} 如果 API 调用失败
     *
     * @deprecated Use {@link getUsersPaginated} for consistent pagination format
     */
    async getUsers(
        from?: string,
        limit?: number,
    ): Promise<{ users: UserInfo[]; next_token?: string; total?: number }> {
        const paginated = await this.getUsersPaginated({ from, limit });
        return {
            users: paginated.items,
            next_token: paginated.nextToken,
            total: paginated.total,
        };
    }

    /**
     * 获取用户列表（统一分页格式）
     *
     * @param options - 查询选项
     * @param options.from - 分页起点 token
     * @param options.limit - 返回用户数量限制（1-10000）
     * @returns 统一格式的分页响应
     *
     * @example
     * ```typescript
     * // 获取前 50 个用户
     * const result = await adminManager.getUsersPaginated({ limit: 50 });
     * console.log(`获取 ${result.items.length} 个用户`);
     *
     * // 分页获取所有用户
     * let nextToken: string | undefined;
     * do {
     *   const result = await adminManager.getUsersPaginated({
     *     from: nextToken,
     *     limit: 50
     *   });
     *   result.items.forEach(user => console.log(user.user_id));
     *   nextToken = result.nextToken;
     * } while (nextToken);
     * ```
     *
     * @throws {ValidationError} 如果 limit 参数无效
     * @throws {AuthError} 如果没有管理员权限
     * @throws {ApiError} 如果 API 调用失败
     */
    async getUsersPaginated(options?: {
        from?: string;
        limit?: number;
    }): Promise<PaginatedResponse<UserInfo>> {
        if (options?.limit !== undefined) {
            AdminValidators.validateLimit(options.limit);
        }

        const queryParams = buildPaginationParams(options?.from, options?.limit);

        const response = await this.adminRequest<{
            users: UserInfo[];
            next_token?: string;
            total?: number;
        }>(Method.Get, "/v2/users", buildQueryParams(queryParams));

        return {
            items: response.users || [],
            nextToken: response.next_token,
            total: response.total,
        };
    }

    /**
     * Get user details
     *
     * @param userId - User ID (e.g., "@alice:example.com")
     * @param throwOnError - Whether to throw on error (default true)
     * @returns User details or null if not found (when throwOnError=false)
     *
     * @example
     * ```typescript
     * // Get user info
     * const user = await adminManager.getUser("@alice:example.com");
     * console.log(user.displayname);
     * console.log(user.admin); // true/false
     *
     * // Handle missing users gracefully
     * const user = await adminManager.getUser("@unknown:example.com", false);
     * if (!user) {
     *     console.log("User not found");
     * }
     * ```
     *
     * @throws {ValidationError} If user ID format is invalid
     * @throws {AuthError} If authentication fails
     * @throws {NotFoundError} If user not found (when throwOnError=true)
     * @throws {ApiError} If the request fails
     */
    async getUser(userId: string, throwOnError = true): Promise<UserInfo | null> {
        AdminValidators.validateUserId(userId);

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
     *
     * @param userId - 用户 ID (e.g., "@bob:example.com")
     * @param options - 用户选项
     * @param options.password - 用户密码
     * @param options.displayname - 显示名称
     * @param options.admin - 是否为管理员
     * @param options.deactivated - 是否停用
     * @returns 创建的用户信息
     *
     * @example
     * ```typescript
     * // 创建普通用户
     * const user = await adminManager.createUser("@bob:example.com", {
     *     password: "secure123",
     *     displayname: "Bob Smith"
     * });
     *
     * // 创建管理员用户
     * const admin = await adminManager.createUser("@admin:example.com", {
     *     password: "admin123",
     *     displayname: "Admin User",
     *     admin: true
     * });
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 格式无效
     * @throws {AuthError} 如果没有管理员权限
     * @throws {ApiError} 如果用户已存在或创建失败
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
        AdminValidators.validateUserId(userId);

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
     * 对接: POST /_synapse/admin/v1/users/{user_id}/deactivate （后端当前忽略 body；erase 参数保留以便未来扩展）
     * @deprecated `erase` 参数当前被后端忽略，仅保留签名稳定性
     */
    async deactivateUser(userId: string, _erase?: boolean): Promise<void> {
        AdminValidators.validateUserId(userId);

        await this.adminRequest(Method.Post, `/v1/users/${encodeURIComponent(userId)}/deactivate`);
        this.emit(AdminEvent.UserDeactivated, userId);
    }

    /**
     * 重置用户密码
     * 对接: POST /_synapse/admin/v1/users/{user_id}/password body={new_password}
     * 注意：当前后端不支持 `logout_devices`，仅重置密码。
     */
    async resetPassword(userId: string, newPassword: string): Promise<void> {
        AdminValidators.validateUserId(userId);

        await this.adminRequest(Method.Post, `/v1/users/${encodeURIComponent(userId)}/password`, undefined, {
            new_password: newPassword,
        });
    }

    /**
     * 设置用户管理员权限
     * 对接: PUT /_synapse/admin/v1/users/{user_id}/admin  body={admin}
     */
    async setAdmin(userId: string, admin: boolean): Promise<void> {
        AdminValidators.validateUserId(userId);
        await this.adminRequest(
            Method.Put,
            `/v1/users/${encodeURIComponent(userId)}/admin`,
            undefined,
            { admin },
        );
    }

    /**
     * 获取用户的设备列表
     *
     * @param userId - 用户 ID（格式：@localpart:homeserver）
     * @returns 设备列表
     *
     * @example
     * ```typescript
     * // 获取用户设备列表
     * const devices = await adminManager.getUserDevices("@alice:example.com");
     * devices.forEach(device => {
     *     console.log(`Device: ${device.device_id}`);
     *     console.log(`Display name: ${device.display_name}`);
     *     console.log(`Last seen: ${device.last_seen_ts}`);
     * });
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 格式无效
     * @throws {ApiError} 如果 API 调用失败
     */
    async getUserDevices(userId: string): Promise<DeviceInfo[]> {
        AdminValidators.validateUserId(userId);
        const response = await this.adminRequest<{ devices: DeviceInfo[] }>(
            Method.Get,
            `/v2/users/${encodeURIComponent(userId)}/devices`,
        );
        return response.devices || [];
    }

    /**
     * 删除用户的设备
     *
     * @param userId - 用户 ID（格式：@localpart:homeserver）
     * @param deviceIds - 设备 ID 列表
     *
     * @example
     * ```typescript
     * // 删除用户的多个设备
     * await adminManager.deleteUserDevices(
     *     "@alice:example.com",
     *     ["DEVICE1", "DEVICE2"]
     * );
     *
     * // 删除单个设备
     * await adminManager.deleteUserDevice("@alice:example.com", "DEVICE1");
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 格式无效或设备列表为空
     * @throws {ApiError} 如果 API 调用失败
     */
    async deleteUserDevices(userId: string, deviceIds: string[]): Promise<void> {
        AdminValidators.validateUserId(userId);
        if (!deviceIds || deviceIds.length === 0) {
            throw new ValidationError("Device IDs list cannot be empty");
        }
        await this.adminRequest(Method.Post, `/v1/users/${encodeURIComponent(userId)}/devices/delete`, undefined, {
            devices: deviceIds,
        });
    }

    /**
     * 删除用户的单个设备
     *
     * @param userId - 用户 ID
     * @param deviceId - 设备 ID
     */
    async deleteUserDevice(userId: string, deviceId: string): Promise<void> {
        await this.adminRequest(
            Method.Delete,
            `/v1/users/${encodeURIComponent(userId)}/devices/${encodeURIComponent(deviceId)}`,
        );
    }

    /**
     * 获取账户状态
     *
     * @param userId - 用户 ID
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 账户状态
     */
    async getAccountStatus(userId: string, throwOnError = true): Promise<AccountStatus | null> {
        try {
            return await this.adminRequest<AccountStatus>(
                Method.Get,
                `/v1/account/${encodeURIComponent(userId)}`,
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
     * 检查用户是否为管理员
     *
     * @param userId - 用户 ID
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 是否为管理员
     */
    async isAdmin(userId: string, throwOnError = true): Promise<boolean> {
        try {
            const response = await this.adminRequest<{ admin: boolean }>(
                Method.Get,
                `/v1/users/${encodeURIComponent(userId)}/admin`,
            );
            return response.admin;
            // @swallow-error { owner: "admin", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            logger.warn(`AdminManager.isAdmin failed for ${userId}:`, e);
            return false;
        }
    }

    /**
     * 覆盖用户速率限制（完全禁用限制）
     *
     * @param userId - 用户 ID
     */
    async overrideRateLimit(userId: string): Promise<void> {
        await this.adminRequest(Method.Post, `/v1/users/${encodeURIComponent(userId)}/override_ratelimit`);
    }

    /**
     * 获取用户速率限制覆盖状态
     *
     * @param userId - 用户 ID
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 是否已覆盖
     */
    async getRateLimitOverride(userId: string, throwOnError = true): Promise<{ overridden: boolean } | null> {
        try {
            return await this.adminRequest<{ overridden: boolean }>(
                Method.Get,
                `/v1/users/${encodeURIComponent(userId)}/override_ratelimit`,
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
     * 删除用户速率限制覆盖
     *
     * @param userId - 用户 ID
     */
    async deleteRateLimitOverride(userId: string): Promise<void> {
        await this.adminRequest(Method.Delete, `/v1/users/${encodeURIComponent(userId)}/override_ratelimit`);
    }

    // ===== Shadow Ban =====

    /**
     * 对用户实施影子封禁
     *
     * @param userId - 用户 ID（格式：@localpart:homeserver）
     *
     * @example
     * ```typescript
     * // 影子封禁用户
     * await adminManager.shadowBanUser("@spammer:example.com");
     *
     * // 监听影子封禁事件
     * adminManager.on(AdminEvent.UserShadowBanned, (userId) => {
     *     console.log(`User ${userId} shadow banned`);
     * });
     *
     * // 检查封禁状态
     * const status = await adminManager.getShadowBanStatus("@spammer:example.com");
     * console.log("Is shadow banned:", status.shadow_banned);
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 格式无效
     * @throws {ApiError} 如果 API 调用失败
     */
    async shadowBanUser(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        await this.adminRequest(Method.Post, `/v1/users/${encodeURIComponent(userId)}/shadow_ban`);
        this.emit(AdminEvent.UserShadowBanned, userId);
    }

    /**
     * 取消用户的影子封禁
     *
     * @param userId - 用户 ID（格式：@localpart:homeserver）
     *
     * @example
     * ```typescript
     * // 取消影子封禁
     * await adminManager.unshadowBanUser("@user:example.com");
     *
     * // 监听取消封禁事件
     * adminManager.on(AdminEvent.UserUnshadowBanned, (userId) => {
     *     console.log(`User ${userId} unshadow banned`);
     * });
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 格式无效
     * @throws {ApiError} 如果 API 调用失败
     */
    async unshadowBanUser(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        await this.adminRequest(Method.Delete, `/v1/users/${encodeURIComponent(userId)}/shadow_ban`);
        this.emit(AdminEvent.UserUnshadowBanned, userId);
    }

    /**
     * 获取用户影子封禁状态
     *
     * @param userId - 用户 ID
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 封禁状态
     */
    async getShadowBanStatus(userId: string, throwOnError = true): Promise<ShadowBanStatus | null> {
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
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 速率限制配置
     */
    async getRateLimit(userId: string, throwOnError = true): Promise<RateLimitConfig | null> {
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
     *
     * @param from - 分页起点 token
     * @param limit - 返回房间数量限制
     * @param searchTerm - 搜索关键词（房间名称或 ID）
     * @returns 房间列表和下一页 token
     *
     * @example
     * ```typescript
     * // 获取所有房间
     * const result = await adminManager.getRooms();
     * console.log(`总共 ${result.rooms.length} 个房间`);
     *
     * // 搜索房间
     * const result = await adminManager.getRooms(undefined, 50, "general");
     * result.rooms.forEach(room => console.log(room.name));
     *
     * // 分页获取
     * let from: string | undefined;
     * do {
     *   const result = await adminManager.getRooms(from, 100);
     *   // 处理房间...
     *   from = result.next_token;
     * } while (from);
     * ```
     *
     * @throws {AuthError} 如果没有管理员权限
     * @throws {ApiError} 如果 API 调用失败
     *
     * @deprecated Use {@link getRoomsPaginated} for consistent pagination format
     */
    async getRooms(
        from?: string,
        limit?: number,
        searchTerm?: string,
    ): Promise<{ rooms: RoomInfo[]; next_token?: string; total?: number }> {
        const paginated = await this.getRoomsPaginated({ from, limit, searchTerm });
        return {
            rooms: paginated.items,
            next_token: paginated.nextToken,
            total: paginated.total,
        };
    }

    /**
     * 获取房间列表（统一分页格式）
     *
     * @param options - 查询选项
     * @param options.from - 分页起点 token
     * @param options.limit - 返回房间数量限制
     * @param options.searchTerm - 搜索关键词
     * @returns 统一格式的分页响应
     *
     * @throws {AuthError} 如果没有管理员权限
     * @throws {ApiError} 如果 API 调用失败
     */
    async getRoomsPaginated(options?: {
        from?: string;
        limit?: number;
        searchTerm?: string;
    }): Promise<PaginatedResponse<RoomInfo>> {
        const queryParams = buildSearchParams(options?.searchTerm, options?.from, options?.limit);

        const response = await this.adminRequest<{
            rooms: RoomInfo[];
            next_token?: string;
            total?: number;
        }>(Method.Get, "/v1/rooms", buildQueryParams(queryParams));

        return {
            items: response.rooms || [],
            nextToken: response.next_token,
            total: response.total,
        };
    }

    /**
     * 获取房间详情
     *
     * @param roomId - 房间 ID
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 房间详情
     */
    async getRoom(roomId: string, throwOnError = true): Promise<RoomInfo | null> {
        AdminValidators.validateRoomId(roomId);

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
        AdminValidators.validateRoomId(roomId);

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
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 服务器版本信息
     */
    async getServerVersion(throwOnError = true): Promise<{ server_version: string; python_version: string }> {
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
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 配置信息
     */
    async getServerConfig(throwOnError = true): Promise<Record<string, unknown>> {
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

    /**
     * 获取服务器状态
     *
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 服务器状态信息
     *
     * @example
     * ```typescript
     * // 检查服务器状态
     * const status = await adminManager.getServerStatus();
     * if (status?.status === "online") {
     *     console.log(`服务器在线，运行时间: ${status.uptime}秒`);
     * }
     *
     * // 优雅处理错误
     * const status = await adminManager.getServerStatus(false);
     * if (!status) {
     *     console.log("无法获取服务器状态");
     * }
     * ```
     *
     * @throws {AuthError} 如果没有管理员权限
     * @throws {ApiError} 如果 API 调用失败（当 throwOnError=true）
     */
    async getServerStatus(throwOnError = true): Promise<ServerStatus | null> {
        try {
            return await this.adminRequest<ServerStatus>(Method.Get, "/v1/status");
            // @swallow-error { owner: "admin", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            logger.warn("AdminManager.getServerStatus failed:", e);
            return null;
        }
    }

    /**
     * 获取服务器健康状态
     *
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 健康状态
     */
    async getServerHealth(throwOnError = true): Promise<ServerHealth | null> {
        try {
            return await this.adminRequest<ServerHealth>(Method.Get, "/v1/health");
            // @swallow-error { owner: "admin", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            logger.warn("AdminManager.getServerHealth failed:", e);
            return null;
        }
    }

    /**
     * 获取服务器信息（合并 status+config+server_version）
     * 对接: GET /_synapse/admin/v1/status, /v1/config, /v1/server_version
     */
    async getServerInfo(throwOnError = true): Promise<ServerInfo | null> {
        try {
            const [status, config, version] = await Promise.all([
                this.adminRequest<Record<string, unknown>>(Method.Get, "/v1/status"),
                this.adminRequest<Record<string, unknown>>(Method.Get, "/v1/config"),
                this.adminRequest<Record<string, unknown>>(Method.Get, "/v1/server_version"),
            ]);
            return { ...status, ...config, ...version } as ServerInfo;
            // @swallow-error { owner: "admin", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            logger.warn("AdminManager.getServerInfo failed:", e);
            return null;
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
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 详情
     */
    async getFederationDestination(destination: string, throwOnError = true): Promise<FederationDestination | null> {
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

    /**
     * 删除联邦目的地记录
     * 对接: DELETE /_synapse/admin/v1/federation/destinations/{destination}
     */
    async deleteFederationDestination(destination: string): Promise<void> {
        if (!destination) throw new ValidationError("destination is required");
        await this.adminRequest(
            Method.Delete,
            `/v1/federation/destinations/${encodeURIComponent(destination)}`,
        );
    }

    /**
     * 列出与某联邦目的地共享的房间
     * 对接: GET /_synapse/admin/v1/federation/destinations/{destination}/rooms
     */
    async getFederationDestinationRooms(
        destination: string,
        params?: { from?: string | number; limit?: number },
    ): Promise<{ rooms: Array<{ room_id: string; stream_ordering?: number }>; total?: number; next_token?: string | number }> {
        if (!destination) throw new ValidationError("destination is required");
        const q: Record<string, string> = {};
        if (params?.from !== undefined) q.from = String(params.from);
        if (params?.limit !== undefined) q.limit = String(params.limit);
        return await this.adminRequest(
            Method.Get,
            `/v1/federation/destinations/${encodeURIComponent(destination)}/rooms`,
            q,
        );
    }

    /**
     * 获取联邦黑名单
     *
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 黑名单列表
     *
     * @example
     * ```typescript
     * // 获取黑名单
     * const blacklist = await adminManager.getFederationBlacklist();
     * console.log(`黑名单中有 ${blacklist.length} 个服务器`);
     * blacklist.forEach(entry => {
     *     console.log(`${entry.server_name}: ${entry.reason}`);
     * });
     *
     * // 检查特定服务器是否在黑名单中
     * const blacklist = await adminManager.getFederationBlacklist();
     * const isBlocked = blacklist.some(e => e.server_name === "evil.com");
     * ```
     *
     * @throws {AuthError} 如果没有管理员权限
     * @throws {ApiError} 如果 API 调用失败（当 throwOnError=true）
     */
    async getFederationBlacklist(throwOnError = true): Promise<FederationBlacklistEntry[]> {
        try {
            const response = await this.adminRequest<{ blacklist: FederationBlacklistEntry[] }>(
                Method.Get,
                "/v1/federation/blacklist",
            );
            return response.blacklist || [];
            // @swallow-error { owner: "admin", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            logger.warn("AdminManager.getFederationBlacklist failed:", e);
            return [];
        }
    }

    /**
     * 添加服务器到联邦黑名单
     *
     * @param serverName - 服务器名称（域名）
     * @param reason - 封禁原因（可选）
     *
     * @example
     * ```typescript
     * // 添加到黑名单
     * await adminManager.addToFederationBlacklist(
     *     "spam-server.com",
     *     "发送垃圾消息"
     * );
     *
     * // 批量添加
     * const spamServers = ["spam1.com", "spam2.com", "spam3.com"];
     * for (const server of spamServers) {
     *     await adminManager.addToFederationBlacklist(server, "垃圾服务器");
     * }
     * ```
     *
     * @throws {ValidationError} 如果服务器名称格式无效
     * @throws {AuthError} 如果没有管理员权限
     * @throws {ApiError} 如果添加失败
     */
    async addToFederationBlacklist(serverName: string, reason?: string): Promise<void> {
        await this.adminRequest(
            Method.Post,
            `/v1/federation/blacklist/${encodeURIComponent(serverName)}`,
            undefined,
            { reason },
        );
    }

    /**
     * 从联邦黑名单移除服务器
     *
     * @param serverName - 服务器名称
     */
    async removeFromFederationBlacklist(serverName: string): Promise<void> {
        await this.adminRequest(
            Method.Delete,
            `/v1/federation/blacklist/${encodeURIComponent(serverName)}`,
        );
    }

    /**
     * @deprecated 使用 {@link resetFederationConnection}（原路径 `/v1/federation/disconnect` 后端并不存在）
     */
    async disconnectFederation(serverName: string): Promise<void> {
        return this.resetFederationConnection(serverName);
    }

    async confirmFederationAdmission(serverName: string, accept: boolean): Promise<FederationAdmissionResult> {
        return await this.adminRequest<FederationAdmissionResult>(
            Method.Post,
            "/v1/federation/confirm",
            undefined,
            { server_name: serverName, accept },
        );
    }

    async listPendingFederation(options?: {
        limit?: number;
        offset?: number;
    }): Promise<PendingFederationList> {
        const queryParams: Record<string, string> = {};
        if (options?.limit !== undefined) queryParams["limit"] = String(options.limit);
        if (options?.offset !== undefined) queryParams["offset"] = String(options.offset);
        return await this.adminRequest<PendingFederationList>(
            Method.Get,
            "/v1/federation/pending",
            queryParams,
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
     *
     * 删除指定时间戳之前的所有媒体文件和缩略图缓存。
     * 如果不传 `beforeTs`，后端默认清理 30 天前的缓存。
     *
     * 对接: `POST /_synapse/admin/v1/purge_media_cache`
     * 实现: `synapse-rust/src/services/media_service.rs::purge_media_cache`
     * 作用域: 遍历 `media_path` + `thumbnail_path`，按文件 mtime 过滤。
     *
     * @param beforeTs - 时间戳（毫秒），删除此时间之前的缓存。必须 > 0 的整数。
     * @returns `{ deleted: number }` — 已删除的文件总数（媒体 + 缩略图）
     *
     * @throws {ValidationError} 当 beforeTs 非正数或非整数时
     * @throws {AuthError} 没有管理员权限
     *
     * @example
     * ```typescript
     * // 清理 7 天前的媒体缓存
     * const result = await adminManager.purgeMediaCache(Date.now() - 7 * 24 * 60 * 60 * 1000);
     * console.log(`Deleted ${result.deleted} files`);
     *
     * // 使用后端默认 (30 天)
     * const result = await adminManager.purgeMediaCache();
     * ```
     */
    async purgeMediaCache(beforeTs?: number): Promise<{ deleted: number }> {
        if (beforeTs !== undefined) {
            if (!Number.isInteger(beforeTs) || beforeTs <= 0) {
                throw new ValidationError("beforeTs must be a positive integer (milliseconds since epoch)");
            }
        }
        const response = await this.adminRequest<{ deleted: number }>(
            Method.Post,
            "/v1/purge_media_cache",
            undefined,
            beforeTs !== undefined ? { before_ts: beforeTs } : {},
        );
        return { deleted: response.deleted || 0 };
    }

    // ===== Backups =====

    /**
     * 列出端到端加密密钥备份的服务器视图
     *
     * 对接: `GET /_synapse/admin/v1/backups`
     * 后端实现: `synapse-rust/src/web/routes/admin/server.rs::get_backups`
     *
     * @param params.limit - 分页大小（1-500，默认 50）
     * @param params.offset - 起始位置（默认 0）
     * @returns 备份汇总 + 分页项
     */
    async listBackups(params: { limit?: number; offset?: number } = {}): Promise<{
        backups: Array<{
            user_id: string;
            backup_id: string;
            version: string;
            algorithm: string;
            key_count: number;
            created_ts: number;
            updated_ts: number | null;
        }>;
        total: number;
        total_keys: number;
        limit: number;
        offset: number;
    }> {
        const q: Record<string, string> = {};
        if (params.limit !== undefined) {
            if (!Number.isInteger(params.limit) || params.limit < 1 || params.limit > 500) {
                throw new ValidationError("limit must be an integer in [1, 500]");
            }
            q.limit = String(params.limit);
        }
        if (params.offset !== undefined) {
            if (!Number.isInteger(params.offset) || params.offset < 0) {
                throw new ValidationError("offset must be a non-negative integer");
            }
            q.offset = String(params.offset);
        }
        return await this.adminRequest(Method.Get, "/v1/backups", q);
    }

    // ===== Experimental features =====

    /**
     * 列出启用/禁用的实验性特性（基于 FeatureFlag 存储）
     *
     * 对接: `GET /_synapse/admin/v1/experimental_features`
     * 后端实现: `synapse-rust/src/web/routes/admin/server.rs::get_experimental_features`
     *
     * 后端筛选规则：`flag_key` 以 `experimental.` / `msc` 开头，
     * 或 `target_scope == "experimental"` 的 feature flag 被视为实验特性。
     * `expires_at` 已过期会自动归入 disabled。
     */
    async getExperimentalFeatures(): Promise<{
        enabled: Array<Record<string, unknown>>;
        disabled: Array<Record<string, unknown>>;
        total: number;
        total_flags: number;
    }> {
        return await this.adminRequest(Method.Get, "/v1/experimental_features");
    }

    // ===== 通知管理 =====

    /**
     * 发送服务器通知
     *
     * @param userId - 目标用户 ID
     * @param content - 通知内容
     * @param content.msgtype - 消息类型（默认 "m.text"）
     * @param content.body - 消息正文
     * @returns 事件 ID
     *
     * @example
     * ```typescript
     * // 发送文本通知
     * const result = await adminManager.sendServerNotice(
     *     "@user:example.com",
     *     {
     *         msgtype: "m.text",
     *         body: "重要通知：服务器将于今晚 22:00 维护"
     *     }
     * );
     * console.log(`通知已发送，事件 ID: ${result.event_id}`);
     *
     * // 发送 HTML 格式通知
     * await adminManager.sendServerNotice(
     *     "@user:example.com",
     *     {
     *         msgtype: "m.text",
     *         body: "系统更新",
     *         format: "org.matrix.custom.html",
     *         formatted_body: "<strong>系统更新</strong><br>新功能已上线"
     *     }
     * );
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 格式无效
     * @throws {AuthError} 如果没有管理员权限
     * @throws {ApiError} 如果发送失败
     */
    async sendServerNotice(
        userId: string,
        content: {
            msgtype?: string;
            body: string;
            [key: string]: unknown;
        },
    ): Promise<{ event_id: string }> {
        return await this.adminRequest<{ event_id: string }>(Method.Post, "/v1/send_server_notice", undefined, {
            user_id: userId,
            content,
        });
    }

    /**
     * 获取服务器通知列表
     *
     * @param limit - 限制数量
     * @param from - 分页起点
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 通知列表
     */
    async getServerNotices(
        limit?: number,
        from?: string,
        throwOnError = true,
    ): Promise<{ notices: ServerNotice[]; next_token?: string } | null> {
        try {
            const queryParams: Record<string, string> = {};
            if (limit) queryParams["limit"] = String(limit);
            if (from) queryParams["from"] = from;

            const response = await this.adminRequest<{ notices: ServerNotice[]; next_token?: string }>(
                Method.Get,
                "/v1/server_notices",
                Object.keys(queryParams).length > 0 ? queryParams : undefined,
            );

            return {
                notices: response.notices || [],
                next_token: response.next_token,
            };
            // @swallow-error { owner: "admin", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            logger.warn("AdminManager.getServerNotices failed:", e);
            return null;
        }
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
        if (options?.limit !== undefined) queryParams["limit"] = String(options.limit);
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
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 版本信息
     */
    async getRoomVersion(
        roomId: string,
        throwOnError = true,
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
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 空间详情
     */
    async getSpace(spaceId: string, throwOnError = true): Promise<SpaceInfo | null> {
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
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 账户详情
     */
    async getAccountDetails(
        userId: string,
        throwOnError = true,
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
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 用户信息，包括设备和连接详情
     *
     * @example
     * ```typescript
     * // 查询用户的连接信息
     * const info = await adminManager.whois("@alice:example.com");
     * console.log(`用户 ID: ${info.user_id}`);
     *
     * // 遍历设备和连接
     * for (const [deviceId, device] of Object.entries(info.devices)) {
     *     console.log(`设备: ${deviceId}`);
     *     device.sessions.forEach(session => {
     *         session.connections.forEach(conn => {
     *             console.log(`  IP: ${conn.ip}, 最后活跃: ${new Date(conn.last_seen)}`);
     *         });
     *     });
     * }
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 格式无效
     * @throws {AuthError} 如果没有管理员权限
     * @throws {NotFoundError} 如果用户不存在（当 throwOnError=true）
     * @throws {ApiError} 如果 API 调用失败
     */
    async whois(userId: string, throwOnError = true): Promise<WhoisResponse | null> {
        AdminValidators.validateUserId(userId);

        try {
            return await this.adminRequest<WhoisResponse>(Method.Get, `/v1/whois/${encodeURIComponent(userId)}`);
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
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 统计信息
     */
    async getRoomStats(roomId: string, throwOnError = true): Promise<RoomStats | null> {
        try {
            return await this.adminRequest<RoomStats>(Method.Get, `/v1/room_stats/${encodeURIComponent(roomId)}`);
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

    // ===== 联邦解析与重写 =====

    /**
     * 解析联邦服务器可达性与黑名单状态
     * 对接: POST /_synapse/admin/v1/federation/resolve
     */
    async resolveFederation(serverName: string): Promise<{
        server_name: string;
        resolved: boolean;
        blacklisted: boolean;
        in_destinations: boolean;
        resolved_by?: string;
    }> {
        if (!serverName) {
            throw new ValidationError("serverName is required");
        }
        return await this.adminRequest(Method.Post, "/v1/federation/resolve", undefined, {
            server_name: serverName,
        });
    }

    /**
     * 重写联邦服务器名称
     * 对接: POST /_synapse/admin/v1/federation/rewrite
     */
    async rewriteFederation(
        from: string,
        to: string,
    ): Promise<{
        from: string;
        to: string;
        rewritten: boolean;
        rooms_affected: number;
        rewritten_by?: string;
    }> {
        if (!from || !to) {
            throw new ValidationError("from and to are required");
        }
        return await this.adminRequest(Method.Post, "/v1/federation/rewrite", undefined, { from, to });
    }

    // ===== 留存策略 =====

    /**
     * 获取服务器全局留存策略
     * 对接: GET /_synapse/admin/v1/retention/policy
     */
    async getRetentionPolicy(): Promise<RetentionPolicy> {
        return await this.adminRequest(Method.Get, "/v1/retention/policy");
    }

    /**
     * 设置服务器全局留存策略
     * 对接: POST /_synapse/admin/v1/retention/policy
     */
    async setRetentionPolicy(policy: {
        max_lifetime?: number | null;
        min_lifetime?: number | null;
        expire_on_clients?: boolean;
    }): Promise<RetentionPolicy> {
        return await this.adminRequest(Method.Post, "/v1/retention/policy", undefined, policy);
    }

    /**
     * 获取房间留存策略
     * 对接: GET /_synapse/admin/v1/retention/policy/{room_id}
     */
    async getRoomRetentionPolicy(roomId: string): Promise<RoomRetentionPolicy> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(
            Method.Get,
            `/v1/retention/policy/${encodeURIComponent(roomId)}`,
        );
    }

    /**
     * 设置房间留存策略
     * 对接: POST /_synapse/admin/v1/retention/policy/{room_id}
     */
    async setRoomRetentionPolicy(
        roomId: string,
        policy: {
            max_lifetime?: number | null;
            min_lifetime?: number | null;
            expire_on_clients?: boolean;
        },
    ): Promise<RoomRetentionPolicy> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(
            Method.Post,
            `/v1/retention/policy/${encodeURIComponent(roomId)}`,
            undefined,
            policy,
        );
    }

    /**
     * 触发留存清理
     * 对接: POST /_synapse/admin/v1/retention/run
     */
    async runRetention(roomId?: string): Promise<RetentionRunResult> {
        return await this.adminRequest(Method.Post, "/v1/retention/run", undefined, {
            room_id: roomId,
        });
    }

    async getRetentionStatus(): Promise<RetentionStatus> {
        return await this.adminRequest(Method.Get, "/v1/retention/status");
    }

    // ===== 审计事件 =====

    /**
     * 列出审计事件
     * 对接: GET /_synapse/admin/v1/audit/events
     */
    async listAuditEvents(params: {
        actor_id?: string;
        action?: string;
        resource_type?: string;
        resource_id?: string;
        result?: string;
        limit?: number;
        from?: number;
    } = {}): Promise<AuditEventPage> {
        const query: Record<string, string> = {};
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== null) query[k] = String(v);
        }
        return await this.adminRequest(Method.Get, "/v1/audit/events", query);
    }

    async getAuditEvent(eventId: string): Promise<AuditEvent> {
        if (!eventId) throw new ValidationError("eventId is required");
        return await this.adminRequest(Method.Get, `/v1/audit/events/${encodeURIComponent(eventId)}`);
    }

    async createAuditEvent(event: {
        actor_id: string;
        action: string;
        resource_type: string;
        resource_id: string;
        result: string;
        request_id: string;
        details?: Record<string, unknown>;
    }): Promise<AuditEvent> {
        return await this.adminRequest(Method.Post, "/v1/audit/events", undefined, event);
    }

    // ===== 媒体配额 =====

    /**
     * 获取媒体配额统计
     * 对接: GET /_synapse/admin/v1/media/quota
     */
    async getMediaQuota(): Promise<{
        total_size: number;
        total_count: number;
        default_size_limit: number;
        default_count_limit: number;
    }> {
        return await this.adminRequest(Method.Get, "/v1/media/quota");
    }

    // ===== 特性开关 =====

    /**
     * 列出特性开关
     * 对接: GET /_synapse/admin/v1/feature-flags
     */
    async listFeatureFlags(params: {
        target_scope?: string;
        status?: string;
        limit?: number;
        offset?: number;
    } = {}): Promise<FeatureFlagPage> {
        const query: Record<string, string> = {};
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== null) query[k] = String(v);
        }
        return await this.adminRequest(Method.Get, "/v1/feature-flags", query);
    }

    async getFeatureFlag(flagKey: string): Promise<FeatureFlag> {
        if (!flagKey) throw new ValidationError("flagKey is required");
        return await this.adminRequest(Method.Get, `/v1/feature-flags/${encodeURIComponent(flagKey)}`);
    }

    async createFeatureFlag(flag: {
        flag_key: string;
        target_scope: string;
        rollout_percent: number;
        expires_at?: number | null;
        reason: string;
        status?: string;
        targets?: FeatureFlagTarget[];
    }): Promise<FeatureFlag> {
        return await this.adminRequest(Method.Post, "/v1/feature-flags", undefined, flag);
    }

    async updateFeatureFlag(
        flagKey: string,
        patch: {
            rollout_percent?: number;
            expires_at?: number | null;
            reason?: string;
            status?: string;
            targets?: FeatureFlagTarget[];
        },
    ): Promise<FeatureFlag> {
        if (!flagKey) throw new ValidationError("flagKey is required");
        return await this.adminRequest(
            Method.Patch,
            `/v1/feature-flags/${encodeURIComponent(flagKey)}`,
            undefined,
            patch,
        );
    }

    // ===== 事件举报限流 =====

    /**
     * 检查用户的事件举报限流状态
     * 对接: GET /_synapse/admin/v1/event_reports/rate_limit/{user_id}
     */
    async checkEventReportRateLimit(userId: string): Promise<{
        is_allowed: boolean;
        remaining_reports: number;
        block_reason: string | null;
    }> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(
            Method.Get,
            `/v1/event_reports/rate_limit/${encodeURIComponent(userId)}`,
        );
    }

    /**
     * 阻止用户提交事件举报
     * 对接: POST /_synapse/admin/v1/event_reports/rate_limit/{user_id}/block
     */
    async blockEventReportUser(
        userId: string,
        body: { blocked_until: number; reason: string },
    ): Promise<void> {
        AdminValidators.validateUserId(userId);
        await this.adminRequest(
            Method.Post,
            `/v1/event_reports/rate_limit/${encodeURIComponent(userId)}/block`,
            undefined,
            body,
        );
    }

    /**
     * 解除用户事件举报阻止
     * 对接: POST /_synapse/admin/v1/event_reports/rate_limit/{user_id}/unblock
     */
    async unblockEventReportUser(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        await this.adminRequest(
            Method.Post,
            `/v1/event_reports/rate_limit/${encodeURIComponent(userId)}/unblock`,
        );
    }

    // ===== 遥测告警 =====

    /**
     * 列出遥测告警
     * 对接: GET /_synapse/admin/v1/telemetry/alerts
     */
    async listTelemetryAlerts(params: {
        status?: string;
        severity?: string;
        refresh?: boolean;
    } = {}): Promise<{ alerts: Array<Record<string, unknown>> }> {
        const q: Record<string, string> = {};
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== null) q[k] = String(v);
        }
        return await this.adminRequest(Method.Get, "/v1/telemetry/alerts", q);
    }

    /**
     * 确认遥测告警
     * 对接: POST /_synapse/admin/v1/telemetry/alerts/{alert_id}/ack
     */
    async acknowledgeTelemetryAlert(alertId: string): Promise<Record<string, unknown>> {
        if (!alertId) throw new ValidationError("alertId is required");
        return await this.adminRequest(
            Method.Post,
            `/v1/telemetry/alerts/${encodeURIComponent(alertId)}/ack`,
        );
    }

    // ===== 模块管理 =====

    /** GET /_synapse/admin/v1/modules */
    async listModules(): Promise<{ modules: Array<Record<string, unknown>> }> {
        return await this.adminRequest(Method.Get, "/v1/modules");
    }

    /** GET /_synapse/admin/v1/modules/type/{module_type} */
    async listModulesByType(
        moduleType: string,
    ): Promise<{ modules: Array<Record<string, unknown>> }> {
        if (!moduleType) throw new ValidationError("moduleType is required");
        return await this.adminRequest(
            Method.Get,
            `/v1/modules/type/${encodeURIComponent(moduleType)}`,
        );
    }

    /** GET /_synapse/admin/v1/modules/{module_name} */
    async getModule(moduleName: string): Promise<Record<string, unknown>> {
        if (!moduleName) throw new ValidationError("moduleName is required");
        return await this.adminRequest(
            Method.Get,
            `/v1/modules/${encodeURIComponent(moduleName)}`,
        );
    }

    /** POST /_synapse/admin/v1/modules */
    async createModule(module: Record<string, unknown>): Promise<Record<string, unknown>> {
        return await this.adminRequest(Method.Post, "/v1/modules", undefined, module);
    }

    /** POST /_synapse/admin/v1/modules/{module_name}/config */
    async updateModuleConfig(
        moduleName: string,
        config: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        if (!moduleName) throw new ValidationError("moduleName is required");
        return await this.adminRequest(
            Method.Post,
            `/v1/modules/${encodeURIComponent(moduleName)}/config`,
            undefined,
            config,
        );
    }

    /** POST /_synapse/admin/v1/modules/{module_name}/enable */
    async setModuleEnabled(
        moduleName: string,
        enabled: boolean,
    ): Promise<Record<string, unknown>> {
        if (!moduleName) throw new ValidationError("moduleName is required");
        return await this.adminRequest(
            Method.Post,
            `/v1/modules/${encodeURIComponent(moduleName)}/enable`,
            undefined,
            { enabled },
        );
    }

    /** DELETE /_synapse/admin/v1/modules/{module_name} */
    async deleteModule(moduleName: string): Promise<void> {
        if (!moduleName) throw new ValidationError("moduleName is required");
        await this.adminRequest(
            Method.Delete,
            `/v1/modules/${encodeURIComponent(moduleName)}`,
        );
    }

    /** POST /_synapse/admin/v1/modules/check_spam */
    async checkModuleSpam(
        body: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        return await this.adminRequest(Method.Post, "/v1/modules/check_spam", undefined, body);
    }

    /** GET /_synapse/admin/v1/modules/logs/{module_name} */
    async getModuleLogs(
        moduleName: string,
        params?: { limit?: number; from?: number | string },
    ): Promise<Record<string, unknown>> {
        if (!moduleName) throw new ValidationError("moduleName is required");
        const q: Record<string, string> = {};
        if (params?.limit !== undefined) q.limit = String(params.limit);
        if (params?.from !== undefined) q.from = String(params.from);
        return await this.adminRequest(
            Method.Get,
            `/v1/modules/logs/${encodeURIComponent(moduleName)}`,
            q,
        );
    }

    // ===== SAML 映射 =====

    /** GET /_synapse/admin/v1/saml/mappings */
    async listSamlMappings(params: { limit?: number; from?: string } = {}): Promise<SamlMappingPage> {
        const q: Record<string, string> = {};
        if (params.limit !== undefined) q.limit = String(params.limit);
        if (params.from !== undefined) q.from = params.from;
        return await this.adminRequest(Method.Get, "/v1/saml/mappings", q);
    }

    /** GET /_synapse/admin/v1/saml/mapping/{name_id} */
    async getSamlMapping(nameId: string): Promise<SamlMapping> {
        if (!nameId) throw new ValidationError("nameId is required");
        return await this.adminRequest(
            Method.Get,
            `/v1/saml/mapping/${encodeURIComponent(nameId)}`,
        );
    }

    /** PUT /_synapse/admin/v1/saml/mapping/{name_id} */
    async updateSamlMapping(nameId: string, updates: Record<string, unknown>): Promise<void> {
        if (!nameId) throw new ValidationError("nameId is required");
        await this.adminRequest(
            Method.Put,
            `/v1/saml/mapping/${encodeURIComponent(nameId)}`,
            undefined,
            updates,
        );
    }

    /** DELETE /_synapse/admin/v1/saml/mapping/{name_id} */
    async deleteSamlMapping(nameId: string): Promise<void> {
        if (!nameId) throw new ValidationError("nameId is required");
        await this.adminRequest(
            Method.Delete,
            `/v1/saml/mapping/${encodeURIComponent(nameId)}`,
        );
    }

    /** POST /_synapse/admin/v1/saml/logout */
    async samlLogout(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        await this.adminRequest(Method.Post, "/v1/saml/logout", undefined, { user_id: userId });
    }

    // ===== Application Services =====

    /** GET /_synapse/admin/v1/appservices */
    async listApplicationServices(
        params: { limit?: number; from?: string } = {},
    ): Promise<ApplicationServicePage> {
        const q: Record<string, string> = {};
        if (params.limit !== undefined) q.limit = String(params.limit);
        if (params.from !== undefined) q.from = params.from;
        return await this.adminRequest(Method.Get, "/v1/appservices", q);
    }

    /** POST /_synapse/admin/v1/appservices */
    async registerApplicationService(
        asToken: string,
        config: Record<string, unknown>,
    ): Promise<ApplicationServiceInfo> {
        if (!asToken) throw new ValidationError("asToken is required");
        return await this.adminRequest(
            Method.Post,
            "/v1/appservices",
            undefined,
            { as_token: asToken, ...config },
        );
    }

    /** GET /_synapse/admin/v1/appservices/{service_id} */
    async getApplicationService(serviceId: string): Promise<ApplicationServiceInfo> {
        if (!serviceId) throw new ValidationError("serviceId is required");
        return await this.adminRequest(
            Method.Get,
            `/v1/appservices/${encodeURIComponent(serviceId)}`,
        );
    }

    /** PUT /_synapse/admin/v1/appservices/{service_id} */
    async updateApplicationService(
        serviceId: string,
        config: Record<string, unknown>,
    ): Promise<void> {
        if (!serviceId) throw new ValidationError("serviceId is required");
        await this.adminRequest(
            Method.Put,
            `/v1/appservices/${encodeURIComponent(serviceId)}`,
            undefined,
            config,
        );
    }

    /** DELETE /_synapse/admin/v1/appservices/{service_id} */
    async deleteApplicationService(serviceId: string): Promise<void> {
        if (!serviceId) throw new ValidationError("serviceId is required");
        await this.adminRequest(
            Method.Delete,
            `/v1/appservices/${encodeURIComponent(serviceId)}`,
        );
    }

    /** POST /_synapse/admin/v1/appservices/{service_id}/ping */
    async pingApplicationService(serviceId: string): Promise<ApplicationServicePingResult> {
        if (!serviceId) throw new ValidationError("serviceId is required");
        return await this.adminRequest(
            Method.Post,
            `/v1/appservices/${encodeURIComponent(serviceId)}/ping`,
        );
    }

    // ===== 系统通知 CRUD =====

    /** POST /_synapse/admin/v1/notifications */
    async createSystemNotification(body: {
        content: string;
        type?: string;
        target_users?: string[];
    }): Promise<{ notification_id: string }> {
        if (!body.content) throw new ValidationError("content is required");
        return await this.adminRequest(Method.Post, "/v1/notifications", undefined, body);
    }

    /** GET /_synapse/admin/v1/notifications */
    async listSystemNotifications(
        params: { limit?: number; from?: string } = {},
    ): Promise<SystemNotificationPage> {
        const q: Record<string, string> = {};
        if (params.limit !== undefined) q.limit = String(params.limit);
        if (params.from !== undefined) q.from = params.from;
        return await this.adminRequest(Method.Get, "/v1/notifications", q);
    }

    /** GET /_synapse/admin/v1/notifications/{notification_id} */
    async getSystemNotification(notificationId: string): Promise<SystemNotificationInfo> {
        if (!notificationId) throw new ValidationError("notificationId is required");
        return await this.adminRequest(
            Method.Get,
            `/v1/notifications/${encodeURIComponent(notificationId)}`,
        );
    }

    /** PUT /_synapse/admin/v1/notifications/{notification_id} */
    async updateSystemNotification(
        notificationId: string,
        updates: Record<string, unknown>,
    ): Promise<void> {
        if (!notificationId) throw new ValidationError("notificationId is required");
        await this.adminRequest(
            Method.Put,
            `/v1/notifications/${encodeURIComponent(notificationId)}`,
            undefined,
            updates,
        );
    }

    /** DELETE /_synapse/admin/v1/notifications/{notification_id} */
    async deleteSystemNotification(notificationId: string): Promise<void> {
        if (!notificationId) throw new ValidationError("notificationId is required");
        await this.adminRequest(
            Method.Delete,
            `/v1/notifications/${encodeURIComponent(notificationId)}`,
        );
    }

    // ===== 用户通知设置 / Pushers =====

    /** GET /_synapse/admin/v1/users/{user_id}/notification */
    async getUserNotificationSettings(userId: string): Promise<Record<string, unknown>> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(
            Method.Get,
            `/v1/users/${encodeURIComponent(userId)}/notification`,
        );
    }

    /** PUT /_synapse/admin/v1/users/{user_id}/notification */
    async setUserNotificationSettings(
        userId: string,
        settings: Record<string, unknown>,
    ): Promise<void> {
        AdminValidators.validateUserId(userId);
        await this.adminRequest(
            Method.Put,
            `/v1/users/${encodeURIComponent(userId)}/notification`,
            undefined,
            settings,
        );
    }

    /** GET /_synapse/admin/v1/users/{user_id}/pushers */
    async listUserPushers(userId: string): Promise<{ pushers: UserPusher[] }> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(
            Method.Get,
            `/v1/users/${encodeURIComponent(userId)}/pushers`,
        );
    }

    /** DELETE /_synapse/admin/v1/users/{user_id}/pushers/{pushkey} */
    async deleteUserPusher(userId: string, pushkey: string, appId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        if (!pushkey) throw new ValidationError("pushkey is required");
        if (!appId) throw new ValidationError("appId is required");
        await this.adminRequest(
            Method.Delete,
            `/v1/users/${encodeURIComponent(userId)}/pushers/${encodeURIComponent(pushkey)}`,
            undefined,
            { app_id: appId },
        );
    }

    // ===== Spaces 管理 =====

    /** GET /_synapse/admin/v1/spaces */
    async listSpaces(params: { limit?: number; from?: string } = {}): Promise<SpacePage> {
        const q: Record<string, string> = {};
        if (params.limit !== undefined) q.limit = String(params.limit);
        if (params.from !== undefined) q.from = params.from;
        return await this.adminRequest(Method.Get, "/v1/spaces", q);
    }

    /** GET /_synapse/admin/v1/spaces/{space_id}/users — 对象形态（与已存在的 `getSpaceUsers` 字符串数组形态并存） */
    async listSpaceUsers(spaceId: string): Promise<{ users: SpaceUser[] }> {
        if (!spaceId) throw new ValidationError("spaceId is required");
        return await this.adminRequest(
            Method.Get,
            `/v1/spaces/${encodeURIComponent(spaceId)}/users`,
        );
    }

    /** GET /_synapse/admin/v1/spaces/{space_id}/rooms — 对象形态（与已存在的 `getSpaceRooms` 字符串数组形态并存） */
    async listSpaceRooms(spaceId: string): Promise<{ rooms: SpaceRoom[] }> {
        if (!spaceId) throw new ValidationError("spaceId is required");
        return await this.adminRequest(
            Method.Get,
            `/v1/spaces/${encodeURIComponent(spaceId)}/rooms`,
        );
    }

    // ===== Security =====

    /** GET /_synapse/admin/v1/security/events */
    async listSecurityEvents(
        params: { limit?: number; from?: string } & Record<string, unknown> = {},
    ): Promise<SecurityEventPage> {
        const q: Record<string, string> = {};
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== null) q[k] = String(v);
        }
        return await this.adminRequest(Method.Get, "/v1/security/events", q);
    }

    /** GET /_synapse/admin/v1/security/ip/blocks */
    async listIpBlocks(): Promise<IpBlock[]> {
        return await this.adminRequest(Method.Get, "/v1/security/ip/blocks");
    }

    /** POST /_synapse/admin/v1/security/ip/block */
    async blockIp(
        ip: string,
        options?: { cidr?: number; expire_at?: number; reason?: string },
    ): Promise<IpBlock> {
        if (!ip) throw new ValidationError("ip is required");
        return await this.adminRequest(
            Method.Post,
            "/v1/security/ip/block",
            undefined,
            { ip, ...(options ?? {}) },
        );
    }

    /** POST /_synapse/admin/v1/security/ip/unblock */
    async unblockIp(ip: string): Promise<void> {
        if (!ip) throw new ValidationError("ip is required");
        await this.adminRequest(Method.Post, "/v1/security/ip/unblock", undefined, { ip });
    }

    /** GET /_synapse/admin/v1/security/ip/reputation/{ip} */
    async getIpReputation(ip: string): Promise<Record<string, unknown>> {
        if (!ip) throw new ValidationError("ip is required");
        return await this.adminRequest(
            Method.Get,
            `/v1/security/ip/reputation/${encodeURIComponent(ip)}`,
        );
    }

    // ===== Server 运维 =====

    /** POST /_synapse/admin/v1/restart */
    async restartServer(): Promise<void> {
        await this.adminRequest(Method.Post, "/v1/restart");
    }

    /** GET /_synapse/admin/v1/logs */
    async getServerLogs(params: { level?: string; limit?: number } = {}): Promise<ServerLogEntry[]> {
        const q: Record<string, string> = {};
        if (params.level !== undefined) q.level = params.level;
        if (params.limit !== undefined) q.limit = String(params.limit);
        return await this.adminRequest(Method.Get, "/v1/logs", q);
    }

    /** GET /_synapse/admin/v1/media_stats */
    async getMediaStats(): Promise<Record<string, unknown>> {
        return await this.adminRequest(Method.Get, "/v1/media_stats");
    }

    // ===== Room 扩展（Batch 8） =====

    /** PUT/DELETE /_synapse/admin/v1/rooms/{room_id}/listings/public */
    async setRoomPublicListing(roomId: string, isPublic: boolean): Promise<void> {
        if (!roomId) throw new ValidationError("roomId is required");
        const method = isPublic ? Method.Put : Method.Delete;
        await this.adminRequest(
            method,
            `/v1/rooms/${encodeURIComponent(roomId)}/listings/public`,
        );
    }

    /** GET /_synapse/admin/v1/rooms/{room_id}/event_context/{event_id} */
    async getRoomEventContext(
        roomId: string,
        eventId: string,
    ): Promise<Record<string, unknown>> {
        if (!roomId) throw new ValidationError("roomId is required");
        if (!eventId) throw new ValidationError("eventId is required");
        return await this.adminRequest(
            Method.Get,
            `/v1/rooms/${encodeURIComponent(roomId)}/event_context/${encodeURIComponent(eventId)}`,
        );
    }

    /** POST /_synapse/admin/v1/rooms/{room_id}/search */
    async searchInRoom(
        roomId: string,
        searchTerm: string,
        limit = 50,
    ): Promise<{ results: Array<Record<string, unknown>>; next_batch?: string }> {
        if (!roomId) throw new ValidationError("roomId is required");
        if (!searchTerm) throw new ValidationError("searchTerm is required");
        return await this.adminRequest(
            Method.Post,
            `/v1/rooms/${encodeURIComponent(roomId)}/search`,
            undefined,
            { search_term: searchTerm, limit },
        );
    }

    /** POST /_synapse/admin/v1/rooms/search */
    async searchRooms(
        searchTerm: string,
        limit = 50,
    ): Promise<{ rooms: Array<Record<string, unknown>>; next_batch?: string }> {
        if (!searchTerm) throw new ValidationError("searchTerm is required");
        return await this.adminRequest(
            Method.Post,
            "/v1/rooms/search",
            undefined,
            { search_term: searchTerm, limit },
        );
    }

    /** DELETE /_synapse/admin/v1/rooms/{room_id} with body */
    async deleteRoomV2(
        roomId: string,
        options?: {
            purge?: boolean;
            force?: boolean;
            new_room_user_id?: string;
            room_name?: string;
            message?: string;
            block?: boolean;
        },
    ): Promise<{
        kicked_users: string[];
        failed_to_kick_users: string[];
        local_aliases: string[];
        new_room_id?: string;
    }> {
        if (!roomId) throw new ValidationError("roomId is required");
        return await this.adminRequest(
            Method.Delete,
            `/v1/rooms/${encodeURIComponent(roomId)}`,
            undefined,
            options ?? {},
        );
    }

    /** GET /_synapse/admin/v1/room_stats (paginated list) — 区别于已存在的 `getRoomStats(roomId)` 和 `getAllRoomStats()` 聚合 */
    async listRoomStats(
        params: { limit?: number; from?: string } = {},
    ): Promise<{ room_stats: Array<Record<string, unknown>>; next_token?: string }> {
        const q: Record<string, string> = {};
        if (params.limit !== undefined) q.limit = String(params.limit);
        if (params.from !== undefined) q.from = params.from;
        return await this.adminRequest(Method.Get, "/v1/room_stats", q);
    }

    /** POST /_synapse/admin/v1/purge_history — 全局端点，body 里携带 room_id；区别于 room-level `purgeRoomHistory` */
    async purgeHistoryGlobal(
        roomId: string,
        options?: {
            purge_up_to_event_id?: string;
            purge_up_to_ts?: number;
            delete_local_events?: boolean;
        },
    ): Promise<{ purge_id: string }> {
        if (!roomId) throw new ValidationError("roomId is required");
        return await this.adminRequest(
            Method.Post,
            "/v1/purge_history",
            undefined,
            { room_id: roomId, ...(options ?? {}) },
        );
    }

    // ===== Batch 9: 用户批量 / 登录失败 / SAML 配置 / 备份 / 实验特性 =====

    /** GET /_synapse/admin/v1/user_stats — 用户统计分页列表 */
    async listUserStats(
        params: { limit?: number; from?: string } = {},
    ): Promise<{ user_stats: Array<Record<string, unknown>>; next_token?: string }> {
        const q: Record<string, string> = {};
        if (params.limit !== undefined) q.limit = String(params.limit);
        if (params.from !== undefined) q.from = params.from;
        return await this.adminRequest(Method.Get, "/v1/user_stats", q);
    }

    /** GET /_synapse/admin/v1/login/failures */
    async listLoginFailures(
        params: { limit?: number; from?: string } = {},
    ): Promise<{ failures: Array<Record<string, unknown>>; next_token?: string }> {
        const q: Record<string, string> = {};
        if (params.limit !== undefined) q.limit = String(params.limit);
        if (params.from !== undefined) q.from = params.from;
        return await this.adminRequest(Method.Get, "/v1/login/failures", q);
    }

    /** GET /_matrix/client/r0/saml/metadata */
    async getSamlMetadata(): Promise<SamlMetadata> {
        return await this.rawRequest(Method.Get, "/_matrix/client/r0/saml/metadata", undefined, undefined, "getSamlMetadata");
    }

    /** GET /_matrix/client/r0/saml/sp_metadata */
    async getSpMetadata(): Promise<Blob> {
        return await this.rawRequest(Method.Get, "/_matrix/client/r0/saml/sp_metadata", undefined, undefined, "getSpMetadata", true);
    }

    /** POST /_synapse/admin/v1/saml/metadata/refresh */
    async refreshIdpMetadata(): Promise<SamlMetadata> {
        return await this.adminRequest(Method.Post, "/v1/saml/metadata/refresh", undefined, undefined, "refreshIdpMetadata");
    }

    /** GET /_synapse/admin/v1/saml/config */
    async getSamlConfig(): Promise<Record<string, unknown>> {
        return await this.adminRequest(Method.Get, "/v1/saml/config");
    }

    /** PUT /_synapse/admin/v1/saml/config */
    async updateSamlConfig(config: Record<string, unknown>): Promise<void> {
        await this.adminRequest(Method.Put, "/v1/saml/config", undefined, config);
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
