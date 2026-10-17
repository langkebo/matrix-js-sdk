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
 * Tag Manager - 标签管理
 *
 * 提供房间标签的添加、删除、查询功能
 */

import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import type { IContent } from "../models/event";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { MatrixClient } from "../client";
import { logger } from "../logger";
import { ValidationError } from "../errors";
import type { TagsPath } from "./__generated__/route-table";
import type { PathAssert, StripV3 } from "../http-api/strip-prefix";

function tp<const P extends string>(path: P & PathAssert<P, StripV3<TagsPath>>): P {
    return path;
}

export enum TagEvent {
    TagAdded = "TagAdded",
    TagRemoved = "TagRemoved",
    TagsUpdated = "TagsUpdated",
    TagError = "TagError",
}

export interface IRoomTag {
    name: string;
    order?: number;
}

export interface IRoomTags {
    [tagName: string]: {
        order?: number;
    };
}

interface TagManagerEventMap {
    [TagEvent.TagAdded]: (roomId: string, tag: string) => void;
    [TagEvent.TagRemoved]: (roomId: string, tag: string) => void;
    [TagEvent.TagsUpdated]: (roomId: string, tags: IRoomTags) => void;
    [TagEvent.TagError]: (roomId: string, error: Error) => void;
}

export class TagManager extends BaseManager<TagEvent, TagManagerEventMap> {
    private roomTags: Map<string, IRoomTags> = new Map();

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 获取指定房间的全部标签：优先命中本地缓存，未命中则回源到服务端。
     *
     * @param roomId - 房间 ID
     * @returns 该房间的标签映射；请求失败时返回空对象
     * @throws {ValidationError} 当当前未登录时（该异常在方法内被捕获并降级为空对象）
     * @example
     * const tags = await client.getTagManager().getRoomTags(roomId);
     */
    async getRoomTags(roomId: string): Promise<IRoomTags> {
        if (this.roomTags.has(roomId)) {
            return this.roomTags.get(roomId) || {};
        }

        try {
            const userId = this.client.getUserId();
            if (!userId) {
                throw new ValidationError("User ID is required");
            }
            const response = await this.withRetry(
                async () =>
                    await this.request<{ tags?: IRoomTags }>({
                        method: Method.Get,
                        path: tp(`/user/${encodeURIComponent(userId)}/rooms/${encodeURIComponent(roomId)}/tags`),
                        prefix: ClientPrefix.V3,
                    }),
                "getRoomTags",
            );

            const tags = response.tags || {};
            this.roomTags.set(roomId, tags);

            return tags;
        } catch (e) {
            logger.warn("TagManager.getRoomTags failed:", e);
        }
        return {};
    }

    /**
     * 为房间添加（或覆盖）一个标签。
     *
     * 成功后更新本地缓存，并依次发出 {@link TagEvent.TagAdded} 与 {@link TagEvent.TagsUpdated}。
     *
     * @param roomId - 房间 ID
     * @param tag - 标签名（如 `m.favourite`）
     * @param order - 可选排序权重，用于同一标签组内排序
     * @throws {ValidationError} 当 roomId/tag 缺失或当前未登录时
     * @example
     * await client.getTagManager().addRoomTag(roomId, "m.favourite", 0.5);
     */
    async addRoomTag(roomId: string, tag: string, order?: number): Promise<void> {
        if (!roomId || !tag) {
            throw new ValidationError("Room ID and tag are required");
        }

        try {
            const userId = this.client.getUserId();
            if (!userId) {
                throw new ValidationError("User ID is required");
            }
            const body: IContent = {};

            if (order !== undefined) {
                body.order = order;
            }

            await this.withRetry(
                async () =>
                    await this.request({
                        method: Method.Put,
                        path: tp(
                            `/user/${encodeURIComponent(userId)}/rooms/${encodeURIComponent(roomId)}/tags/${encodeURIComponent(tag)}`,
                        ),
                        body: body,
                        prefix: ClientPrefix.V3,
                    }),
                "addRoomTag",
            );

            const tags = this.roomTags.get(roomId) || {};
            tags[tag] = { order };
            this.roomTags.set(roomId, tags);

            this.emit(TagEvent.TagAdded, roomId, tag);
            this.emit(TagEvent.TagsUpdated, roomId, tags);
        } catch (error) {
            this.emit(TagEvent.TagError, roomId, this.normalizeError(error, "addRoomTag"));
            throw error;
        }
    }

