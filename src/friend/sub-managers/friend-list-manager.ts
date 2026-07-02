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
 * Friend List Manager - 好友列表管理
 *
 * 管理好友列表、搜索、同步、分组、DM 房间等操作。
 */

import { Method } from "../../http-api/method";
import { ClientPrefix } from "../../http-api/prefix";
import { InvalidParamError } from "../../common/errors";
import { logger } from "../../logger";
import { NotFoundError } from "../../errors";
import { BaseManager } from "../../managers/base-manager";
import { validateUserId, validateLimit } from "../../common/validators";
import { doesClientAdvertiseSynapseRustFeature, SynapseRustFeature } from "../../server-capabilities";
import type {
    Friend,
    FriendRequest,
    FriendGroup,
    FriendGroups,
    FriendSearchResponse,
    FriendSearchQuery,
    FriendStatusInfo,
    FriendshipCheckResponse,
    FriendStatus,
    FriendRelationshipStatus,
    FriendRequestStatus,
} from "../index";
import type { FriendSharedState } from "./shared-state";

export enum FriendListManagerEvent {
    FriendAdded = "FriendAdded",
    FriendRemoved = "FriendRemoved",
    FriendUpdated = "FriendUpdated",
    ListUpdated = "ListUpdated",
    SyncComplete = "SyncComplete",
    Removed = "Removed",
}

interface FriendListManagerEventMap {
    [FriendListManagerEvent.FriendAdded]: (friend: Friend) => void;
    [FriendListManagerEvent.FriendRemoved]: (userId: string) => void;
    [FriendListManagerEvent.FriendUpdated]: (friend: Friend) => void;
    [FriendListManagerEvent.ListUpdated]: () => void;
    [FriendListManagerEvent.SyncComplete]: () => void;
    [FriendListManagerEvent.Removed]: (userId: string) => void;
}

interface IFriendsResponse {
    room_id?: string;
    total?: number;
    friends?: Friend[];
    items?: Friend[];
    limit?: number;
    offset?: number;
    next_offset?: number;
    version?: number;
    cached?: boolean;
    generated_ts?: number;
}

interface IFriendSuggestionsResponse {
    suggestions?: Friend[];
    total?: number;
}

interface IFriendGroupsResponse {
    groups?: FriendGroup[];
}

interface ICreateGroupResponse extends FriendGroup {}

const FRIEND_RELATIONSHIP_STATUSES = new Set<string>(["favorite", "normal", "blocked", "hidden"]);

function normalizeFriend(friend: Friend): Friend {
    const status = friend.status;
    return {
        ...friend,
        display_name: friend.display_name ?? friend.displayname,
        status: status && FRIEND_RELATIONSHIP_STATUSES.has(status) ? status : ("normal" as FriendStatus),
    };
}

export class FriendListManager extends BaseManager<FriendListManagerEvent, FriendListManagerEventMap> {
    constructor(private readonly sharedState: FriendSharedState) {
        super(sharedState.client);
    }

    // ===== 功能支持检查 =====

    async isSupported(): Promise<boolean> {
        return doesClientAdvertiseSynapseRustFeature(this.client, SynapseRustFeature.Friends, true);
    }

    // ===== 内部工具 =====

    async ensureFriendListRoom(): Promise<string> {
        if (this.sharedState.friendListRoomId) {
            return this.sharedState.friendListRoomId;
        }

        try {
            const response = await this.client.http.authedRequest<IFriendsResponse>(
                Method.Get,
                "/friends",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );

            if (response.room_id) {
                this.sharedState.friendListRoomId = response.room_id;
                return response.room_id;
            }
        } catch (e) {
            logger.debug("Friend list doesn't exist", e);
        }
        return "";
    }

    // ===== 好友列表 =====

