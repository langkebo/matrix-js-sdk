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

import { Method } from "../../http-api/method";
import { MatrixError } from "../../http-api/errors";
import { NotFoundError, ValidationError } from "../../errors";
import { logger } from "../../logger";
import { AdminBaseManager, type AdminErrorCallback, type ManagerOpts } from "../admin-base-manager";
import { AdminValidators } from "../validators";
import { buildPaginationParams, buildQueryParams } from "../utils";
import { toPaginatedResult } from "../../common/pagination";
import type {
    DeviceInfo,
    MediaInfo,
    UserMediaList,
    AccountStatus,
    WhoisResponse,
    UserPusher,
    PaginatedResponse,
    AdminAccountDetails,
    ShadowBanStatus,
    RateLimitConfig,
    AdminLoginAsUserRequest,
    AdminLoginAsUserResponse,
    BatchCreateUsersRequest,
    BatchCreateUsersResponse,
    BatchDeactivateUsersRequest,
    BatchDeactivateUsersResponse,
    UpdateAccountDetailsRequest,
    UpdateAccountDetailsResponse,
    AdminLogoutResponse,
    AdminEvictResponse,
    UserSession,
    AdminToken,
    AdminRefreshToken,
    AdminLogoutRequest,
    AdminEvictRequest,
    UserStatsResponse,
    UserStatsListResponse,
    UserRoomsResponse,
    UserNotificationResponse,
    UserNotificationPayload,
} from "../types";
import type { ISynapseAdminWhoisResponse, ISynapseAdminDeactivateResponse } from "../../@types/synapse";
import { MatrixClient } from "../../client";

export enum AdminUserEvent {
    UserCreated = "UserCreated",
    UserActivated = "UserActivated",
    UserDeactivated = "UserDeactivated",
    UserShadowBanned = "UserShadowBanned",
    UserUnshadowBanned = "UserUnshadowBanned",
}

export interface AdminUserEventMap {
    [AdminUserEvent.UserCreated]: (userId: string, user: AdminAccountDetails) => void;
    [AdminUserEvent.UserActivated]: (userId: string, user: AdminAccountDetails) => void;
    [AdminUserEvent.UserDeactivated]: (userId: string) => void;
    [AdminUserEvent.UserShadowBanned]: (userId: string) => void;
    [AdminUserEvent.UserUnshadowBanned]: (userId: string) => void;
}

export class AdminUserManager extends AdminBaseManager<AdminUserEvent, AdminUserEventMap> {
    constructor(client: MatrixClient, onError?: AdminErrorCallback, opts?: ManagerOpts) {
        super(client, onError, opts);
    }

    /**
     * 获取用户列表（统一分页格式）
     */
    async getUsersPaginated(options?: {
        from?: string;
        limit?: number;
    }): Promise<PaginatedResponse<AdminAccountDetails>> {
        if (options?.limit !== undefined) {
            AdminValidators.validateLimit(options.limit);
        }

        const queryParams = buildPaginationParams(options?.limit, options?.from);
        let response: {
            users: AdminAccountDetails[];
            next_token?: string;
            total?: number;
        };
        try {
            response = await this.v2Request<{
                users: AdminAccountDetails[];
                next_token?: string;
                total?: number;
            }>(Method.Get, "/v2/users", buildQueryParams(queryParams));
        } catch (e) {
            const err = e as MatrixError;
            if (e instanceof NotFoundError || (err instanceof MatrixError && err.httpStatus === 404)) {
                response = await this.adminRequest<{
                    users: AdminAccountDetails[];
                    next_token?: string;
                    total?: number;
                }>(Method.Get, "/users", buildQueryParams(queryParams));
            } else {
                throw e;
            }
        }

        return toPaginatedResult<AdminAccountDetails>(response as unknown as Record<string, unknown>, "users");
    }

