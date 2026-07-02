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
 *
 * 采用组合模式，将方法按领域拆分为 3 个子 Manager：
 * - requests: 好友请求管理（发送、接受、拒绝、取消）
 * - list: 好友列表管理（列表、搜索、同步、分组、DM）
 * - blocks: 好友屏蔽管理（状态更新、屏蔽/取消屏蔽）
 *
 * 所有原有方法保持向后兼容（委托到子 Manager）。
 * 推荐使用子 Manager 直接访问：`friendManager.requests.sendFriendRequest(...)`
 */

import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { InvalidParamError } from "../common/errors";
import { logger } from "../logger";
import { MatrixClient } from "../client";
import { NotFoundError } from "../errors";
import { BaseManager } from "../managers/base-manager";
import { LRUCache } from "../utils/lru-cache";
import { getOrCreateManager } from "../client-infra/manager-registry";

import { doesClientAdvertiseSynapseRustFeature, SynapseRustFeature } from "../server-capabilities";
import type { FriendPathPattern } from "./__generated__/route-table";

// 子 Manager 导入
import {
    FriendRequestManager,
    FriendRequestManagerEvent,
} from "./sub-managers/friend-request-manager";
import {
    FriendListManager,
    FriendListManagerEvent,
} from "./sub-managers/friend-list-manager";
import {
    FriendBlockManager,
    FriendBlockManagerEvent,
} from "./sub-managers/friend-block-manager";
import type { FriendSharedState } from "./sub-managers/shared-state";

// 重新导出子 Manager 类型，供直接使用
export { FriendRequestManager, FriendRequestManagerEvent } from "./sub-managers/friend-request-manager";
export { FriendListManager, FriendListManagerEvent } from "./sub-managers/friend-list-manager";
export { FriendBlockManager, FriendBlockManagerEvent } from "./sub-managers/friend-block-manager";
export type { FriendSharedState } from "./sub-managers/shared-state";

// ===== 类型和枚举（向下兼容） =====

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
    NotificationReceived = "NotificationReceived",
}

export interface Friend {
    user_id: string;
    reason?: string;
    since?: number;
    display_name?: string;
    displayname?: string;
    username?: string;
    avatar_url?: string;
    note?: string;
    presence?: string;
    online?: boolean;
    last_active_ts?: number;
    last_seen_ts?: number;
    added_ts?: number;
    status?: "favorite" | "normal" | "blocked" | "hidden" | string;
    dm_room_id?: string;
    dm_room_active?: boolean;
    dm_room_state?: string;
    dm_room_updated_ts?: number;
    dm_room_affected_user_id?: string;
    dm_room_changed_by?: string;
    dm_room_reason?: string;
}

export interface FriendRequest {
    user_id: string;
    reason?: string;
    status: "pending" | "accepted" | "rejected" | "cancelled";
    timestamp?: number;
    display_name?: string;
    displayname?: string;
    avatar_url?: string;
    message?: string;
    direction?: "incoming" | "outgoing";
    request_id?: string;
}

export interface FriendStatusInfo {
    user_id: string;
    status: string;
    is_friend?: boolean;
    are_friends?: boolean;
}

export interface FriendshipCheckResponse {
    user_id: string;
    is_friend: boolean;
    are_friends: boolean;
}

export interface FriendSearchResult {
    user_id: string;
    username?: string;
    displayname?: string;
    avatar_url?: string;
    presence?: string;
    online?: boolean;
    last_active_ts?: number;
    last_seen_ts?: number;
    created_ts?: number;
    match_score?: number;
    match_type?: string;
}

export interface FriendSearchQuery {
    q?: string;
    query?: string;
    mode?: "exact" | "fuzzy";
    limit?: number;
    filters?: Record<string, unknown> /* Dynamic: arbitrary filter fields */;
}

