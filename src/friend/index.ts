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

import { logger } from "../logger";
import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { LRUCache } from "../utils/lru-cache";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

// 子 Manager 导入
import { FriendRequestManager, FriendRequestManagerEvent } from "./sub-managers/friend-request-manager";
import { FriendListManager, FriendListManagerEvent } from "./sub-managers/friend-list-manager";
import { FriendBlockManager, FriendBlockManagerEvent } from "./sub-managers/friend-block-manager";
import type { FriendSharedState } from "./sub-managers/shared-state";

// 重新导出子 Manager 类型，供直接使用
export { FriendRequestManager, FriendRequestManagerEvent } from "./sub-managers/friend-request-manager";
export { FriendListManager, FriendListManagerEvent } from "./sub-managers/friend-list-manager";
export { FriendBlockManager, FriendBlockManagerEvent } from "./sub-managers/friend-block-manager";
export type { FriendSharedState } from "./sub-managers/shared-state";

// 契约 DTO 单一权威（ISSUE-2.1）：从契约文档 codegen 生成，避免手写漂移。
// 先 import 到本文件作用域（供内部使用），再 re-export（供外部引用）。
import type {
    Friend,
    FriendRequest,
    FriendStatusInfo,
    FriendshipCheckResponse,
    FriendSearchResult,
    FriendSearchResponse,
    FriendGroup,
    IFriendsResponse,
} from "./__generated__/dto";

export type {
    Friend,
    FriendRequest,
    FriendStatusInfo,
    FriendshipCheckResponse,
    FriendSearchResult,
    FriendSearchResponse,
    FriendGroup,
    IFriendsResponse,
};

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

export interface FriendSearchQuery {
    q?: string;
    query?: string;
    mode?: "exact" | "fuzzy";
    limit?: number;
    filters?: Record<string, unknown> /* Dynamic: arbitrary filter fields */;
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
    [FriendEvent.NotificationReceived]: (notification: {
        type: string;
        user_id?: string;
        data?: FriendNotificationData;
    }) => void;
}