    /**
     * Get user details
     */
    async getUser(userId: string, throwOnError = true): Promise<AdminAccountDetails | null> {
        AdminValidators.validateUserId(userId);

        try {
            try {
                return await this.v2Request<AdminAccountDetails>(
                    Method.Get,
                    `/v2/users/${encodeURIComponent(userId)}`,
                    undefined,
                    undefined,
                    "getUser",
                );
            } catch (e) {
                const err = e as MatrixError;
                if (e instanceof NotFoundError || (err instanceof MatrixError && err.httpStatus === 404)) {
                    return await this.adminRequest<AdminAccountDetails>(
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
                logger.warn(`AdminUserManager.getUser failed for ${userId}:`, e);
                return null;
            }
            throw e;
        }
    }

    /**
     * 通过用户 ID 获取用户详情（getUser 的语义化别名）
     *
     * @param userId - 用户 ID
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 用户详情或 null
     */
    async getUserById(userId: string, throwOnError = true): Promise<AdminAccountDetails | null> {
        return this.getUser(userId, throwOnError);
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
    ): Promise<AdminAccountDetails> {
        AdminValidators.validateUserId(userId);

        const user = await this.v2Request<AdminAccountDetails>(
            Method.Put,
            `/v2/users/${encodeURIComponent(userId)}`,
            undefined,
            options || {},
        );

        this.emit(AdminUserEvent.UserCreated, userId, user);
        return user;
    }

    /**
     * 重新激活已停用的用户。
     *
     * 走 Admin v2 的 upsert 语义：`PUT /_synapse/admin/v2/users/{userId}` + `{ deactivated: false }`。
     * 与 `deactivateUser()`（v1 `POST .../deactivate`）不是同一条路由，故不能互相替代。
     *
     * @param userId - 目标用户 ID
     * @returns 更新后的用户详情
     */
    async activateUser(userId: string): Promise<AdminAccountDetails> {
        AdminValidators.validateUserId(userId);

        const user = await this.v2Request<AdminAccountDetails>(
            Method.Put,
            `/v2/users/${encodeURIComponent(userId)}`,
            undefined,
            { deactivated: false },
        );

        this.emit(AdminUserEvent.UserActivated, userId, user);
        return user;
    }

    async deactivateUser(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);

        await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/deactivate`);
        this.emit(AdminUserEvent.UserDeactivated, userId);
    }

    async deleteUser(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        try {
            await this.adminRequest(Method.Delete, `/users/${encodeURIComponent(userId)}`);
        } catch (e) {
            const err = e as MatrixError;
            if (e instanceof NotFoundError || (err instanceof MatrixError && err.httpStatus === 404)) {
                await this.v2Request(Method.Delete, `/v2/users/${encodeURIComponent(userId)}`);
                return;
            }
            throw e;
        }
    }

    async batchCreateUsers(payload: BatchCreateUsersRequest): Promise<BatchCreateUsersResponse> {
        return await this.adminRequest(Method.Post, "/users/batch", {}, payload);
    }

    async batchDeactivateUsers(payload: BatchDeactivateUsersRequest): Promise<BatchDeactivateUsersResponse> {
        return await this.adminRequest(Method.Post, "/users/batch_deactivate", {}, payload);
    }

    /**
     * 重置用户密码
     */
    async resetPassword(userId: string, newPassword: string): Promise<void> {
        AdminValidators.validateUserId(userId);

        await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/password`, undefined, {
            new_password: newPassword,
        });
    }

    /**
     * 设置用户管理员权限
     */
    async setAdmin(userId: string, admin: boolean): Promise<void> {
        AdminValidators.validateUserId(userId);
        await this.adminRequest(Method.Put, `/users/${encodeURIComponent(userId)}/admin`, undefined, { admin });
    }

    /**
     * 获取用户的设备列表
     */
    async getUserDevices(userId: string): Promise<DeviceInfo[]> {
        AdminValidators.validateUserId(userId);
        // `v2Request GET /v2/users/{id}/devices` 回退分支已删除：后端设备端点只注册在
        // `/_synapse/admin/v1/users/{user_id}/devices`，v2 命名空间下没有 devices。
        const response = await this.adminRequest<{ devices: DeviceInfo[] }>(
            Method.Get,
            `/users/${encodeURIComponent(userId)}/devices`,
        );
        return response.devices || [];
    }