export interface FriendSearchResponse {
    results?: FriendSearchResult[];
    count?: number;
    mode?: string;
    limited?: boolean;
    retry_after_seconds?: number;
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

/**
 * 单个好友分组（对应后端 `friend_room_service::create_friend_group` 返回的对象）。
 */
export interface FriendGroup {
    id: string;
    name: string;
    members: string[];
    created_at?: number;
    updated_ts?: number;
}

/**
 * 内部缓存：按 group `id` 索引的分组映射。
 */
export interface FriendGroups {
    [groupId: string]: FriendGroup;
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
    [FriendEvent.NotificationReceived]: (notification: { type: string; user_id?: string; data?: FriendNotificationData }) => void;
}

export interface FriendNotificationData {
    request_id?: string;
    message?: string;
    [key: string]: unknown;
}

interface IFriendListResponse {
    room_id?: string;
    total?: number;
}

interface IFriendsResponse extends IFriendListResponse {
    friends?: Friend[];
    items?: Friend[];
    limit?: number;
    offset?: number;
    next_offset?: number;
    version?: number;
    cached?: boolean;
    generated_ts?: number;
}

interface IFriendRequestsResponse {
    requests?: FriendRequest[];
}

interface IFriendGroupsResponse {
    groups?: FriendGroup[];
}

interface ICreateGroupResponse extends FriendGroup {}

interface IFriendSuggestionsResponse {
    suggestions?: Friend[];
    total?: number;
}

type StripClientPrefix<P extends string> =
    P extends `/_matrix/client/r0${infer Rest}`
        ? Rest
        : P extends `/_matrix/client/v1${infer Rest}`
          ? Rest
          : P extends `/_matrix/client/v3${infer Rest}`
            ? Rest
            : never;

function fr<P extends StripClientPrefix<FriendPathPattern>>(path: P): P {
    return path;
}

const FRIEND_RELATIONSHIP_STATUSES = new Set<string>(Object.values(FriendRelationshipStatus));
const FRIEND_REQUEST_STATUSES = new Set<string>(Object.values(FriendRequestStatus));

function normalizeFriend(friend: Friend): Friend {
    const status = friend.status;
    return {
        ...friend,
        display_name: friend.display_name ?? friend.displayname,
        status: status && FRIEND_RELATIONSHIP_STATUSES.has(status) ? status : FriendRelationshipStatus.Normal,
    };
}

function normalizeFriendRequest(request: FriendRequest): FriendRequest {
    return {
        ...request,
        reason: request.reason ?? request.message,
        display_name: request.display_name ?? request.displayname,
        status: FRIEND_REQUEST_STATUSES.has(request.status) ? request.status : FriendRequestStatus.Pending,
    };
}

/**
 * Friend Manager - 好友管理统一入口
 *
 * 通过组合模式将功能委托到子 Manager，同时保持完全向后兼容。
 *
 * @example
 * ```typescript
 * // 向后兼容：直接在 FriendManager 上调用方法
 * await friendManager.sendFriendRequest("@alice:example.com", "Hi!");
 *
 * // 推荐新方式：通过子 Manager 访问
 * await friendManager.requests.sendFriendRequest("@alice:example.com", "Hi!");
 * const friends = await friendManager.list.getFriends();
 * await friendManager.blocks.updateFriendStatus("@alice:example.com", "blocked");
 * ```
 */
export class FriendManager extends BaseManager<FriendEvent, FriendManagerEventMap> {
    // ===== 共享状态 =====
    private readonly sharedState: FriendSharedState;

    // ===== 子 Manager（组合模式） =====
    public readonly requests: FriendRequestManager;
    public readonly list: FriendListManager;
    public readonly blocks: FriendBlockManager;

    constructor(client: MatrixClient) {
        super(client);

        // 创建共享状态
        const friendListRoomId: string | null = null;
        const friends = new LRUCache<Friend>(500, 5 * 60 * 1000);
        const incomingRequests = new Map<string, FriendRequest>();
        const outgoingRequests = new Map<string, FriendRequest>();
        const groups: FriendGroups = {};
        const initialized = false;

        this.sharedState = {
            client,
            friendListRoomId,
            friends,
            incomingRequests,
            outgoingRequests,
            groups,
            initialized,
        };

        // 创建子 Manager，共享状态
        this.requests = new FriendRequestManager(this.sharedState);
        this.list = new FriendListManager(this.sharedState);
        this.blocks = new FriendBlockManager(this.sharedState);

        // 转发子 Manager 事件到 FriendManager（向后兼容）
        this.forwardSubManagerEvents();
    }

