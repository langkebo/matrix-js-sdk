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
 * Space Manager - Space 空间管理
 *
 * 提供 Space 相关的 API 封装，包括：
 * - 创建/更新/删除 Space
 * - 获取 Space 信息和层级结构
 * - 管理 Space 子房间
 * - 获取用户的所有 Space
 *
 * 对接后端: synapse-rust/src/web/routes/space.rs
 */

import { MatrixClient } from "../client";
import { EventType } from "../@types/event";
import { MatrixError } from "../http-api/errors";
import { AuthError, NotFoundError, RetryableError, ApiError, SdkError } from "../errors";

export interface Space {
    space_id: string;
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    creator: string;
    join_rule: string;
    is_public: boolean;
    created_ts: number;
}

export interface SpaceChild {
    space_id: string;
    room_id: string;
    via_servers: string[];
    sender: string;
    is_suggested: boolean;
    added_ts: number;
}

export interface SpaceMember {
    space_id: string;
    user_id: string;
    membership: string;
    joined_ts: number;
}

export interface SpaceHierarchy {
    space: Space;
    children: SpaceChild[];
    members: SpaceMember[];
}

export interface CreateSpaceOptions {
    name: string;
    topic?: string;
    avatar_url?: string;
    visibility?: "public" | "private";
    parent_space_id?: string;
}

export interface UpdateSpaceOptions {
    name?: string;
    topic?: string;
}

export interface AddChildOptions {
    room_id: string;
    via_servers?: string[];
    suggested?: boolean;
}

export class SpaceManager {
    private client: MatrixClient;
    private cache: Map<string, { data: Space[]; expiry: number }> = new Map();
    private static readonly CACHE_TTL = 5 * 60 * 1000;

    constructor(client: MatrixClient) {
        this.client = client;
    }

    /**
     * 创建 Space
     *
     * @param options - 创建选项
     * @returns 创建的 Space 信息
     */
    async createSpace(options: CreateSpaceOptions): Promise<Space> {
        const room = await this.client.createRoom({
            name: options.name,
            topic: options.topic,
            ...(options.avatar_url && { avatar_url: options.avatar_url }),
        });

        const spaceId = room.room_id;
        if (!spaceId) {
            throw new Error("No room_id returned from createRoom");
        }

        if (options.parent_space_id) {
            await this.addChild(options.parent_space_id, {
                room_id: spaceId,
                via_servers: [this.client.getDomain() ?? "localhost"],
            });
        }

        this.clearCache();
        return this.getSpace(spaceId);
    }

    /**
     * 获取 Space 信息
     *
     * @param spaceId - Space ID
     * @returns Space 信息
     */
    async getSpace(spaceId: string): Promise<Space> {
        const room = this.client.getRoom(spaceId);
        if (!room) {
            throw new Error(`Space not found: ${spaceId}`);
        }

        const nameEvent = room.currentState.getStateEvents(EventType.RoomName);
        const topicEvent = room.currentState.getStateEvents(EventType.RoomTopic);
        const createEvent = room.currentState.getStateEvents(EventType.RoomCreate);
        const joinRulesEvent = room.currentState.getStateEvents(EventType.RoomJoinRules);

        const name = nameEvent?.[0]?.getContent()?.name as string | undefined;
        const topic = topicEvent?.[0]?.getContent()?.topic as string | undefined;
        const avatar_url = room.currentState.getStateEvents(EventType.RoomAvatar)?.[0]?.getContent()?.url as string | undefined;
        const creator = (createEvent?.[0]?.getContent() as Record<string, unknown>)?.creator as string || "";
        const join_rule = (joinRulesEvent?.[0]?.getContent() as Record<string, unknown>)?.join_rule as string || "invite";

        return {
            space_id: spaceId,
            room_id: spaceId,
            name: name || room.name,
            topic: topic,
            avatar_url: avatar_url,
            creator: creator,
            join_rule: join_rule,
            is_public: join_rule === "public",
            created_ts: Date.now(),
        };
    }

    /**
     * 更新 Space 信息
     *
     * @param spaceId - Space ID
     * @param options - 更新选项
     * @returns 更新后的 Space 信息
     */
    async updateSpace(spaceId: string, options: UpdateSpaceOptions): Promise<Space> {
        if (options.name !== undefined) {
            await this.client.setRoomName(spaceId, options.name);
        }
        if (options.topic !== undefined) {
            await this.client.setRoomTopic(spaceId, options.topic);
        }

        this.clearCache();
        return this.getSpace(spaceId);
    }

    /**
     * 删除 Space
     *
     * @param spaceId - Space ID
     */
    async deleteSpace(spaceId: string): Promise<void> {
        await this.client.leave(spaceId);
        this.clearCache();
    }

    /**
     * 获取 Space 的子房间
     *
     * @param spaceId - Space ID
     * @returns 子房间列表
     */
    async getSpaceChildren(spaceId: string): Promise<SpaceChild[]> {
        const room = this.client.getRoom(spaceId);
        if (!room) {
            return [];
        }

        const childEvents = room.currentState.getStateEvents(EventType.SpaceChild);

        return childEvents
            .map((event) => {
                const content = event.getContent() as Record<string, unknown>;
                return {
                    space_id: spaceId,
                    room_id: event.getStateKey() || "",
                    via_servers: (content.via as string[]) || [],
                    sender: event.getSender() || "",
                    is_suggested: (content.suggested as boolean) || false,
                    added_ts: event.getTs(),
                };
            });
    }

