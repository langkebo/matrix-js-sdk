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
 * Invite Blocklist Manager - 邀请黑名单管理 (MSC4380)
 *
 * 提供房间邀请黑名单/白名单管理功能
 * 对应后端 API:
 * - GET /_matrix/vendor/v1/rooms/{room_id}/invite_blocklist - 获取邀请黑名单
 * - POST /_matrix/vendor/v1/rooms/{room_id}/invite_blocklist - 设置邀请黑名单
 * - GET /_matrix/vendor/v1/rooms/{room_id}/invite_allowlist - 获取邀请白名单
 * - POST /_matrix/vendor/v1/rooms/{room_id}/invite_allowlist - 设置邀请白名单
 */

import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { VendorPrefix } from "../http-api/prefix";
import { InvalidParamError } from "../common/errors";
import { logger } from "../logger";
import { MatrixClient } from "../client";
import { EventType, type InvitePermissionConfigContent } from "../@types/event";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

import type { InviteBlocklistPath } from "./__generated__/route-table";
import type { PathAssert, StripVendor } from "../http-api/strip-prefix";

/**
 * 契约路径断言：把本文件手写的相对路径绑到生成的 `InviteBlocklistPath` 上。
 *
 * 契约表的路径带 `/_matrix/vendor/v1` 前缀、实现侧写相对路径（前缀由 `VendorPrefix` 提供），
 * 故先 `StripVendor` 剥离再**逐段比较**。拼错尾段 / 凭空多段会在**编译期**报 TS2345
 * （见 `http-api/strip-prefix.ts` 的 `PathAssert`）。
 */
function dp<const P extends string>(path: P & PathAssert<P, StripVendor<InviteBlocklistPath>>): P {
    return path;
}

export enum InviteBlocklistEvent {
    BlocklistUpdated = "BlocklistUpdated",
    AllowlistUpdated = "AllowlistUpdated",
    Error = "Error",
}

export interface IBlocklistResponse {
    blocklist: string[];
    blocked_users?: string[];
}

export interface IAllowlistResponse {
    allowlist: string[];
    allowed_users?: string[];
}

export interface IBlocklistResult {
    success: boolean;
    blocklist: string[];
    blocked_users?: string[];
}

export interface IAllowlistResult {
    success: boolean;
    allowlist: string[];
    allowed_users?: string[];
}

interface InviteBlocklistManagerEventMap {
    [InviteBlocklistEvent.BlocklistUpdated]: (blocklist: string[]) => void;
    [InviteBlocklistEvent.AllowlistUpdated]: (allowlist: string[]) => void;
    [InviteBlocklistEvent.Error]: (error: Error) => void;
}

