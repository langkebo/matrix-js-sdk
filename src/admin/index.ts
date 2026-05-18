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
import { MatrixError } from "../http-api/errors";
import { logger } from "../logger";
import { MatrixClient } from "../client";
import { getOrCreateManager } from "../client-infra/manager-registry";
import { NotFoundError, ValidationError } from "../errors";
import { BaseManager } from "../managers/base-manager";
import { AdminValidators } from "./validators";
import { buildPaginationParams, buildQueryParams } from "./utils";
import type { AdminPathPattern } from "./__generated__/route-table";
import {
    AdminEvent,
    type DeviceInfo,
    type MediaInfo,
    type RoomStateEvent,
    type RoomMessage,
    type UserInfo,
    type RoomInfo,
    type ServerStats,
    type ServerStatus,
    type ServerHealth,
    type ServerInfo,
    type AdminCleanupResponse,
    type AccountStatus,
    type ServerNotice,
    type FederationBlacklistEntry,
    type RegistrationToken,
    type FederationDestination,
    type FederationAdmissionResult,
    type PendingFederationList,
    type RoomStats,
    type WhoisResponse,
    type RetentionPolicy,
    type RoomRetentionPolicy,
    type RetentionRunResult,
    type RetentionStatus,
    type FeatureFlagTarget,
    type FeatureFlag,
    type FeatureFlagPage,
    type SystemNotificationInfo,
    type SystemNotificationPage,
    type UserPusher,
    type SpacePage,
    type SpaceUser,
    type SpaceRoom,
    type PaginatedResponse,
} from "./types";

export * from "./types";

type StripAdminPath<P extends string> =
    P extends `/_synapse/admin${infer Rest}` ? Rest : never;

function ap<P extends StripAdminPath<AdminPathPattern>>(path: P): P {
    return path;
}