    /**
     * 删除用户的设备
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
     */
    async deleteUserDevice(userId: string, deviceId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        if (!deviceId) throw new ValidationError("Device ID is required");
        try {
            await this.adminRequest(
                Method.Delete,
                `/users/${encodeURIComponent(userId)}/devices/${encodeURIComponent(deviceId)}`,
            );
        } catch (e) {
            const err = e as MatrixError;
            if (e instanceof NotFoundError || (err instanceof MatrixError && err.httpStatus === 404)) {
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

    async getUserTokens(userId: string): Promise<{ tokens: AdminToken[] }> {
        AdminValidators.validateUserId(userId);
        const response = await this.adminRequest<{ tokens?: AdminToken[] }>(
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

    async getUserRefreshTokens(userId: string): Promise<{ refresh_tokens: AdminRefreshToken[] }> {
        AdminValidators.validateUserId(userId);
        const response = await this.adminRequest<{ refresh_tokens?: AdminRefreshToken[] }>(
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

    async getUserSession(userId: string): Promise<UserSession> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Get, `/user_sessions/${encodeURIComponent(userId)}`);
    }

    async getUserRooms(userId: string, from?: string, limit?: number): Promise<UserRoomsResponse> {
        AdminValidators.validateUserId(userId);
        const query = buildPaginationParams(limit, from);
        return await this.adminRequest(Method.Get, `/users/${encodeURIComponent(userId)}/rooms`, query);
    }

    async getUserStats(userId: string): Promise<UserStatsResponse> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Get, `/users/${encodeURIComponent(userId)}/stats`);
    }

    async listUserStats(from?: string, limit?: number): Promise<UserStatsListResponse> {
        const query = buildPaginationParams(limit, from);
        return await this.adminRequest(Method.Get, "/user_stats", query);
    }

    async invalidateUserSession(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        await this.adminRequest(Method.Post, `/user_sessions/${encodeURIComponent(userId)}/invalidate`, {}, undefined);
    }

    async loginAsUser(userId: string, payload?: AdminLoginAsUserRequest): Promise<AdminLoginAsUserResponse> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/login`, {}, payload ?? {});
    }

    async logoutUser(userId: string, payload?: AdminLogoutRequest): Promise<AdminLogoutResponse> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/logout`, {}, payload ?? {});
    }

    async evictUser(userId: string, payload?: AdminEvictRequest): Promise<AdminEvictResponse> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/evict`, {}, payload ?? {});
    }

    /**
     * 获取账户状态
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
            logger.warn(`AdminUserManager.isAdmin failed for ${userId}:`, e);
            return false;
        }
    }

    /**
     * 覆盖用户速率限制（完全禁用限制）
     */
    async overrideRateLimit(userId: string): Promise<void> {
        await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/override_ratelimit`);
    }

    /**
     * 获取用户速率限制覆盖状态
     * 后端 override_ratelimit 端点实际返回与 rate_limit 相同的 {messages_per_second, burst_count} 结构
     */
    async getRateLimitOverride(userId: string, throwOnError = true): Promise<RateLimitConfig | null> {
        try {
            return await this.adminRequest<RateLimitConfig>(
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
     */
    async deleteRateLimitOverride(userId: string): Promise<void> {
        await this.adminRequest(Method.Delete, `/users/${encodeURIComponent(userId)}/override_ratelimit`);
    }

    async shadowBanUser(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/shadow_ban`, {}, undefined);
        this.emit(AdminUserEvent.UserShadowBanned, userId);
    }

    async unshadowBanUser(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        await this.adminRequest(Method.Delete, `/users/${encodeURIComponent(userId)}/shadow_ban`, {}, undefined);
        this.emit(AdminUserEvent.UserUnshadowBanned, userId);
    }

    async getShadowBanStatus(userId: string, throwOnError = true): Promise<ShadowBanStatus | null> {
        try {
            return await this.adminRequest<ShadowBanStatus>(
                Method.Get,
                `/users/${encodeURIComponent(userId)}/shadow_ban`,
            );
            // @swallow-error { owner: "admin", expires: "2026-12-31" }
        } catch (e) {
            const err = e as MatrixError;
            if (!throwOnError && (e instanceof NotFoundError || (err instanceof MatrixError && err.httpStatus === 404)))
                return null;
            throw e;
        }
    }

    async getRateLimit(userId: string, throwOnError = true): Promise<RateLimitConfig | null> {
        try {
            return await this.adminRequest(Method.Get, `/users/${encodeURIComponent(userId)}/rate_limit`);
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            try {
                return await this.getRateLimitOverride(userId, throwOnError);
                // @swallow-error { owner: "admin", expires: "2026-12-31" }
            } catch (fallbackErr) {
                const err = fallbackErr as MatrixError;
                if (
                    !throwOnError &&
                    (fallbackErr instanceof NotFoundError || (err instanceof MatrixError && err.httpStatus === 404))
                ) {
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
            if (e instanceof NotFoundError || (err instanceof MatrixError && err.httpStatus === 404)) {
                await this.adminRequest(
                    Method.Post,
                    `/users/${encodeURIComponent(userId)}/override_ratelimit`,
                    {},
                    config,
                );
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
            if (e instanceof NotFoundError || (err instanceof MatrixError && err.httpStatus === 404)) {
                await this.deleteRateLimitOverride(userId);
                return;
            }
            throw e;
        }
    }

    async getAccountDetails(userId: string): Promise<AdminAccountDetails> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest<AdminAccountDetails>(Method.Get, `/account/${encodeURIComponent(userId)}`);
    }

    async updateAccountDetails(
        userId: string,
        payload: UpdateAccountDetailsRequest,
    ): Promise<UpdateAccountDetailsResponse> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Post, `/account/${encodeURIComponent(userId)}`, {}, payload);
    }

    /**
     * 获取用户 Whois 信息
     */
    async getUserWhois(userId: string): Promise<WhoisResponse> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest<WhoisResponse>(Method.Get, `/whois/${encodeURIComponent(userId)}`);
    }

    async whois(userId: string): Promise<WhoisResponse> {
        return await this.getUserWhois(userId);
    }

    async whoisByDevice(userId: string, deviceId: string): Promise<WhoisResponse> {
        AdminValidators.validateUserId(userId);
        if (!deviceId) throw new ValidationError("Device ID is required");
        return await this.adminRequest(
            Method.Get,
            `/whois/${encodeURIComponent(userId)}/${encodeURIComponent(deviceId)}`,
        );
    }

    /**
     * 获取用户上传的媒体列表
     *
     * ⚠️ 后端（`admin/media.rs::get_user_media`）只返回 `{media, total}`：既不读 `limit` / `from`，
     * 也不返回分页游标（原先声明的 `next_token` 后端从不返回，恒为 `undefined`）。
     * 与 `AdminMediaManager.getUserMedia` 是同一端点的两条入口。
     *
     * @param userId - 用户 MXC ID（如 `@alice:example.org`）
     * @param from - 分页起点（当前后端忽略）
     * @param limit - 返回条数上限（当前后端忽略）
     * @returns 用户的媒体列表与条数
     *
     * @example
     * ```typescript
     * const { media, total } = await adminManager.getUserMedia("@alice:example.org");
     * console.log(`${total} 个媒体`, media.map((m) => m.media_id));
     * ```
     */
    async getUserMedia(userId: string, from?: string, limit?: number): Promise<UserMediaList> {
        AdminValidators.validateUserId(userId);
        const queryParams = buildPaginationParams(limit, from);
        const response = await this.adminRequest<{ media?: MediaInfo[]; total?: number }>(
            Method.Get,
            `/users/${encodeURIComponent(userId)}/media`,
            queryParams,
        );
        const media = response.media ?? [];
        return { media, total: response.total ?? media.length };
    }

    async deleteUserMedia(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        await this.adminRequest(Method.Delete, `/users/${encodeURIComponent(userId)}/media`);
    }

    async getUserNotification(userId: string): Promise<UserNotificationResponse> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Get, `/users/${encodeURIComponent(userId)}/notification`);
    }

    async setUserNotification(userId: string, payload: UserNotificationPayload): Promise<UserNotificationResponse> {
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

    async blockEventReportUser(userId: string, payload: { blocked_until?: number; reason?: string }): Promise<void> {
        await this.adminRequest(
            Method.Post,
            `/event_reports/rate_limit/${encodeURIComponent(userId)}/block`,
            {},
            payload,
        );
    }

    async unblockEventReportUser(userId: string): Promise<void> {
        await this.adminRequest(
            Method.Post,
            `/event_reports/rate_limit/${encodeURIComponent(userId)}/unblock`,
            {},
            undefined,
        );
    }

    // ===== Synapse-specific admin methods =====

    /**
     * Determines if the current user is an administrator of the Synapse homeserver.
     * Returns false if untrue or the homeserver does not appear to be a Synapse
     * homeserver. <strong>This function is implementation specific and may change
     * as a result.</strong>
     * @param userId - The user ID to check.
     * @returns true if the user appears to be a Synapse administrator.
     */
    async isSynapseAdministrator(userId: string): Promise<boolean> {
        const path = `/v1/users/${encodeURIComponent(userId)}/admin`;
        const response = await this.request<{ admin: boolean }>({
            method: Method.Get,
            path,
            prefix: "/_synapse/admin",
        });
        return response.admin;
    }

    /**
     * Performs a whois lookup on a user using Synapse's administrator API.
     * <strong>This function is implementation specific and may change as a
     * result.</strong>
     * @param userId - the User ID to look up.
     * @returns the whois response - see Synapse docs for information.
     */
    async whoisSynapseUser(userId: string): Promise<ISynapseAdminWhoisResponse> {
        const path = `/v1/whois/${encodeURIComponent(userId)}`;
        return this.request<ISynapseAdminWhoisResponse>({
            method: Method.Get,
            path,
            prefix: "/_synapse/admin",
        });
    }

    /**
     * Deactivates a user using Synapse's administrator API. <strong>This
     * function is implementation specific and may change as a result.</strong>
     * @param userId - the User ID to deactivate.
     * @returns the deactivate response - see Synapse docs for information.
     */
    async deactivateSynapseUser(userId: string): Promise<ISynapseAdminDeactivateResponse> {
        const path = `/v1/deactivate/${encodeURIComponent(userId)}`;
        return this.request<ISynapseAdminDeactivateResponse>({
            method: Method.Post,
            path,
            prefix: "/_synapse/admin",
        });
    }
}
