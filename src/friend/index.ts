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
 * Friend Manager - 好友管理
 *
 * 提供好友请求、好友列表管理功能
 * 对接后端: synapse-rust/src/web/routes/friend_room.rs
 */

import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { InvalidParamError } from "../common/errors.ts";
import { logger } from "../logger.ts";
import { MatrixClient } from "../client";
import { NotFoundError, ValidationError } from "../errors";
import { BaseManager } from "../managers/base-manager.ts";
import { LRUCache } from "../utils/lru-cache.ts";
import { getOrCreateManager } from "../client-infra/manager-registry.ts";
import { AdminValidators } from "../admin/validators";

export enum FriendEvent {
    Invited = "Invited",
    Accepted = "Accepted",
    Rejected = "Rejected",
    Cancelled = "Cancelled",
    Removed = "Removed",
    RequestReceived = "RequestReceived",
    ListUpdated = "ListUpdated",
    SyncComplete = "SyncComplete",
    FriendAdded = "FriendAdded",
    FriendRemoved = "FriendRemoved",
    FriendUpdated = "FriendUpdated",
    RequestSent = "RequestSent",
    RequestAccepted = "RequestAccepted",
    RequestRejected = "RequestRejected",
    RequestCancelled = "RequestCancelled",
}

export interface Friend {
    user_id: string;
    reason?: string;
    since?: number;
    display_name?: string;
    avatar_url?: string;
    note?: string;
    status?: "favorite" | "normal" | "blocked" | "hidden" | string;
    dm_room_id?: string;
}

export interface FriendRequest {
    user_id: string;
    reason?: string;
    status: "pending" | "accepted" | "rejected" | "cancelled";
    timestamp?: number;
    display_name?: string;
    avatar_url?: string;
    message?: string;
    direction?: "incoming" | "outgoing";
    request_id?: string;
}

export enum FriendRelationshipStatus {
    Favorite = "favorite",
    Normal = "normal",
    Blocked = "blocked",
    Hidden = "hidden",
}

export enum FriendRequestStatus {
    Pending = "pending",
    Accepted = "accepted",
    Rejected = "rejected",
    Cancelled = "cancelled",
}

export type FriendStatus =
    | "pending"
    | "accepted"
    | "rejected"
    | "cancelled"
    | "favorite"
    | "normal"
    | "blocked"
    | "hidden";

export interface FriendGroups {
    [groupId: string]: {
        name: string;
        users: string[];
    };
}

interface FriendManagerEventMap {
    [FriendEvent.Invited]: (userId: string, request: FriendRequest) => void;
    [FriendEvent.Accepted]: (userId: string) => void;
    [FriendEvent.Rejected]: (userId: string) => void;
    [FriendEvent.Cancelled]: (userId: string) => void;
    [FriendEvent.Removed]: (userId: string) => void;
    [FriendEvent.RequestReceived]: (request: FriendRequest) => void;
    [FriendEvent.ListUpdated]: () => void;
    [FriendEvent.SyncComplete]: () => void;
    [FriendEvent.FriendAdded]: (friend: Friend) => void;
    [FriendEvent.FriendRemoved]: (userId: string) => void;
    [FriendEvent.FriendUpdated]: (friend: Friend) => void;
    [FriendEvent.RequestSent]: (userId: string) => void;
    [FriendEvent.RequestAccepted]: (userId: string) => void;
    [FriendEvent.RequestRejected]: (userId: string) => void;
    [FriendEvent.RequestCancelled]: (userId: string) => void;
}

interface IFriendListResponse {
    room_id?: string;
    total?: number;
}

interface IFriendsResponse extends IFriendListResponse {
    friends?: Friend[];
}

interface IFriendRequestsResponse {
    requests?: FriendRequest[];
}

interface IFriendGroupsResponse {
    groups?: FriendGroups;
}

interface ICreateGroupResponse {
    id: string;
    name?: string;
    members?: string[];
    created_at?: number;
}

interface IFriendSuggestionsResponse {
    suggestions?: Friend[];
    total?: number;
}

const FRIEND_RELATIONSHIP_STATUSES = new Set<string>(Object.values(FriendRelationshipStatus));
const FRIEND_REQUEST_STATUSES = new Set<string>(Object.values(FriendRequestStatus));

function normalizeFriend(friend: Friend): Friend {
    const status = friend.status;
    return {
        ...friend,
        status: status && FRIEND_RELATIONSHIP_STATUSES.has(status) ? status : FriendRelationshipStatus.Normal,
    };
}