    async getFriends(): Promise<Friend[]> {
        try {
            const response = await this.client.http.authedRequest<IFriendsResponse>(
                Method.Get,
                "/friends",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );

            if (response.room_id) {
                this.sharedState.friendListRoomId = response.room_id;
            }

            const friends = (response.friends || response.items || []).map(normalizeFriend);
            this.sharedState.friends.clear();
            friends.forEach((f) => this.sharedState.friends.set(f.user_id, f));

            return friends;
        } catch (e) {
            throw this.normalizeError(e, "getFriends");
        }
    }

    async getFriendSuggestions(limit: number = 10): Promise<Friend[]> {
        validateLimit(limit);
        try {
            const response = await this.client.http.authedRequest<IFriendSuggestionsResponse>(
                Method.Get,
                "/friends/suggestions",
                { limit },
                undefined,
                { prefix: ClientPrefix.V1 },
            );

            return (response.suggestions || []).map(normalizeFriend);
        } catch (e) {
            throw this.normalizeError(e, "getFriendSuggestions");
        }
    }

    // ===== 搜索 =====

    async searchUsers(
        q: string,
        mode?: "fuzzy" | "exact",
        limit?: number,
    ): Promise<FriendSearchResponse> {
        if (!q || q.trim().length === 0) {
            throw new InvalidParamError("Search term cannot be empty");
        }

        const params: Record<string, string | number> = { q: q.trim() };
        if (mode) params.mode = mode;
        if (limit !== undefined) params.limit = limit;

        try {
            const response = await this.client.http.authedRequest<FriendSearchResponse>(
                Method.Get,
                "/friends/search",
                params,
                undefined,
                { prefix: ClientPrefix.V3 },
            );

            return response;
        } catch (e) {
            throw this.normalizeError(e, "searchUsers");
        }
    }

    async searchFriendsAdvanced(query: FriendSearchQuery): Promise<FriendSearchResponse> {
        if (!query || Object.keys(query).length === 0) {
            throw new InvalidParamError("Search query cannot be empty");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<FriendSearchResponse>(
                    Method.Post,
                    "/friends/search",
                    undefined,
                    query,
                    { prefix: ClientPrefix.V3 },
                );
            }, "searchFriendsAdvanced");

