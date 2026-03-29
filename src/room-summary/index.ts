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
 * Room Summary Manager - 房间摘要管理
 * 
 * 提供房间摘要、成员、统计等功能
 * 对接后端: synapse-rust/src/web/routes/room_summary.rs
 * 
 * ⚠️ 注意：此模块是 Room Summary 的主要实现
 * 旧的 room-summaries/index.ts 模块已废弃，请使用此模块
 */

import { MatrixClient } from "../client.ts";
import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { logger } from "../logger.ts";
import { MatrixError } from "../http-api/errors.ts";

export interface RoomSummary {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    join_rule?: string;
    member_count?: number;
    invited_member_count?: number;
    joined_member_count?: number;
    world_readable?: boolean;
    guest_can_join?: boolean;
    heroes?: Array<{ user_id: string; avatar_url?: string; name?: string }>;
    is_exposed?: boolean;
    room_type?: string;
    membership?: string;
}

export interface RoomSummaryOptions {
    limit?: number;
    maxJoinedMembers?: number;
    suggested?: boolean;
    includeAllFields?: boolean;
}

export interface RoomStats {
    room_id: string;
    total_events?: number;
    active_events?: number;
    created_ts?: number;
    joined_members?: number;
    invited_members?: number;
    left_members?: number;
    state_events?: number;
}

export enum RoomSummaryEvent {
    Updated = "Updated",
    MembersUpdated = "MembersUpdated",
    StatsUpdated = "StatsUpdated",
    Error = "Error",
}

interface RoomSummaryEventMap {
    [RoomSummaryEvent.Updated]: (roomId: string, summary: RoomSummary) => void;
    [RoomSummaryEvent.MembersUpdated]: (roomId: string, members: unknown[]) => void;
    [RoomSummaryEvent.StatsUpdated]: (roomId: string, stats: RoomStats) => void;
    [RoomSummaryEvent.Error]: (error: Error) => void;
}

/**
 * Room Summary Manager - 房间摘要管理
 * 
 * ⚠️ 与旧的 room-summaries/index.ts 的区别：
 * - 本模块提供完整的封装（缓存、事件、统计）
 * - 提供真实后端 API 调用
 * - 推荐使用本模块
 */
export class RoomSummaryManager extends TypedEventEmitter<RoomSummaryEvent, RoomSummaryEventMap> {
    private client: MatrixClient;
    private summaries = new Map<string, { summary: RoomSummary; timestamp: number }>();
    private members = new Map<string, { members: unknown[]; timestamp: number }>();
    private stats = new Map<string, { stats: RoomStats; timestamp: number }>();
    private readonly cacheTtl = 300000; // 5 分钟缓存

    public constructor(client: MatrixClient) {
        super();
        this.client = client;
    }

    /**
     * 获取房间摘要
     * 
     * @param roomIdOrAlias - 房间 ID 或别名
     * @param forceRefresh - 是否强制刷新缓存
     * @returns 房间摘要
     */
    public async getRoomSummary(roomIdOrAlias: string, forceRefresh = false): Promise<RoomSummary | null> {
        // 检查缓存
        if (!forceRefresh) {
            const cached = this.summaries.get(roomIdOrAlias);
            if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
                return cached.summary;
            }
        }