function apu(path: string): string {
    return path;
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

export class AdminManager extends BaseManager<AdminEvent, AdminManagerEventMap> {
    private serverStats: ServerStats | null = null;

    constructor(client: MatrixClient) {
        super(client);
    }

    protected async adminRequest<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, string | string[]>,
        body?: Record<string, unknown>,
        label?: string,
    ): Promise<T> {
        try {
            return await super.adminRequest<T>(method, path, queryParams, body, label);
        } catch (err) {
            const error = this.normalizeError(err, label ?? "unknown");
            this.emit(AdminEvent.AdminError, error);
            throw error;
        }
    }

    private async v2Request<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, string | string[]>,
        body?: Record<string, unknown>,
        label?: string,
    ): Promise<T> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<T>(
                    method,
                    path,
                    queryParams,
                    body,
                    { prefix: "/_synapse/admin" },
                );
            }, label ?? "v2Request");
        } catch (err) {
            const error = this.normalizeError(err, label ?? "unknown");
            this.emit(AdminEvent.AdminError, error);
            throw error;
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
    async getUsers(from?: string, limit?: number): Promise<{ users: UserInfo[]; next_token?: string; total?: number }> {
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
    async getUsersPaginated(options?: { from?: string; limit?: number }): Promise<PaginatedResponse<UserInfo>> {
        if (options?.limit !== undefined) {
            AdminValidators.validateLimit(options.limit);
        }

        const queryParams = buildPaginationParams(options?.from, options?.limit);
        let response: {
            users: UserInfo[];
            next_token?: string;
            total?: number;
        };
        try {
            response = await this.v2Request<{
                users: UserInfo[];
                next_token?: string;
                total?: number;
            }>(Method.Get, "/v2/users", buildQueryParams(queryParams));
        } catch (e) {
            const err = e as MatrixError;
            if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                response = await this.adminRequest<{
                    users: UserInfo[];
                    next_token?: string;
                    total?: number;
                }>(Method.Get, "/users", buildQueryParams(queryParams));
            } else {
                throw e;
            }
        }

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
            try {
                return await this.v2Request<UserInfo>(
                    Method.Get,
                    `/v2/users/${encodeURIComponent(userId)}`,
                    undefined,
                    undefined,
                    "getUser",
                );
            } catch (e) {
                const err = e as MatrixError;
                if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                    return await this.adminRequest<UserInfo>(
                        Method.Get,
                        `/users/${encodeURIComponent(userId)}`,
                        undefined,
                        undefined,
                        "getUser",
                    );
                }
                throw e;
            }
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

        const user = await this.v2Request<UserInfo>(
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

        await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/deactivate`);
        this.emit(AdminEvent.UserDeactivated, userId);
    }

    async deleteUser(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        try {
            await this.adminRequest(Method.Delete, `/users/${encodeURIComponent(userId)}`);
        } catch (e) {
            const err = e as MatrixError;
            if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                await this.v2Request(Method.Delete, `/v2/users/${encodeURIComponent(userId)}`);
                return;
            }
            throw e;
        }
    }

    async batchCreateUsers(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
        return await this.adminRequest(Method.Post, "/users/batch", {}, payload);
    }

    async batchDeactivateUsers(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
        return await this.adminRequest(Method.Post, "/users/batch_deactivate", {}, payload);
    }

    /**
     * 重置用户密码
     * 对接: POST /_synapse/admin/v1/users/{user_id}/password body={new_password}
     * 注意：当前后端不支持 `logout_devices`，仅重置密码。
     */
    async resetPassword(userId: string, newPassword: string): Promise<void> {
        AdminValidators.validateUserId(userId);

        await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/password`, undefined, {
            new_password: newPassword,
        });
    }

    /**
     * 设置用户管理员权限
     * 对接: PUT /_synapse/admin/v1/users/{user_id}/admin  body={admin}
     */
    async setAdmin(userId: string, admin: boolean): Promise<void> {
        AdminValidators.validateUserId(userId);
        await this.adminRequest(Method.Put, `/users/${encodeURIComponent(userId)}/admin`, undefined, { admin });
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
        let response: { devices: DeviceInfo[] };
        try {
            response = await this.adminRequest<{ devices: DeviceInfo[] }>(
                Method.Get,
                `/users/${encodeURIComponent(userId)}/devices`,
            );
        } catch (e) {
            const err = e as MatrixError;
            if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                response = await this.v2Request<{ devices: DeviceInfo[] }>(
                    Method.Get,
                    `/v2/users/${encodeURIComponent(userId)}/devices`,
                );
            } else {
                throw e;
            }
        }
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
        await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/devices/delete`, undefined, {
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
        AdminValidators.validateUserId(userId);
        if (!deviceId) throw new ValidationError("Device ID is required");
        try {
            await this.adminRequest(Method.Delete, `/users/${encodeURIComponent(userId)}/devices/${encodeURIComponent(deviceId)}`);
        } catch (e) {
            const err = e as MatrixError;
            if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                await this.adminRequest(
                    Method.Post,
                    `/users/${encodeURIComponent(userId)}/devices/${encodeURIComponent(deviceId)}/delete`,
                    {},
                    undefined,
                );
                return;
            }
            throw e;
        }
    }

    async getUserTokens(userId: string): Promise<{ tokens: Record<string, unknown>[] }> {
        AdminValidators.validateUserId(userId);
        const response = await this.adminRequest<{ tokens?: Record<string, unknown>[] }>(
            Method.Get,
            `/users/${encodeURIComponent(userId)}/tokens`,
        );
        return { tokens: response.tokens || [] };
    }

    async deleteUserToken(userId: string, tokenId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        if (!tokenId) throw new ValidationError("Token ID is required");
        await this.adminRequest(
            Method.Delete,
            `/users/${encodeURIComponent(userId)}/tokens/${encodeURIComponent(tokenId)}`,
        );
    }

    async getUserRefreshTokens(userId: string): Promise<{ refresh_tokens: Record<string, unknown>[] }> {
        AdminValidators.validateUserId(userId);
        const response = await this.adminRequest<{ refresh_tokens?: Record<string, unknown>[] }>(
            Method.Get,
            `/users/${encodeURIComponent(userId)}/refresh_tokens`,
        );
        return { refresh_tokens: response.refresh_tokens || [] };
    }

    async deleteUserRefreshToken(userId: string, tokenId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        if (!tokenId) throw new ValidationError("Token ID is required");
        await this.adminRequest(
            Method.Delete,
            `/users/${encodeURIComponent(userId)}/refresh_tokens/${encodeURIComponent(tokenId)}`,
        );
    }

    async getUserSession(userId: string): Promise<Record<string, unknown>> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Get, `/user_sessions/${encodeURIComponent(userId)}`);
    }

    async getUserRooms(userId: string, from?: string, limit?: number): Promise<Record<string, unknown>> {
        AdminValidators.validateUserId(userId);
        const query = buildPaginationParams(from, limit);
        return await this.adminRequest(Method.Get, `/users/${encodeURIComponent(userId)}/rooms`, query);
    }

    async getUserStats(userId: string): Promise<Record<string, unknown>> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Get, `/users/${encodeURIComponent(userId)}/stats`);
    }

    async listUserStats(from?: string, limit?: number): Promise<Record<string, unknown>> {
        const query = buildPaginationParams(from, limit);
        return await this.adminRequest(Method.Get, "/user_stats", query);
    }

    async invalidateUserSession(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        await this.adminRequest(Method.Post, `/user_sessions/${encodeURIComponent(userId)}/invalidate`, {}, undefined);
    }

    async loginAsUser(userId: string, payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/login`, {}, payload ?? {});
    }

    async logoutUser(userId: string, payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/logout`, {}, payload ?? {});
    }

    async evictUser(userId: string, payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/evict`, {}, payload ?? {});
    }

    /**
     * 获取账户状态
     *
     * @param userId - 用户 ID
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 账户状态
     */
    async getAccountStatus(userId: string, throwOnError = true): Promise<AccountStatus | null> {
        AdminValidators.validateUserId(userId);
        try {
            return await this.adminRequest<AccountStatus>(Method.Get, `/account/${encodeURIComponent(userId)}`);
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
                `/users/${encodeURIComponent(userId)}/admin`,
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
        await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/override_ratelimit`);
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
                `/users/${encodeURIComponent(userId)}/override_ratelimit`,
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
        await this.adminRequest(Method.Delete, `/users/${encodeURIComponent(userId)}/override_ratelimit`);
    }

    // ===== Retention Policy =====

    /**
     * 获取服务器默认保留策略
     *
     * @returns 保留策略
     */
    async getRetentionPolicy(): Promise<RetentionPolicy> {
        return await this.adminRequest<RetentionPolicy>(Method.Get, apu("/retention/policy"));
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
        return await this.adminRequest<RetentionPolicy>(Method.Post, apu("/retention/policy"), undefined, policy);
    }

    /**
     * 获取房间的保留策略
     * 对接: GET /_synapse/admin/v1/retention/policy/{room_id}
     */
    async getRoomRetentionPolicy(roomId: string): Promise<RoomRetentionPolicy> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest<RoomRetentionPolicy>(
            Method.Get,
            apu(`/retention/policy/${encodeURIComponent(roomId)}`),
        );
    }

    /**
     * 设置房间的保留策略
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
        return await this.adminRequest<RoomRetentionPolicy>(
            Method.Post,
            apu(`/retention/policy/${encodeURIComponent(roomId)}`),
            undefined,
            policy,
        );
    }

    /**
     * 触发保留策略运行
     * 对接: POST /_synapse/admin/v1/retention/run
     */
    async runRetention(options?: {
        room_id?: string;
        scope?: "all" | "room";
    }): Promise<RetentionRunResult> {
        return await this.adminRequest<RetentionRunResult>(
            Method.Post,
            apu("/retention/run"),
            undefined,
            options || {},
        );
    }

    /**
     * 获取保留策略运行状态
     * 对接: GET /_synapse/admin/v1/retention/status
     */
    async getRetentionStatus(): Promise<RetentionStatus> {
        return await this.adminRequest<RetentionStatus>(Method.Get, apu("/retention/status"));
    }

    // Deprecated getRooms method
    /**
     * 获取房间列表（支持分页）
     *
     * @param from - 分页起点 token
     * @param limit - 返回房间数量限制
     * @param search - 房间名称或别名搜索关键词
     * @param order_by - 排序字段 (e.g., "name", "joined_members")
     * @param sort_order - 排序顺序 ("asc" 或 "desc")
     * @returns 房间列表和下一页 token
     *
     * @deprecated Use {@link getRoomsPaginated} for consistent pagination format
     */
    async getRooms(
        from?: string,
        limit?: number,
        search?: string,
        order_by?: string,
        sort_order?: "asc" | "desc",
    ): Promise<{ rooms: RoomInfo[]; next_token?: string; total?: number }> {
        const paginated = await this.getRoomsPaginated({ from, limit, search, order_by, sort_order });
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
     * @param options.search - 房间名称或别名搜索关键词
     * @param options.order_by - 排序字段 (e.g., "name", "joined_members")
     * @param options.sort_order - 排序顺序 ("asc" 或 "desc")
     * @returns 统一格式的分页响应
     */
    async getRoomsPaginated(options?: {
        from?: string;
        limit?: number;
        search?: string;
        order_by?: string;
        sort_order?: "asc" | "desc";
    }): Promise<PaginatedResponse<RoomInfo>> {
        if (options?.limit !== undefined) {
            AdminValidators.validateLimit(options.limit);
        }

        const queryParams = buildPaginationParams(options?.from, options?.limit);
        if (options?.search) {
            queryParams.search = options.search;
            queryParams.search_term = options.search;
        }
        if (options?.order_by) {
            queryParams.order_by = options.order_by;
        }
        if (options?.sort_order) {
            queryParams.sort_order = options.sort_order;
        }

        const response = await this.adminRequest<{
            rooms: RoomInfo[];
            next_token?: string;
            total?: number;
        }>(Method.Get, "/rooms", buildQueryParams(queryParams));

        return {
            items: response.rooms || [],
            nextToken: response.next_token,
            total: response.total,
        };
    }

    async searchRooms(options?: Record<string, string | number | boolean | undefined>): Promise<Record<string, unknown>> {
        const query: Record<string, string> = {};
        if (options) {
            for (const [k, v] of Object.entries(options)) {
                if (v !== undefined && v !== null) query[k] = String(v);
            }
        }
        return await this.adminRequest(Method.Get, "/rooms/search", query);
    }

    async searchRoomsPost(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
        return await this.adminRequest(Method.Post, "/rooms/search", {}, payload);
    }

    /**
     * 获取房间详情
     *
     * @param roomId - 房间 ID
     * @returns 房间详情
     */
    async getRoom(roomId: string, throwOnError = true): Promise<RoomInfo | null> {
        AdminValidators.validateRoomId(roomId);
        try {
            return await this.adminRequest<RoomInfo>(Method.Get, `/rooms/${encodeURIComponent(roomId)}`);
        } catch (e) {
            const err = e as MatrixError;
            if (!throwOnError && ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404))) {
                return null;
            }
            throw e;
        }
    }

    /**
     * 删除房间
     *
     * @param roomId - 房间 ID
     * @param block - 是否阻止未来的加入
     * @param purge - 是否从数据库中清除房间
     * @param reason - 删除原因
     */
    async deleteRoom(
        roomId: string,
        blockOrOptions: boolean | { block?: boolean; purge?: boolean; force_purge?: boolean; reason?: string } = false,
        purge = false,
        reason?: string,
    ): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        let body: Record<string, unknown> | undefined;
        if (typeof blockOrOptions === "object") {
            body = { ...blockOrOptions };
        } else {
            body = { block: blockOrOptions, purge };
            if (reason) {
                body.reason = reason;
            }
        }
        await this.adminRequest(Method.Delete, `/rooms/${encodeURIComponent(roomId)}`, {}, body);
        this.emit(AdminEvent.RoomDeleted, roomId);
    }

    async deleteRoomAdmin(roomId: string, payload?: Record<string, unknown>): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        await this.adminRequest(Method.Post, `/rooms/${encodeURIComponent(roomId)}/delete`, {}, payload ?? {});
    }

    async purgeRoomHistory(roomId: string, payload?: Record<string, unknown>): Promise<any> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Post, `/rooms/${encodeURIComponent(roomId)}/purge_history`, {}, payload ?? {});
    }

    /**
     * 封锁/解封房间
     *
     * @param roomId - 房间 ID
     * @param block - 是否封锁房间
     * @param reason - 原因
     */
    async blockRoom(roomId: string, block: boolean, reason?: string): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        const body: { block: boolean; reason?: string } = { block };
        if (reason) {
            body.reason = reason;
        }
        await this.adminRequest(Method.Post, `/rooms/${encodeURIComponent(roomId)}/block`, undefined, body);
        this.emit(AdminEvent.RoomBlocked, roomId, block);
    }

    async unblockRoom(roomId: string, payload?: Record<string, unknown>): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        await this.adminRequest(Method.Post, `/rooms/${encodeURIComponent(roomId)}/unblock`, {}, payload ?? {});
    }

    /**
     * 获取房间成员列表
     *
     * @param roomId - 房间 ID
     * @returns 房间成员列表
     */
    async getRoomMembers(roomId: string): Promise<UserInfo[]> {
        AdminValidators.validateRoomId(roomId);
        const response = await this.adminRequest<{ members: UserInfo[] }>(
            Method.Get,
            `/rooms/${encodeURIComponent(roomId)}/members`,
        );
        return response.members || [];
    }

    async addRoomMember(roomId: string, userId: string, payload?: Record<string, unknown>): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        AdminValidators.validateUserId(userId);
        await this.adminRequest(
            Method.Put,
            `/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}`,
            {},
            payload ?? {},
        );
    }

    async removeRoomMember(roomId: string, userId: string): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        AdminValidators.validateUserId(userId);
        await this.adminRequest(
            Method.Delete,
            `/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}`,
            {},
            undefined,
        );
    }

    async banRoomMember(roomId: string, userId: string, payload?: Record<string, unknown>): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        AdminValidators.validateUserId(userId);
        await this.adminRequest(
            Method.Post,
            `/rooms/${encodeURIComponent(roomId)}/ban/${encodeURIComponent(userId)}`,
            {},
            payload ?? {},
        );
    }

    async kickRoomMember(roomId: string, userId: string, payload?: Record<string, unknown>): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        AdminValidators.validateUserId(userId);
        await this.adminRequest(
            Method.Post,
            `/rooms/${encodeURIComponent(roomId)}/kick/${encodeURIComponent(userId)}`,
            {},
            payload ?? {},
        );
    }

    async unbanRoomMember(roomId: string, userId: string, payload?: Record<string, unknown>): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        AdminValidators.validateUserId(userId);
        await this.adminRequest(
            Method.Post,
            `/rooms/${encodeURIComponent(roomId)}/unban/${encodeURIComponent(userId)}`,
            {},
            payload ?? {},
        );
    }

    async banRoom(roomId: string, payload: Record<string, unknown>): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        await this.adminRequest(Method.Post, `/rooms/${encodeURIComponent(roomId)}/ban`, {}, payload);
    }

    async kickRoom(roomId: string, payload: Record<string, unknown>): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        await this.adminRequest(Method.Post, `/rooms/${encodeURIComponent(roomId)}/kick`, {}, payload);
    }

    async makeRoomAdmin(roomId: string, payload: Record<string, unknown>): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        try {
            await this.adminRequest(Method.Put, `/rooms/${encodeURIComponent(roomId)}/make_admin`, {}, payload);
        } catch (e) {
            const err = e as MatrixError;
            if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                await this.adminRequest(Method.Post, `/rooms/${encodeURIComponent(roomId)}/make_admin`, {}, payload);
                return;
            }
            throw e;
        }
    }

    /**
     * 获取房间状态事件
     *
     * @param roomId - 房间 ID
     * @returns 房间状态事件列表
     */
    async getRoomState(roomId: string): Promise<{ state: RoomStateEvent[] }> {
        AdminValidators.validateRoomId(roomId);
        const response = await this.adminRequest<{ state: RoomStateEvent[] }>(
            Method.Get,
            `/rooms/${encodeURIComponent(roomId)}/state`,
        );
        return { state: response.state || [] };
    }

    /**
     * 获取房间消息
     *
     * @param roomId - 房间 ID
     * @param from - 分页起点
     * @param limit - 数量限制
     * @returns 房间消息列表
     */
    async getRoomMessages(
        roomId: string,
        optionsOrFrom?: string | { from?: string; limit?: number; dir?: "b" | "f" | string },
        limit?: number,
    ): Promise<{ chunk: RoomMessage[]; start?: string; end?: string }> {
        AdminValidators.validateRoomId(roomId);
        const queryParams: Record<string, string> = {};
        if (typeof optionsOrFrom === "string") {
            Object.assign(queryParams, buildPaginationParams(optionsOrFrom, limit));
        } else if (optionsOrFrom) {
            Object.assign(queryParams, buildPaginationParams(optionsOrFrom.from, optionsOrFrom.limit));
            if (optionsOrFrom.dir !== undefined) {
                queryParams.dir = String(optionsOrFrom.dir);
            }
        }
        const response = await this.adminRequest<{ chunk?: RoomMessage[]; start?: string; end?: string; messages?: RoomMessage[] }>(
            Method.Get,
            `/rooms/${encodeURIComponent(roomId)}/messages`,
            queryParams,
        );
        return {
            chunk: response.chunk || response.messages || [],
            start: response.start,
            end: response.end,
        };
    }

    /**
     * 删除房间消息
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @param reason - 删除原因
     */
    async deleteRoomMessage(roomId: string, eventId: string, reason?: string): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        if (!eventId) {
            throw new ValidationError("Event ID is required");
        }
        const body: { reason?: string } = {};
        if (reason) {
            body.reason = reason;
        }
        await this.adminRequest(
            Method.Delete,
            `/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(eventId)}`,
            undefined,
            body,
        );
    }

    /**
     * 获取媒体列表
     *
     * @param from - 分页起点
     * @param limit - 数量限制
     * @returns 媒体列表
     */
    async getMedia(
        fromOrLimit?: string | number,
        limitOrFrom?: number | string,
    ): Promise<{ media: MediaInfo[]; next_token?: string }> {
        let from: string | undefined;
        let limit: number | undefined;
        if (typeof fromOrLimit === "number") {
            limit = fromOrLimit;
            if (typeof limitOrFrom === "string") {
                from = limitOrFrom;
            }
        } else {
            from = fromOrLimit;
            if (typeof limitOrFrom === "number") {
                limit = limitOrFrom;
            }
        }
        const queryParams = buildPaginationParams(from, limit);
        const response = await this.adminRequest<{ media: MediaInfo[]; next_token?: string }>(Method.Get, "/media", queryParams);
        return { media: response.media || [], next_token: response.next_token };
    }

    /**
     * 获取媒体详情
     *
     * @param mediaId - 媒体 ID
     * @returns 媒体详情
     */
    async getMediaInfo(mediaId: string): Promise<MediaInfo> {
        if (!mediaId) {
            throw new ValidationError("Media ID is required");
        }
        return await this.adminRequest<MediaInfo>(Method.Get, `/media/${encodeURIComponent(mediaId)}`);
    }

    async getMediaQuota(): Promise<Record<string, unknown>> {
        return await this.adminRequest(Method.Get, "/media/quota");
    }

    /**
     * 删除媒体
     *
     * @param mediaId - 媒体 ID
     */
    async deleteMedia(mediaId: string): Promise<void> {
        if (!mediaId) {
            throw new ValidationError("Media ID is required");
        }
        await this.adminRequest(Method.Delete, `/media/${encodeURIComponent(mediaId)}`);
    }

    async getUserMedia(
        userId: string,
        from?: string,
        limit?: number,
    ): Promise<{ media: MediaInfo[]; next_token?: string }> {
        AdminValidators.validateUserId(userId);
        const queryParams = buildPaginationParams(from, limit);
        const response = await this.adminRequest<{ media?: MediaInfo[]; next_token?: string }>(
            Method.Get,
            `/users/${encodeURIComponent(userId)}/media`,
            queryParams,
        );
        return {
            media: response.media || [],
            next_token: response.next_token,
        };
    }

    async deleteUserMedia(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        await this.adminRequest(Method.Delete, `/users/${encodeURIComponent(userId)}/media`);
    }

    /**
     * 隔离媒体
     *
     * @param mediaId - 媒体 ID
     */
    async quarantineMedia(mediaId: string): Promise<void> {
        if (!mediaId) {
            throw new ValidationError("Media ID is required");
        }
        await this.adminRequest(Method.Post, `/media/${encodeURIComponent(mediaId)}/quarantine`);
    }

    /**
     * 取消隔离媒体
     *
     * @param mediaId - 媒体 ID
     */
    async unquarantineMedia(mediaId: string): Promise<void> {
        if (!mediaId) {
            throw new ValidationError("Media ID is required");
        }
        await this.adminRequest(Method.Post, `/media/${encodeURIComponent(mediaId)}/unquarantine`);
    }

    /**
     * 获取服务器统计信息
     *
     * @returns 服务器统计信息
     */
    async getServerStats(): Promise<ServerStats> {
        let stats: ServerStats;
        try {
            stats = await this.adminRequest<ServerStats>(Method.Get, "/statistics");
        } catch (e) {
            const err = e as MatrixError;
            if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                stats = await this.adminRequest<ServerStats>(Method.Get, "/server_stats");
            } else {
                throw e;
            }
        }
        this.serverStats = stats;
        this.emit(AdminEvent.ServerStatsUpdated, stats);
        return stats;
    }

    /**
     * 获取缓存的服务器统计信息
     *
     * @returns 缓存的服务器统计信息，如果不存在则为 null
     */
    getServerStatsCached(): ServerStats | null {
        return this.serverStats;
    }

    /**
     * 获取服务器状态
     *
     * @returns 服务器状态
     */
    async getServerStatus(): Promise<ServerStatus> {
        return await this.adminRequest<ServerStatus>(Method.Get, "/status");
    }

    /**
     * 获取服务器健康检查
     *
     * @returns 服务器健康检查结果
     */
    async getServerHealth(): Promise<ServerHealth> {
        try {
            return await this.adminRequest<ServerHealth>(Method.Get, "/health");
        } catch (e) {
            const err = e as MatrixError;
            if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                return await this.adminRequest<ServerHealth>(Method.Get, "/server_health");
            }
            throw e;
        }
    }

    /**
     * 获取服务器信息
     *
     * @returns 服务器信息
     */
    async getServerInfo(): Promise<ServerInfo> {
        try {
            return await this.adminRequest<ServerInfo>(Method.Get, "/info");
        } catch (e) {
            const err = e as MatrixError;
            if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                return await this.adminRequest<ServerInfo>(Method.Get, "/server_info");
            }
            throw e;
        }
    }

    /**
     * 清理数据库
     *
     * @param options - 清理选项
     * @returns 清理结果
     */
    async cleanupDatabase(options?: {
        room_id?: string;
        min_depth?: number;
        max_depth?: number;
        min_ts?: number;
        max_ts?: number;
        limit?: number;
        delete_local_media?: boolean;
        delete_remote_media?: boolean;
        delete_old_events?: boolean;
        delete_old_rooms?: boolean;
        delete_old_users?: boolean;
    }): Promise<AdminCleanupResponse> {
        return await this.adminRequest<AdminCleanupResponse>(Method.Post, "/cleanup", undefined, options || {});
    }

    /**
     * 获取服务器通知列表
     *
     * @param from - 分页起点
     * @param limit - 数量限制
     * @returns 服务器通知列表
     */
    async getServerNotices(
        fromOrLimit?: string | number,
        limit?: number,
    ): Promise<{ notices: ServerNotice[]; next_token?: string }> {
        let from: string | undefined;
        let localLimit: number | undefined = limit;
        if (typeof fromOrLimit === "number") {
            localLimit = fromOrLimit;
        } else {
            from = fromOrLimit;
        }
        const queryParams = buildPaginationParams(from, localLimit);
        const response = await this.adminRequest<{ notices: ServerNotice[]; next_token?: string }>(
            Method.Get,
            "/server_notices",
            queryParams,
        );
        return { notices: response.notices || [], next_token: response.next_token };
    }

    /**
     * 发送服务器通知
     *
     * @param content - 通知内容
     * @param type - 通知类型
     * @param targetUsers - 目标用户列表
     */
    async sendServerNotice(
        arg1: string,
        arg2?: string | { msgtype: string; body: string; [k: string]: unknown },
        arg3?: string[],
    ): Promise<{ event_id?: string }> {
        if (typeof arg2 === "object" && arg2 !== null) {
            const body = {
                user_id: arg1,
                content: arg2,
            };
            return await this.adminRequest<{ event_id?: string }>(Method.Post, "/send_server_notice", {}, body);
        }
        const body: { content: string; type?: string; target_users?: string[] } = { content: arg1 };
        if (typeof arg2 === "string") {
            body.type = arg2;
        }
        if (arg3) {
            body.target_users = arg3;
        }
        return await this.adminRequest<{ event_id?: string }>(Method.Post, "/server_notices", {}, body);
    }

    /**
     * 删除服务器通知
     *
     * @param notificationId - 通知 ID
     */
    async deleteServerNotice(notificationId: string): Promise<void> {
        if (!notificationId) {
            throw new ValidationError("Notification ID is required");
        }
        await this.adminRequest(Method.Delete, `/server_notices/${encodeURIComponent(notificationId)}`);
    }

    async getServerNotice(noticeId: string): Promise<ServerNotice> {
        if (!noticeId) throw new ValidationError("Notice ID is required");
        return await this.adminRequest(Method.Get, `/server_notices/${encodeURIComponent(noticeId)}`);
    }

    async listNotifications(from?: string, limit?: number): Promise<SystemNotificationPage> {
        const queryParams = buildPaginationParams(from, limit);
        const response = await this.adminRequest<SystemNotificationPage>(Method.Get, "/notifications", queryParams);
        return {
            notifications: response.notifications || [],
            next_token: response.next_token,
        };
    }

    async createNotification(payload: Record<string, unknown>): Promise<SystemNotificationInfo> {
        return await this.adminRequest<SystemNotificationInfo>(Method.Post, "/notifications", {}, payload);
    }

    async listActiveNotifications(): Promise<SystemNotificationInfo[]> {
        const response = await this.adminRequest<{ notifications?: SystemNotificationInfo[] }>(
            Method.Get,
            "/notifications/active",
        );
        return response.notifications || [];
    }

    async getNotification(notificationId: string): Promise<SystemNotificationInfo> {
        if (!notificationId) throw new ValidationError("Notification ID is required");
        return await this.adminRequest<SystemNotificationInfo>(
            Method.Get,
            `/notifications/${encodeURIComponent(notificationId)}`,
        );
    }

    async updateNotification(notificationId: string, payload: Record<string, unknown>): Promise<SystemNotificationInfo> {
        if (!notificationId) throw new ValidationError("Notification ID is required");
        return await this.adminRequest<SystemNotificationInfo>(
            Method.Put,
            `/notifications/${encodeURIComponent(notificationId)}`,
            {},
            payload,
        );
    }

    async deactivateNotification(notificationId: string): Promise<void> {
        if (!notificationId) throw new ValidationError("Notification ID is required");
        await this.adminRequest(Method.Put, `/notifications/${encodeURIComponent(notificationId)}/deactivate`, {}, undefined);
    }

    async deleteNotification(notificationId: string): Promise<void> {
        if (!notificationId) throw new ValidationError("Notification ID is required");
        await this.adminRequest(Method.Delete, `/notifications/${encodeURIComponent(notificationId)}`, {}, undefined);
    }

    async getUserNotification(userId: string): Promise<Record<string, unknown>> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Get, `/users/${encodeURIComponent(userId)}/notification`);
    }

    async setUserNotification(userId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Put, `/users/${encodeURIComponent(userId)}/notification`, {}, payload);
    }

    async getUserPushers(userId: string): Promise<{ pushers: UserPusher[] }> {
        AdminValidators.validateUserId(userId);
        const response = await this.adminRequest<{ pushers?: UserPusher[] }>(
            Method.Get,
            `/users/${encodeURIComponent(userId)}/pushers`,
        );
        return { pushers: response.pushers || [] };
    }

    async deleteUserPusher(userId: string, pushkey: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        if (!pushkey) throw new ValidationError("Pushkey is required");
        await this.adminRequest(
            Method.Delete,
            `/users/${encodeURIComponent(userId)}/pushers/${encodeURIComponent(pushkey)}`,
            {},
            undefined,
        );
    }

    /**
     * 获取联邦黑名单列表
     *
     * @returns 联邦黑名单列表
     */
    async getFederationBlacklist(): Promise<FederationBlacklistEntry[]> {
        const response = await this.adminRequest<{ blacklist: FederationBlacklistEntry[] }>(
            Method.Get,
            "/federation/blacklist",
        );
        return response.blacklist || [];
    }

    /**
     * 添加到联邦黑名单
     *
     * @param serverName - 服务器名称
     * @param reason - 原因
     */
    async addFederationBlacklistEntry(serverName: string, reason?: string): Promise<void> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }
        const body: { server_name: string; reason?: string } = { server_name: serverName };
        if (reason) {
            body.reason = reason;
        }
        await this.adminRequest(Method.Post, "/federation/blacklist", undefined, body);
    }

    /**
     * 从联邦黑名单移除
     *
     * @param serverName - 服务器名称
     */
    async removeFederationBlacklistEntry(serverName: string): Promise<void> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }
        await this.adminRequest(Method.Delete, `/federation/blacklist/${encodeURIComponent(serverName)}`);
    }

    /**
     * 获取联邦目的地列表
     *
     * @returns 联邦目的地列表
     */
    async getFederationDestinations(): Promise<FederationDestination[]> {
        const response = await this.adminRequest<{ destinations: FederationDestination[] }>(
            Method.Get,
            "/federation/destinations",
        );
        return response.destinations || [];
    }

    /**
     * 获取联邦缓存信息
     * 对接: GET /_synapse/admin/v1/federation/cache
     */
    async getFederationCache(): Promise<any> {
        return await this.adminRequest(Method.Get, apu("/federation/cache"));
    }

    /**
     * 清除联邦缓存
     * 对接: POST /_synapse/admin/v1/federation/cache/clear
     */
    async clearFederationCache(): Promise<void> {
        await this.adminRequest(Method.Post, apu("/federation/cache/clear"));
    }

    /**
     * 删除联邦缓存中的指定条目
     * 对接: DELETE /_synapse/admin/v1/federation/cache/{key}
     *
     * @param key - 缓存条目的键
     */
    async deleteFederationCacheEntry(key: string): Promise<void> {
        if (!key) {
            throw new ValidationError("Cache key is required");
        }
        await this.adminRequest(Method.Delete, apu(`/federation/cache/${encodeURIComponent(key)}`));
    }

    /**
     * 获取联邦准入列表
     *
     * @returns 联邦准入列表
     */
    async getFederationAdmissionList(): Promise<FederationAdmissionResult[]> {
        try {
            const response = await this.adminRequest<{ admissions?: FederationAdmissionResult[]; pending?: FederationAdmissionResult[] }>(
                Method.Get,
                "/federation/pending",
            );
            return response.admissions || response.pending || [];
        } catch (e) {
            const err = e as MatrixError;
            if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                const fallback = await this.adminRequest<{ admissions?: FederationAdmissionResult[] }>(
                    Method.Get,
                    "/federation/admissions",
                );
                return fallback.admissions || [];
            }
            throw e;
        }
    }

    /**
     * 获取待处理联邦服务器列表
     *
     * @param from - 分页起点
     * @param limit - 数量限制
     * @returns 待处理联邦服务器列表
     */
    async getPendingFederationServers(from?: string, limit?: number): Promise<PendingFederationList> {
        const queryParams = buildPaginationParams(from, limit);
        try {
            return await this.adminRequest<PendingFederationList>(
                Method.Get,
                "/federation/pending",
                queryParams,
            );
        } catch (e) {
            const err = e as MatrixError;
            if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                return await this.adminRequest<PendingFederationList>(
                    Method.Get,
                    "/federation/pending_servers",
                    queryParams,
                );
            }
            throw e;
        }
    }

    /**
     * 获取注册令牌列表
     *
     * @returns 注册令牌列表
     */
    async getRegistrationTokens(): Promise<RegistrationToken[]> {
        const response = await this.adminRequest<{ registration_tokens: RegistrationToken[] }>(
            Method.Get,
            "/registration_tokens",
        );
        return response.registration_tokens || [];
    }

    /**
     * 创建注册令牌
     *
     * @param token - 令牌字符串
     * @param usesAllowed - 允许使用次数
     * @param expiryTs - 过期时间戳
     * @returns 创建的注册令牌
     */
    async createRegistrationToken(
        tokenOrPayload: string | { token: string; uses_allowed?: number; expiry_ts?: number },
        usesAllowed?: number,
        expiryTs?: number,
    ): Promise<RegistrationToken> {
        const body: { token: string; uses_allowed?: number; expiry_ts?: number } =
            typeof tokenOrPayload === "string"
                ? { token: tokenOrPayload, uses_allowed: usesAllowed, expiry_ts: expiryTs }
                : { ...tokenOrPayload };
        return await this.adminRequest<RegistrationToken>(Method.Post, "/registration_tokens", undefined, body);
    }

    /**
     * 删除注册令牌
     *
     * @param token - 令牌字符串
     */
    async deleteRegistrationToken(token: string): Promise<void> {
        if (!token) {
            throw new ValidationError("Token is required");
        }
        await this.adminRequest(Method.Delete, `/registration_tokens/${encodeURIComponent(token)}`);
    }

    /**
     * 获取房间统计信息
     *
     * @param from - 分页起点
     * @param limit - 数量限制
     * @returns 房间统计信息列表
     */
    async getRoomStats(from?: string, limit?: number): Promise<RoomStats[]> {
        const queryParams = buildPaginationParams(from, limit);
        const response = await this.adminRequest<{ rooms: RoomStats[] }>(Method.Get, "/room_stats", queryParams);
        return response.rooms || [];
    }

    async getRoomStatsByRoom(roomId: string): Promise<RoomStats> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest<RoomStats>(Method.Get, `/room_stats/${encodeURIComponent(roomId)}`);
    }

    /**
     * 获取用户 Whois 信息
     *
     * @param userId - 用户 ID
     * @returns Whois 信息
     */
    async getUserWhois(userId: string): Promise<WhoisResponse> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest<WhoisResponse>(Method.Get, `/whois/${encodeURIComponent(userId)}`);
    }

    /**
     * 获取功能标志列表
     *
     * @returns 功能标志列表
     */
    async getFeatureFlags(): Promise<FeatureFlagPage> {
        return await this.adminRequest<FeatureFlagPage>(Method.Get, apu("/feature_flags"));
    }

    /**
     * 获取功能标志详情
     *
     * @param flagKey - 功能标志键
     * @returns 功能标志详情
     */
    async getFeatureFlag(flagKey: string): Promise<FeatureFlag> {
        if (!flagKey) {
            throw new ValidationError("Flag key is required");
        }
        return await this.adminRequest<FeatureFlag>(Method.Get, apu(`/feature_flags/${encodeURIComponent(flagKey)}`));
    }

    /**
     * 设置功能标志
     *
     * @param flagKey - 功能标志键
     * @param targetScope - 目标范围
     * @param rolloutPercent - 推出百分比
     * @param expiresAt - 过期时间戳
     * @param reason - 原因
     * @param targets - 目标列表
     * @returns 设置后的功能标志
     */
    async setFeatureFlag(
        flagKey: string,
        targetScope: string,
        rolloutPercent: number,
        expiresAt: number | null,
        reason: string,
        targets: FeatureFlagTarget[],
    ): Promise<FeatureFlag> {
        if (!flagKey) {
            throw new ValidationError("Flag key is required");
        }
        const body: {
            target_scope: string;
            rollout_percent: number;
            expires_at: number | null;
            reason: string;
            targets: FeatureFlagTarget[];
        } = {
            target_scope: targetScope,
            rollout_percent: rolloutPercent,
            expires_at: expiresAt,
            reason: reason,
            targets: targets,
        };
        return await this.adminRequest<FeatureFlag>(
            Method.Put,
            apu(`/feature_flags/${encodeURIComponent(flagKey)}`),
            undefined,
            body,
        );
    }

    /**
     * 删除功能标志
     *
     * @param flagKey - 功能标志键
     */
    async deleteFeatureFlag(flagKey: string): Promise<void> {
        if (!flagKey) {
            throw new ValidationError("Flag key is required");
        }
        await this.adminRequest(Method.Delete, apu(`/feature_flags/${encodeURIComponent(flagKey)}`));
    }

    // ===== Compatibility wrappers / additional admin routes =====
    async shadowBanUser(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/shadow_ban`, {}, undefined);
        this.emit(AdminEvent.UserShadowBanned, userId);
    }

    async unshadowBanUser(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        await this.adminRequest(Method.Delete, `/users/${encodeURIComponent(userId)}/shadow_ban`, {}, undefined);
        this.emit(AdminEvent.UserUnshadowBanned, userId);
    }

    async getShadowBanStatus(userId: string, throwOnError = true): Promise<any | null> {
        try {
            return await this.adminRequest(Method.Get, `/users/${encodeURIComponent(userId)}/shadow_ban`);
        } catch (e) {
            const err = e as MatrixError;
            if (!throwOnError && ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404))) return null;
            throw e;
        }
    }

    async getRateLimit(userId: string, throwOnError = true): Promise<any | null> {
        try {
            return await this.adminRequest(Method.Get, `/users/${encodeURIComponent(userId)}/rate_limit`);
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            try {
                return await this.getRateLimitOverride(userId, throwOnError);
            } catch (fallbackErr) {
                const err = fallbackErr as MatrixError;
                if (!throwOnError && ((fallbackErr instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404))) {
                    return null;
                }
                throw fallbackErr;
            }
        }
    }

    async setRateLimit(userId: string, config: { messages_per_second?: number; burst_count?: number }): Promise<void> {
        try {
            await this.adminRequest(Method.Put, `/users/${encodeURIComponent(userId)}/rate_limit`, {}, config);
        } catch (e) {
            const err = e as MatrixError;
            if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/override_ratelimit`, {}, config);
                return;
            }
            throw e;
        }
    }

    async deleteRateLimit(userId: string): Promise<void> {
        try {
            await this.adminRequest(Method.Delete, `/users/${encodeURIComponent(userId)}/rate_limit`);
        } catch (e) {
            const err = e as MatrixError;
            if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                await this.deleteRateLimitOverride(userId);
                return;
            }
            throw e;
        }
    }

    async joinRoom(roomId: string, userId: string): Promise<void> {
        await this.adminRequest(Method.Post, `/rooms/${encodeURIComponent(roomId)}/join`, {}, { user_id: userId });
    }

    async getRoomAliases(roomId: string): Promise<{ aliases: string[] }> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Get, `/rooms/${encodeURIComponent(roomId)}/aliases`);
    }

    async getRoomVersion(roomId: string): Promise<any> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Get, `/rooms/${encodeURIComponent(roomId)}/version`);
    }

    async getRoomBlockStatus(roomId: string): Promise<any> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Get, `/rooms/${encodeURIComponent(roomId)}/block`);
    }

    async getRoomEventContext(roomId: string, eventId: string): Promise<any> {
        AdminValidators.validateRoomId(roomId);
        if (!eventId) throw new ValidationError("Event ID is required");
        return await this.adminRequest(
            Method.Get,
            `/rooms/${encodeURIComponent(roomId)}/event_context/${encodeURIComponent(eventId)}`,
        );
    }

    async getRoomForwardExtremities(roomId: string): Promise<any> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Get, `/rooms/${encodeURIComponent(roomId)}/forward_extremities`);
    }

    async getRoomTokenSync(roomId: string): Promise<any> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Get, `/rooms/${encodeURIComponent(roomId)}/token_sync`);
    }

    async searchRoomEvents(roomId: string, payload: Record<string, unknown>): Promise<any> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Post, `/rooms/${encodeURIComponent(roomId)}/search`, {}, payload);
    }

    async getRoomListings(roomId: string): Promise<any> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Get, `/rooms/${encodeURIComponent(roomId)}/listings`);
    }

    async setRoomPublicListing(roomId: string): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        await this.adminRequest(Method.Put, `/rooms/${encodeURIComponent(roomId)}/listings/public`, {}, undefined);
    }

    async deleteRoomPublicListing(roomId: string): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        await this.adminRequest(Method.Delete, `/rooms/${encodeURIComponent(roomId)}/listings/public`, {}, undefined);
    }

    async getServerConfig(throwOnError = true): Promise<Record<string, unknown>> {
        try {
            return await this.adminRequest(Method.Get, "/config");
        } catch (e) {
            const err = e as MatrixError;
            if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                try {
                    return await this.adminRequest(Method.Get, "/server_config");
                } catch (fallbackErr) {
                    if (!throwOnError) return {};
                    throw fallbackErr;
                }
            }
            if (!throwOnError) return {};
            throw e;
        }
    }

    async getAdminInfo(): Promise<Record<string, unknown>> {
        return await this.adminRequest(Method.Get, "/info");
    }

    async getServerVersion(throwOnError = true): Promise<{ server_version: string; python_version: string }> {
        try {
            return await this.adminRequest(Method.Get, "/server_version");
        } catch (e) {
            if (!throwOnError) return { server_version: "unknown", python_version: "unknown" };
            throw e;
        }
    }

    async addToFederationBlacklist(serverName: string, reason?: string): Promise<void> {
        if (!serverName) throw new ValidationError("Server name is required");
        await this.adminRequest(Method.Post, `/federation/blacklist/${encodeURIComponent(serverName)}`, {}, reason ? { reason } : undefined);
    }

    async removeFromFederationBlacklist(serverName: string): Promise<void> {
        await this.removeFederationBlacklistEntry(serverName);
    }

    async disconnectFederation(serverName: string): Promise<void> {
        await this.adminRequest(Method.Post, `/federation/destinations/${encodeURIComponent(serverName)}/reset_connection`, {}, undefined);
    }

    async getFederationDestination(serverName: string, throwOnError = true): Promise<any | null> {
        try {
            return await this.adminRequest(Method.Get, `/federation/destinations/${encodeURIComponent(serverName)}`);
        } catch (e) {
            const err = e as MatrixError;
            if (!throwOnError && ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404))) return null;
            throw e;
        }
    }

    async resetFederationConnection(serverName: string): Promise<void> {
        await this.disconnectFederation(serverName);
    }

    async getFederationDestinationRooms(
        serverName: string,
        options?: { from?: number; limit?: number },
    ): Promise<any> {
        const query: Record<string, string> = {};
        if (options?.from !== undefined) query.from = String(options.from);
        if (options?.limit !== undefined) query.limit = String(options.limit);
        return await this.adminRequest(Method.Get, `/federation/destinations/${encodeURIComponent(serverName)}/rooms`, query);
    }

    async getAccountDetails(userId: string): Promise<any> {
        return await this.getAccountStatus(userId);
    }

    async updateAccountDetails(userId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Post, `/account/${encodeURIComponent(userId)}`, {}, payload);
    }

    async getSpace(spaceId: string): Promise<any> {
        AdminValidators.validateRoomId(spaceId);
        return await this.adminRequest(Method.Get, `/spaces/${encodeURIComponent(spaceId)}`);
    }

    async listSpaces(from?: string, limit?: number): Promise<SpacePage> {
        const query = buildPaginationParams(from, limit);
        return await this.adminRequest(Method.Get, "/spaces", query);
    }

    async deleteSpace(spaceId: string): Promise<void> {
        AdminValidators.validateRoomId(spaceId);
        await this.adminRequest(Method.Delete, `/spaces/${encodeURIComponent(spaceId)}`);
    }

    async getSpaceRooms(spaceId: string, from?: string, limit?: number): Promise<{ rooms: SpaceRoom[]; next_batch?: string }> {
        AdminValidators.validateRoomId(spaceId);
        const query = buildPaginationParams(from, limit);
        return await this.adminRequest(Method.Get, `/spaces/${encodeURIComponent(spaceId)}/rooms`, query);
    }

    async getSpaceStats(spaceId: string): Promise<Record<string, unknown>> {
        AdminValidators.validateRoomId(spaceId);
        return await this.adminRequest(Method.Get, `/spaces/${encodeURIComponent(spaceId)}/stats`);
    }

    async getSpaceUsers(spaceId: string, from?: string, limit?: number): Promise<{ users: SpaceUser[]; next_batch?: string }> {
        AdminValidators.validateRoomId(spaceId);
        const query = buildPaginationParams(from, limit);
        return await this.adminRequest(Method.Get, `/spaces/${encodeURIComponent(spaceId)}/users`, query);
    }

    async whois(userId: string): Promise<WhoisResponse> {
        return await this.getUserWhois(userId);
    }

    async whoisByDevice(userId: string, deviceId: string): Promise<any> {
        AdminValidators.validateUserId(userId);
        if (!deviceId) throw new ValidationError("Device ID is required");
        return await this.adminRequest(Method.Get, `/whois/${encodeURIComponent(userId)}/${encodeURIComponent(deviceId)}`);
    }

    async purgeMediaCache(beforeTs?: number): Promise<{ deleted: number }> {
        if (beforeTs !== undefined) {
            if (!Number.isInteger(beforeTs) || beforeTs <= 0) {
                throw new ValidationError("beforeTs must be a positive integer");
            }
        }
        const body = beforeTs !== undefined ? { before_ts: beforeTs } : {};
        const result = await this.adminRequest<{ deleted?: number }>(Method.Post, "/purge_media_cache", {}, body);
        return { deleted: result.deleted ?? 0 };
    }

    async updateRegistrationToken(token: string, payload: { uses_allowed?: number; expiry_ts?: number }): Promise<void> {
        if (!token) throw new ValidationError("Token is required");
        try {
            await this.adminRequest(Method.Post, `/registration_tokens/${encodeURIComponent(token)}`, {}, payload);
        } catch (e) {
            const err = e as MatrixError;
            if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                await this.adminRequest(Method.Put, `/registration_tokens/${encodeURIComponent(token)}`, {}, payload);
                return;
            }
            throw e;
        }
    }

    async getRegistrationToken(token: string): Promise<RegistrationToken> {
        if (!token) throw new ValidationError("Token is required");
        return await this.adminRequest(Method.Get, `/registration_tokens/${encodeURIComponent(token)}`);
    }

    async getRegisterNonce(): Promise<{ nonce: string }> {
        return await this.adminRequest(Method.Get, "/register/nonce");
    }

    async registerAdmin(payload: Record<string, unknown>): Promise<any> {
        return await this.adminRequest(Method.Post, "/register", {}, payload);
    }

    async listReports(options?: { from?: string; limit?: number }): Promise<any> {
        const query = buildPaginationParams(options?.from, options?.limit);
        return await this.adminRequest(Method.Get, "/reports", query);
    }

    async getReport(reportId: string): Promise<any> {
        if (!reportId) throw new ValidationError("Report ID is required");
        return await this.adminRequest(Method.Get, `/reports/${encodeURIComponent(reportId)}`);
    }

    async deleteReport(reportId: string): Promise<void> {
        if (!reportId) throw new ValidationError("Report ID is required");
        await this.adminRequest(Method.Delete, `/reports/${encodeURIComponent(reportId)}`);
    }

    async listRoomReports(roomId: string, options?: { from?: string; limit?: number }): Promise<any> {
        AdminValidators.validateRoomId(roomId);
        const query = buildPaginationParams(options?.from, options?.limit);
        return await this.adminRequest(Method.Get, `/rooms/${encodeURIComponent(roomId)}/reports`, query);
    }

    async getRoomReport(roomId: string, reportId: string): Promise<any> {
        AdminValidators.validateRoomId(roomId);
        if (!reportId) throw new ValidationError("Report ID is required");
        return await this.adminRequest(
            Method.Get,
            `/rooms/${encodeURIComponent(roomId)}/reports/${encodeURIComponent(reportId)}`,
        );
    }

    async listAuditEvents(options?: Record<string, string | number | undefined>): Promise<any> {
        const query: Record<string, string> = {};
        if (options) {
            for (const [k, v] of Object.entries(options)) {
                if (v !== undefined && v !== null) query[k] = String(v);
            }
        }
        return await this.adminRequest(Method.Get, "/audit/events", query);
    }

    async getAuditEvent(eventId: string): Promise<any> {
        if (!eventId) throw new ValidationError("Event ID is required");
        return await this.adminRequest(Method.Get, `/audit/events/${encodeURIComponent(eventId)}`);
    }

    async createAuditEvent(payload: Record<string, unknown>): Promise<any> {
        return await this.adminRequest(Method.Post, "/audit/events", {}, payload);
    }

    async listFeatureFlags(options?: Record<string, string | number | undefined>): Promise<any> {
        const query: Record<string, string> = {};
        if (options) {
            for (const [k, v] of Object.entries(options)) {
                if (v !== undefined && v !== null) query[k] = String(v);
            }
        }
        return await this.adminRequest(Method.Get, "/feature-flags", query);
    }

    async updateFeatureFlag(flagId: string, payload: Record<string, unknown>): Promise<any> {
        return await this.adminRequest(Method.Patch, `/feature-flags/${encodeURIComponent(flagId)}`, {}, payload);
    }

    async resolveFederation(serverName: string): Promise<any> {
        return await this.adminRequest(Method.Post, "/federation/resolve", {}, { server_name: serverName });
    }

    async rewriteFederation(from: string, to: string): Promise<any> {
        if (!from || !to) throw new ValidationError("from and to are required");
        return await this.adminRequest(Method.Post, "/federation/rewrite", {}, { from, to });
    }

    async confirmFederation(payload: { server_name?: string; action?: string; reason?: string }): Promise<any> {
        return await this.adminRequest(Method.Post, "/federation/confirm", {}, payload);
    }

    async deleteFederationDestination(serverName: string): Promise<void> {
        await this.adminRequest(Method.Delete, `/federation/destinations/${encodeURIComponent(serverName)}`, {}, undefined);
    }

    async resetFederationDestination(serverName: string): Promise<void> {
        if (!serverName) throw new ValidationError("Server name is required");
        try {
            await this.adminRequest(Method.Post, `/federation/destinations/${encodeURIComponent(serverName)}/reset`, {}, undefined);
        } catch (e) {
            const err = e as MatrixError;
            if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                await this.adminRequest(
                    Method.Post,
                    `/federation/destinations/${encodeURIComponent(serverName)}/reset_connection`,
                    {},
                    undefined,
                );
                return;
            }
            throw e;
        }
    }

    async blockEventReportUser(userId: string, payload: { blocked_until?: number; reason?: string }): Promise<void> {
        await this.adminRequest(Method.Post, `/event_reports/rate_limit/${encodeURIComponent(userId)}/block`, {}, payload);
    }

    async unblockEventReportUser(userId: string): Promise<void> {
        await this.adminRequest(Method.Post, `/event_reports/rate_limit/${encodeURIComponent(userId)}/unblock`, {}, undefined);
    }

    async acknowledgeTelemetryAlert(alertId: string): Promise<void> {
        await this.adminRequest(Method.Post, `/telemetry/alerts/${encodeURIComponent(alertId)}/ack`, {}, undefined);
    }

    async listModules(options?: { limit?: number; from?: string }): Promise<any> {
        const query: Record<string, string> = {};
        if (options?.limit !== undefined) query.limit = String(options.limit);
        if (options?.from !== undefined) query.from = String(options.from);
        return await this.adminRequest(Method.Get, "/modules", query);
    }

    async listModulesByType(moduleType: string): Promise<any> {
        return await this.adminRequest(Method.Get, `/modules/type/${encodeURIComponent(moduleType)}`);
    }

    async updateModuleConfig(moduleId: string, config: Record<string, unknown>): Promise<any> {
        return await this.adminRequest(Method.Put, `/modules/${encodeURIComponent(moduleId)}/config`, {}, { config });
    }

    async setModuleEnabled(moduleId: string, isEnabled: boolean): Promise<any> {
        return await this.adminRequest(Method.Post, `/modules/${encodeURIComponent(moduleId)}/enable`, {}, { is_enabled: isEnabled });
    }

    async getModuleLogs(moduleId: string, options?: { limit?: number; from?: number }): Promise<any> {
        const query: Record<string, string> = {};
        if (options?.limit !== undefined) query.limit = String(options.limit);
        if (options?.from !== undefined) query.from = String(options.from);
        return await this.adminRequest(Method.Get, `/modules/${encodeURIComponent(moduleId)}/logs`, query);
    }

    async checkModuleThirdPartyRule(payload: Record<string, unknown>): Promise<any> {
        return await this.adminRequest(Method.Post, "/modules/check_third_party_rule", {}, payload);
    }

    async getModuleSpamCheckResult(eventId: string): Promise<any> {
        return await this.adminRequest(Method.Get, `/modules/spam_check/${encodeURIComponent(eventId)}`);
    }

    async listModuleSpamChecksBySender(sender: string, options?: { limit?: number }): Promise<any> {
        const query: Record<string, string> = {};
        if (options?.limit !== undefined) query.limit = String(options.limit);
        return await this.adminRequest(Method.Get, `/modules/spam_check/sender/${encodeURIComponent(sender)}`, query);
    }

    async getModuleThirdPartyRuleResults(eventId: string): Promise<any> {
        return await this.adminRequest(Method.Get, `/modules/third_party_rule/${encodeURIComponent(eventId)}`);
    }

    async createAccountValidity(payload: Record<string, unknown>): Promise<any> {
        return await this.adminRequest(Method.Post, "/account_validity", {}, payload);
    }

    async getAccountValidity(userId: string): Promise<any> {
        return await this.adminRequest(Method.Get, `/account_validity/${encodeURIComponent(userId)}`);
    }

    async renewAccountValidity(userId: string, payload: Record<string, unknown>): Promise<any> {
        return await this.adminRequest(Method.Post, `/account_validity/${encodeURIComponent(userId)}/renew`, {}, payload);
    }

    async listPasswordAuthProviders(): Promise<any> {
        return await this.adminRequest(Method.Get, "/password_auth_providers");
    }

    async createPasswordAuthProvider(payload: Record<string, unknown>): Promise<any> {
        return await this.adminRequest(Method.Post, "/password_auth_providers", {}, payload);
    }

    async listPresenceRoutes(): Promise<any> {
        return await this.adminRequest(Method.Get, "/presence_routes");
    }

    async createPresenceRoute(payload: Record<string, unknown>): Promise<any> {
        return await this.adminRequest(Method.Post, "/presence_routes", {}, payload);
    }

    async listMediaCallbacks(): Promise<any> {
        return await this.adminRequest(Method.Get, "/media_callbacks");
    }

    async listMediaCallbacksByType(callbackType: string): Promise<any> {
        return await this.adminRequest(Method.Get, `/media_callbacks/${encodeURIComponent(callbackType)}`);
    }

    async createMediaCallback(payload: Record<string, unknown>): Promise<any> {
        return await this.adminRequest(Method.Post, "/media_callbacks", {}, payload);
    }

    async listRateLimitCallbacks(): Promise<any> {
        return await this.adminRequest(Method.Get, "/rate_limit_callbacks");
    }

    async createRateLimitCallback(payload: Record<string, unknown>): Promise<any> {
        return await this.adminRequest(Method.Post, "/rate_limit_callbacks", {}, payload);
    }

    async listAccountDataCallbacks(): Promise<any> {
        return await this.adminRequest(Method.Get, "/account_data_callbacks");
    }

    async createAccountDataCallback(payload: Record<string, unknown>): Promise<any> {
        return await this.adminRequest(Method.Post, "/account_data_callbacks", {}, payload);
    }

    async getInviteAllowlist(): Promise<any> {
        return await this.adminRequest(Method.Get, "/invite/allowlist");
    }

    async getInviteBlocklist(): Promise<any> {
        return await this.adminRequest(Method.Get, "/invite/blocklist");
    }

    async getJitsiConfig(): Promise<any> {
        return await this.adminRequest(Method.Get, "/jitsi/config");
    }

    async cleanupAll(): Promise<any> {
        return await this.adminRequest(Method.Post, "/cleanup/all", {}, undefined);
    }

    async cleanupRooms(payload?: Record<string, unknown>): Promise<any> {
        try {
            return await this.adminRequest(Method.Post, "/rooms/cleanup", {}, payload ?? {});
        } catch (e) {
            const err = e as MatrixError;
            if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                return await this.adminRequest(Method.Post, "/cleanup/rooms", {}, payload ?? {});
            }
            throw e;
        }
    }

    async cleanupTokens(): Promise<any> {
        return await this.adminRequest(Method.Post, "/cleanup/tokens", {}, undefined);
    }

    async purgeRoom(payload: Record<string, unknown>): Promise<any> {
        return await this.adminRequest(Method.Post, "/purge_room", {}, payload);
    }

    async purgeHistory(payload: Record<string, unknown>): Promise<any> {
        return await this.adminRequest(Method.Post, "/purge_history", {}, payload);
    }

    async shutdownRoom(payload: Record<string, unknown>): Promise<any> {
        return await this.adminRequest(Method.Post, "/shutdown_room", {}, payload);
    }

    async restartServer(payload?: Record<string, unknown>): Promise<any> {
        return await this.adminRequest(Method.Post, "/restart", {}, payload ?? {});
    }

    async listBackups(options?: { limit?: number; offset?: number }): Promise<any> {
        if (options?.limit !== undefined) {
            if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 500) {
                throw new ValidationError("limit must be an integer between 1 and 500");
            }
        }
        if (options?.offset !== undefined) {
            if (!Number.isInteger(options.offset) || options.offset < 0) {
                throw new ValidationError("offset must be a non-negative integer");
            }
        }
        const query: Record<string, string> = {};
        if (options?.limit !== undefined) query.limit = String(options.limit);
        if (options?.offset !== undefined) query.offset = String(options.offset);
        return await this.adminRequest(Method.Get, "/backups", query);
    }

    async getExperimentalFeatures(): Promise<any> {
        return await this.adminRequest(Method.Get, "/experimental_features");
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getAdminManager = function (): AdminManager {
        return getOrCreateManager(this, "admin", () => new AdminManager(this));
    };
}

export default extendMatrixClient;