    /**
     * 添加子房间到 Space
     *
     * @param spaceId - Space ID
     * @param options - 添加选项
     */
    async addChild(spaceId: string, options: AddChildOptions): Promise<void> {
        const content = {
            via: options.via_servers || [this.client.getDomain() ?? "localhost"],
            suggested: options.suggested ?? false,
        };

        await this.client.sendStateEvent(
            spaceId,
            EventType.SpaceChild,
            content,
            options.room_id
        );

        this.clearCache();
    }

    /**
     * 从 Space 移除子房间
     *
     * @param spaceId - Space ID
     * @param roomId - 要移除的房间 ID
     */
    async removeChild(spaceId: string, roomId: string): Promise<void> {
        await this.client.sendStateEvent(
            spaceId,
            EventType.SpaceChild,
            {},
            roomId
        );
        this.clearCache(spaceId);
    }

    /**
     * 获取 Space 的成员列表
     *
     * @param spaceId - Space ID
     * @returns 成员列表
     */
    async getSpaceMembers(spaceId: string): Promise<SpaceMember[]> {
        const room = this.client.getRoom(spaceId);
        if (!room) {
            return [];
        }

        const members: SpaceMember[] = [];
        const joinedMembers = room.getJoinedMembers();

        for (const member of joinedMembers) {
            members.push({
                space_id: spaceId,
                user_id: member.userId,
                membership: "joined",
                joined_ts: Date.now(),
            });
        }

        return members;
    }

    /**
     * 获取 Space 层级结构（包含子房间和成员）
     *
     * @param spaceId - Space ID
     * @returns 层级结构
     */
    async getSpaceHierarchy(spaceId: string): Promise<SpaceHierarchy> {
        const [space, children, members] = await Promise.all([
            this.getSpace(spaceId),
            this.getSpaceChildren(spaceId),
            this.getSpaceMembers(spaceId),
        ]);

        return { space, children, members };
    }

    /**
     * 获取用户的所有 Space
     *
     * @returns 用户作为成员的 Space 列表
     */
    async getUserSpaces(): Promise<Space[]> {
        const cacheKey = "user_spaces";
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expiry > Date.now()) {
            return cached.data;
        }

        const rooms = this.client.getRooms();
        const spaces: Space[] = [];

        for (const room of rooms) {
            const myMembership = room.getMyMembership();
            if (myMembership === "join" || myMembership === "invite") {
                const childEvents = room.currentState.getStateEvents(EventType.SpaceChild);
                if (childEvents && childEvents.length > 0) {
                    spaces.push({
                        space_id: room.roomId,
                        room_id: room.roomId,
                        name: room.name,
                        topic: "",
                        avatar_url: undefined,
                        creator: "",
                        join_rule: room.getJoinRule() || "invite",
                        is_public: room.getJoinRule() === "public",
                        created_ts: Date.now(),
                    });
                }
            }
        }

        this.cache.set(cacheKey, { data: spaces, expiry: Date.now() + SpaceManager.CACHE_TTL });
        return spaces;
    }

    /**
     * 搜索 Spaces
     *
     * @param query - 搜索关键词
     * @param limit - 返回数量限制
     * @returns 匹配的 Space 列表
     */
    async searchSpaces(query: string, limit: number = 10): Promise<Space[]> {
        const allSpaces = await this.getUserSpaces();
        const lowerQuery = query.toLowerCase();
        return allSpaces
            .filter(
                (space) =>
                    space.name?.toLowerCase().includes(lowerQuery) ||
                    space.topic?.toLowerCase().includes(lowerQuery)
            )
            .slice(0, limit);
    }

    /**
     * 检查房间是否是 Space
     *
     * @param roomId - 房间 ID
     * @returns 是否是 Space
     */
    async isSpace(roomId: string): Promise<boolean> {
        const room = this.client.getRoom(roomId);
        if (!room) {
            return false;
        }
        const childEvents = room.currentState.getStateEvents(EventType.SpaceChild);
        return childEvents && childEvents.length > 0;
    }

    /**
     * 获取 Space 的统计信息
     *
     * @param spaceId - Space ID
     * @returns 统计信息
     */
    async getSpaceStats(spaceId: string): Promise<{
        memberCount: number;
        childCount: number;
    }> {
        const [members, children] = await Promise.all([
            this.getSpaceMembers(spaceId),
            this.getSpaceChildren(spaceId),
        ]);

        return {
            memberCount: members.length,
            childCount: children.length,
        };
    }

    private normalizeError(error: unknown, method: string): SdkError {
        const err = error as Error;
        if (error instanceof MatrixError) {
            if (error.httpStatus === 401 || error.errcode === 'M_UNKNOWN_TOKEN') {
                return new AuthError(`SpaceManager.${method} failed: ${err?.message ?? 'Unknown error'}`, error);
            }
            if (error.httpStatus === 404 || error.errcode === 'M_NOT_FOUND') {
                return new NotFoundError(`SpaceManager.${method} failed: ${err?.message ?? 'Unknown error'}`, error);
            }
            return new ApiError(`SpaceManager.${method} failed: ${err?.message ?? 'Unknown error'}`, error.errcode, error.httpStatus, error);
        }
        return new ApiError(`SpaceManager.${method} failed: ${err?.message ?? String(error)}`, 'UNKNOWN', 0, error);
    }

    private clearCache(spaceId?: string): void {
        if (spaceId) {
            this.cache.delete(`space:${spaceId}`);
        } else {
            this.cache.clear();
        }
    }

    start(): void {
        this.clearCache();
    }

    stop(): void {
        this.clearCache();
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getSpaceManager(): SpaceManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSpaceManager = function (): SpaceManager {
        return new SpaceManager(this);
    };
}

export default extendMatrixClient;