export class InviteBlocklistManager extends BaseManager<InviteBlocklistEvent, InviteBlocklistManagerEventMap> {
    private blocklistCache: Map<string, string[]> = new Map();
    private allowlistCache: Map<string, string[]> = new Map();

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * Get invite blocklist for a room
     * GET /_matrix/vendor/v1/rooms/{room_id}/invite_blocklist
     *
     * @param roomId - 目标房间 ID。
     * @returns 被禁止邀请的用户 ID 列表；请求失败时回退到本地缓存。
     * @throws {ValidationError} 当 roomId 为空时抛出。
     * @example
     * const blocked = await client.getInviteBlocklistManager().getBlocklist("!room:example.org");
     * console.log(blocked); // ["@spammer:example.org"]
     */
    public async getBlocklist(roomId: string): Promise<string[]> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.request<IBlocklistResponse>({
                    method: Method.Get,
                    path: dp(`/rooms/${encodeURIComponent(roomId)}/invite_blocklist`),
                    prefix: VendorPrefix,
                });
            }, "getBlocklist");

            const blocklist = response.blocked_users || response.blocklist || [];
            this.blocklistCache.set(roomId, blocklist);
            return blocklist;
        } catch (error) {
            logger.warn(`InviteBlocklistManager.getBlocklist failed for room ${roomId}:`, error);
            return this.blocklistCache.get(roomId) || [];
        }
    }

    /**
     * Set invite blocklist for a room (room admin only)
     * POST /_matrix/vendor/v1/rooms/{room_id}/invite_blocklist
     *
     * @param roomId - 目标房间 ID。
     * @param userIds - 要写入黑名单的用户 ID 列表。
     * @returns 写入结果，包含 success 与最新黑名单。
     * @throws {ValidationError} 当 roomId 为空或 userIds 不是数组时抛出。
     * @example
     * const result = await client
     *     .getInviteBlocklistManager()
     *     .setBlocklist("!room:example.org", ["@spammer:example.org"]);
     * console.log(result.success); // true
     */
    public async setBlocklist(roomId: string, userIds: string[]): Promise<IBlocklistResult> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }

        if (!Array.isArray(userIds)) {
            throw new InvalidParamError("User IDs must be an array");
        }

        try {
            await this.withRetry(async () => {
                await this.request({
                    method: Method.Post,
                    path: dp(`/rooms/${encodeURIComponent(roomId)}/invite_blocklist`),
                    body: { user_ids: userIds },
                    prefix: VendorPrefix,
                });
            }, "setBlocklist");

            this.blocklistCache.set(roomId, userIds);
            this.emit(InviteBlocklistEvent.BlocklistUpdated, userIds);

            return {
                success: true,
                blocklist: userIds,
                blocked_users: userIds,
            };
        } catch (error) {
            logger.error(`InviteBlocklistManager.setBlocklist failed for room ${roomId}:`, error);
            this.emit(InviteBlocklistEvent.Error, error as Error);
            throw error;
        }
    }

    /**
     * Add users to blocklist
     *
     * @param roomId - 目标房间 ID。
     * @param userIds - 要追加到黑名单的用户 ID 列表。
     * @returns 写入结果，包含 success 与最新黑名单。
     * @example
     * await client
     *     .getInviteBlocklistManager()
     *     .addToBlocklist("!room:example.org", ["@spammer:example.org"]);
     */
    public async addToBlocklist(roomId: string, userIds: string[]): Promise<IBlocklistResult> {
        const currentBlocklist = await this.getBlocklist(roomId);
        const newBlocklist = [...new Set([...currentBlocklist, ...userIds])];
        return this.setBlocklist(roomId, newBlocklist);
    }

    /**
     * Remove users from blocklist
     *
     * @param roomId - 目标房间 ID。
     * @param userIds - 要从黑名单移除的用户 ID 列表。
     * @returns 写入结果，包含 success 与最新黑名单。
     * @example
     * await client
     *     .getInviteBlocklistManager()
     *     .removeFromBlocklist("!room:example.org", ["@spammer:example.org"]);
     */
    public async removeFromBlocklist(roomId: string, userIds: string[]): Promise<IBlocklistResult> {
        const currentBlocklist = await this.getBlocklist(roomId);
        const newBlocklist = currentBlocklist.filter((id) => !userIds.includes(id));
        return this.setBlocklist(roomId, newBlocklist);
    }

    /**
     * Clear blocklist for a room
     *
     * @param roomId - 目标房间 ID。
     * @returns 写入结果，blocklist 为空数组。
     * @example
     * await client.getInviteBlocklistManager().clearBlocklist("!room:example.org");
     */
    public async clearBlocklist(roomId: string): Promise<IBlocklistResult> {
        return this.setBlocklist(roomId, []);
    }

    /**
     * Get invite allowlist for a room
     * GET /_matrix/vendor/v1/rooms/{room_id}/invite_allowlist
     *
     * @param roomId - 目标房间 ID。
     * @returns 允许邀请的用户 ID 列表；请求失败时回退到本地缓存。
     * @throws {ValidationError} 当 roomId 为空时抛出。
     * @example
     * const allowed = await client.getInviteBlocklistManager().getAllowlist("!room:example.org");
     * console.log(allowed); // ["@friend:example.org"]
     */
    public async getAllowlist(roomId: string): Promise<string[]> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.request<IAllowlistResponse>({
                    method: Method.Get,
                    path: dp(`/rooms/${encodeURIComponent(roomId)}/invite_allowlist`),
                    prefix: VendorPrefix,
                });
            }, "getAllowlist");

            const allowlist = response.allowed_users || response.allowlist || [];
            this.allowlistCache.set(roomId, allowlist);
            return allowlist;
        } catch (error) {
            logger.warn(`InviteBlocklistManager.getAllowlist failed for room ${roomId}:`, error);
            return this.allowlistCache.get(roomId) || [];
        }
    }

    /**
     * Set invite allowlist for a room (room admin only)
     * POST /_matrix/vendor/v1/rooms/{room_id}/invite_allowlist
     *
     * @param roomId - 目标房间 ID。
     * @param userIds - 要写入白名单的用户 ID 列表。
     * @returns 写入结果，包含 success 与最新白名单。
     * @throws {ValidationError} 当 roomId 为空或 userIds 不是数组时抛出。
     * @example
     * const result = await client
     *     .getInviteBlocklistManager()
     *     .setAllowlist("!room:example.org", ["@friend:example.org"]);
     * console.log(result.success); // true
     */
    public async setAllowlist(roomId: string, userIds: string[]): Promise<IAllowlistResult> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }

        if (!Array.isArray(userIds)) {
            throw new InvalidParamError("User IDs must be an array");
        }

        try {
            await this.withRetry(async () => {
                await this.request({
                    method: Method.Post,
                    path: dp(`/rooms/${encodeURIComponent(roomId)}/invite_allowlist`),
                    body: { user_ids: userIds },
                    prefix: VendorPrefix,
                });
            }, "setAllowlist");

            this.allowlistCache.set(roomId, userIds);
            this.emit(InviteBlocklistEvent.AllowlistUpdated, userIds);

            return {
                success: true,
                allowlist: userIds,
                allowed_users: userIds,
            };
        } catch (error) {
            logger.error(`InviteBlocklistManager.setAllowlist failed for room ${roomId}:`, error);
            this.emit(InviteBlocklistEvent.Error, error as Error);
            throw error;
        }
    }

    /**
     * Add users to allowlist
     *
     * @param roomId - 目标房间 ID。
     * @param userIds - 要追加到白名单的用户 ID 列表。
     * @returns 写入结果，包含 success 与最新白名单。
     * @example
     * await client
     *     .getInviteBlocklistManager()
     *     .addToAllowlist("!room:example.org", ["@friend:example.org"]);
     */
    public async addToAllowlist(roomId: string, userIds: string[]): Promise<IAllowlistResult> {
        const currentAllowlist = await this.getAllowlist(roomId);
        const newAllowlist = [...new Set([...currentAllowlist, ...userIds])];
        return this.setAllowlist(roomId, newAllowlist);
    }

    /**
     * Remove users from allowlist
     *
     * @param roomId - 目标房间 ID。
     * @param userIds - 要从白名单移除的用户 ID 列表。
     * @returns 写入结果，包含 success 与最新白名单。
     * @example
     * await client
     *     .getInviteBlocklistManager()
     *     .removeFromAllowlist("!room:example.org", ["@friend:example.org"]);
     */
    public async removeFromAllowlist(roomId: string, userIds: string[]): Promise<IAllowlistResult> {
        const currentAllowlist = await this.getAllowlist(roomId);
        const newAllowlist = currentAllowlist.filter((id) => !userIds.includes(id));
        return this.setAllowlist(roomId, newAllowlist);
    }

    /**
     * Clear allowlist for a room
     *
     * @param roomId - 目标房间 ID。
     * @returns 写入结果，allowlist 为空数组。
     * @example
     * await client.getInviteBlocklistManager().clearAllowlist("!room:example.org");
     */
    public async clearAllowlist(roomId: string): Promise<IAllowlistResult> {
        return this.setAllowlist(roomId, []);
    }

    /**
     * Check if a user is blocked from being invited
     *
     * @param roomId - 目标房间 ID。
     * @param userId - 要检查的用户 ID。
     * @returns 若该用户在黑名单中则返回 true。
     * @example
     * const blocked = await client
     *     .getInviteBlocklistManager()
     *     .isUserBlocked("!room:example.org", "@spammer:example.org");
     */
    public async isUserBlocked(roomId: string, userId: string): Promise<boolean> {
        const blocklist = await this.getBlocklist(roomId);
        return blocklist.includes(userId);
    }

    /**
     * Check if a user is in the allowlist (only这些人可以邀请)
     *
     * @param roomId - 目标房间 ID。
     * @param userId - 要检查的用户 ID。
     * @returns 若该用户在白名单中则返回 true。
     * @example
     * const allowed = await client
     *     .getInviteBlocklistManager()
     *     .isUserAllowed("!room:example.org", "@friend:example.org");
     */
    public async isUserAllowed(roomId: string, userId: string): Promise<boolean> {
        const allowlist = await this.getAllowlist(roomId);
        return allowlist.includes(userId);
    }

    /**
     * Get the user's invite permission config (MSC4155).
     * Reads the global account data event `m.invite_permission_config`.
     *
     * **Draft — not implemented by synapse-rust.** The backend borrows the
     * `msc4155` namespace for its thread-subscription endpoints and does not
     * implement MSC4155 invite filtering, so this read is never served with a
     * meaningful value: an unset event 404s and is treated as "not configured"
     * (`null`). No invite filtering is applied server-side. See
     * `docs/MSC_SEMANTICS.md`.
     *
     * @returns the config content, or null if it is not set / cannot be read.
     * @example
     * ```typescript
     * const config = await client.getInviteBlocklistManager().getInvitePermissionConfig();
     * if (config?.default_action === "block") {
     *     console.log("invites blocked by default (client-side policy only)");
     * }
     * ```
     */
    public async getInvitePermissionConfig(): Promise<InvitePermissionConfigContent | null> {
        try {
            return await this.client.getAccountDataFromServer(EventType.InvitePermissionConfig);
            // 未设置时服务端返回 404；读取失败一律降级为"未配置"（null）并记录 warn，
            // 以免阻断邀请流程。调用方按 null 走默认允许策略。
        } catch (error) {
            logger.warn("InviteBlocklistManager.getInvitePermissionConfig failed:", error);
        }
        return null;
    }

    /**
     * Set the user's invite permission config (MSC4155).
     * Writes the global account data event `m.invite_permission_config`.
     *
     * **Draft — not implemented by synapse-rust.** The event is stored as
     * ordinary account data and the backend performs no invite filtering based
     * on it. See `docs/MSC_SEMANTICS.md`.
     *
     * @param content - the invite permission configuration to store.
     * @throws {Error} 当写入账户数据失败时抛出。
     * @example
     * ```typescript
     * await client.getInviteBlocklistManager().setInvitePermissionConfig({
     *     default_action: "block",
     *     user_exceptions: { "@trusted:example.org": {} },
     * });
     * ```
     */
    public async setInvitePermissionConfig(content: InvitePermissionConfigContent): Promise<void> {
        try {
            await this.client.setAccountData(EventType.InvitePermissionConfig, content);
        } catch (error) {
            logger.error("InviteBlocklistManager.setInvitePermissionConfig failed:", error);
            throw error;
        }
    }

    /**
     * Get cached blocklist
     *
     * @param roomId - 目标房间 ID。
     * @returns 本地缓存的房间黑名单；无缓存时返回空数组。
     * @example
     * const cached = client.getInviteBlocklistManager().getCachedBlocklist("!room:example.org");
     */
    public getCachedBlocklist(roomId: string): string[] {
        return this.blocklistCache.get(roomId) || [];
    }

    /**
     * Get cached allowlist
     *
     * @param roomId - 目标房间 ID。
     * @returns 本地缓存的房间白名单；无缓存时返回空数组。
     * @example
     * const cached = client.getInviteBlocklistManager().getCachedAllowlist("!room:example.org");
     */
    public getCachedAllowlist(roomId: string): string[] {
        return this.allowlistCache.get(roomId) || [];
    }

    /**
     * Clear cache for a room
     *
     * @param roomId - 目标房间 ID；省略时清空全部缓存。
     * @example
     * const manager = client.getInviteBlocklistManager();
     * manager.clearCache("!room:example.org"); // 清理单个房间
     * manager.clearCache(); // 清理全部缓存
     */
    public clearCache(roomId?: string): void {
        if (roomId) {
            this.blocklistCache.delete(roomId);
            this.allowlistCache.delete(roomId);
        } else {
            this.blocklistCache.clear();
            this.allowlistCache.clear();
        }
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getInviteBlocklistManager = function (): InviteBlocklistManager {
        registerManagerClass("inviteBlocklist", InviteBlocklistManager);
        return getOrCreateManager(this, "inviteBlocklist", () => new InviteBlocklistManager(this));
    };
}
