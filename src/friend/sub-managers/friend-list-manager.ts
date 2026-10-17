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
import { VendorPrefix } from "../../http-api/prefix";
import { InvalidParamError } from "../../common/errors";
import { logger } from "../../logger";
import { NotFoundError } from "../../errors";
import { BaseManager } from "../../managers/base-manager";
import { validateUserId, validateLimit } from "../../common/validators";
import { doesClientAdvertiseSynapseRustFeature, SynapseRustFeature } from "../../server-capabilities";
import type {
    Friend,
    FriendGroup,
    FriendSearchResponse,
    FriendSearchQuery,
    FriendStatusInfo,
    FriendshipCheckResponse,
    FriendStatus,
    IFriendsResponse,
} from "../index";
import type { FriendSharedState } from "./shared-state";
import { friendPath } from "../paths";

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

    /**
     * 探测后端是否实现了好友能力。
     *
     * 判据是服务端 capabilities 是否宣告 `SynapseRustFeature.Friends`（缺省乐观为 true）。
     * 调用任何好友接口前都应先判一次：后端未实现时全部好友路由都会 404，而 404 很容易
     * 被误读成"没有好友"。
     *
     * @returns `true` 表示好友能力可用。
     *
     * @example
     * ```typescript
     * const friends = client.getFriendManager().list;
     * if (!(await friends.isSupported())) {
     *     console.log("后端未启用好友能力，跳过");
     *     return;
     * }
     * const list = await friends.getFriends();
     * ```
     */
    async isSupported(): Promise<boolean> {
        return doesClientAdvertiseSynapseRustFeature(this.client, SynapseRustFeature.Friends, true);
    }

    // ===== 内部工具 =====

    /**
     * 取好友列表房间的 ID，必要时从服务端补齐。
     *
     * 好友关系存储在一个专门的房间（`/friends` 返回 `room_id`）里。本方法的结果会被记忆在
     * 共享状态中，后续调用直接返回缓存值。
     *
     * @returns 好友列表房间 ID；服务端未返回时为**空字符串**（不是抛错）。
     *
     * @example
     * ```typescript
     * const roomId = await client.getFriendManager().list.ensureFriendListRoom();
     * if (!roomId) console.log("该账号还没有好友列表房间");
     * ```
     */
    async ensureFriendListRoom(): Promise<string> {
        if (this.sharedState.friendListRoomId) {
            return this.sharedState.friendListRoomId;
        }

        try {
            const response = await this.request<IFriendsResponse>({
                method: Method.Get,
                path: friendPath("/friends"),
                prefix: VendorPrefix,
            });

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

    /**
     * 获取好友列表。
     *
     * 每次调用都会向服务端请求并把结果写入共享缓存（`sharedState.friends`），
     * 不读缓存。要读缓存用 `getCachedFriends()`，要判断某人是否在缓存里用 `hasCachedFriend(userId)`。
     *
     * 响应归一化时优先取 `friends`，为**空数组**时回退到 `items`（FT-085：空数组是 truthy，
     * 用 `||` 会错误短路）。
     *
     * @returns 归一化后的好友数组。
     *
     * @example
     * ```typescript
     * const friends = await client.getFriendManager().list.getFriends();
     * console.log(`共 ${friends.length} 位好友`);
     * for (const f of friends) {
     *     console.log(f.display_name ?? f.user_id, f.online ? "在线" : "离线");
     * }
     * ```
     *
     * @throws {SdkError} 请求失败时抛出；后端未实现好友能力时通常是 404，应先用
     *   {@link FriendListManager.isSupported} 判空。
     */
    async getFriends(): Promise<Friend[]> {
        try {
            const response = await this.request<IFriendsResponse>({
                method: Method.Get,
                path: friendPath("/friends"),
                prefix: VendorPrefix,
            });

            if (response.room_id) {
                this.sharedState.friendListRoomId = response.room_id;
            }

            // FT-085: 空数组 [] 是 truthy，`friends || items` 会短路；改用 length 检查回退
            const friends = ((response.friends?.length ? response.friends : response.items) || []).map(normalizeFriend);
            this.sharedState.friends.clear();
            friends.forEach((f) => this.sharedState.friends.set(f.user_id, f));

            return friends;
        } catch (e) {
            throw this.normalizeError(e, "getFriends");
        }
    }

    /**
     * 获取推荐好友列表。
     *
     * @param limit - 返回的推荐数量上限，默认 10。
     * @returns 归一化后的推荐好友数组；服务端未返回 `suggestions` 时为空数组。
     * @throws {ValidationError} `limit` 非正整数时抛出。
     * @throws {Error} 请求失败时抛出。
     * @example
     * ```typescript
     * const suggestions = await client.getFriendManager().list.getFriendSuggestions(5);
     * console.log(`推荐 ${suggestions.length} 位好友`);
     * ```
     */
    async getFriendSuggestions(limit: number = 10): Promise<Friend[]> {
        validateLimit(limit);
        try {
            const response = await this.request<IFriendSuggestionsResponse>({
                method: Method.Get,
                path: friendPath("/friends/suggestions"),
                queryParams: { limit: String(limit) },
                prefix: VendorPrefix,
            });

            return (response.suggestions || []).map(normalizeFriend);
        } catch (e) {
            throw this.normalizeError(e, "getFriendSuggestions");
        }
    }

    // ===== 搜索 =====

    /**
     * 按关键词搜索用户。
     *
     * @param q - 搜索关键词，不能为空或纯空白。
     * @param mode - 匹配模式：`"fuzzy"` 模糊匹配或 `"exact"` 精确匹配；省略由服务端决定。
     * @param limit - 返回结果数量上限；省略由服务端决定。
     * @returns 搜索结果（`results` 为命中的用户数组）。
     * @throws {ValidationError} `q` 为空或仅含空白字符时抛出。
     * @throws {Error} 请求失败时抛出。
     * @example
     * ```typescript
     * const result = await client.getFriendManager().list.searchUsers("alice", "fuzzy", 20);
     * console.log(`命中 ${result.results?.length ?? 0} 个用户`);
     * ```
     */
    async searchUsers(q: string, mode?: "fuzzy" | "exact", limit?: number): Promise<FriendSearchResponse> {
        if (!q || q.trim().length === 0) {
            throw new InvalidParamError("Search term cannot be empty");
        }

        const params: Record<string, string | number> = { q: q.trim() };
        if (mode) params.mode = mode;
        if (limit !== undefined) params.limit = limit;

        try {
            const response = await this.request<FriendSearchResponse>({
                method: Method.Get,
                path: friendPath("/friends/search"),
                queryParams: params as Record<string, string | string[]>,
                prefix: VendorPrefix,
            });

            return response;
        } catch (e) {
            throw this.normalizeError(e, "searchUsers");
        }
    }

    /**
     * 以结构化条件进行高级好友搜索（POST /friends/search）。
     *
     * @param query - 搜索条件对象（如 `q`、`mode`、`limit`、`filters` 等），不能是空对象。
     * @returns 搜索结果（`results` 为命中的用户数组）。
     * @throws {ValidationError} `query` 为空对象时抛出。
     * @throws {Error} 请求失败时抛出。
     * @example
     * ```typescript
     * const result = await client.getFriendManager().list.searchFriendsAdvanced({ q: "alice", mode: "fuzzy", limit: 20 });
     * console.log(`命中 ${result.results?.length ?? 0} 个用户`);
     * ```
     */
    async searchFriendsAdvanced(query: FriendSearchQuery): Promise<FriendSearchResponse> {
        if (!query || Object.keys(query).length === 0) {
            throw new InvalidParamError("Search query cannot be empty");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.request<FriendSearchResponse>({
                    method: Method.Post,
                    path: friendPath("/friends/search"),
                    body: query,
                    prefix: VendorPrefix,
                });
            }, "searchFriendsAdvanced");

            return response;
        } catch (e) {
            throw this.normalizeError(e, "searchFriendsAdvanced");
        }
    }

    // ===== 好友关系检查 =====

    /**
     * 检查与指定用户之间的好友关系。
     *
     * @param userId - 目标用户的 Matrix ID，如 `@alice:example.com`。
     * @returns 好友关系检查结果（`user_id` / `is_friend` / `are_friends`）。
     * @throws {ValidationError} `userId` 为空时抛出。
     * @throws {Error} 请求失败时抛出。
     * @example
     * ```typescript
     * const { are_friends } = await client.getFriendManager().list.checkFriendship("@alice:example.com");
     * console.log(are_friends ? "已是好友" : "不是好友");
     * ```
     */
    async checkFriendship(userId: string): Promise<FriendshipCheckResponse> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        try {
            const response = await this.request<FriendshipCheckResponse>({
                method: Method.Get,
                path: friendPath(`/friends/check/${encodeURIComponent(userId)}`),
                prefix: VendorPrefix,
            });
            return response;
        } catch (e) {
            throw this.normalizeError(e, "checkFriendship");
        }
    }

    /**
     * 判断指定用户是否存在于本地好友缓存中（同步方法，不发起网络请求）。
     *
     * @param userId - 目标用户的 Matrix ID。
     * @returns 缓存中命中该用户时返回 `true`。
     * @example
     * ```typescript
     * const cached = client.getFriendManager().list.hasCachedFriend("@alice:example.com");
     * console.log(cached ? "缓存命中" : "缓存中无此人");
     * ```
     */
    hasCachedFriend(userId: string): boolean {
        return this.sharedState.friends.has(userId);
    }

    // ===== r0 兼容接口 =====

    /**
     * 获取好友关系列表（r0 兼容接口，带重试）。
     *
     * 与 `getFriends()` 不同，本方法不写入共享缓存。
     *
     * @returns 归一化后的好友数组。
     * @throws {Error} 请求失败时抛出。
     * @example
     * ```typescript
     * const friends = await client.getFriendManager().list.getFriendships();
     * console.log(`共 ${friends.length} 位好友`);
     * ```
     */
    async getFriendships(): Promise<Friend[]> {
        try {
            const response = await this.withRetry(async () => {
                return await this.request<IFriendsResponse>({
                    method: Method.Get,
                    path: friendPath("/friends"),
                    prefix: VendorPrefix,
                });
            }, "getFriendships");

            // FT-085: 空数组 [] 是 truthy，`friends || items` 会短路；改用 length 检查回退
            const friends = ((response.friends?.length ? response.friends : response.items) || []).map(normalizeFriend);
            return friends;
        } catch (e) {
            throw this.normalizeError(e, "getFriendships");
        }
    }

    /**
     * 创建好友关系（r0 兼容接口，带重试）。
     *
     * @param userId - 要添加为好友的用户 Matrix ID。
     * @returns 服务端返回的好友关系信息（`user_id` / `status`）。
     * @throws {ValidationError} `userId` 为空或格式非法时抛出。
     * @throws {Error} 请求失败时抛出。
     * @example
     * ```typescript
     * const { status } = await client.getFriendManager().list.createFriendship("@alice:example.com");
     * console.log(`关系状态：${status}`);
     * ```
     */
    async createFriendship(userId: string): Promise<{ user_id?: string; status?: string }> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }
        validateUserId(userId);

        try {
            const response = await this.withRetry(async () => {
                return await this.request<{ user_id?: string; status?: string }>({
                    method: Method.Post,
                    path: friendPath("/friends"),
                    body: { user_id: userId },
                    prefix: VendorPrefix,
                });
            }, "createFriendship");

            return { user_id: response?.user_id, status: response?.status };
        } catch (e) {
            throw this.normalizeError(e, "createFriendship");
        }
    }

    // ===== 好友分组 =====

    /**
     * 获取全部好友分组，并刷新共享缓存中的分组。
     *
     * @returns 好友分组数组；服务端未返回 `groups` 时为空数组。
     * @throws {Error} 请求失败时抛出。
     * @example
     * ```typescript
     * const groups = await client.getFriendManager().list.getFriendGroups();
     * for (const g of groups) console.log(g.id, g.name);
     * ```
     */
    async getFriendGroups(): Promise<FriendGroup[]> {
        try {
            const response = await this.request<IFriendGroupsResponse>({
                method: Method.Get,
                path: friendPath("/friends/groups"),
                prefix: VendorPrefix,
            });

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

    /**
     * 创建好友分组。
     *
     * @param name - 分组名称，长度 1–50 个字符。
     * @returns 新建的分组（同时写入共享缓存）。
     * @throws {ValidationError} `name` 为空或超过 50 个字符时抛出。
     * @example
     * ```typescript
     * const group = await client.getFriendManager().list.createFriendGroup("同事");
     * console.log(`已创建分组 ${group.id}`);
     * ```
     */
    async createFriendGroup(name: string): Promise<FriendGroup> {
        if (!name || name.length === 0) {
            throw new InvalidParamError("Group name is required");
        }
        if (name.length > 50) {
            throw new InvalidParamError("Group name too long (max 50 characters)");
        }

        const response = await this.request<ICreateGroupResponse>({
            method: Method.Post,
            path: friendPath("/friends/groups"),
            body: { name },
            prefix: VendorPrefix,
        });

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

    /**
     * 将用户加入指定好友分组，并同步更新本地缓存。
     *
     * @param groupId - 目标分组 ID。
     * @param userId - 要加入分组的用户 Matrix ID。
     * @returns 无返回值。
     * @throws {ValidationError} `userId` 为空或格式非法时抛出。
     * @example
     * ```typescript
     * await client.getFriendManager().list.addToFriendGroup("grp_1", "@alice:example.com");
     * ```
     */
    async addToFriendGroup(groupId: string, userId: string): Promise<void> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }
        validateUserId(userId);
        await this.request({
            method: Method.Post,
            path: friendPath(`/friends/groups/${groupId}/add/${encodeURIComponent(userId)}`),
            prefix: VendorPrefix,
        });

        const cached = this.sharedState.groups[groupId];
        if (cached && !cached.members.includes(userId)) {
            cached.members.push(userId);
        }
    }

    /**
     * 将用户移出指定好友分组，并同步更新本地缓存。
     *
     * @param groupId - 目标分组 ID。
     * @param userId - 要移出分组的用户 Matrix ID。
     * @returns 无返回值。
     * @example
     * ```typescript
     * await client.getFriendManager().list.removeFromFriendGroup("grp_1", "@alice:example.com");
     * ```
     */
    async removeFromFriendGroup(groupId: string, userId: string): Promise<void> {
        await this.request({
            method: Method.Delete,
            path: friendPath(`/friends/groups/${groupId}/remove/${encodeURIComponent(userId)}`),
            prefix: VendorPrefix,
        });

        const cached = this.sharedState.groups[groupId];
        if (cached) {
            cached.members = cached.members.filter((u) => u !== userId);
        }
    }

    /**
     * 删除指定好友分组，并从本地缓存中移除。
     *
     * @param groupId - 要删除的分组 ID。
     * @returns 无返回值。
     * @example
     * ```typescript
     * await client.getFriendManager().list.deleteFriendGroup("grp_1");
     * ```
     */
    async deleteFriendGroup(groupId: string): Promise<void> {
        await this.request({
            method: Method.Delete,
            path: friendPath(`/friends/groups/${groupId}`),
            prefix: VendorPrefix,
        });

        delete this.sharedState.groups[groupId];
    }

    /**
     * 重命名好友分组，并同步更新本地缓存。
     *
     * @param groupId - 目标分组 ID。
     * @param name - 新分组名称，长度 1–50 个字符。
     * @returns 无返回值。
     * @throws {ValidationError} `name` 为空或超过 50 个字符时抛出。
     * @example
     * ```typescript
     * await client.getFriendManager().list.renameFriendGroup("grp_1", "老同事");
     * ```
     */
    async renameFriendGroup(groupId: string, name: string): Promise<void> {
        if (!name || name.length === 0) {
            throw new InvalidParamError("Group name is required");
        }
        if (name.length > 50) {
            throw new InvalidParamError("Group name too long (max 50 characters)");
        }

        await this.request({
            method: Method.Put,
            path: friendPath(`/friends/groups/${groupId}/name`),
            body: { name },
            prefix: VendorPrefix,
        });

        const cached = this.sharedState.groups[groupId];
        if (cached) {
            cached.name = name;
        }
    }

    /**
     * 获取指定分组内的好友。
     *
     * @param groupId - 目标分组 ID。
     * @returns 归一化后的好友数组；服务端未返回 `friends` 时为空数组。
     * @example
     * ```typescript
     * const friends = await client.getFriendManager().list.getFriendsInGroup("grp_1");
     * console.log(`分组内有 ${friends.length} 位好友`);
     * ```
     */
    async getFriendsInGroup(groupId: string): Promise<Friend[]> {
        const response = await this.request<{ friends: Friend[] }>({
            method: Method.Get,
            path: friendPath(`/friends/groups/${groupId}/friends`),
            prefix: VendorPrefix,
        });

        return (response.friends || []).map(normalizeFriend);
    }

    /**
     * 获取指定用户所属的全部分组。
     *
     * @param userId - 目标用户的 Matrix ID。
     * @returns 该用户所属的分组数组；服务端未返回 `groups` 时为空数组。
     * @throws {ValidationError} `userId` 为空时抛出。
     * @example
     * ```typescript
     * const groups = await client.getFriendManager().list.getGroupsForUser("@alice:example.com");
     * console.log(groups.map((g) => g.name).join("、"));
     * ```
     */
    async getGroupsForUser(userId: string): Promise<FriendGroup[]> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        const response = await this.request<{ groups?: FriendGroup[] }>({
            method: Method.Get,
            path: friendPath(`/friends/${encodeURIComponent(userId)}/groups`),
            prefix: VendorPrefix,
        });

        return response.groups ?? [];
    }

    // ===== 好友操作 =====

    /**
     * 删除好友，并同步清理本地缓存、派发 `Removed` / `FriendRemoved` / `ListUpdated` 事件。
     *
     * @param userId - 要删除的好友 Matrix ID。
     * @returns 无返回值。
     * @example
     * ```typescript
     * await client.getFriendManager().list.removeFriend("@alice:example.com");
     * ```
     */
    async removeFriend(userId: string): Promise<void> {
        validateUserId(userId);

        await this.request({
            method: Method.Delete,
            path: friendPath(`/friends/${encodeURIComponent(userId)}`),
            prefix: VendorPrefix,
        });

        this.sharedState.friends.delete(userId);
        this.emit(FriendListManagerEvent.Removed, userId);
        this.emit(FriendListManagerEvent.FriendRemoved, userId);
        this.emit(FriendListManagerEvent.ListUpdated);
    }

    /**
     * 设置好友的备注名（仅对自己可见）。
     *
     * @param userId - 目标好友 Matrix ID。
     * @param displayName - 备注名，长度 1–256 个字符。
     * @returns 无返回值。
     * @throws {ValidationError} `displayName` 为空或超过 256 个字符时抛出。
     * @example
     * ```typescript
     * await client.getFriendManager().list.setFriendDisplayName("@alice:example.com", "Alice（同事）");
     * ```
     */
    async setFriendDisplayName(userId: string, displayName: string): Promise<void> {
        if (!displayName || displayName.length < 1 || displayName.length > 256) {
            throw new InvalidParamError("Display name must be between 1 and 256 characters");
        }
        await this.request({
            method: Method.Put,
            path: friendPath(`/friends/${encodeURIComponent(userId)}/displayname`),
            body: { displayname: displayName },
            prefix: VendorPrefix,
        });
    }

    /**
     * 更新好友备注（note），并同步本地缓存、派发 `FriendUpdated` 事件。
     *
     * @param userId - 目标好友 Matrix ID。
     * @param note - 备注内容，最长 1000 个字符。
     * @returns 无返回值。
     * @throws {ValidationError} `userId` 为空或 `note` 超过 1000 个字符时抛出。
     * @example
     * ```typescript
     * await client.getFriendManager().list.updateFriendNote("@alice:example.com", "在 2024 年产品会上认识");
     * ```
     */
    async updateFriendNote(userId: string, note: string): Promise<void> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }
        if (note.length > 1000) {
            throw new InvalidParamError("Note too long (max 1000 characters)");
        }

        await this.request({
            method: Method.Put,
            path: friendPath(`/friends/${encodeURIComponent(userId)}/note`),
            body: { note },
            prefix: VendorPrefix,
        });

        const friend = this.sharedState.friends.get(userId);
        if (friend) {
            friend.note = note;
            this.sharedState.friends.set(userId, friend);
            this.emit(FriendListManagerEvent.FriendUpdated, friend);
        }
    }

    // ===== 好友信息 =====

    /**
     * 获取好友状态详情。
     *
     * @param userId - 目标好友 Matrix ID。
     * @returns 好友状态信息（`user_id` / `status` / `is_friend` 等）。
     * @throws {ValidationError} `userId` 为空时抛出。
     * @example
     * ```typescript
     * const info = await client.getFriendManager().list.getFriendStatusInfo("@alice:example.com");
     * console.log(info.status);
     * ```
     */
    async getFriendStatusInfo(userId: string): Promise<FriendStatusInfo> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        return this.request<FriendStatusInfo>({
            method: Method.Get,
            path: friendPath(`/friends/${encodeURIComponent(userId)}/status`),
            prefix: VendorPrefix,
        });
    }

    /**
     * 获取好友状态字符串（`getFriendStatusInfo()` 的便捷封装）。
     *
     * @param userId - 目标好友 Matrix ID。
     * @returns 好友状态字符串。
     * @example
     * ```typescript
     * const status = await client.getFriendManager().list.getFriendStatus("@alice:example.com");
     * console.log(status);
     * ```
     */
    async getFriendStatus(userId: string): Promise<string> {
        const response = await this.getFriendStatusInfo(userId);
        return response.status;
    }

    /**
     * 获取单个好友的详细信息。
     *
     * @param userId - 目标好友 Matrix ID。
     * @param throwOnError - 为 `true`（默认）时请求出错直接抛出；为 `false` 时好友不存在
     *   （`NotFoundError`）返回 `null`，其他错误仍抛出。
     * @returns 归一化后的好友信息；`throwOnError` 为 `false` 且好友不存在时为 `null`。
     * @throws {ValidationError} `userId` 为空时抛出。
     * @throws {Error} 请求失败（且 `throwOnError` 为 `true`）时抛出。
     * @example
     * ```typescript
     * const friend = await client.getFriendManager().list.getFriendInfo("@alice:example.com");
     * if (friend) console.log(friend.display_name ?? friend.user_id);
     * ```
     */
    async getFriendInfo(userId: string, throwOnError = true): Promise<Friend | null> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        try {
            const response = await this.request<Friend>({
                method: Method.Get,
                path: friendPath(`/friends/${encodeURIComponent(userId)}/info`),
                prefix: VendorPrefix,
            });
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

    /**
     * 获取与指定好友的私聊（DM）房间 ID。
     *
     * @param userId - 目标好友 Matrix ID。
     * @returns 包含 `room_id` 的对象；尚未建立私聊时 `room_id` 为 `null`。
     * @throws {ValidationError} `userId` 为空或格式非法时抛出。
     * @throws {Error} 请求失败时抛出。
     * @example
     * ```typescript
     * const { room_id } = await client.getFriendManager().list.getFriendDm("@alice:example.com");
     * console.log(room_id ?? "还没有私聊房间");
     * ```
     */
    async getFriendDm(userId: string): Promise<{ room_id: string | null }> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }
        validateUserId(userId);

        try {
            const response = await this.request<{ room_id: string | null }>({
                method: Method.Get,
                path: friendPath(`/friends/dm/${encodeURIComponent(userId)}`),
                prefix: VendorPrefix,
            });
            return response;
        } catch (e) {
            throw this.normalizeError(e, "getFriendDm");
        }
    }

    /**
     * 创建（或获取已存在的）与指定好友的私聊（DM）房间。
     *
     * @param userId - 目标好友 Matrix ID。
     * @returns 包含 `room_id` 的对象。
     * @throws {ValidationError} `userId` 为空或格式非法时抛出。
     * @throws {Error} 请求失败时抛出。
     * @example
     * ```typescript
     * const { room_id } = await client.getFriendManager().list.createFriendDm("@alice:example.com");
     * console.log(`私聊房间：${room_id}`);
     * ```
     */
    async createFriendDm(userId: string): Promise<{ room_id: string }> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }
        validateUserId(userId);

        try {
            const response = await this.request<{ room_id: string }>({
                method: Method.Post,
                path: friendPath(`/friends/dm/${encodeURIComponent(userId)}`),
                prefix: VendorPrefix,
            });
            return response;
        } catch (e) {
            throw this.normalizeError(e, "createFriendDm");
        }
    }

    // ===== 缓存访问 =====

    /**
     * 获取已缓存的好友列表房间 ID（同步方法，不发起网络请求）。
     *
     * @returns 好友列表房间 ID；尚未解析或未知时为 `null`。
     * @example
     * ```typescript
     * const roomId = client.getFriendManager().list.getFriendListRoomId();
     * if (roomId) console.log(`好友列表房间：${roomId}`);
     * ```
     */
    getFriendListRoomId(): string | null {
        return this.sharedState.friendListRoomId;
    }

    /**
     * 读取本地缓存的好友列表（同步方法，不发起网络请求）。
     *
     * @returns 缓存中的好友数组；缓存为空时为空数组。
     * @example
     * ```typescript
     * const cached = client.getFriendManager().list.getCachedFriends();
     * console.log(`缓存中有 ${cached.length} 位好友`);
     * ```
     */
    getCachedFriends(): Friend[] {
        return this.sharedState.friends.values();
    }

    /**
     * 获取本地缓存的好友数量（同步方法，不发起网络请求）。
     *
     * @returns 缓存中的好友数量。
     * @example
     * ```typescript
     * const count = client.getFriendManager().list.getFriendCount();
     * console.log(`好友数：${count}`);
     * ```
     */
    getFriendCount(): number {
        return this.sharedState.friends.size();
    }

    /**
     * 获取好友缓存的命中统计信息。
     *
     * @returns 统计对象，包含 `size`、`hits`、`misses`、`hitRate`。
     * @example
     * ```typescript
     * const stats = client.getFriendManager().list.getCacheStats();
     * console.log(`命中率 ${(stats.hitRate * 100).toFixed(1)}%`);
     * ```
     */
    getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        return this.sharedState.friends.getStats();
    }

    /**
     * 清空本地好友缓存（同步方法，不发起网络请求）。
     *
     * @returns 无返回值。
     * @example
     * ```typescript
     * client.getFriendManager().list.clearCache();
     * ```
     */
    clearCache(): void {
        this.sharedState.friends.clear();
    }

    // ===== 生命周期 =====

    /**
     * 同步好友列表数据，完成后派发 `SyncComplete` 事件。
     *
     * @returns 同步完成时 resolve 的 Promise。
     * @example
     * ```typescript
     * await client.getFriendManager().list.sync();
     * console.log("好友列表已同步");
     * ```
     */
    async sync(): Promise<void> {
        await Promise.all([
            this.getFriends(),
            // getIncomingRequests / getOutgoingRequests are on FriendRequestManager;
            // the orchestrator calls these in parallel. Here we only sync the list part.
        ]);
        this.emit(FriendListManagerEvent.SyncComplete);
    }

    /**
     * 进行中的初始化 Promise（S-12）。
     *
     * 原实现用 `if (initialized) return` 守卫，但 `initialized` 是在 `await` 之后才置位，
     * 并发调用会一起越过守卫、各自发一轮网络请求。这里缓存进行中的 Promise，
     * 让并发调用复用同一次初始化。
     */
    private initPromise: Promise<void> | null = null;

    /**
     * 启动（初始化）好友列表管理器：加载好友列表与好友分组。
     *
     * 并发调用会复用同一次进行中的初始化 Promise（S-12）；初始化失败时不抛出，
     * 仅记录警告，并允许下一次调用重试。
     *
     * @returns 初始化完成时 resolve 的 Promise。
     * @example
     * ```typescript
     * await client.getFriendManager().list.start();
     * ```
     */
    async start(): Promise<void> {
        if (this.sharedState.initialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            try {
                await Promise.all([this.getFriends(), this.getFriendGroups()]);
                this.sharedState.initialized = true;
            } catch (e) {
                logger.warn("FriendListManager.start failed:", e);
            } finally {
                // 置空以便失败后下一次调用可以重试（与原有语义一致）
                this.initPromise = null;
            }
        })();

        return this.initPromise;
    }

    /**
     * 停止（重置）好友列表管理器：清空好友缓存与分组，并标记为未初始化。
     *
     * @returns 无返回值。
     * @example
     * ```typescript
     * client.getFriendManager().list.stop();
     * ```
     */
    stop(): void {
        this.sharedState.friends.clear();
        this.sharedState.groups = {};
        this.sharedState.initialized = false;
    }
}
