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
 * - GET /_matrix/client/v3/rooms/{room_id}/invite_blocklist - 获取邀请黑名单
 * - POST /_matrix/client/v3/rooms/{room_id}/invite_blocklist - 设置邀请黑名单
 * - GET /_matrix/client/v3/rooms/{room_id}/invite_allowlist - 获取邀请白名单
 * - POST /_matrix/client/v3/rooms/{room_id}/invite_allowlist - 设置邀请白名单
 */

import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { InvalidParamError } from "../common/errors";
import { logger } from "../logger";
import { MatrixClient } from "../client";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

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
     * GET /_matrix/client/v3/rooms/{room_id}/invite_blocklist
     */
    public async getBlocklist(roomId: string): Promise<string[]> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.request<IBlocklistResponse>({
                    method: Method.Get,
                    path: `/rooms/${encodeURIComponent(roomId)}/invite_blocklist`,
                    prefix: ClientPrefix.V3,
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
     * POST /_matrix/client/v3/rooms/{room_id}/invite_blocklist
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
                    path: `/rooms/${encodeURIComponent(roomId)}/invite_blocklist`,
                    body: { user_ids: userIds },
                    prefix: ClientPrefix.V3,
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
     */
    public async addToBlocklist(roomId: string, userIds: string[]): Promise<IBlocklistResult> {
        const currentBlocklist = await this.getBlocklist(roomId);
        const newBlocklist = [...new Set([...currentBlocklist, ...userIds])];
        return this.setBlocklist(roomId, newBlocklist);
    }

    /**
     * Remove users from blocklist
     */
    public async removeFromBlocklist(roomId: string, userIds: string[]): Promise<IBlocklistResult> {
        const currentBlocklist = await this.getBlocklist(roomId);
        const newBlocklist = currentBlocklist.filter((id) => !userIds.includes(id));
        return this.setBlocklist(roomId, newBlocklist);
    }

    /**
     * Clear blocklist for a room
     */
    public async clearBlocklist(roomId: string): Promise<IBlocklistResult> {
        return this.setBlocklist(roomId, []);
    }

    /**
     * Get invite allowlist for a room
     * GET /_matrix/client/v3/rooms/{room_id}/invite_allowlist
     */
    public async getAllowlist(roomId: string): Promise<string[]> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.request<IAllowlistResponse>({
                    method: Method.Get,
                    path: `/rooms/${encodeURIComponent(roomId)}/invite_allowlist`,
                    prefix: ClientPrefix.V3,
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
     * POST /_matrix/client/v3/rooms/{room_id}/invite_allowlist
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
                    path: `/rooms/${encodeURIComponent(roomId)}/invite_allowlist`,
                    body: { user_ids: userIds },
                    prefix: ClientPrefix.V3,
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
     */
    public async addToAllowlist(roomId: string, userIds: string[]): Promise<IAllowlistResult> {
        const currentAllowlist = await this.getAllowlist(roomId);
        const newAllowlist = [...new Set([...currentAllowlist, ...userIds])];
        return this.setAllowlist(roomId, newAllowlist);
    }

    /**
     * Remove users from allowlist
     */
    public async removeFromAllowlist(roomId: string, userIds: string[]): Promise<IAllowlistResult> {
        const currentAllowlist = await this.getAllowlist(roomId);
        const newAllowlist = currentAllowlist.filter((id) => !userIds.includes(id));
        return this.setAllowlist(roomId, newAllowlist);
    }

    /**
     * Clear allowlist for a room
     */
    public async clearAllowlist(roomId: string): Promise<IAllowlistResult> {
        return this.setAllowlist(roomId, []);
    }

    /**
     * Check if a user is blocked from being invited
     */
    public async isUserBlocked(roomId: string, userId: string): Promise<boolean> {
        const blocklist = await this.getBlocklist(roomId);
        return blocklist.includes(userId);
    }

    /**
     * Check if a user is in the allowlist (only这些人可以邀请)
     */
    public async isUserAllowed(roomId: string, userId: string): Promise<boolean> {
        const allowlist = await this.getAllowlist(roomId);
        return allowlist.includes(userId);
    }

    /**
     * Get cached blocklist
     */
    public getCachedBlocklist(roomId: string): string[] {
        return this.blocklistCache.get(roomId) || [];
    }

    /**
     * Get cached allowlist
     */
    public getCachedAllowlist(roomId: string): string[] {
        return this.allowlistCache.get(roomId) || [];
    }

    /**
     * Clear cache for a room
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

export default InviteBlocklistManager;