        try {
            const summary = await this.client.getRoomSummary(roomIdOrAlias);
            if (summary) {
                this.summaries.set(roomIdOrAlias, { summary, timestamp: Date.now() });
                this.emit(RoomSummaryEvent.Updated, roomIdOrAlias, summary);
            }
            return summary;
        } catch (e) {
            this.handleError("getRoomSummary", e);
            return null;
        }
    }

    /**
     * 获取房间成员列表摘要
     * 
     * @param roomId - 房间 ID
     * @param forceRefresh - 是否强制刷新缓存
     * @returns 成员列表
     */
    public async getRoomSummaryMembers(roomId: string, forceRefresh = false): Promise<unknown[]> {
        // 检查缓存
        if (!forceRefresh) {
            const cached = this.members.get(roomId);
            if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
                return cached.members;
            }
        }

        try {
            const members = await this.client.getRoomSummaryMembers(roomId);
            this.members.set(roomId, { members, timestamp: Date.now() });
            this.emit(RoomSummaryEvent.MembersUpdated, roomId, members);
            return members;
        } catch (e) {
            this.handleError("getRoomSummaryMembers", e);
            return [];
        }
    }

    /**
     * 获取房间统计信息
     * 
     * @param roomId - 房间 ID
     * @param forceRefresh - 是否强制刷新缓存
     * @returns 房间统计
     */
    public async getRoomSummaryStats(roomId: string, forceRefresh = false): Promise<RoomStats | null> {
        // 检查缓存
        if (!forceRefresh) {
            const cached = this.stats.get(roomId);
            if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
                return cached.stats;
            }
        }

        try {
            const stats = await this.client.getRoomSummaryStats(roomId);
            if (stats) {
                this.stats.set(roomId, { stats, timestamp: Date.now() });
                this.emit(RoomSummaryEvent.StatsUpdated, roomId, stats);
            }
            return stats;
        } catch (e) {
            this.handleError("getRoomSummaryStats", e);
            return null;
        }
    }

    /**
     * 清除缓存
     * 
     * @param roomId - 房间 ID（可选，不传则清除所有缓存）
     */
    public clearCache(roomId?: string): void {
        if (roomId) {
            this.summaries.delete(roomId);
            this.members.delete(roomId);
            this.stats.delete(roomId);
            return;
        }

        this.summaries.clear();
        this.members.clear();
        this.stats.clear();
    }

    /**
     * 获取房间层级结构（Space 层级）
     * 
     * @param roomId - 房间 ID
     * @param options - 选项
     * @returns 层级结构
     */
    public async getRoomHierarchy(roomId: string, options?: RoomSummaryOptions): Promise<unknown | null> {
        try {
            return await this.client.getRoomHierarchy(
                roomId,
                options?.limit,
                undefined,
                options?.suggested ?? false
            );
        } catch (e) {
            this.handleError("getRoomHierarchy", e);
            return null;
        }
    }

    /**
     * 获取公共房间列表
     * 
     * @param server - 服务器名（可选）
     * @param options - 选项
     * @returns 公共房间列表
     */
    public async getPublicRooms(
        server = "",
        options?: { limit?: number; since?: string; query?: string },
    ): Promise<unknown | null> {
        try {
            return await this.client.publicRooms({
                server,
                limit: options?.limit,
                since: options?.since,
                filter: options?.query ? { generic_search_term: options.query } : undefined,
            });
        } catch (e) {
            this.handleError("getPublicRooms", e);
            return null;
        }
    }

    /**
     * 搜索公共房间
     * 
     * @param query - 搜索关键词
     * @param server - 服务器名
     * @param limit - 限制数量
     * @returns 房间摘要列表
     */
    public async searchPublicRooms(query: string, server = "", limit = 20): Promise<RoomSummary[]> {
        try {
            const result = await this.getPublicRooms(server, { query, limit });
            return (result as { chunk?: RoomSummary[] })?.chunk || [];
        } catch (e) {
            this.handleError("searchPublicRooms", e);
            return [];
        }
    }

    /**
     * 获取推荐房间
     * 
     * @param server - 服务器名
     * @param limit - 限制数量
     * @returns 房间摘要列表
     */
    public async getRecommendedRooms(server = "", limit = 20): Promise<RoomSummary[]> {
        try {
            const result = await this.getPublicRooms(server, { limit });
            return (result as { chunk?: RoomSummary[] })?.chunk || [];
        } catch (e) {
            this.handleError("getRecommendedRooms", e);
            return [];
        }
    }

    /**
     * 获取收藏的房间
     * 
     * @returns 收藏的房间摘要列表
     */
    public async getFavoriteRooms(): Promise<RoomSummary[]> {
        try {
            const rooms = this.client.getRooms() as unknown as Array<{
                roomId: string;
                name?: string;
                topic?: string;
                avatarUrl?: string;
                tags?: Record<string, unknown>;
                getJoinedMemberCount?: () => number;
            }>;
            
            return rooms
                .filter((room) => room.tags && room.tags["m.favorite"])
                .map((room) => ({
                    room_id: room.roomId,
                    name: room.name,
                    topic: room.topic,
                    avatar_url: room.avatarUrl,
                    member_count: room.getJoinedMemberCount?.() || 0,
                }));
        } catch (e) {
            this.handleError("getFavoriteRooms", e);
            return [];
        }
    }

    /**
     * 获取最近活跃的房间
     * 
     * @param limit - 限制数量
     * @returns 最近活跃的房间摘要列表
     */
    public async getRecentRooms(limit = 10): Promise<RoomSummary[]> {
        try {
            const rooms = this.client.getRooms() as unknown as Array<{
                roomId: string;
                name?: string;
                topic?: string;
                avatarUrl?: string;
                getLastActiveTimestamp?: () => number;
                getMyMembership?: () => string;
                getJoinedMemberCount?: () => number;
            }>;
            
            return rooms
                .filter((room) => room.getLastActiveTimestamp?.())
                .sort((a, b) => (b.getLastActiveTimestamp?.() || 0) - (a.getLastActiveTimestamp?.() || 0))
                .slice(0, limit)
                .map((room) => ({
                    room_id: room.roomId,
                    name: room.name,
                    topic: room.topic,
                    avatar_url: room.avatarUrl,
                    member_count: room.getJoinedMemberCount?.() || 0,
                    membership: room.getMyMembership?.() || "join",
                }));
        } catch (e) {
            this.handleError("getRecentRooms", e);
            return [];
        }
    }

    /**
     * 获取缓存的摘要
     */
    public getCachedSummary(roomId: string): RoomSummary | null {
        return this.summaries.get(roomId)?.summary || null;
    }

    /**
     * 获取缓存的成员
     */
    public getCachedMembers(roomId: string): unknown[] {
        return this.members.get(roomId)?.members || [];
    }

    /**
     * 获取缓存的统计
     */
    public getCachedStats(roomId: string): RoomStats | null {
        return this.stats.get(roomId)?.stats || null;
    }

    /**
     * 检查房间是否在缓存中
     */
    public isCached(roomId: string): boolean {
        return this.summaries.has(roomId);
    }

    start(): void {
        // 初始化逻辑（如果需要）
    }

    stop(): void {
        this.clearCache();
    }

    /**
     * 处理错误
     */
    private handleError(method: string, error: unknown): void {
        if (error instanceof MatrixError) {
            logger.warn(`RoomSummaryManager.${method} failed: [${error.errcode}] ${error.message}`);
        } else {
            logger.warn(`RoomSummaryManager.${method} failed:`, error);
        }
        this.emit(RoomSummaryEvent.Error, error as Error);
    }
}

// Type declaration for MatrixClient extension
declare module "../client.ts" {
    interface MatrixClient {
        getRoomSummaryManager(): RoomSummaryManager;
    }
}

/**
 * 扩展 MatrixClient 原型
 * 
 * @example
 * import { extendMatrixClient } from "./room-summary";
 * extendMatrixClient();
 * 
 * const client = createClient({ ... });
 * const roomSummary = client.getRoomSummaryManager();
 */
export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomSummaryManager = function (): RoomSummaryManager {
        return new RoomSummaryManager(this);
    };
}

export default extendMatrixClient;