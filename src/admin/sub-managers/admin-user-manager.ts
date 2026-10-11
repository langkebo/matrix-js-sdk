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
    UserSessionsResponse,
    InvalidateUserSessionsResponse,
    AdminToken,
    AdminRefreshToken,
    UserTokensResponse,
    UserRefreshTokensResponse,
    AdminLogoutRequest,
    AdminEvictRequest,
    UserStatsResponse,
    UserStatsListResponse,
    UserRoomsResponse,
    UserNotificationResponse,
    UserNotificationUpdateResponse,
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
     *
     * 优先走 Admin v2 的 `GET /v2/users`，端点不存在时回退到 `GET /users`，
     * 并把后端分页结构统一映射为 {@link PaginatedResponse}。
     *
     * @param options - 分页选项：`limit` 每页条数、`from` 游标
     * @returns 统一分页格式的用户列表
     *
     * @example
     * ```typescript
     * const page = await client.getAdminManager().users.getUsersPaginated({ limit: 50 });
     * console.log(page.items.length, page.next);
     * ```
     *
     * @throws {Error} 当请求失败且无法回退到 v1 端点时抛出
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
     * 获取用户详情
     *
     * 优先走 Admin v2 的 `GET /v2/users/{userId}`，端点不存在时回退到
     * `GET /users/{userId}`。当 `throwOnError` 为 `false` 且用户不存在时返回 `null`。
     *
     * @param userId - 用户 ID
     * @param throwOnError - 是否在出错时抛出（默认 `true`）
     * @returns 用户详情，或用户不存在且 `throwOnError` 为 `false` 时返回 `null`
     *
     * @example
     * ```typescript
     * const user = await client.getAdminManager().users.getUser("@alice:example.org");
     * console.log(user?.displayname, user?.admin);
     * ```
     *
     * @throws {Error} 当请求失败且 `throwOnError` 为 `true` 时抛出
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
     *
     * @example
     * ```typescript
     * const user = await client.getAdminManager().users.getUserById("@alice:example.org");
     * console.log(user?.displayname);
     * ```
     */
    async getUserById(userId: string, throwOnError = true): Promise<AdminAccountDetails | null> {
        return this.getUser(userId, throwOnError);
    }

    /**
     * 创建新用户
     *
     * 走 Admin v2 的 upsert 语义：`PUT /v2/users/{userId}`。
     *
     * @param userId - 用户 ID
     * @param options - 创建选项：`password` / `displayname` / `admin` / `deactivated`
     * @returns 创建出的用户详情
     *
     * @example
     * ```typescript
     * const user = await client.getAdminManager().users.createUser("@alice:example.org", {
     *     password: "s3cret",
     *     admin: false,
     * });
     * console.log(user.name);
     * ```
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
     *
     * @example
     * ```typescript
     * const user = await client.getAdminManager().users.activateUser("@alice:example.org");
     * console.log(user.deactivated);
     * ```
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

    /**
     * 停用用户。
     *
     * 走 v1 路由 `POST /users/{userId}/deactivate`；成功后发出
     * {@link AdminUserEvent.UserDeactivated} 事件。
     *
     * @param userId - 目标用户 ID
     *
     * @example
     * ```typescript
     * await client.getAdminManager().users.deactivateUser("@alice:example.org");
     * ```
     */
    async deactivateUser(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);

        await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/deactivate`);
        this.emit(AdminUserEvent.UserDeactivated, userId);
    }

    /**
     * 删除用户。
     *
     * 优先走 v1 的 `DELETE /users/{userId}`，端点不存在时回退到
     * `DELETE /v2/users/{userId}`。
     *
     * @param userId - 目标用户 ID
     *
     * @example
     * ```typescript
     * await client.getAdminManager().users.deleteUser("@alice:example.org");
     * ```
     *
     * @throws {Error} 当请求失败且无法回退到 v2 端点时抛出
     */
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

    /**
     * 批量创建用户。
     *
     * 对应 `POST /users/batch`。
     *
     * @param payload - 批量创建请求载荷（`users` 数组，元素含 `username` 等字段）
     * @returns 批量创建结果
     *
     * @example
     * ```typescript
     * const result = await client.getAdminManager().users.batchCreateUsers({
     *     users: [{ username: "bob", password: "s3cret" }],
     * });
     * console.log(result);
     * ```
     */
    async batchCreateUsers(payload: BatchCreateUsersRequest): Promise<BatchCreateUsersResponse> {
        return await this.adminRequest(Method.Post, "/users/batch", {}, payload);
    }

    /**
     * 批量停用（可选择性擦除）用户。
     *
     * 对应 `POST /users/batch_deactivate`。
     *
     * @param payload - 批量停用请求载荷（`users` 为待停用用户 ID 列表，`erase` 是否擦除数据）
     * @returns 批量停用结果
     *
     * @example
     * ```typescript
     * const result = await client.getAdminManager().users.batchDeactivateUsers({
     *     users: ["@bob:example.org"],
     *     erase: true,
     * });
     * console.log(result.deactivated, result.failed);
     * ```
     */
    async batchDeactivateUsers(payload: BatchDeactivateUsersRequest): Promise<BatchDeactivateUsersResponse> {
        return await this.adminRequest(Method.Post, "/users/batch_deactivate", {}, payload);
    }

    /**
     * 重置用户密码
     *
     * 对应 `POST /users/{userId}/password`。
     *
     * @param userId - 目标用户 ID
     * @param newPassword - 新密码
     *
     * @example
     * ```typescript
     * await client.getAdminManager().users.resetPassword("@alice:example.org", "n3w-s3cret");
     * ```
     */
    async resetPassword(userId: string, newPassword: string): Promise<void> {
        AdminValidators.validateUserId(userId);

        await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/password`, undefined, {
            new_password: newPassword,
        });
    }

    /**
     * 设置用户管理员权限
     *
     * 对应 `PUT /users/{userId}/admin`。
     *
     * @param userId - 目标用户 ID
     * @param admin - 是否授予管理员权限
     *
     * @example
     * ```typescript
     * await client.getAdminManager().users.setAdmin("@alice:example.org", true);
     * ```
     */
    async setAdmin(userId: string, admin: boolean): Promise<void> {
        AdminValidators.validateUserId(userId);
        await this.adminRequest(Method.Put, `/users/${encodeURIComponent(userId)}/admin`, undefined, { admin });
    }

    /**
     * 获取用户的设备列表
     *
     * 对应 `GET /users/{userId}/devices`。
     *
     * @param userId - 目标用户 ID
     * @returns 该用户的设备列表
     *
     * @example
     * ```typescript
     * const devices = await client.getAdminManager().users.getUserDevices("@alice:example.org");
     * console.log(devices.map((d) => d.device_id));
     * ```
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
     * 删除用户的单个设备
     *
     * 优先走 `DELETE /users/{userId}/devices/{deviceId}`，端点不存在时回退到
     * `POST /users/{userId}/devices/{deviceId}/delete`。
     *
     * @param userId - 目标用户 ID
     * @param deviceId - 设备 ID
     *
     * @example
     * ```typescript
     * await client.getAdminManager().users.deleteUserDevice("@alice:example.org", "ABCDEFGHIJ");
     * ```
     *
     * @throws {ValidationError} 如果 deviceId 为空
     * @throws {Error} 当请求失败且无法回退到 delete 端点时抛出
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

    /**
     * 列出用户的 access token。
     *
     * 后端 `GET /_synapse/admin/v1/users/{user_id}/tokens` 返回
     * `{tokens: [{id, device_id, created_ts, expires_at, is_revoked}], total}`。
     *
     * @param userId - 用户 id
     *
     * @example
     * ```typescript
     * const { tokens, total } = await adminManager.getUserTokens("@alice:example.org");
     * console.log(total, tokens.map((t) => t.device_id));
     * ```
     *
     * @throws {ValidationError} 如果 userId 为空
     */
    async getUserTokens(userId: string): Promise<UserTokensResponse> {
        AdminValidators.validateUserId(userId);
        const response = await this.adminRequest<{ tokens?: AdminToken[]; total?: number }>(
            Method.Get,
            `/users/${encodeURIComponent(userId)}/tokens`,
        );
        const tokens = response.tokens || [];
        return { tokens, total: response.total ?? tokens.length };
    }

    /**
     * 删除用户的某个 access token。
     *
     * @param userId - 用户 id
     * @param tokenId - token id（整数，后端 `Path<(UserId, i64)>`）
     *
     * @example
     * ```typescript
     * await adminManager.deleteUserToken("@alice:example.org", "12");
     * ```
     *
     * @throws {ValidationError} 如果 userId 或 tokenId 为空
     */
    async deleteUserToken(userId: string, tokenId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        if (!tokenId) throw new ValidationError("Token ID is required");
        await this.adminRequest(
            Method.Delete,
            `/users/${encodeURIComponent(userId)}/tokens/${encodeURIComponent(tokenId)}`,
        );
    }

    /**
     * 列出用户的 refresh token。
     *
     * 后端返回 `{refresh_tokens: [{id, device_id, created_ts, expires_at, is_revoked}], total}`。
     *
     * @param userId - 用户 id
     *
     * @example
     * ```typescript
     * const { refresh_tokens, total } = await adminManager.getUserRefreshTokens("@alice:example.org");
     * console.log(total, refresh_tokens);
     * ```
     *
     * @throws {ValidationError} 如果 userId 为空
     */
    async getUserRefreshTokens(userId: string): Promise<UserRefreshTokensResponse> {
        AdminValidators.validateUserId(userId);
        const response = await this.adminRequest<{ refresh_tokens?: AdminRefreshToken[]; total?: number }>(
            Method.Get,
            `/users/${encodeURIComponent(userId)}/refresh_tokens`,
        );
        const refresh_tokens = response.refresh_tokens || [];
        return { refresh_tokens, total: response.total ?? refresh_tokens.length };
    }

    /**
     * 删除用户的某个 refresh token。
     *
     * @param userId - 用户 id
     * @param tokenId - token id
     *
     * @example
     * ```typescript
     * await adminManager.deleteUserRefreshToken("@alice:example.org", "12");
     * ```
     *
     * @throws {ValidationError} 如果 userId 或 tokenId 为空
     */
    async deleteUserRefreshToken(userId: string, tokenId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        if (!tokenId) throw new ValidationError("Token ID is required");
        await this.adminRequest(
            Method.Delete,
            `/users/${encodeURIComponent(userId)}/refresh_tokens/${encodeURIComponent(tokenId)}`,
        );
    }

    /**
     * 获取用户的会话（设备）列表。
     *
     * ⚠️ 后端 `GET /_synapse/admin/v1/user_sessions/{user_id}` 返回**包装对象**
     * `{user_id, sessions: [{session_id, device_id, display_name, last_seen_ts, last_seen_ip}], total}`；
     * 旧实现把包装对象当成 `UserSession` 直接返回，于是 `session_id` / `device_id` 恒为 `undefined`。
     *
     * @param userId - 用户 id
     *
     * @example
     * ```typescript
     * const page = await adminManager.getUserSession("@alice:example.org");
     * console.log(page.total, page.sessions.map((s) => s.session_id));
     * ```
     *
     * @throws {ValidationError} 如果 userId 为空
     */
    async getUserSession(userId: string): Promise<UserSessionsResponse> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Get, `/user_sessions/${encodeURIComponent(userId)}`);
    }

    /**
     * 列出用户加入的房间（分页）。
     *
     * 后端返回 `{joined_rooms, total, next_batch}`。
     *
     * @param userId - 用户 id
     * @param from - 分页游标
     * @param limit - 每页条数
     *
     * @example
     * ```typescript
     * const page = await adminManager.getUserRooms("@alice:example.org", undefined, 50);
     * console.log(page.total, page.joined_rooms);
     * ```
     *
     * @throws {ValidationError} 如果 userId 为空
     */
    async getUserRooms(userId: string, from?: string, limit?: number): Promise<UserRoomsResponse> {
        AdminValidators.validateUserId(userId);
        const query = buildPaginationParams(limit, from);
        return await this.adminRequest(Method.Get, `/users/${encodeURIComponent(userId)}/rooms`, query);
    }

    /**
     * 获取单个用户的统计。
     *
     * @param userId - 用户 id
     *
     * @example
     * ```typescript
     * const stats = await adminManager.getUserStats("@alice:example.org");
     * console.log(stats.rooms_joined, stats.messages_sent);
     * ```
     *
     * @throws {ValidationError} 如果 userId 为空
     */
    async getUserStats(userId: string): Promise<UserStatsResponse> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Get, `/users/${encodeURIComponent(userId)}/stats`);
    }

    /**
     * 获取全站用户统计汇总（不分页）。
     *
     * @example
     * ```typescript
     * const stats = await adminManager.listUserStats();
     * console.log(stats.total_users, stats.active_users);
     * ```
     */
    async listUserStats(): Promise<UserStatsListResponse> {
        return await this.adminRequest(Method.Get, "/user_stats");
    }

    /**
     * 使某用户的全部会话失效。
     *
     * 后端返回 `{invalidated, sessions_removed}`；旧实现声明 `void` 并丢弃。
     *
     * @param userId - 用户 id
     *
     * @example
     * ```typescript
     * const result = await adminManager.invalidateUserSession("@alice:example.org");
     * console.log(result.sessions_removed);
     * ```
     *
     * @throws {ValidationError} 如果 userId 为空
     */
    async invalidateUserSession(userId: string): Promise<InvalidateUserSessionsResponse> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(
            Method.Post,
            `/user_sessions/${encodeURIComponent(userId)}/invalidate`,
            {},
            undefined,
        );
    }

    /**
     * 以某用户身份登录（管理端互登录）。
     *
     * ⚠️ **`payload` 后端不读**：`user.rs::login_as_user` 的签名里没有 `Json` 提取器，
     * device_id 由后端随机生成、`is_admin` 取自目标用户。参数保留仅为向后兼容，
     * 已在 `admin-response-contract-ledger.json` 登记为待决项。
     *
     * @param userId - 目标用户 id
     * @param payload - **被后端忽略**；见上方说明
     *
     * @example
     * ```typescript
     * const { access_token, device_id } = await adminManager.loginAsUser("@alice:example.org");
     * ```
     *
     * @throws {ValidationError} 如果 userId 为空
     */
    async loginAsUser(userId: string, payload?: AdminLoginAsUserRequest): Promise<AdminLoginAsUserResponse> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/login`, {}, payload ?? {});
    }

    /**
     * 登出某用户的会话。
     *
     * ⚠️⚠️ **会登出该用户的「全部」设备**：后端 `user.rs::logout_user_devices` 调
     * `token_auth.logout_all(user_id)`，**既不读请求体、也不支持按设备筛选**。
     * 传 `{ devices: [...] }` 会造成"只登出了这些设备"的错觉，而实际是全部登出。
     * 参数保留仅为向后兼容，已在 `admin-response-contract-ledger.json` 登记为待决项。
     *
     * @param userId - 用户 id
     * @param payload - **被后端忽略，且不会缩小登出范围**；见上方说明
     *
     * @example
     * ```typescript
     * const { devices_deleted } = await adminManager.logoutUser("@alice:example.org");
     * ```
     *
     * @throws {ValidationError} 如果 userId 为空
     */
    async logoutUser(userId: string, payload?: AdminLogoutRequest): Promise<AdminLogoutResponse> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/logout`, {}, payload ?? {});
    }

    /**
     * 把用户从其加入的全部房间中逐出。
     *
     * ⚠️ **`payload` 后端不读**：`user.rs::evict_user` 的签名里没有 `Json` 提取器，
     * 也就没有"逐出原因"这条链路。参数保留仅为向后兼容。
     *
     * @param userId - 用户 id
     * @param payload - **被后端忽略**；见上方说明
     *
     * @example
     * ```typescript
     * const result = await adminManager.evictUser("@alice:example.org");
     * console.log(result.rooms_evicted, result.failures);
     * ```
     *
     * @throws {ValidationError} 如果 userId 为空
     */
    async evictUser(userId: string, payload?: AdminEvictRequest): Promise<AdminEvictResponse> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/evict`, {}, payload ?? {});
    }

    /**
     * 获取账户状态
     *
     * 对应 `GET /account/{userId}`；当 `throwOnError` 为 `false` 且用户不存在时返回 `null`。
     *
     * @param userId - 目标用户 ID
     * @param throwOnError - 是否在出错时抛出（默认 `true`）
     * @returns 账户状态，或用户不存在且 `throwOnError` 为 `false` 时返回 `null`
     *
     * @example
     * ```typescript
     * const status = await client.getAdminManager().users.getAccountStatus("@alice:example.org");
     * console.log(status?.deactivated, status?.device_count);
     * ```
     *
     * @throws {Error} 当请求失败且 `throwOnError` 为 `true` 时抛出
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
     * 对应 `GET /users/{userId}/admin`。
     *
     * @param userId - 目标用户 ID
     * @param throwOnError - 是否在出错时抛出（默认 `true`）
     * @returns 该用户是否为管理员；`throwOnError` 为 `false` 且请求失败时返回 `false`
     *
     * @example
     * ```typescript
     * const admin = await client.getAdminManager().users.isAdmin("@alice:example.org");
     * console.log(admin);
     * ```
     *
     * @throws {Error} 当请求失败且 `throwOnError` 为 `true` 时抛出
     */
    async isAdmin(userId: string, throwOnError = true): Promise<boolean> {
        try {
            const response = await this.adminRequest<{ admin: boolean }>(
                Method.Get,
                `/users/${encodeURIComponent(userId)}/admin`,
            );
            return response.admin;
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            logger.warn(`AdminUserManager.isAdmin failed for ${userId}:`, e);
        }
        return false;
    }

    /**
     * 设置用户的速率限制覆盖（`POST /users/{user_id}/override_ratelimit`）。
     *
     * ⚠️ 后端 `security.rs::set_user_override_rate_limit` 走
     * `Json<RateLimitRequest>`（字段 `{messages_per_second, burst_count}`，带
     * `#[serde(deny_unknown_fields)]`）。**没有请求体时 axum 会以 415 拒绝**
     * （SDK 只在 body 是对象时才设 `Content-Type: application/json`）——
     * 旧实现就是这个形态，调用必失败。
     *
     * 覆盖是"另设一套限额"，**不是**禁用限制；省略字段时后端用默认值
     * （`messages_per_second = 5.0`、`burst_count = 10`）。要移除覆盖请用
     * {@link deleteRateLimitOverride}。
     *
     * @param userId - 用户 id
     * @param config - 覆盖用的限额；省略时按后端默认值
     *
     * @example
     * ```typescript
     * await adminManager.overrideRateLimit("@alice:example.org", { messages_per_second: 2, burst_count: 5 });
     * ```
     *
     * @throws {ValidationError} 如果 userId 为空
     */
    async overrideRateLimit(userId: string, config?: RateLimitConfig): Promise<RateLimitConfig> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest<RateLimitConfig>(
            Method.Post,
            `/users/${encodeURIComponent(userId)}/override_ratelimit`,
            {},
            config ?? {},
        );
    }

    /**
     * 获取用户速率限制覆盖状态
     * 后端 override_ratelimit 端点实际返回与 rate_limit 相同的 {messages_per_second, burst_count} 结构
     *
     * @param userId - 目标用户 ID
     * @param throwOnError - 是否在出错时抛出（默认 `true`）
     * @returns 速率限制覆盖配置，或覆盖不存在且 `throwOnError` 为 `false` 时返回 `null`
     *
     * @example
     * ```typescript
     * const config = await client.getAdminManager().users.getRateLimitOverride("@alice:example.org");
     * console.log(config?.messages_per_second, config?.burst_count);
     * ```
     *
     * @throws {Error} 当请求失败且 `throwOnError` 为 `true` 时抛出
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
     *
     * 对应 `DELETE /users/{userId}/override_ratelimit`。
     *
     * @param userId - 目标用户 ID
     *
     * @example
     * ```typescript
     * await client.getAdminManager().users.deleteRateLimitOverride("@alice:example.org");
     * ```
     */
    async deleteRateLimitOverride(userId: string): Promise<void> {
        await this.adminRequest(Method.Delete, `/users/${encodeURIComponent(userId)}/override_ratelimit`);
    }

    /**
     * 影子封禁用户。
     *
     * 对应 `POST /users/{userId}/shadow_ban`；成功后发出
     * {@link AdminUserEvent.UserShadowBanned} 事件。
     *
     * @param userId - 目标用户 ID
     *
     * @example
     * ```typescript
     * await client.getAdminManager().users.shadowBanUser("@spammer:example.org");
     * ```
     */
    async shadowBanUser(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        await this.adminRequest(Method.Post, `/users/${encodeURIComponent(userId)}/shadow_ban`, {}, undefined);
        this.emit(AdminUserEvent.UserShadowBanned, userId);
    }

    /**
     * 解除影子封禁。
     *
     * 对应 `DELETE /users/{userId}/shadow_ban`；成功后发出
     * {@link AdminUserEvent.UserUnshadowBanned} 事件。
     *
     * @param userId - 目标用户 ID
     *
     * @example
     * ```typescript
     * await client.getAdminManager().users.unshadowBanUser("@spammer:example.org");
     * ```
     */
    async unshadowBanUser(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        await this.adminRequest(Method.Delete, `/users/${encodeURIComponent(userId)}/shadow_ban`, {}, undefined);
        this.emit(AdminUserEvent.UserUnshadowBanned, userId);
    }

    /**
     * 获取用户的影子封禁状态。
     *
     * 对应 `GET /users/{userId}/shadow_ban`。
     *
     * @param userId - 目标用户 ID
     * @param throwOnError - 是否在出错时抛出（默认 `true`）
     * @returns 影子封禁状态，或不存在且 `throwOnError` 为 `false` 时返回 `null`
     *
     * @example
     * ```typescript
     * const status = await client.getAdminManager().users.getShadowBanStatus("@alice:example.org");
     * console.log(status?.banned);
     * ```
     *
     * @throws {Error} 当请求失败且 `throwOnError` 为 `true` 时抛出
     */
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

    /**
     * 获取用户速率限制。
     *
     * 优先走 `GET /users/{userId}/rate_limit`，端点不存在时回退到
     * {@link getRateLimitOverride}。
     *
     * @param userId - 目标用户 ID
     * @param throwOnError - 是否在出错时抛出（默认 `true`）
     * @returns 速率限制配置，或不存在且 `throwOnError` 为 `false` 时返回 `null`
     *
     * @example
     * ```typescript
     * const config = await client.getAdminManager().users.getRateLimit("@alice:example.org");
     * console.log(config?.messages_per_second);
     * ```
     *
     * @throws {Error} 当请求失败且 `throwOnError` 为 `true` 时抛出
     */
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

    /**
     * 设置用户速率限制。
     *
     * 优先走 `PUT /users/{userId}/rate_limit`，端点不存在时回退到
     * `POST /users/{userId}/override_ratelimit`。
     *
     * @param userId - 目标用户 ID
     * @param config - 速率限制配置：`messages_per_second`、`burst_count`
     *
     * @example
     * ```typescript
     * await client.getAdminManager().users.setRateLimit("@alice:example.org", {
     *     messages_per_second: 2,
     *     burst_count: 5,
     * });
     * ```
     *
     * @throws {Error} 当请求失败且无法回退到 override 端点时抛出
     */
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

    /**
     * 删除用户速率限制。
     *
     * 优先走 `DELETE /users/{userId}/rate_limit`，端点不存在时回退到
     * {@link deleteRateLimitOverride}。
     *
     * @param userId - 目标用户 ID
     *
     * @example
     * ```typescript
     * await client.getAdminManager().users.deleteRateLimit("@alice:example.org");
     * ```
     *
     * @throws {Error} 当请求失败且无法回退到 override 端点时抛出
     */
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

    /**
     * 获取用户账户详情。
     *
     * 对应 `GET /account/{userId}`。
     *
     * @param userId - 目标用户 ID
     * @returns 账户详情
     *
     * @example
     * ```typescript
     * const details = await client.getAdminManager().users.getAccountDetails("@alice:example.org");
     * console.log(details.name, details.admin);
     * ```
     */
    async getAccountDetails(userId: string): Promise<AdminAccountDetails> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest<AdminAccountDetails>(Method.Get, `/account/${encodeURIComponent(userId)}`);
    }

    /**
     * 更新用户账户详情。
     *
     * 对应 `POST /account/{userId}`。
     *
     * @param userId - 目标用户 ID
     * @param payload - 要更新的账户字段（`displayname` / `avatar_url` / `admin`）
     * @returns 更新结果
     *
     * @example
     * ```typescript
     * const result = await client.getAdminManager().users.updateAccountDetails("@alice:example.org", {
     *     displayname: "Alice",
     * });
     * console.log(result.updated);
     * ```
     */
    async updateAccountDetails(
        userId: string,
        payload: UpdateAccountDetailsRequest,
    ): Promise<UpdateAccountDetailsResponse> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Post, `/account/${encodeURIComponent(userId)}`, {}, payload);
    }

    /**
     * 获取用户 Whois 信息
     *
     * 对应 `GET /whois/{userId}`。
     *
     * @param userId - 目标用户 ID
     * @returns Whois 信息
     *
     * @example
     * ```typescript
     * const whois = await client.getAdminManager().users.getUserWhois("@alice:example.org");
     * console.log(whois.user_id, Object.keys(whois.devices));
     * ```
     */
    async getUserWhois(userId: string): Promise<WhoisResponse> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest<WhoisResponse>(Method.Get, `/whois/${encodeURIComponent(userId)}`);
    }

    /**
     * 获取用户 Whois 信息（{@link getUserWhois} 的别名）。
     *
     * @param userId - 目标用户 ID
     * @returns Whois 信息
     *
     * @example
     * ```typescript
     * const whois = await client.getAdminManager().users.whois("@alice:example.org");
     * console.log(whois.user_id);
     * ```
     */
    async whois(userId: string): Promise<WhoisResponse> {
        return await this.getUserWhois(userId);
    }

    /**
     * 获取用户指定设备的 Whois 信息。
     *
     * 对应 `GET /whois/{userId}/{deviceId}`。
     *
     * @param userId - 目标用户 ID
     * @param deviceId - 设备 ID
     * @returns Whois 信息
     *
     * @example
     * ```typescript
     * const whois = await client.getAdminManager().users.whoisByDevice("@alice:example.org", "ABCDEFGHIJ");
     * console.log(whois.user_id);
     * ```
     *
     * @throws {ValidationError} 如果 deviceId 为空
     */
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

    /**
     * 删除用户上传的全部媒体。
     *
     * 对应 `DELETE /users/{userId}/media`。
     *
     * @param userId - 目标用户 ID
     *
     * @example
     * ```typescript
     * await client.getAdminManager().users.deleteUserMedia("@alice:example.org");
     * ```
     */
    async deleteUserMedia(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);
        await this.adminRequest(Method.Delete, `/users/${encodeURIComponent(userId)}/media`);
    }

    /**
     * 获取用户的通知开关状态。
     *
     * 对应 `GET /users/{userId}/notification`，返回 `{enabled}`。
     *
     * @param userId - 目标用户 ID
     * @returns 通知开关状态
     *
     * @example
     * ```typescript
     * const { enabled } = await client.getAdminManager().users.getUserNotification("@alice:example.org");
     * console.log(enabled);
     * ```
     */
    async getUserNotification(userId: string): Promise<UserNotificationResponse> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(Method.Get, `/users/${encodeURIComponent(userId)}/notification`);
    }

    /**
     * 设置用户的通知开关
     *
     * ⚠️ GET 与 PUT 在后端用的是**不同的键**：GET 返回 `{enabled}`，PUT 收/发 `{is_enabled}`
     * （`UserNotificationRequest` 带 `deny_unknown_fields`）。本方法接收对调用方更自然的
     * `{enabled}` 并映射为线上字段 `{is_enabled}`；返回值用后端的 `{is_enabled}`。
     *
     * @example
     * ```typescript
     * const { is_enabled } = await adminManager.setUserNotification("@alice:example.org", { enabled: false });
     * console.log(is_enabled);
     * ```
     */
    async setUserNotification(
        userId: string,
        payload: UserNotificationPayload,
    ): Promise<UserNotificationUpdateResponse> {
        AdminValidators.validateUserId(userId);
        return await this.adminRequest(
            Method.Put,
            `/users/${encodeURIComponent(userId)}/notification`,
            {},
            { is_enabled: payload.enabled },
        );
    }

    /**
     * 列出用户的 pusher
     *
     * 后端返回 `{pushers, total}`（原先只声明并返回了 `pushers`，丢掉了 `total`）。
     *
     * @example
     * ```typescript
     * const { pushers, total } = await adminManager.getUserPushers("@alice:example.org");
     * console.log(total, pushers.map((p) => p.pushkey));
     * ```
     */
    async getUserPushers(userId: string): Promise<{ pushers: UserPusher[]; total: number }> {
        AdminValidators.validateUserId(userId);
        const response = await this.adminRequest<{ pushers?: UserPusher[]; total?: number }>(
            Method.Get,
            `/users/${encodeURIComponent(userId)}/pushers`,
        );
        const pushers = response.pushers ?? [];
        return { pushers, total: response.total ?? pushers.length };
    }

    /**
     * 删除用户的某个 pusher。
     *
     * 对应 `DELETE /users/{userId}/pushers/{pushkey}`。
     *
     * @param userId - 目标用户 ID
     * @param pushkey - pusher 的 pushkey
     *
     * @example
     * ```typescript
     * await client.getAdminManager().users.deleteUserPusher("@alice:example.org", "APnsKey...");
     * ```
     *
     * @throws {ValidationError} 如果 pushkey 为空
     */
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
     * 按事件举报限流记录封锁用户（`POST /_synapse/admin/v1/event_reports/rate_limit/{user_id}/block`）。
     *
     * ⚠️ `blocked_until` 与 `reason` 都是**必填**：后端 `event_report.rs::BlockUserBody`
     * 声明的是 `pub blocked_until: i64` / `pub reason: String`（都不是 `Option`），
     * 且带 `deny_unknown_fields`。此前声明成可选 ⇒ 省略任一个都会得到 422。
     *
     * @param userId - 用户 ID
     * @param payload - `blocked_until`（毫秒时间戳，必填）与 `reason`（必填）
     * @example
     * ```typescript
     * await adminManager.blockEventReportUser("@spammer:example.org", {
     *     blocked_until: Date.now() + 86400_000,
     *     reason: "repeat report abuse",
     * });
     * ```
     */
    async blockEventReportUser(userId: string, payload: { blocked_until: number; reason: string }): Promise<void> {
        await this.adminRequest(
            Method.Post,
            `/event_reports/rate_limit/${encodeURIComponent(userId)}/block`,
            {},
            payload,
        );
    }

    /**
     * 解除按事件举报限流记录对用户的封锁。
     *
     * 对应 `POST /event_reports/rate_limit/{userId}/unblock`。
     *
     * @param userId - 用户 ID
     *
     * @example
     * ```typescript
     * await client.getAdminManager().users.unblockEventReportUser("@spammer:example.org");
     * ```
     */
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
     *
     * @example
     * ```typescript
     * const isAdmin = await client.getAdminManager().users.isSynapseAdministrator("@alice:example.org");
     * console.log(isAdmin);
     * ```
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
     *
     * @example
     * ```typescript
     * const whois = await client.getAdminManager().users.whoisSynapseUser("@alice:example.org");
     * console.log(whois.user_id, Object.keys(whois.devices));
     * ```
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
     *
     * @example
     * ```typescript
     * const result = await client.getAdminManager().users.deactivateSynapseUser("@alice:example.org");
     * console.log(result.id_server_unbind_result);
     * ```
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