    /**
     * 移除房间上的指定标签。
     *
     * 成功后更新本地缓存，并依次发出 {@link TagEvent.TagRemoved} 与 {@link TagEvent.TagsUpdated}。
     *
     * @param roomId - 房间 ID
     * @param tag - 标签名
     * @throws {ValidationError} 当 roomId/tag 缺失或当前未登录时
     * @example
     * await client.getTagManager().removeRoomTag(roomId, "m.favourite");
     */
    async removeRoomTag(roomId: string, tag: string): Promise<void> {
        if (!roomId || !tag) {
            throw new ValidationError("Room ID and tag are required");
        }

        try {
            const userId = this.client.getUserId();
            if (!userId) {
                throw new ValidationError("User ID is required");
            }

            await this.withRetry(
                async () =>
                    await this.request({
                        method: Method.Delete,
                        path: tp(
                            `/user/${encodeURIComponent(userId)}/rooms/${encodeURIComponent(roomId)}/tags/${encodeURIComponent(tag)}`,
                        ),
                        prefix: ClientPrefix.V3,
                    }),
                "removeRoomTag",
            );

            const tags = this.roomTags.get(roomId) || {};
            delete tags[tag];
            this.roomTags.set(roomId, tags);

            this.emit(TagEvent.TagRemoved, roomId, tag);
            this.emit(TagEvent.TagsUpdated, roomId, tags);
        } catch (error) {
            this.emit(TagEvent.TagError, roomId, this.normalizeError(error, "removeRoomTag"));
            throw error;
        }
    }

    /**
     * 从本地缓存中筛选带指定标签的全部房间。
     *
     * @param tag - 标签名
     * @returns 带该标签的房间 ID 列表
     * @example
     * const rooms = await client.getTagManager().getRoomsByTag("m.favourite");
     */
    async getRoomsByTag(tag: string): Promise<string[]> {
        const rooms: string[] = [];

        for (const [roomId, tags] of this.roomTags.entries()) {
            if (tags[tag] !== undefined) {
                rooms.push(roomId);
            }
        }

        return rooms;
    }

    /**
     * 设置房间标签的排序权重（等价于以指定 order 调用 {@link TagManager.addRoomTag}）。
     *
     * @param roomId - 房间 ID
     * @param tag - 标签名
     * @param order - 排序权重
     * @example
     * await client.getTagManager().setRoomTagOrder(roomId, "m.favourite", 0.5);
     */
    async setRoomTagOrder(roomId: string, tag: string, order: number): Promise<void> {
        await this.addRoomTag(roomId, tag, order);
    }

    /**
     * 清空房间上的全部标签。
     *
     * @param roomId - 房间 ID
     * @example
     * await client.getTagManager().clearRoomTags(roomId);
     */
    async clearRoomTags(roomId: string): Promise<void> {
        const tags = await this.getRoomTags(roomId);

        for (const tag of Object.keys(tags)) {
            await this.removeRoomTag(roomId, tag);
        }
    }

    /**
     * 汇总本地缓存，得到「标签 -> 房间 ID 列表」的反向映射。
     *
     * @returns 标签名到房间 ID 列表的映射
     * @example
     * const byTag = await client.getTagManager().getTaggedRooms();
     */
    async getTaggedRooms(): Promise<Map<string, string[]>> {
        const result = new Map<string, string[]>();

        for (const [roomId, tags] of this.roomTags.entries()) {
            for (const tag of Object.keys(tags)) {
                if (!result.has(tag)) {
                    result.set(tag, []);
                }
                result.get(tag)!.push(roomId);
            }
        }

        return result;
    }

    /**
     * 获取被标记为收藏（`m.favourite`）的房间。
     *
     * @returns 收藏房间的 ID 列表
     * @example
     * const favorites = await client.getTagManager().getFavoriteRooms();
     */
    async getFavoriteRooms(): Promise<string[]> {
        return this.getRoomsByTag("m.favourite");
    }