    /**
     * 将子 Manager 的事件转发到 FriendManager
     * 保持 `friendManager.on(FriendEvent.Invited, ...)` 的向后兼容性
     */
    private forwardSubManagerEvents(): void {
        // FriendRequestManager 事件转发
        this.requests.on(FriendRequestManagerEvent.Invited, (userId, request) =>
            this.emit(FriendEvent.Invited, userId, request),
        );
        this.requests.on(FriendRequestManagerEvent.Accepted, (userId) =>
            this.emit(FriendEvent.Accepted, userId),
        );
        this.requests.on(FriendRequestManagerEvent.Rejected, (userId) =>
            this.emit(FriendEvent.Rejected, userId),
        );
        this.requests.on(FriendRequestManagerEvent.Cancelled, (userId) =>
            this.emit(FriendEvent.Cancelled, userId),
        );
        this.requests.on(FriendRequestManagerEvent.RequestSent, (userId) =>
            this.emit(FriendEvent.RequestSent, userId),
        );
        this.requests.on(FriendRequestManagerEvent.RequestAccepted, (userId) =>
            this.emit(FriendEvent.RequestAccepted, userId),
        );
        this.requests.on(FriendRequestManagerEvent.RequestRejected, (userId) =>
            this.emit(FriendEvent.RequestRejected, userId),
        );
        this.requests.on(FriendRequestManagerEvent.RequestCancelled, (userId) =>
            this.emit(FriendEvent.RequestCancelled, userId),
        );
        this.requests.on(FriendRequestManagerEvent.RequestReceived, (request) =>
            this.emit(FriendEvent.RequestReceived, request),
        );
        this.requests.on(FriendRequestManagerEvent.FriendAdded, (friend) =>
            this.emit(FriendEvent.FriendAdded, friend),
        );
        this.requests.on(FriendRequestManagerEvent.ListUpdated, () =>
            this.emit(FriendEvent.ListUpdated),
        );

        // FriendListManager 事件转发
        this.list.on(FriendListManagerEvent.FriendAdded, (friend) =>
            this.emit(FriendEvent.FriendAdded, friend),
        );
        this.list.on(FriendListManagerEvent.FriendRemoved, (userId) =>
            this.emit(FriendEvent.FriendRemoved, userId),
        );
        this.list.on(FriendListManagerEvent.FriendUpdated, (friend) =>
            this.emit(FriendEvent.FriendUpdated, friend),
        );
        this.list.on(FriendListManagerEvent.ListUpdated, () =>
            this.emit(FriendEvent.ListUpdated),
        );
        this.list.on(FriendListManagerEvent.SyncComplete, () =>
            this.emit(FriendEvent.SyncComplete),
        );
        this.list.on(FriendListManagerEvent.Removed, (userId) =>
            this.emit(FriendEvent.Removed, userId),
        );

        // FriendBlockManager 事件转发
        this.blocks.on(FriendBlockManagerEvent.FriendUpdated, (friend) =>
            this.emit(FriendEvent.FriendUpdated, friend),
        );
    }

    // ===== 向后兼容委托方法 =====
    // 所有原有方法委托到对应的子 Manager，保持 API 完全兼容

    // ----- 通用 -----

    async isSupported(): Promise<boolean> {
        return this.list.isSupported();
    }

    // ----- 好友请求（委托 → requests） -----

    async sendFriendRequest(userId: string, reason?: string): Promise<{ request_id?: string; status?: string }> {
        return this.requests.sendFriendRequest(userId, reason);
    }

    async addFriend(userId: string, opts?: { reason?: string }): Promise<{ user_id?: string; status?: string }> {
        return this.requests.addFriend(userId, opts);
    }

    async acceptFriendRequest(userId: string): Promise<{ room_id?: string }> {
        return this.requests.acceptFriendRequest(userId);
    }

    async rejectFriendRequest(userId: string): Promise<void> {
        return this.requests.rejectFriendRequest(userId);
    }

    async cancelFriendRequest(userId: string): Promise<void> {
        return this.requests.cancelFriendRequest(userId);
    }

    async getIncomingRequests(): Promise<FriendRequest[]> {
        return this.requests.getIncomingRequests();
    }

    async getOutgoingRequests(): Promise<FriendRequest[]> {
        return this.requests.getOutgoingRequests();
    }

    getCachedIncomingRequests(): FriendRequest[] {
        return this.requests.getCachedIncomingRequests();
    }

    getCachedOutgoingRequests(): FriendRequest[] {
        return this.requests.getCachedOutgoingRequests();
    }

    // ----- 好友列表（委托 → list） -----

    async getFriends(): Promise<Friend[]> {
        return this.list.getFriends();
    }

    async getFriendSuggestions(limit: number = 10): Promise<Friend[]> {
        return this.list.getFriendSuggestions(limit);
    }

    async searchUsers(
        q: string,
        mode?: "fuzzy" | "exact",
        limit?: number,
    ): Promise<FriendSearchResponse> {
        return this.list.searchUsers(q, mode, limit);
    }