            return response;
        } catch (e) {
            throw this.normalizeError(e, "searchFriendsAdvanced");
        }
    }

    // ===== 好友关系检查 =====

    async checkFriendship(userId: string): Promise<FriendshipCheckResponse> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        try {
            const response = await this.client.http.authedRequest<FriendshipCheckResponse>(
                Method.Get,
                `/friends/check/${encodeURIComponent(userId)}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            return response;
        } catch (e) {
            throw this.normalizeError(e, "checkFriendship");
        }
    }

    hasCachedFriend(userId: string): boolean {
        return this.sharedState.friends.has(userId);
    }

    // ===== r0 兼容接口 =====

    async getFriendships(): Promise<Friend[]> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IFriendsResponse>(
                    Method.Get,
                    "/friendships",
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.R0 },
                );
            }, "getFriendships");

            const friends = (response.friends || response.items || []).map(normalizeFriend);
            return friends;
        } catch (e) {
            throw this.normalizeError(e, "getFriendships");
        }
    }

    async createFriendship(userId: string): Promise<{ user_id?: string; status?: string }> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }
        validateUserId(userId);

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<{ user_id?: string; status?: string }>(
                    Method.Post,
                    "/friendships",
                    undefined,
                    { user_id: userId },
                    { prefix: ClientPrefix.R0 },
                );
            }, "createFriendship");

            return { user_id: response?.user_id, status: response?.status };
        } catch (e) {
            throw this.normalizeError(e, "createFriendship");
        }
    }

    // ===== 好友分组 =====

    async getFriendGroups(): Promise<FriendGroup[]> {
        try {
            const response = await this.client.http.authedRequest<IFriendGroupsResponse>(
                Method.Get,
                "/friends/groups",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );

            const list = response.groups ?? [];
            this.sharedState.groups = {};
            for (const g of list) {
                if (g && g.id) {
                    this.sharedState.groups[g.id] = {
                        id: g.id,
                        name: g.name,
                        members: g.members ?? [],
                        created_at: g.created_at,
                        updated_ts: g.updated_ts,
                    };
                }
            }
            return list;
        } catch (e) {
            throw this.normalizeError(e, "getFriendGroups");
        }
    }

    async createFriendGroup(name: string): Promise<FriendGroup> {
        if (!name || name.length === 0) {
            throw new InvalidParamError("Group name is required");
        }
        if (name.length > 50) {
            throw new InvalidParamError("Group name too long (max 50 characters)");
        }

        const response = await this.client.http.authedRequest<ICreateGroupResponse>(
            Method.Post,
            "/friends/groups",
            undefined,
            { name },
            { prefix: ClientPrefix.V1 },
        );

        const group: FriendGroup = {
            id: response.id,
            name: response.name ?? name,
            members: response.members ?? [],
            created_at: response.created_at,
            updated_ts: response.updated_ts,
        };
        this.sharedState.groups[group.id] = group;

        return group;
    }

    async addToFriendGroup(groupId: string, userId: string): Promise<void> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }
        validateUserId(userId);
        await this.client.http.authedRequest(
            Method.Post,
            `/friends/groups/${groupId}/add/${encodeURIComponent(userId)}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );

        const cached = this.sharedState.groups[groupId];
        if (cached && !cached.members.includes(userId)) {
            cached.members.push(userId);
        }
    }

    async removeFromFriendGroup(groupId: string, userId: string): Promise<void> {
        await this.client.http.authedRequest(
            Method.Delete,
            `/friends/groups/${groupId}/remove/${encodeURIComponent(userId)}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );

        const cached = this.sharedState.groups[groupId];
        if (cached) {
            cached.members = cached.members.filter((u) => u !== userId);
        }
    }

    async deleteFriendGroup(groupId: string): Promise<void> {
        await this.client.http.authedRequest(Method.Delete, `/friends/groups/${groupId}`, undefined, undefined, {
            prefix: ClientPrefix.V1,
        });

        delete this.sharedState.groups[groupId];
    }

    async renameFriendGroup(groupId: string, name: string): Promise<void> {
        if (!name || name.length === 0) {
            throw new InvalidParamError("Group name is required");
        }
        if (name.length > 50) {
            throw new InvalidParamError("Group name too long (max 50 characters)");
        }

        await this.client.http.authedRequest(
            Method.Put,
            `/friends/groups/${groupId}/name`,
            undefined,
            { name },
            { prefix: ClientPrefix.V1 },
        );

        const cached = this.sharedState.groups[groupId];
        if (cached) {
            cached.name = name;
        }
    }

    async getFriendsInGroup(groupId: string): Promise<Friend[]> {
        const response = await this.client.http.authedRequest<{ friends: Friend[] }>(
            Method.Get,
            `/friends/groups/${groupId}/friends`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );

        return (response.friends || []).map(normalizeFriend);
    }

    async getGroupsForUser(userId: string): Promise<FriendGroup[]> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        const response = await this.client.http.authedRequest<{ groups?: FriendGroup[] }>(
            Method.Get,
            `/friends/${encodeURIComponent(userId)}/groups`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );

        return response.groups ?? [];
    }

    // ===== 好友操作 =====

    async removeFriend(userId: string): Promise<void> {
        validateUserId(userId);

        await this.client.http.authedRequest(
            Method.Delete,
            `/friends/${encodeURIComponent(userId)}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );

        this.sharedState.friends.delete(userId);
        this.emit(FriendListManagerEvent.Removed, userId);
        this.emit(FriendListManagerEvent.FriendRemoved, userId);
        this.emit(FriendListManagerEvent.ListUpdated);
    }

    async setFriendDisplayName(userId: string, displayName: string): Promise<void> {
        if (!displayName || displayName.length < 1 || displayName.length > 256) {
            throw new InvalidParamError("Display name must be between 1 and 256 characters");
        }
        await this.client.http.authedRequest(
            Method.Put,
            `/friends/${encodeURIComponent(userId)}/displayname`,
            undefined,
            { displayname: displayName },
            { prefix: ClientPrefix.V1 },
        );
    }

    async updateFriendNote(userId: string, note: string): Promise<void> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }
        if (note.length > 1000) {
            throw new InvalidParamError("Note too long (max 1000 characters)");
        }

        await this.client.http.authedRequest(
            Method.Put,
            `/friends/${encodeURIComponent(userId)}/note`,
            undefined,
            { note },
            { prefix: ClientPrefix.V1 },
        );

        const friend = this.sharedState.friends.get(userId);
        if (friend) {
            friend.note = note;
            this.sharedState.friends.set(userId, friend);
            this.emit(FriendListManagerEvent.FriendUpdated, friend);
        }
    }

    // ===== 好友信息 =====

    async getFriendStatusInfo(userId: string): Promise<FriendStatusInfo> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        return this.client.http.authedRequest<FriendStatusInfo>(
            Method.Get,
            `/friends/${encodeURIComponent(userId)}/status`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );
    }

    async getFriendStatus(userId: string): Promise<string> {
        const response = await this.getFriendStatusInfo(userId);
        return response.status;
    }

    async getFriendInfo(userId: string, throwOnError = true): Promise<Friend | null> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        try {
            const response = await this.client.http.authedRequest<Friend>(
                Method.Get,
                `/friends/${encodeURIComponent(userId)}/info`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );
            return normalizeFriend(response);
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            const error = this.normalizeError(e, "getFriendInfo");
            if (error instanceof NotFoundError) {
                // @swallow-error { owner: "friend", expires: "2026-12-31" }
                return null;
            }
            throw error;
        }
    }

    // ===== DM 房间 =====

    async getFriendDm(userId: string): Promise<{ room_id: string | null }> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }
        validateUserId(userId);

        try {
            const response = await this.client.http.authedRequest<{ room_id: string | null }>(
                Method.Get,
                `/friends/dm/${encodeURIComponent(userId)}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );
            return response;
        } catch (e) {
            throw this.normalizeError(e, "getFriendDm");
        }
    }

    async createFriendDm(userId: string): Promise<{ room_id: string }> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }
        validateUserId(userId);

        try {
            const response = await this.client.http.authedRequest<{ room_id: string }>(
                Method.Post,
                `/friends/dm/${encodeURIComponent(userId)}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );
            return response;
        } catch (e) {
            throw this.normalizeError(e, "createFriendDm");
        }
    }

    // ===== 缓存访问 =====

    getFriendListRoomId(): string | null {
        return this.sharedState.friendListRoomId;
    }

    getCachedFriends(): Friend[] {
        return this.sharedState.friends.values();
    }

    getFriendCount(): number {
        return this.sharedState.friends.size();
    }

    getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        return this.sharedState.friends.getStats();
    }

    clearCache(): void {
        this.sharedState.friends.clear();
    }

    // ===== 生命周期 =====

    async sync(): Promise<void> {
        await Promise.all([
            this.getFriends(),
            // getIncomingRequests / getOutgoingRequests are on FriendRequestManager;
            // the orchestrator calls these in parallel. Here we only sync the list part.
        ]);
        this.emit(FriendListManagerEvent.SyncComplete);
    }

    async start(): Promise<void> {
        if (this.sharedState.initialized) return;

        try {
            await Promise.all([
                this.getFriends(),
                this.getFriendGroups(),
            ]);
            this.sharedState.initialized = true;
        } catch (e) {
            logger.warn("FriendListManager.start failed:", e);
        }
    }

    stop(): void {
        this.sharedState.friends.clear();
        this.sharedState.groups = {};
        this.sharedState.initialized = false;
    }
}