export interface FriendNotificationData {
    request_id?: string;
    message?: string;
    [key: string]: unknown;
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

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);

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
        this.requests.on(FriendRequestManagerEvent.Accepted, (userId) => this.emit(FriendEvent.Accepted, userId));
        this.requests.on(FriendRequestManagerEvent.Rejected, (userId) => this.emit(FriendEvent.Rejected, userId));
        this.requests.on(FriendRequestManagerEvent.Cancelled, (userId) => this.emit(FriendEvent.Cancelled, userId));
        this.requests.on(FriendRequestManagerEvent.RequestSent, (userId) => this.emit(FriendEvent.RequestSent, userId));
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
        this.requests.on(FriendRequestManagerEvent.FriendAdded, (friend) => this.emit(FriendEvent.FriendAdded, friend));
        this.requests.on(FriendRequestManagerEvent.ListUpdated, () => this.emit(FriendEvent.ListUpdated));

        // FriendListManager 事件转发
        this.list.on(FriendListManagerEvent.FriendAdded, (friend) => this.emit(FriendEvent.FriendAdded, friend));
        this.list.on(FriendListManagerEvent.FriendRemoved, (userId) => this.emit(FriendEvent.FriendRemoved, userId));
        this.list.on(FriendListManagerEvent.FriendUpdated, (friend) => this.emit(FriendEvent.FriendUpdated, friend));
        this.list.on(FriendListManagerEvent.ListUpdated, () => this.emit(FriendEvent.ListUpdated));
        this.list.on(FriendListManagerEvent.SyncComplete, () => this.emit(FriendEvent.SyncComplete));
        this.list.on(FriendListManagerEvent.Removed, (userId) => this.emit(FriendEvent.Removed, userId));

        // FriendBlockManager 事件转发
        this.blocks.on(FriendBlockManagerEvent.FriendUpdated, (friend) => this.emit(FriendEvent.FriendUpdated, friend));
    }

    // ===== 向后兼容委托方法 =====
    // 所有原有方法委托到对应的子 Manager，保持 API 完全兼容

    // ----- 通用 -----

    /**
     * 探测后端是否实现了好友能力（后端未实现时全部好友路由会 404）。
     *
     * @returns `true` 表示好友能力可用。
     * @example
     * const ok = await client.getFriendManager().isSupported();
     */
    async isSupported(): Promise<boolean> {
        return this.list.isSupported();
    }

    // ----- 好友请求（委托 → requests） -----

    /**
     * 发送好友请求（走请求-确认流程，需对方接受后才成为好友）。
     *
     * @param userId - 目标用户 ID（格式：@localpart:homeserver）。
     * @param reason - 请求附言，最长 500 字符。
     * @returns 服务端返回的请求 ID 与状态。
     * @example
     * const r = await client.getFriendManager().sendFriendRequest("@alice:example.com", "Hi!");
     */
    async sendFriendRequest(userId: string, reason?: string): Promise<{ request_id?: string; status?: string }> {
        return this.requests.sendFriendRequest(userId, reason);
    }

    /**
     * 直接添加好友（不经过对方的请求-确认流程）。
     *
     * @param userId - 目标用户 ID。
     * @param opts - 可选配置对象。
     * @param opts.reason - 附加理由（下发时映射到后端 `message` 字段）。
     * @returns 服务端返回的用户 ID 与状态。
     * @example
     * const r = await client.getFriendManager().addFriend("@alice:example.com", { reason: "同事" });
     */
    async addFriend(userId: string, opts?: { reason?: string }): Promise<{ user_id?: string; status?: string }> {
        return this.requests.addFriend(userId, opts);
    }

    /**
     * 接受来自指定用户的好友请求。
     *
     * @param userId - 发起好友请求的用户 ID。
     * @returns 接受后返回的私聊房间 ID（如后端提供）。
     * @example
     * const r = await client.getFriendManager().acceptFriendRequest("@alice:example.com");
     */
    async acceptFriendRequest(userId: string): Promise<{ room_id?: string }> {
        return this.requests.acceptFriendRequest(userId);
    }

    /**
     * 拒绝来自指定用户的好友请求。
     *
     * @param userId - 发起好友请求的用户 ID。
     * @returns 无。
     * @example
     * await client.getFriendManager().rejectFriendRequest("@alice:example.com");
     */
    async rejectFriendRequest(userId: string): Promise<void> {
        return this.requests.rejectFriendRequest(userId);
    }

    /**
     * 取消自己已发给指定用户、尚未处理的好友请求。
     *
     * @param userId - 已收到该请求的目标用户 ID。
     * @returns 无。
     * @example
     * await client.getFriendManager().cancelFriendRequest("@alice:example.com");
     */
    async cancelFriendRequest(userId: string): Promise<void> {
        return this.requests.cancelFriendRequest(userId);
    }

    /**
     * 从服务端拉取「收到」的好友请求并刷新缓存。
     *
     * @returns 收到的好友请求数组。
     * @example
     * const reqs = await client.getFriendManager().getIncomingRequests();
     */
    async getIncomingRequests(): Promise<FriendRequest[]> {
        return this.requests.getIncomingRequests();
    }

    /**
     * 从服务端拉取「发出」的好友请求并刷新缓存。
     *
     * @returns 发出的好友请求数组。
     * @example
     * const reqs = await client.getFriendManager().getOutgoingRequests();
     */
    async getOutgoingRequests(): Promise<FriendRequest[]> {
        return this.requests.getOutgoingRequests();
    }

    /**
     * 读取缓存中「收到」的好友请求（不发网络请求）。
     *
     * @returns 缓存的好友请求数组。
     * @example
     * const reqs = client.getFriendManager().getCachedIncomingRequests();
     */
    getCachedIncomingRequests(): FriendRequest[] {
        return this.requests.getCachedIncomingRequests();
    }

    /**
     * 读取缓存中「发出」的好友请求（不发网络请求）。
     *
     * @returns 缓存的好友请求数组。
     * @example
     * const reqs = client.getFriendManager().getCachedOutgoingRequests();
     */
    getCachedOutgoingRequests(): FriendRequest[] {
        return this.requests.getCachedOutgoingRequests();
    }

    // ----- 好友列表（委托 → list） -----

    /**
     * 从服务端拉取好友列表并写入共享缓存。
     *
     * @returns 归一化后的好友数组。
     * @example
     * const friends = await client.getFriendManager().getFriends();
     */
    async getFriends(): Promise<Friend[]> {
        return this.list.getFriends();
    }

    /**
     * 获取好友推荐（可能认识的人）。
     *
     * @param limit - 返回条数上限，默认 10。
     * @returns 推荐好友数组。
     * @example
     * const suggestions = await client.getFriendManager().getFriendSuggestions(5);
     */
    async getFriendSuggestions(limit: number = 10): Promise<Friend[]> {
        return this.list.getFriendSuggestions(limit);
    }

    /**
     * 按关键词搜索用户（支持精确/模糊匹配）。
     *
     * @param q - 搜索关键词。
     * @param mode - 匹配模式：`"fuzzy"` 模糊或 `"exact"` 精确。
     * @param limit - 返回条数上限。
     * @returns 搜索结果。
     * @example
     * const r = await client.getFriendManager().searchUsers("alice", "fuzzy", 20);
     */
    async searchUsers(q: string, mode?: "fuzzy" | "exact", limit?: number): Promise<FriendSearchResponse> {
        return this.list.searchUsers(q, mode, limit);
    }

    /**
     * 以结构化查询对象进行高级好友搜索。
     *
     * @param query - 查询条件（关键词、匹配模式、条数、过滤项等）。
     * @returns 搜索结果。
     * @example
     * const r = await client.getFriendManager().searchFriendsAdvanced({ q: "alice", mode: "fuzzy", limit: 20 });
     */
    async searchFriendsAdvanced(query: FriendSearchQuery): Promise<FriendSearchResponse> {
        return this.list.searchFriendsAdvanced(query);
    }

    /**
     * 判断指定用户是否存在于本地好友缓存中（不发网络请求）。
     *
     * @param userId - 用户 ID。
     * @returns 是否命中缓存。
     * @example
     * const hit = client.getFriendManager().hasCachedFriend("@alice:example.com");
     */
    hasCachedFriend(userId: string): boolean {
        return this.list.hasCachedFriend(userId);
    }

    /**
     * 检查与指定用户的好友关系状态。
     *
     * @param userId - 目标用户 ID。
     * @returns 好友关系检查结果。
     * @example
     * const r = await client.getFriendManager().checkFriendship("@alice:example.com");
     */
    async checkFriendship(userId: string): Promise<FriendshipCheckResponse> {
        return this.list.checkFriendship(userId);
    }

    /**
     * 获取好友关系列表（r0 兼容接口）。
     *
     * @returns 归一化后的好友数组。
     * @example
     * const friends = await client.getFriendManager().getFriendships();
     */
    async getFriendships(): Promise<Friend[]> {
        return this.list.getFriendships();
    }

    /**
     * 建立与指定用户的好友关系。
     *
     * @param userId - 目标用户 ID。
     * @returns 服务端返回的用户 ID 与状态。
     * @example
     * const r = await client.getFriendManager().createFriendship("@alice:example.com");
     */
    async createFriendship(userId: string): Promise<{ user_id?: string; status?: string }> {
        return this.list.createFriendship(userId);
    }

    /**
     * 更新某个好友的备注（note）。
     *
     * @param userId - 好友用户 ID。
     * @param note - 备注内容，最长 1000 字符。
     * @returns 无。
     * @example
     * await client.getFriendManager().updateFriendNote("@alice:example.com", "大学同学");
     */
    async updateFriendNote(userId: string, note: string): Promise<void> {
        return this.list.updateFriendNote(userId, note);
    }

    /**
     * 获取某好友的完整状态信息。
     *
     * @param userId - 用户 ID。
     * @returns 好友状态信息。
     * @example
     * const info = await client.getFriendManager().getFriendStatusInfo("@alice:example.com");
     */
    async getFriendStatusInfo(userId: string): Promise<FriendStatusInfo> {
        return this.blocks.getFriendStatusInfo(userId);
    }

    /**
     * 获取某好友的状态字符串（如 favorite / normal / blocked / hidden）。
     *
     * @param userId - 用户 ID。
     * @returns 状态字符串。
     * @example
     * const status = await client.getFriendManager().getFriendStatus("@alice:example.com");
     */
    async getFriendStatus(userId: string): Promise<string> {
        return this.blocks.getFriendStatus(userId);
    }

    /**
     * 更新好友关系状态（可用于屏蔽/取消屏蔽）。
     *
     * @param userId - 用户 ID。
     * @param status - 状态值：`favorite` | `normal` | `blocked` | `hidden`。
     * @returns 无。
     * @example
     * await client.getFriendManager().updateFriendStatus("@alice:example.com", "blocked");
     */
    async updateFriendStatus(userId: string, status: string): Promise<void> {
        return this.blocks.updateFriendStatus(userId, status);
    }

    /**
     * 获取与某好友的私聊（DM）房间 ID。
     *
     * @param userId - 好友用户 ID。
     * @returns 包含 `room_id` 的对象；尚未建立私聊时为 `null`。
     * @example
     * const { room_id } = await client.getFriendManager().getFriendDm("@alice:example.com");
     */
    async getFriendDm(userId: string): Promise<{ room_id: string | null }> {
        return this.list.getFriendDm(userId);
    }

    /**
     * 创建（或获取）与某好友的私聊（DM）房间。
     *
     * @param userId - 好友用户 ID。
     * @returns 包含 `room_id` 的对象。
     * @example
     * const { room_id } = await client.getFriendManager().createFriendDm("@alice:example.com");
     */
    async createFriendDm(userId: string): Promise<{ room_id: string }> {
        return this.list.createFriendDm(userId);
    }

    /**
     * 删除某好友，并同步更新本地缓存。
     *
     * @param userId - 好友用户 ID。
     * @returns 无。
     * @example
     * await client.getFriendManager().removeFriend("@alice:example.com");
     */
    async removeFriend(userId: string): Promise<void> {
        return this.list.removeFriend(userId);
    }

    /**
     * 设置好友的显示名称（1~256 字符）。
     *
     * @param userId - 好友用户 ID。
     * @param displayName - 显示名称。
     * @returns 无。
     * @example
     * await client.getFriendManager().setFriendDisplayName("@alice:example.com", "Alice");
     */
    async setFriendDisplayName(userId: string, displayName: string): Promise<void> {
        return this.list.setFriendDisplayName(userId, displayName);
    }

    /**
     * 获取单个好友的详细信息。
     *
     * @param userId - 用户 ID。
     * @param throwOnError - 为 `true` 时出错即抛出；为 `false` 且「未找到」时返回 `null`。
     * @returns 好友信息；`throwOnError` 为 `false` 且未找到时为 `null`。
     * @example
     * const friend = await client.getFriendManager().getFriendInfo("@alice:example.com");
     */
    async getFriendInfo(userId: string, throwOnError = true): Promise<Friend | null> {
        return this.list.getFriendInfo(userId, throwOnError);
    }

    // ----- 好友分组（委托 → list） -----

    /**
     * 获取全部好友分组，并刷新本地分组缓存。
     *
     * @returns 好友分组数组。
     * @example
     * const groups = await client.getFriendManager().getFriendGroups();
     */
    async getFriendGroups(): Promise<FriendGroup[]> {
        return this.list.getFriendGroups();
    }

    /**
     * 创建好友分组（名称最长 50 字符）。
     *
     * @param name - 分组名称。
     * @returns 新建的分组。
     * @example
     * const group = await client.getFriendManager().createFriendGroup("同事");
     */
    async createFriendGroup(name: string): Promise<FriendGroup> {
        return this.list.createFriendGroup(name);
    }

    /**
     * 将某好友加入指定分组。
     *
     * @param groupId - 分组 ID。
     * @param userId - 好友用户 ID。
     * @returns 无。
     * @example
     * await client.getFriendManager().addToFriendGroup("g1", "@alice:example.com");
     */
    async addToFriendGroup(groupId: string, userId: string): Promise<void> {
        return this.list.addToFriendGroup(groupId, userId);
    }

    /**
     * 将某好友移出指定分组。
     *
     * @param groupId - 分组 ID。
     * @param userId - 好友用户 ID。
     * @returns 无。
     * @example
     * await client.getFriendManager().removeFromFriendGroup("g1", "@alice:example.com");
     */
    async removeFromFriendGroup(groupId: string, userId: string): Promise<void> {
        return this.list.removeFromFriendGroup(groupId, userId);
    }

    /**
     * 删除指定好友分组。
     *
     * @param groupId - 分组 ID。
     * @returns 无。
     * @example
     * await client.getFriendManager().deleteFriendGroup("g1");
     */
    async deleteFriendGroup(groupId: string): Promise<void> {
        return this.list.deleteFriendGroup(groupId);
    }

    /**
     * 重命名指定好友分组（名称最长 50 字符）。
     *
     * @param groupId - 分组 ID。
     * @param name - 新分组名称。
     * @returns 无。
     * @example
     * await client.getFriendManager().renameFriendGroup("g1", "老同事");
     */
    async renameFriendGroup(groupId: string, name: string): Promise<void> {
        return this.list.renameFriendGroup(groupId, name);
    }

    /**
     * 获取指定分组内的好友。
     *
     * @param groupId - 分组 ID。
     * @returns 该分组内的好友数组。
     * @example
     * const friends = await client.getFriendManager().getFriendsInGroup("g1");
     */
    async getFriendsInGroup(groupId: string): Promise<Friend[]> {
        return this.list.getFriendsInGroup(groupId);
    }

    /**
     * 获取某好友所属的全部分组。
     *
     * @param userId - 好友用户 ID。
     * @returns 该好友所属的分组数组。
     * @example
     * const groups = await client.getFriendManager().getGroupsForUser("@alice:example.com");
     */
    async getGroupsForUser(userId: string): Promise<FriendGroup[]> {
        return this.list.getGroupsForUser(userId);
    }

    // ----- 缓存（委托 → list） -----

    /**
     * 读取好友列表房间 ID（不发网络请求）。
     *
     * @returns 好友列表房间 ID；未初始化时为 `null`。
     * @example
     * const roomId = client.getFriendManager().getFriendListRoomId();
     */
    getFriendListRoomId(): string | null {
        return this.list.getFriendListRoomId();
    }

    /**
     * 读取本地缓存中的好友列表（不发网络请求）。
     *
     * @returns 缓存的好友数组。
     * @example
     * const friends = client.getFriendManager().getCachedFriends();
     */
    getCachedFriends(): Friend[] {
        return this.list.getCachedFriends();
    }

    /**
     * 获取本地缓存中的好友数量。
     *
     * @returns 好友数量。
     * @example
     * const count = client.getFriendManager().getFriendCount();
     */
    getFriendCount(): number {
        return this.list.getFriendCount();
    }

    /**
     * 获取好友缓存的命中统计。
     *
     * @returns 缓存大小、命中/未命中次数与命中率。
     * @example
     * const stats = client.getFriendManager().getCacheStats();
     */
    getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        return this.list.getCacheStats();
    }

    /**
     * 取好友列表房间 ID，必要时向服务端补齐并记忆。
     *
     * @returns 好友列表房间 ID；服务端未返回时为空字符串。
     * @example
     * const roomId = await client.getFriendManager().ensureFriendListRoom();
     */
    async ensureFriendListRoom(): Promise<string> {
        return this.list.ensureFriendListRoom();
    }

    /**
     * 清空好友列表与收发好友请求的全部本地缓存。
     *
     * @returns 无。
     * @example
     * client.getFriendManager().clearCache();
     */
    clearCache(): void {
        this.list.clearCache();
        this.requests.clearCache();
        this.sharedState.incomingRequests.clear();
        this.sharedState.outgoingRequests.clear();
    }

    // ----- 生命周期（委托 → list） -----

    /**
     * 全量同步好友列表与收发好友请求，完成后发出 SyncComplete 事件。
     *
     * @returns 无。
     * @example
     * await client.getFriendManager().sync();
     */
    async sync(): Promise<void> {
        await Promise.all([
            this.list.getFriends(),
            this.requests.getIncomingRequests(),
            this.requests.getOutgoingRequests(),
        ]);
        this.emit(FriendEvent.SyncComplete);
    }

    /** 进行中的初始化 Promise，用于并发 start() 去重（S-12，见 FriendListManager.start）。 */
    private initPromise: Promise<void> | null = null;

    /**
     * 初始化好友管理：拉取好友列表、收发好友请求与分组；并发调用会复用同一次初始化。
     *
     * @returns 无。
     * @example
     * await client.getFriendManager().start();
     */
    async start(): Promise<void> {
        if (this.sharedState.initialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
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
            } finally {
                this.initPromise = null;
            }
        })();

        return this.initPromise;
    }

    /**
     * 停止好友管理：清空缓存并复位初始化状态。
     *
     * @returns 无。
     * @example
     * client.getFriendManager().stop();
     */
    stop(): void {
        this.list.stop();
        this.requests.clearCache();
        this.sharedState.friendListRoomId = null;
        this.sharedState.initialized = false;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getFriendManager = function (): FriendManager {
        registerManagerClass("friend", FriendManager);
        return getOrCreateManager(this, "friend", () => new FriendManager(this));
    };
}