function normalizeFriendRequest(request: FriendRequest): FriendRequest {
    return {
        ...request,
        status: FRIEND_REQUEST_STATUSES.has(request.status) ? request.status : FriendRequestStatus.Pending,
    };
}

export class FriendManager extends BaseManager<FriendEvent, FriendManagerEventMap> {
    private friendListRoomId: string | null = null;
    private friends: LRUCache<Friend>;
    private incomingRequests: Map<string, FriendRequest> = new Map();
    private outgoingRequests: Map<string, FriendRequest> = new Map();
    private groups: FriendGroups = {};
    private initialized: boolean = false;

    constructor(client: MatrixClient) {
        super(client);
        this.friends = new LRUCache<Friend>(500, 5 * 60 * 1000);
    }

    private async ensureFriendListRoom(): Promise<string> {
        if (this.friendListRoomId) {
            return this.friendListRoomId;
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
                this.friendListRoomId = response.room_id;
                return response.room_id;
            }
        } catch (e) {
            logger.debug("Friend list doesn't exist", e);
        }
        return "";
    }

    /**
     * 发送好友请求
     *
     * @param userId - 目标用户 ID（格式：@localpart:homeserver）
     * @param reason - 请求理由（可选）
     *
     * @example
     * ```typescript
     * // 发送好友请求
     * await friendManager.sendFriendRequest("@alice:example.com", "Hi, let's be friends!");
     *
     * // 发送不带理由的请求
     * await friendManager.sendFriendRequest("@bob:example.com");
     *
     * // 监听请求发送事件
     * friendManager.on(FriendEvent.Invited, (userId, request) => {
     *     console.log(`Friend request sent to ${userId}`);
     * });
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 格式无效
     * @throws {InvalidParamError} 如果尝试添加自己为好友
     * @throws {ApiError} 如果 API 调用失败
     */
    async sendFriendRequest(
        userId: string,
        reason?: string,
    ): Promise<{ request_id?: string; status?: string }> {
        AdminValidators.validateUserId(userId);

        if (userId === this.client.getUserId()) {
            throw new InvalidParamError("Cannot send friend request to yourself");
        }

        const response = await this.client.http.authedRequest<{
            request_id?: string;
            status?: string;
        }>(
            Method.Post,
            "/friends/request",
            undefined,
            { user_id: userId, message: reason },
            { prefix: ClientPrefix.V1 },
        );

        const request: FriendRequest = {
            user_id: userId,
            reason,
            status: "pending",
            timestamp: Date.now(),
            request_id: response?.request_id,
        };

        this.outgoingRequests.set(userId, request);
        this.emit(FriendEvent.Invited, userId, request);
        return { request_id: response?.request_id, status: response?.status };
    }

    /**
     * 接受好友请求
     *
     * @param userId - 发送请求的用户 ID
     *
     * @example
     * ```typescript
     * // 接受好友请求
     * await friendManager.acceptFriendRequest("@alice:example.com");
     *
     * // 监听接受事件
     * friendManager.on(FriendEvent.Accepted, (userId) => {
     *     console.log(`Accepted friend request from ${userId}`);
     * });
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 格式无效
     * @throws {ApiError} 如果 API 调用失败
     */
    async acceptFriendRequest(userId: string): Promise<{ room_id?: string }> {
        AdminValidators.validateUserId(userId);

        const response = await this.client.http.authedRequest<{ room_id?: string }>(
            Method.Post,
            `/friends/request/${encodeURIComponent(userId)}/accept`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );

        const request = this.incomingRequests.get(userId);
        if (request) {
            request.status = "accepted";
            this.incomingRequests.delete(userId);
        }

        this.friends.set(userId, {
            user_id: userId,
            since: Date.now(),
            status: FriendRelationshipStatus.Normal,
        });

        this.emit(FriendEvent.Accepted, userId);
        this.emit(FriendEvent.ListUpdated);
        return { room_id: response?.room_id };
    }

    /**
     * 拒绝好友请求
     *
     * @param userId - 发送请求的用户 ID
     *
     * @example
     * ```typescript
     * // 拒绝好友请求
     * await friendManager.rejectFriendRequest("@alice:example.com");
     *
     * // 监听拒绝事件
     * friendManager.on(FriendEvent.Rejected, (userId) => {
     *     console.log(`Rejected friend request from ${userId}`);
     * });
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 格式无效
     * @throws {ApiError} 如果 API 调用失败
     */
    async rejectFriendRequest(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);

        await this.client.http.authedRequest(
            Method.Post,
            `/friends/request/${encodeURIComponent(userId)}/reject`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );

        this.incomingRequests.delete(userId);
        this.emit(FriendEvent.Rejected, userId);
    }

    /**
     * 取消已发送的好友请求
     *
     * @param userId - 目标用户 ID
     *
     * @example
     * ```typescript
     * // 取消好友请求
     * await friendManager.cancelFriendRequest("@alice:example.com");
     *
     * // 监听取消事件
     * friendManager.on(FriendEvent.Cancelled, (userId) => {
     *     console.log(`Cancelled friend request to ${userId}`);
     * });
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 格式无效
     * @throws {ApiError} 如果 API 调用失败
     */
    async cancelFriendRequest(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);

        await this.client.http.authedRequest(
            Method.Post,
            `/friends/request/${encodeURIComponent(userId)}/cancel`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );

        this.outgoingRequests.delete(userId);
        this.emit(FriendEvent.Cancelled, userId);
    }

    /**
     * 删除好友
     *
     * @param userId - 要删除的好友用户 ID
     *
     * @example
     * ```typescript
     * // 删除好友
     * await friendManager.removeFriend("@alice:example.com");
     *
     * // 监听删除事件
     * friendManager.on(FriendEvent.Removed, (userId) => {
     *     console.log(`Removed friend ${userId}`);
     * });
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 格式无效
     * @throws {ApiError} 如果 API 调用失败
     */
    async removeFriend(userId: string): Promise<void> {
        AdminValidators.validateUserId(userId);

        await this.client.http.authedRequest(
            Method.Delete,
            `/friends/${encodeURIComponent(userId)}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );

        this.friends.delete(userId);
        this.emit(FriendEvent.Removed, userId);
        this.emit(FriendEvent.ListUpdated);
    }

    /**
     * 获取好友列表
     *
     * @returns 好友列表
     *
     * @example
     * ```typescript
     * // 获取所有好友
     * const friends = await friendManager.getFriends();
     * friends.forEach(friend => {
     *     console.log(`Friend: ${friend.user_id}`);
     *     console.log(`  Display name: ${friend.display_name}`);
     *     console.log(`  Status: ${friend.status}`);
     * });
     *
     * // 使用缓存
     * const cachedFriends = friendManager.getCachedFriends();
     * if (cachedFriends.length > 0) {
     *     console.log("Using cached friends list");
     * }
     * ```
     *
     * @throws {ApiError} 如果 API 调用失败
     */
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
                this.friendListRoomId = response.room_id;
            }

            const friends = (response.friends || []).map(normalizeFriend);
            this.friends.clear();
            friends.forEach((f) => this.friends.set(f.user_id, f));

            return friends;
        } catch (e) {
            throw this.normalizeError(e, "getFriends");
        }
    }

    async getIncomingRequests(): Promise<FriendRequest[]> {
        try {
            let response: IFriendRequestsResponse;
            try {
                response = await this.client.http.authedRequest<IFriendRequestsResponse>(
                    Method.Get,
                    "/friends/request/received",
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V1 },
                );
            } catch (error) {
                const normalized = this.normalizeError(error, "getIncomingRequests");
                if (!(normalized instanceof NotFoundError)) {
                    throw normalized;
                }

                // Backward compatibility for deployments that only expose the legacy alias.
                response = await this.client.http.authedRequest<IFriendRequestsResponse>(
                    Method.Get,
                    "/friends/requests/incoming",
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V1 },
                );
            }

            const requests = (response.requests || []).map(normalizeFriendRequest);
            this.incomingRequests.clear();
            requests.forEach((r) => this.incomingRequests.set(r.user_id, r));

            return requests;
        } catch (e) {
            throw this.normalizeError(e, "getIncomingRequests");
        }
    }

    async getOutgoingRequests(): Promise<FriendRequest[]> {
        try {
            const response = await this.client.http.authedRequest<IFriendRequestsResponse>(
                Method.Get,
                "/friends/requests/outgoing",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );

            const requests = (response.requests || []).map(normalizeFriendRequest);
            this.outgoingRequests.clear();
            requests.forEach((r) => this.outgoingRequests.set(r.user_id, r));

            return requests;
        } catch (e) {
            throw this.normalizeError(e, "getOutgoingRequests");
        }
    }

    /**
     * 获取好友推荐列表
     *
     * @param limit - 返回数量限制（默认 10）
     * @returns 推荐好友列表
     *
     * @example
     * ```typescript
     * // 获取默认数量的推荐
     * const suggestions = await friendManager.getFriendSuggestions();
     * suggestions.forEach(friend => {
     *     console.log(`Suggested: ${friend.display_name} (${friend.user_id})`);
     * });
     *
     * // 获取更多推荐
     * const moreSuggestions = await friendManager.getFriendSuggestions(20);
     * ```
     *
     * @throws {ValidationError} 如果 limit 超出范围
     * @throws {ApiError} 如果 API 调用失败
     */
    async getFriendSuggestions(limit: number = 10): Promise<Friend[]> {
        AdminValidators.validateLimit(limit);
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

    /**
     * 检查是否为好友
     *
     * @param userId - 用户 ID（格式：@localpart:homeserver）
     * @returns 是否为好友
     *
     * @example
     * ```typescript
     * // 检查是否为好友
     * const isFriend = await friendManager.isFriend("@alice:example.com");
     * if (isFriend) {
     *     console.log("Already friends");
     * } else {
     *     console.log("Not friends yet");
     * }
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 格式无效
     */
    /**
     * @deprecated 使用 {@link checkFriendship}（单次 GET `/friends/check/{id}`）。
     * `isFriend` 需要先拉整张好友列表，代价高。保留兼容性，不会被删除。
     */
    async isFriend(userId: string): Promise<boolean> {
        AdminValidators.validateUserId(userId);
        if (this.friends.has(userId)) {
            return true;
        }

        await this.getFriends();
        return this.friends.has(userId);
    }

    /**
     * 本地缓存快速命中检查（仅在已同步的缓存上工作，不触发网络请求）
     */
    hasCachedFriend(userId: string): boolean {
        return this.friends.has(userId);
    }

    async getFriendGroups(): Promise<FriendGroups> {
        try {
            const response = await this.client.http.authedRequest<IFriendGroupsResponse>(
                Method.Get,
                "/friends/groups",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );

            this.groups = response.groups || {};
            return this.groups;
        } catch (e) {
            throw this.normalizeError(e, "getFriendGroups");
        }
    }

    /**
     * 创建好友分组
     *
     * @param name - 分组名称
     * @returns 分组 ID
     *
     * @example
     * ```typescript
     * // 创建好友分组
     * const groupId = await friendManager.createFriendGroup("Work Friends");
     * console.log("Group created:", groupId);
     *
     * // 添加好友到分组
     * await friendManager.addToFriendGroup(groupId, "@alice:example.com");
     * ```
     *
     * @throws {ValidationError} 如果分组名称为空或过长
     * @throws {ApiError} 如果 API 调用失败
     */
    async createFriendGroup(name: string): Promise<string> {
        if (!name || name.trim().length === 0) {
            throw new ValidationError("Group name is required");
        }
        if (name.length > 255) {
            throw new ValidationError("Group name too long (max 255 characters)");
        }
        const response = await this.client.http.authedRequest<ICreateGroupResponse>(
            Method.Post,
            "/friends/groups",
            undefined,
            { name },
            { prefix: ClientPrefix.V1 },
        );

        const groupId = response.id;
        this.groups[groupId] = { name, users: [] };

        return groupId;
    }

    async addToFriendGroup(groupId: string, userId: string): Promise<void> {
        await this.client.http.authedRequest(
            Method.Post,
            `/friends/groups/${groupId}/add/${encodeURIComponent(userId)}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );

        if (this.groups[groupId]) {
            if (!this.groups[groupId].users.includes(userId)) {
                this.groups[groupId].users.push(userId);
            }
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

        if (this.groups[groupId]) {
            this.groups[groupId].users = this.groups[groupId].users.filter((u) => u !== userId);
        }
    }

    async deleteFriendGroup(groupId: string): Promise<void> {
        await this.client.http.authedRequest(Method.Delete, `/friends/groups/${groupId}`, undefined, undefined, {
            prefix: ClientPrefix.V1,
        });

        delete this.groups[groupId];
    }

    async setFriendDisplayName(userId: string, displayName: string): Promise<void> {
        await this.client.http.authedRequest(
            Method.Put,
            `/friends/${encodeURIComponent(userId)}/displayname`,
            undefined,
            { displayname: displayName },
            { prefix: ClientPrefix.V1 },
        );
    }

    async checkFriendship(userId: string): Promise<boolean> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        try {
            const response = await this.client.http.authedRequest<{ is_friend: boolean }>(
                Method.Get,
                `/friends/check/${encodeURIComponent(userId)}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );
            return response.is_friend;
        } catch (e) {
            throw this.normalizeError(e, "checkFriendship");
        }
    }

    async updateFriendNote(userId: string, note: string): Promise<void> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        await this.client.http.authedRequest(
            Method.Put,
            `/friends/${encodeURIComponent(userId)}/note`,
            undefined,
            { note },
            { prefix: ClientPrefix.V1 },
        );

        const friend = this.friends.get(userId);
        if (friend) {
            friend.note = note;
            this.friends.set(userId, friend);
            this.emit(FriendEvent.FriendUpdated, friend);
        }
    }

    async getFriendStatus(userId: string): Promise<string> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        const response = await this.client.http.authedRequest<{ status: string }>(
            Method.Get,
            `/friends/${encodeURIComponent(userId)}/status`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );

        return response.status;
    }

    async updateFriendStatus(userId: string, status: string): Promise<void> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        const validStatuses = ["favorite", "normal", "blocked", "hidden"];
        if (!validStatuses.includes(status)) {
            throw new InvalidParamError(`Invalid status. Valid values: ${validStatuses.join(", ")}`);
        }

        await this.client.http.authedRequest(
            Method.Put,
            `/friends/${encodeURIComponent(userId)}/status`,
            undefined,
            { status },
            { prefix: ClientPrefix.V1 },
        );

        const friend = this.friends.get(userId);
        if (friend) {
            friend.status = status as FriendStatus;
            this.friends.set(userId, friend);
            this.emit(FriendEvent.FriendUpdated, friend);
        }
    }

    async renameFriendGroup(groupId: string, name: string): Promise<void> {
        if (!name || name.length > 50) {
            throw new InvalidParamError("Group name must be between 1 and 50 characters");
        }

        await this.client.http.authedRequest(
            Method.Put,
            `/friends/groups/${groupId}/name`,
            undefined,
            { name },
            { prefix: ClientPrefix.V1 },
        );

        if (this.groups[groupId]) {
            this.groups[groupId].name = name;
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

    async getGroupsForUser(userId: string): Promise<string[]> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        const response = await this.client.http.authedRequest<{ groups: string[] }>(
            Method.Get,
            `/friends/${encodeURIComponent(userId)}/groups`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );

        return response.groups || [];
    }

    getFriendListRoomId(): string | null {
        return this.friendListRoomId;
    }

    getCachedFriends(): Friend[] {
        return this.friends.values();
    }

    getCachedIncomingRequests(): FriendRequest[] {
        return Array.from(this.incomingRequests.values());
    }

    getCachedOutgoingRequests(): FriendRequest[] {
        return Array.from(this.outgoingRequests.values());
    }

    async getFriendsList(): Promise<Friend[]> {
        return this.getFriends();
    }

    async addFriend(userId: string, reason?: string): Promise<void> {
        await this.sendFriendRequest(userId, reason);
    }

    async declineFriendRequest(userId: string): Promise<void> {
        return this.rejectFriendRequest(userId);
    }

    /**
     * 获取好友信息
     *
     * @param userId - 用户 ID
     * @param throwOnError - 是否抛出错误（默认 true，传 false 时保留兼容 fallback）
     * @returns 好友信息
     */
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

    getFriendCount(): number {
        return this.friends.size();
    }

    getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        return this.friends.getStats();
    }

    clearCache(): void {
        this.friends.clear();
    }

    async sync(): Promise<void> {
        await this.getFriends();
        await this.getIncomingRequests();
        await this.getOutgoingRequests();
        this.emit(FriendEvent.SyncComplete);
    }

    async start(): Promise<void> {
        if (this.initialized) return;

        try {
            await this.getFriends();
            await this.getIncomingRequests();
            await this.getOutgoingRequests();
            await this.getFriendGroups();
            this.initialized = true;
        } catch (e) {
            logger.warn("FriendManager.start failed:", e);
        }
    }

    stop(): void {
        this.friends.clear();
        this.incomingRequests.clear();
        this.outgoingRequests.clear();
        this.groups = {};
        this.initialized = false;
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getFriendManager(): FriendManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getFriendManager = function (): FriendManager {
        return getOrCreateManager(this, "friend", () => new FriendManager(this));
    };
}

export default extendMatrixClient;
