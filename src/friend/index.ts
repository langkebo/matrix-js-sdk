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
import { NotFoundError } from "../errors";
import { BaseManager } from "../managers/base-manager.ts";
import { LRUCache } from "../utils/lru-cache.ts";
import { getOrCreateManager } from "../client-infra/manager-registry.ts";

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
}

interface IFriendsResponse {
    friends?: Friend[];
}

interface IFriendRequestsResponse {
    requests?: FriendRequest[];
}

interface IFriendGroupsResponse {
    groups?: FriendGroups;
}

interface ICreateGroupResponse {
    group_id: string;
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
            const response = await this.client.http.authedRequest<IFriendListResponse>(
                Method.Get,
                "/friends",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );

            if (response.room_id) {
                this.friendListRoomId = response.room_id;
                return response.room_id;
            }
        } catch {
            logger.debug("Friend list doesn't exist");
        }

        const createResponse = await this.client.http.authedRequest<IFriendListResponse>(
            Method.Post,
            "/friends",
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );

        this.friendListRoomId = createResponse.room_id ?? null;
        return createResponse.room_id ?? "";
    }

    async sendFriendRequest(userId: string, reason?: string): Promise<void> {
        if (!userId || userId === this.client.getUserId()) {
            throw new InvalidParamError("Invalid user ID");
        }

        await this.client.http.authedRequest(
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
        };

        this.outgoingRequests.set(userId, request);
        this.emit(FriendEvent.Invited, userId, request);
    }

    async acceptFriendRequest(userId: string): Promise<void> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        await this.client.http.authedRequest(
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
    }

    async rejectFriendRequest(userId: string): Promise<void> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

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

    async cancelFriendRequest(userId: string): Promise<void> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

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

    async removeFriend(userId: string): Promise<void> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

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

    async getFriends(): Promise<Friend[]> {
        try {
            const response = await this.client.http.authedRequest<IFriendsResponse>(
                Method.Get,
                "/friends",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );

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
            const response = await this.client.http.authedRequest<IFriendRequestsResponse>(
                Method.Get,
                "/friends/requests/incoming",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );

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

    async getFriendSuggestions(limit: number = 10): Promise<Friend[]> {
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

    async isFriend(userId: string): Promise<boolean> {
        if (this.friends.has(userId)) {
            return true;
        }

        await this.getFriends();
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

    async createFriendGroup(name: string): Promise<string> {
        const response = await this.client.http.authedRequest<ICreateGroupResponse>(
            Method.Post,
            "/friends/groups",
            undefined,
            { name },
            { prefix: ClientPrefix.V1 },
        );

        const groupId = response.group_id;
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
        return this.sendFriendRequest(userId, reason);
    }

    async declineFriendRequest(userId: string): Promise<void> {
        return this.rejectFriendRequest(userId);
    }

    /**
     * 获取好友信息
     *
     * @param userId - 用户 ID
     * @param throwOnError - 是否抛出错误（默认 false）
     * @returns 好友信息
     */
    async getFriendInfo(userId: string, throwOnError = false): Promise<Friend | null> {
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