    /**
     * 将房间加入收藏（`m.favourite`，权重 0.5）。
     *
     * @param roomId - 房间 ID
     * @example
     * await client.getTagManager().addToFavorites(roomId);
     */
    async addToFavorites(roomId: string): Promise<void> {
        await this.addRoomTag(roomId, "m.favourite", 0.5);
    }

    /**
     * 将房间移出收藏（`m.favourite`）。
     *
     * @param roomId - 房间 ID
     * @example
     * await client.getTagManager().removeFromFavorites(roomId);
     */
    async removeFromFavorites(roomId: string): Promise<void> {
        await this.removeRoomTag(roomId, "m.favourite");
    }

    /**
     * 判断房间是否已收藏。
     *
     * @param roomId - 房间 ID
     * @returns 是否为收藏房间
     * @example
     * const isFav = await client.getTagManager().isFavorite(roomId);
     */
    async isFavorite(roomId: string): Promise<boolean> {
        const tags = await this.getRoomTags(roomId);
        return tags["m.favourite"] !== undefined;
    }

    /**
     * 获取被标记为低优先级（`m.lowpriority`）的房间。
     *
     * @returns 低优先级房间的 ID 列表
     * @example
     * const rooms = await client.getTagManager().getLowPriorityRooms();
     */
    async getLowPriorityRooms(): Promise<string[]> {
        return this.getRoomsByTag("m.lowpriority");
    }

    /**
     * 将房间标记为低优先级（`m.lowpriority`，权重 1）。
     *
     * @param roomId - 房间 ID
     * @example
     * await client.getTagManager().addToLowPriority(roomId);
     */
    async addToLowPriority(roomId: string): Promise<void> {
        await this.addRoomTag(roomId, "m.lowpriority", 1);
    }

    /**
     * 取消房间的低优先级标记（`m.lowpriority`）。
     *
     * @param roomId - 房间 ID
     * @example
     * await client.getTagManager().removeFromLowPriority(roomId);
     */
    async removeFromLowPriority(roomId: string): Promise<void> {
        await this.removeRoomTag(roomId, "m.lowpriority");
    }

    /**
     * 判断房间是否被标记为低优先级。
     *
     * @param roomId - 房间 ID
     * @returns 是否为低优先级房间
     * @example
     * const low = await client.getTagManager().isLowPriority(roomId);
     */
    async isLowPriority(roomId: string): Promise<boolean> {
        const tags = await this.getRoomTags(roomId);
        return tags["m.lowpriority"] !== undefined;
    }

    /**
     * 仅从本地缓存读取房间标签，不触发网络请求。
     *
     * @param roomId - 房间 ID
     * @returns 缓存的标签映射；未缓存时返回空对象
     * @example
     * const cached = client.getTagManager().getCachedTags(roomId);
     */
    getCachedTags(roomId: string): IRoomTags {
        return this.roomTags.get(roomId) || {};
    }

    /**
     * 同步版本的 {@link TagManager.getRoomsByTag}，仅查本地缓存。
     *
     * @param tag - 标签名
     * @returns 带该标签的房间 ID 列表
     * @example
     * const rooms = client.getTagManager().getCachedRoomsByTag("m.favourite");
     */
    getCachedRoomsByTag(tag: string): string[] {
        const rooms: string[] = [];
        for (const [roomId, tags] of this.roomTags.entries()) {
            if (tags[tag] !== undefined) {
                rooms.push(roomId);
            }
        }
        return rooms;
    }

    /**
     * 清空本地标签缓存。
     *
     * @example
     * client.getTagManager().clearCache();
     */
    clearCache(): void {
        this.roomTags.clear();
    }

    /**
     * 预热缓存：为客户端已知的每个房间拉取一次标签。
     *
     * @example
     * await client.getTagManager().start();
     */
    async start(): Promise<void> {
        const rooms = this.client.getRooms?.() || [];
        for (const room of rooms) {
            try {
                await this.getRoomTags(room.roomId);
            } catch (e) {
                logger.warn(`Failed to load tags for room ${room.roomId}:`, e);
            }
        }
    }

    /**
     * 停止管理器并清空本地标签缓存。
     *
     * @example
     * client.getTagManager().stop();
     */
    stop(): void {
        this.roomTags.clear();
    }
}