    async searchFriendsAdvanced(query: FriendSearchQuery): Promise<FriendSearchResponse> {
        return this.list.searchFriendsAdvanced(query);
    }

    hasCachedFriend(userId: string): boolean {
        return this.list.hasCachedFriend(userId);
    }

    async checkFriendship(userId: string): Promise<FriendshipCheckResponse> {
        return this.list.checkFriendship(userId);
    }

    async getFriendships(): Promise<Friend[]> {
        return this.list.getFriendships();
    }

    async createFriendship(userId: string): Promise<{ user_id?: string; status?: string }> {
        return this.list.createFriendship(userId);
    }

    async updateFriendNote(userId: string, note: string): Promise<void> {
        return this.list.updateFriendNote(userId, note);
    }

    async getFriendStatusInfo(userId: string): Promise<FriendStatusInfo> {
        return this.blocks.getFriendStatusInfo(userId);
    }

    async getFriendStatus(userId: string): Promise<string> {
        return this.blocks.getFriendStatus(userId);
    }

    async updateFriendStatus(userId: string, status: string): Promise<void> {
        return this.blocks.updateFriendStatus(userId, status);
    }

    async getFriendDm(userId: string): Promise<{ room_id: string | null }> {
        return this.list.getFriendDm(userId);
    }

    async createFriendDm(userId: string): Promise<{ room_id: string }> {
        return this.list.createFriendDm(userId);
    }

    async removeFriend(userId: string): Promise<void> {
        return this.list.removeFriend(userId);
    }

    async setFriendDisplayName(userId: string, displayName: string): Promise<void> {
        return this.list.setFriendDisplayName(userId, displayName);
    }

    async getFriendInfo(userId: string, throwOnError = true): Promise<Friend | null> {
        return this.list.getFriendInfo(userId, throwOnError);
    }

    // ----- 好友分组（委托 → list） -----

    async getFriendGroups(): Promise<FriendGroup[]> {
        return this.list.getFriendGroups();
    }

    async createFriendGroup(name: string): Promise<FriendGroup> {
        return this.list.createFriendGroup(name);
    }

    async addToFriendGroup(groupId: string, userId: string): Promise<void> {
        return this.list.addToFriendGroup(groupId, userId);
    }

    async removeFromFriendGroup(groupId: string, userId: string): Promise<void> {
        return this.list.removeFromFriendGroup(groupId, userId);
    }

    async deleteFriendGroup(groupId: string): Promise<void> {
        return this.list.deleteFriendGroup(groupId);
    }

    async renameFriendGroup(groupId: string, name: string): Promise<void> {
        return this.list.renameFriendGroup(groupId, name);
    }

    async getFriendsInGroup(groupId: string): Promise<Friend[]> {
        return this.list.getFriendsInGroup(groupId);
    }

    async getGroupsForUser(userId: string): Promise<FriendGroup[]> {
        return this.list.getGroupsForUser(userId);
    }

    // ----- 缓存（委托 → list） -----

    getFriendListRoomId(): string | null {
        return this.list.getFriendListRoomId();
    }

    getCachedFriends(): Friend[] {
        return this.list.getCachedFriends();
    }

    getFriendCount(): number {
        return this.list.getFriendCount();
    }

    getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        return this.list.getCacheStats();
    }

    async ensureFriendListRoom(): Promise<string> {
        return this.list.ensureFriendListRoom();
    }

    clearCache(): void {
        this.list.clearCache();
        this.requests.clearCache();
        this.sharedState.incomingRequests.clear();
        this.sharedState.outgoingRequests.clear();
    }

    // ----- 生命周期（委托 → list） -----

    async sync(): Promise<void> {
        await Promise.all([
            this.list.getFriends(),
            this.requests.getIncomingRequests(),
            this.requests.getOutgoingRequests(),
        ]);
        this.emit(FriendEvent.SyncComplete);
    }

    async start(): Promise<void> {
        if (this.sharedState.initialized) return;

        try {
            await Promise.all([
                this.list.getFriends(),
                this.requests.getIncomingRequests(),
                this.requests.getOutgoingRequests(),
                this.list.getFriendGroups(),
            ]);
            this.sharedState.initialized = true;
        } catch (e) {
            logger.warn("FriendManager.start failed:", e);
        }
    }

    stop(): void {
        this.list.stop();
        this.requests.clearCache();
        this.sharedState.friendListRoomId = null;
        this.sharedState.initialized = false;
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
