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
 * 采用组合模式，将 30+ 个方法按领域拆分为 8 个子 Manager：
 * - members: 成员管理（成员列表、写入、更新、删除、最近成员）
 * - state: 状态管理（获取全部状态、获取/更新单个状态）
 * - stats: 统计管理（统计信息、重算统计、重算 heroes、清除未读）
 * - threads: 线程管理（线程查询、事件密钥）
 * - search: 搜索/发现（层级、公共房间、推荐、收藏、最近、搜索）
 * - keys: 密钥管理（申领密钥、密钥计数、版本、转发、加密事件）
 * - invitePolicy: 邀请策略（黑名单、白名单）
 * - eventOps: 事件操作（通知、能力、同步、账户数据、时间线、元数据等 30+ 方法）
 *
 * 所有原有方法保持向后兼容（委托到子 Manager）。
 * 推荐使用子 Manager 直接访问：`roomSummaryManager.members.getRoomSummaryMembers(...)`
 *
 * ⚠️ 注意：此模块是 Room Summary 的主要实现
 * 旧的 room-summaries/index.ts 模块已废弃，请使用此模块
 */

// 类型从 types.ts 集中导出
export type {
    RoomSummaryHero,
    RoomSummaryMember,
    RoomSummary,
    RoomSummaryOptions,
    RoomStats,
    RoomSummaryStateContent,
    ClientRoomSummary,
    IRoomSummaryState,
    RoomSummaryListResponse,
    RawRoomSummaryListResponse,
    NotificationItem,
    RoomNotificationsResult,
    RoomCapabilities,
    RoomSyncResult,
    TimelineResult,
    UnreadCountResult,
    RoomMetadata,
    RetentionPolicy,
    RoomPermissionsResult,
    RoomResolveResult,
    RoomMessageQueueResult,
    RoomServiceTypesResult,
    RoomReducedEventsResult,
    RoomRenderedResult,
    RoomFragmentsResult,
    RoomDeviceResult,
    RoomEventUrlResult,
    RoomTranslateResult,
    RoomConvertResult,
    RoomSignResult,
    RoomVerifyResult,
    RoomAccountDataResult,
    RoomInvitesResult,
    RoomKeyClaimResult,
    RoomKeyCountResult,
    RoomKeysVersionResult,
    RoomMembersRecentResult,
    RoomReceiptsResult,
    RoomForwardKeysResult,
    RoomSearchResult,
    ExternalId,
    RoomSpace,
    EventPerspective,
    EncryptedEventsResult,
    EventKeysResult,
    ThreadReply,
    ThreadRoot,
    RoomThreadResult,
    RoomThreadDetailRoot,
    RoomThreadDetailReply,
    RoomThreadSummary,
    RoomThreadReadReceipt,
    RoomThreadSubscription,
    RoomThreadDetailResult,
    TurnServerConfig,
    StickyEvent,
    InviteBlocklist,
    InviteAllowlist,
    HeroesRecalcResult,
    UnreadClearResult,
} from "./types";

// 重新导出子 Manager 类型，供直接使用
export { RoomSummaryMemberManager, RoomSummaryMemberEvent } from "./sub-managers/room-member-manager";
export { RoomSummaryStateManager } from "./sub-managers/room-state-manager";
export { RoomSummaryStatsManager, RoomSummaryStatsEvent } from "./sub-managers/room-stats-manager";
export { RoomSummaryThreadManager } from "./sub-managers/room-thread-manager";
export { RoomSummarySearchManager } from "./sub-managers/room-search-manager";
export { RoomSummaryKeyManager } from "./sub-managers/room-key-manager";
export { RoomSummaryInvitePolicyManager } from "./sub-managers/room-invite-policy-manager";
export { RoomSummaryEventOperationManager } from "./sub-managers/room-event-operation-manager";

import { MatrixClient } from "../client";
import { logger } from "../logger";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { Body } from "../http-api/interface";
import { InvalidParamError } from "../common/errors";
import { type QueryDict } from "../utils";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";
import { LRUCache } from "../utils/lru-cache";
import type { IPublicRoomsChunkRoom, IPublicRoomsResponse } from "../client-api-types";
import type { RoomSummaryPathPattern } from "./__generated__/route-table";

import type {
    RoomSummary,
    RoomSummaryMember,
    RoomStats,
    RoomSummaryStateContent,
    ClientRoomSummary,
    RoomSummaryListResponse,
    RawRoomSummaryListResponse,
    RoomSummaryOptions,
    IRoomSummaryState,
    RoomNotificationsResult,
    RoomCapabilities,
    RoomSyncResult,
    TimelineResult,
    UnreadCountResult,
    RoomMetadata,
    RetentionPolicy,
    RoomPermissionsResult,
    RoomResolveResult,
    RoomMessageQueueResult,
    RoomServiceTypesResult,
    RoomReducedEventsResult,
    RoomRenderedResult,
    RoomFragmentsResult,
    RoomDeviceResult,
    RoomEventUrlResult,
    RoomTranslateResult,
    RoomConvertResult,
    RoomSignResult,
    RoomVerifyResult,
    RoomAccountDataResult,
    RoomInvitesResult,
    RoomKeyClaimResult,
    RoomKeyCountResult,
    RoomKeysVersionResult,
    RoomMembersRecentResult,
    RoomReceiptsResult,
    RoomForwardKeysResult,
    RoomSearchResult,
    ExternalId,
    RoomSpace,
    EventPerspective,
    EncryptedEventsResult,
    EventKeysResult,
    RoomThreadResult,
    RoomThreadDetailResult,
    TurnServerConfig,
    StickyEvent,
    InviteBlocklist,
    InviteAllowlist,
    HeroesRecalcResult,
    UnreadClearResult,
} from "./types";

// 子 Manager 导入
import { RoomSummaryMemberManager, RoomSummaryMemberEvent } from "./sub-managers/room-member-manager";
import { RoomSummaryStateManager } from "./sub-managers/room-state-manager";
import { RoomSummaryStatsManager, RoomSummaryStatsEvent } from "./sub-managers/room-stats-manager";
import { RoomSummaryThreadManager } from "./sub-managers/room-thread-manager";
import { RoomSummarySearchManager, type RoomSearchBody } from "./sub-managers/room-search-manager";
import { RoomSummaryKeyManager } from "./sub-managers/room-key-manager";
import { RoomSummaryInvitePolicyManager } from "./sub-managers/room-invite-policy-manager";
import { RoomSummaryEventOperationManager, type TranslateEventBody, type ConvertEventBody, type SignEventBody, type VerifyEventBody } from "./sub-managers/room-event-operation-manager";

type StripClientV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;
type StripClientR0<P extends string> = P extends `/_matrix/client/r0${infer Rest}` ? Rest : never;
type StripInternalSummary<P extends string> = P extends `/_synapse/room_summary/v1${infer Rest}` ? Rest : never;

function rsv<P extends StripClientV3<RoomSummaryPathPattern>>(path: P): P {
    return path;
}

function _rsr0<P extends StripClientR0<RoomSummaryPathPattern>>(path: P): P {
    return path;
}

function rsi<P extends StripInternalSummary<RoomSummaryPathPattern> | "/summaries/batch">(path: P): P {
    return path;
}

export enum RoomSummaryEvent {
    Updated = "Updated",
    MembersUpdated = "MembersUpdated",
    StatsUpdated = "StatsUpdated",
    Error = "Error",
}

interface RoomSummaryEventMap {
    [RoomSummaryEvent.Updated]: (roomId: string, summary: RoomSummary) => void;
    [RoomSummaryEvent.MembersUpdated]: (roomId: string, members: RoomSummaryMember[]) => void;
    [RoomSummaryEvent.StatsUpdated]: (roomId: string, stats: RoomStats) => void;
    [RoomSummaryEvent.Error]: (error: Error) => void;
}

/**
 * Room Summary Manager - 房间摘要管理
 *
 * 通过组合模式将功能委托到子 Manager，同时保持完全向后兼容。
 *
 * @example
 * ```typescript
 * // 向后兼容：直接在 RoomSummaryManager 上调用方法
 * const members = await roomSummaryManager.getRoomSummaryMembers("!room:server.com");
 *
 * // 推荐新方式：通过子 Manager 访问
 * const members = await roomSummaryManager.members.getRoomSummaryMembers("!room:server.com");
 * const stats = await roomSummaryManager.stats.getRoomSummaryStats("!room:server.com");
 * const thread = await roomSummaryManager.threads.getRoomThread("!room:server.com", "$eventId");
 * ```
 */
export class RoomSummaryManager extends BaseManager<RoomSummaryEvent, RoomSummaryEventMap> {
    private summaryCache: LRUCache<RoomSummary>;
    private memberCache: LRUCache<RoomSummaryMember[]>;
    private statsCache: LRUCache<RoomStats>;

    // ===== 子 Manager（组合模式） =====
    public readonly members: RoomSummaryMemberManager;
    public readonly state: RoomSummaryStateManager;
    public readonly stats: RoomSummaryStatsManager;
    public readonly threads: RoomSummaryThreadManager;
    public readonly search: RoomSummarySearchManager;
    public readonly keys: RoomSummaryKeyManager;
    public readonly invitePolicy: RoomSummaryInvitePolicyManager;
    public readonly eventOps: RoomSummaryEventOperationManager;

    public constructor(client: MatrixClient) {
        super(client);

        this.summaryCache = new LRUCache<RoomSummary>({
            maxSize: 1000,
            ttl: 5 * 60 * 1000,
            name: "index.ts-roomsummary",
        });
        this.memberCache = new LRUCache<RoomSummaryMember[]>({
            maxSize: 500,
            ttl: 5 * 60 * 1000,
            name: "index.ts-roomsummarymember",
        });
        this.statsCache = new LRUCache<RoomStats>({ maxSize: 500, ttl: 10 * 60 * 1000, name: "index.ts-roomstats" });

        // 错误回调：发射 Error 事件
        const onError = (error: Error) => {
            this.emit(RoomSummaryEvent.Error, error);
        };

        // 缓存失效回调：子 Manager 操作后清除父级缓存
        const onCacheInvalidation = (roomId: string) => {
            this.clearCache(roomId);
        };

        // 创建子 Manager，共享缓存和回调
        this.members = new RoomSummaryMemberManager(client, this.memberCache, onError);
        this.state = new RoomSummaryStateManager(client, onError);
        this.stats = new RoomSummaryStatsManager(client, this.statsCache, onCacheInvalidation, onError);
        this.threads = new RoomSummaryThreadManager(client, onError);
        this.search = new RoomSummarySearchManager(client, onError);
        this.keys = new RoomSummaryKeyManager(client, onError);
        this.invitePolicy = new RoomSummaryInvitePolicyManager(client, onCacheInvalidation, onError);
        this.eventOps = new RoomSummaryEventOperationManager(client, onCacheInvalidation, onError);

        // 转发子 Manager 事件到 RoomSummaryManager（向后兼容）
        this.forwardSubManagerEvents();
    }

    /**
     * 将子 Manager 的事件转发到 RoomSummaryManager
     * 保持 `roomSummaryManager.on(RoomSummaryEvent.MembersUpdated, ...)` 的向后兼容性
     */
    private forwardSubManagerEvents(): void {
        this.members.on(RoomSummaryMemberEvent.MembersUpdated, (roomId, members) =>
            this.emit(RoomSummaryEvent.MembersUpdated, roomId, members),
        );
        this.stats.on(RoomSummaryStatsEvent.StatsUpdated, (roomId, stats) =>
            this.emit(RoomSummaryEvent.StatsUpdated, roomId, stats),
        );
    }

    // ===== 核心摘要方法（保留在主 Manager，涉及 summaryCache） =====

    private summaryReadPath(roomId: string): StripClientV3<RoomSummaryPathPattern> {
        return rsv(`/rooms/${encodeURIComponent(roomId)}/summary`);
    }

    private internalSummaryPath(path: "/summaries" | "/updates/process"): StripInternalSummary<RoomSummaryPathPattern> {
        return rsi(path);
    }

    /**
     * 获取房间摘要
     */
    public async getRoomSummary(
        roomIdOrAlias: string,
        via?: string[],
        forceRefresh = false,
        throwOnError = false,
    ): Promise<RoomSummary | null> {
        if (!forceRefresh) {
            const cached = this.summaryCache.get(roomIdOrAlias);
            if (cached) {
                return cached;
            }
        }

        try {
            const clientSummary = await this.withRetry(async () => {
                const paramOpts = {
                    prefix: ClientPrefix.V3,
                };
                try {
                    return await this.client.http.authedRequest(
                        Method.Get,
                        this.summaryReadPath(roomIdOrAlias),
                        via ? { via } : undefined,
                        undefined,
                        paramOpts,
                    );
                } catch {
                    const unstableOpts = {
                        prefix: "/_matrix/client/unstable/im.nheko.summary",
                    };
                    return await this.client.http.authedRequest(
                        Method.Get,
                        `/summary/${encodeURIComponent(roomIdOrAlias)}`,
                        via ? { via } : undefined,
                        undefined,
                        unstableOpts,
                    );
                }
            }, "getRoomSummary");

            const summary = this.convertClientSummary(clientSummary as ClientRoomSummary);
            this.summaryCache.set(roomIdOrAlias, summary);
            this.emit(RoomSummaryEvent.Updated, roomIdOrAlias, summary);
            return summary;
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, "getRoomSummary");
            }
            this.handleError("getRoomSummary", e);
            return null;
        }
    }

    public async createOrRefreshSummary(
        roomId: string,
        body: Record<string, unknown> = {},
    ): Promise<RoomSummary | null> {
        this.validateRoomId(roomId);

        try {
            const summary = await this.withRetry(async () => {
                return await this.requestV3<RoomSummary>(
                    Method.Post,
                    this.summaryReadPath(roomId),
                    undefined,
                    body,
                );
            }, "createOrRefreshSummary");

            if (summary) {
                this.summaryCache.set(roomId, summary);
                this.emit(RoomSummaryEvent.Updated, roomId, summary);
            }
            return summary;
        } catch (e) {
            throw this.normalizeError(e, "createOrRefreshSummary");
        }
    }

    public async updateSummary(roomId: string, body: Record<string, unknown>): Promise<RoomSummary | null> {
        this.validateRoomId(roomId);

        try {
            const summary = await this.withRetry(async () => {
                return await this.requestV3<RoomSummary>(
                    Method.Put,
                    this.summaryReadPath(roomId),
                    undefined,
                    body,
                );
            }, "updateSummary");

            if (summary) {
                this.summaryCache.set(roomId, summary);
                this.emit(RoomSummaryEvent.Updated, roomId, summary);
                return summary;
            }
            this.clearCache(roomId);
            return this.getCachedSummary(roomId);
        } catch (e) {
            throw this.normalizeError(e, "updateSummary");
        }
    }

    public async deleteSummary(roomId: string): Promise<void> {
        this.validateRoomId(roomId);

        return this.withRetry(async () => {
            await this.requestV3(Method.Delete, this.summaryReadPath(roomId));
            this.clearCache(roomId);
        }, "deleteSummary");
    }

    public async syncSummary(roomId: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
        this.validateRoomId(roomId);

        return this.withRetry(async () => {
            return await this.requestV3<Record<string, unknown>>(
                Method.Post,
                rsv(`/rooms/${encodeURIComponent(roomId)}/summary/sync`),
                undefined,
                body,
            );
        }, "syncSummary");
    }

    public async listUserSummaries(queryParams: QueryDict = {}): Promise<RoomSummaryListResponse> {
        return this.withRetry(async () => {
            const result = await this.requestInternal<RawRoomSummaryListResponse>(
                Method.Get,
                this.internalSummaryPath("/summaries"),
                queryParams,
            );
            if (Array.isArray(result)) {
                return {
                    summaries: result,
                    rooms: result,
                    chunk: result,
                };
            }
            return result;
        }, "listUserSummaries");
    }

    public async createInternalSummary(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        if (!body || typeof body !== "object") {
            throw new InvalidParamError("Body must be an object");
        }

        return this.withRetry(async () => {
            return await this.requestInternal<Record<string, unknown>>(
                Method.Post,
                this.internalSummaryPath("/summaries"),
                undefined,
                body,
            );
        }, "createInternalSummary");
    }

    /**
     * Batch-get room summaries by room IDs.
     *
     * Uses the backend `/_synapse/room_summary/v1/summaries/batch` endpoint
     * to fetch multiple summaries in a single HTTP request, avoiding N+1
     * per-room API calls.
     */
    public async batchGetRoomSummaries(
        roomIds: string[],
        options?: { suggestedOnly?: boolean },
    ): Promise<RoomSummary[]> {
        if (!roomIds.length) return [];

        return this.withRetry(async () => {
            const response = await this.requestInternal<{
                rooms: ClientRoomSummary[];
                total_room_count_estimate?: number;
                next_batch?: string;
            }>(
                Method.Post,
                rsi("/summaries/batch"),
                undefined,
                {
                    rooms: roomIds,
                    suggested_only: options?.suggestedOnly ?? false,
                },
            );

            return (response.rooms ?? []).map((s) => {
                const summary = this.convertClientSummary(s);
                this.summaryCache.set(summary.room_id, summary);
                return summary;
            });
        }, "batchGetRoomSummaries");
    }

    /**
     * Batch-get room summaries by room IDs (MSC3266).
     *
     * Uses the backend `/_synapse/room_summary/v1/summaries/batch` endpoint
     * to fetch multiple summaries in a single HTTP request.
     *
     * @param rooms - Array of room IDs to fetch summaries for
     * @param isSuggestedOnly - Whether to only return suggested rooms (default: false)
     * @returns Raw batch response with room summaries
     *
     * @example
     * ```typescript
     * const result = await roomSummaryManager.batchGetSummaries(
     *     ["!room1:server.com", "!room2:server.com"],
     *     true,
     * );
     * ```
     */
    public async batchGetSummaries(
        rooms: string[],
        isSuggestedOnly?: boolean,
    ): Promise<Record<string, unknown>> {
        if (!rooms.length) return {};

        return this.withRetry(async () => {
            return await this.requestInternal<Record<string, unknown>>(
                Method.Post,
                rsi("/summaries/batch"),
                undefined,
                {
                    rooms,
                    is_suggested_only: isSuggestedOnly ?? false,
                },
            );
        }, "batchGetSummaries");
    }

    public async processSummaryUpdates(body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
        return this.withRetry(async () => {
            return await this.requestInternal<Record<string, unknown>>(
                Method.Post,
                this.internalSummaryPath("/updates/process"),
                undefined,
                body,
            );
        }, "processSummaryUpdates");
    }

    // ===== 缓存管理 =====

    public clearCache(roomId?: string): void {
        if (roomId) {
            this.summaryCache.delete(roomId);
            this.memberCache.delete(roomId);
            this.statsCache.delete(roomId);
            return;
        }

        this.summaryCache.clear();
        this.memberCache.clear();
        this.statsCache.clear();
    }

    public getCacheStats(): {
        summary: { size: number; hits: number; misses: number; hitRate: number };
        members: { size: number; hits: number; misses: number; hitRate: number };
        stats: { size: number; hits: number; misses: number; hitRate: number };
    } {
        return {
            summary: this.summaryCache.getStats(),
            members: this.memberCache.getStats(),
            stats: this.statsCache.getStats(),
        };
    }

    public getMetrics(): {
        cache: {
            summary: { size: number; hitRate: number };
            members: { size: number; hitRate: number };
            stats: { size: number; hitRate: number };
        };
        requests: {
            total: number;
            successful: number;
            failed: number;
            retried: number;
        };
    } {
        const cacheStats = this.getCacheStats();
        return {
            cache: {
                summary: { size: cacheStats.summary.size, hitRate: cacheStats.summary.hitRate },
                members: { size: cacheStats.members.size, hitRate: cacheStats.members.hitRate },
                stats: { size: cacheStats.stats.size, hitRate: cacheStats.stats.hitRate },
            },
            requests: this.getRequestStats(),
        };
    }

    public getCachedSummary(roomId: string): RoomSummary | null {
        return this.summaryCache.get(roomId) || null;
    }

    public getCachedMembers(roomId: string): RoomSummaryMember[] {
        return this.memberCache.get(roomId) || [];
    }

    public getCachedStats(roomId: string): RoomStats | null {
        return this.statsCache.get(roomId) || null;
    }

    public isCached(roomId: string): boolean {
        return this.summaryCache.get(roomId) !== undefined;
    }

    // ===== 向后兼容委托方法 =====
    // 所有原有方法委托到对应的子 Manager，保持 API 完全兼容

    // ----- 成员管理（委托 → members） -----

    async getRoomSummaryMembers(
        roomId: string,
        forceRefresh = false,
        throwOnError = true,
    ): Promise<RoomSummaryMember[]> {
        return this.members.getRoomSummaryMembers(roomId, forceRefresh, throwOnError);
    }

    async writeSummaryMembers(roomId: string, members: RoomSummaryMember[]): Promise<RoomSummaryMember[]> {
        return this.members.writeSummaryMembers(roomId, members);
    }

    async updateSummaryMember(
        roomId: string,
        userId: string,
        member: Partial<RoomSummaryMember>,
    ): Promise<RoomSummaryMember> {
        return this.members.updateSummaryMember(roomId, userId, member);
    }

    async deleteSummaryMember(roomId: string, userId: string): Promise<void> {
        return this.members.deleteSummaryMember(roomId, userId);
    }

    async getRoomMembersRecent(
        roomId: string,
        options?: { from?: string; limit?: number },
    ): Promise<RoomMembersRecentResult> {
        return this.members.getRoomMembersRecent(roomId, options);
    }

    // ----- 状态管理（委托 → state） -----

    async getAllSummaryState(roomId: string): Promise<IRoomSummaryState[]> {
        return this.state.getAllSummaryState(roomId);
    }

    async getSummaryState(
        roomId: string,
        eventType: string,
        stateKey: string = "",
    ): Promise<RoomSummaryStateContent> {
        return this.state.getSummaryState(roomId, eventType, stateKey);
    }

    async updateSummaryState(
        roomId: string,
        eventType: string,
        stateKey: string,
        content: RoomSummaryStateContent,
    ): Promise<RoomSummaryStateContent> {
        return this.state.updateSummaryState(roomId, eventType, stateKey, content);
    }

    // ----- 统计管理（委托 → stats） -----

    async getRoomSummaryStats(
        roomId: string,
        forceRefresh = false,
        throwOnError = true,
    ): Promise<RoomStats | null> {
        return this.stats.getRoomSummaryStats(roomId, forceRefresh, throwOnError);
    }

    async recalculateSummaryStats(
        roomId: string,
        body: Record<string, unknown> = {},
    ): Promise<RoomStats | null> {
        return this.stats.recalculateSummaryStats(roomId, body);
    }

    async recalculateSummaryHeroes(
        roomId: string,
        body: Record<string, unknown> = {},
    ): Promise<HeroesRecalcResult> {
        return this.stats.recalculateSummaryHeroes(roomId, body);
    }

    async clearSummaryUnread(
        roomId: string,
        body: Record<string, unknown> = {},
    ): Promise<UnreadClearResult> {
        return this.stats.clearSummaryUnread(roomId, body);
    }

    // ----- 线程管理（委托 → threads） -----

    async getEventKeys(roomId: string, eventId: string): Promise<EventKeysResult> {
        return this.threads.getEventKeys(roomId, eventId);
    }

    async getRoomThread(roomId: string, eventId: string): Promise<RoomThreadResult> {
        return this.threads.getRoomThread(roomId, eventId);
    }

    async getRoomThreadById(roomId: string, threadId: string): Promise<RoomThreadDetailResult> {
        return this.threads.getRoomThreadById(roomId, threadId);
    }

    // ----- 搜索/发现（委托 → search） -----

    async getRoomHierarchy(
        roomId: string,
        options?: RoomSummaryOptions,
        throwOnError = true,
    ): Promise<unknown | null> {
        return this.search.getRoomHierarchy(roomId, options, throwOnError);
    }

    async getPublicRooms(
        server = "",
        options?: { limit?: number; since?: string; query?: string },
        throwOnError = true,
    ): Promise<IPublicRoomsResponse | null> {
        return this.search.getPublicRooms(server, options, throwOnError);
    }

    async searchPublicRooms(query: string, server = "", limit = 20): Promise<IPublicRoomsChunkRoom[]> {
        return this.search.searchPublicRooms(query, server, limit);
    }

    async getRecommendedRooms(server = "", limit = 20): Promise<IPublicRoomsChunkRoom[]> {
        return this.search.getRecommendedRooms(server, limit);
    }

    async getFavoriteRooms(): Promise<RoomSummary[]> {
        return this.search.getFavoriteRooms();
    }

    async getRecentRooms(limit = 10): Promise<RoomSummary[]> {
        return this.search.getRecentRooms(limit);
    }

    async searchRoom(roomId: string, body: RoomSearchBody): Promise<RoomSearchResult> {
        return this.search.searchRoom(roomId, body);
    }

    // ----- 密钥管理（委托 → keys） -----

    async claimRoomKeys(roomId: string, body: Record<string, unknown>): Promise<RoomKeyClaimResult> {
        return this.keys.claimRoomKeys(roomId, body);
    }

    async getRoomKeyCount(roomId: string): Promise<RoomKeyCountResult> {
        return this.keys.getRoomKeyCount(roomId);
    }

    async getRoomKeysVersion(roomId: string): Promise<RoomKeysVersionResult> {
        return this.keys.getRoomKeysVersion(roomId);
    }

    async forwardRoomKeys(roomId: string, body: Record<string, unknown>): Promise<RoomForwardKeysResult> {
        return this.keys.forwardRoomKeys(roomId, body);
    }

    async getEncryptedEvents(
        roomId: string,
        options?: { from?: string; limit?: number },
    ): Promise<EncryptedEventsResult> {
        return this.keys.getEncryptedEvents(roomId, options);
    }

    // ----- 邀请策略（委托 → invitePolicy） -----

    async getInviteBlocklist(roomId: string): Promise<InviteBlocklist> {
        return this.invitePolicy.getInviteBlocklist(roomId);
    }

    async addInviteBlocklist(roomId: string, userId: string): Promise<void> {
        return this.invitePolicy.addInviteBlocklist(roomId, userId);
    }

    async getInviteAllowlist(roomId: string): Promise<InviteAllowlist> {
        return this.invitePolicy.getInviteAllowlist(roomId);
    }

    async addInviteAllowlist(roomId: string, userId: string): Promise<void> {
        return this.invitePolicy.addInviteAllowlist(roomId, userId);
    }

    // ----- 事件操作（委托 → eventOps） -----

    async getRoomNotifications(
        roomId: string,
        options?: { from?: string; limit?: number; only?: string },
    ): Promise<RoomNotificationsResult> {
        return this.eventOps.getRoomNotifications(roomId, options);
    }

    async getRoomCapabilities(roomId: string): Promise<RoomCapabilities> {
        return this.eventOps.getRoomCapabilities(roomId);
    }

    async getRoomSync(
        roomId: string,
        options?: { since?: string; timeout_ms?: number; filter?: string },
    ): Promise<RoomSyncResult> {
        return this.eventOps.getRoomSync(roomId, options);
    }

    async getRoomAccountData(roomId: string, type: string): Promise<RoomAccountDataResult> {
        return this.eventOps.getRoomAccountData(roomId, type);
    }

    async setRoomAccountDataV3(
        roomId: string,
        type: string,
        content: RoomSummaryStateContent,
    ): Promise<RoomAccountDataResult> {
        return this.eventOps.setRoomAccountDataV3(roomId, type, content);
    }

    async getRoomInvites(roomId: string): Promise<RoomInvitesResult> {
        return this.eventOps.getRoomInvites(roomId);
    }

    async getRoomReceipts(roomId: string, receiptType: string, eventId: string): Promise<RoomReceiptsResult> {
        return this.eventOps.getRoomReceipts(roomId, receiptType, eventId);
    }

    async getRoomTimeline(
        roomId: string,
        options?: { from?: string; to?: string; dir?: "f" | "b"; limit?: number; filter?: string },
    ): Promise<TimelineResult> {
        return this.eventOps.getRoomTimeline(roomId, options);
    }

    async getRoomUnreadCount(roomId: string): Promise<UnreadCountResult> {
        return this.eventOps.getRoomUnreadCount(roomId);
    }

    async getRoomMetadata(roomId: string): Promise<RoomMetadata> {
        return this.eventOps.getRoomMetadata(roomId);
    }

    async getRoomVaultData(roomId: string): Promise<Record<string, unknown> | null> {
        return this.eventOps.getRoomVaultData(roomId);
    }

    async setRoomVaultData(roomId: string, data: Record<string, unknown>): Promise<void> {
        return this.eventOps.setRoomVaultData(roomId, data);
    }

    async getRoomRetention(roomId: string): Promise<RetentionPolicy | null> {
        return this.eventOps.getRoomRetention(roomId);
    }

    async getRoomExternalIds(roomId: string): Promise<ExternalId[]> {
        return this.eventOps.getRoomExternalIds(roomId);
    }

    async getRoomSpaces(roomId: string): Promise<RoomSpace[]> {
        return this.eventOps.getRoomSpaces(roomId);
    }

    async getRoomEventPerspective(
        roomId: string,
        eventId: string,
        options?: { room_version?: string },
    ): Promise<EventPerspective> {
        return this.eventOps.getRoomEventPerspective(roomId, eventId, options);
    }

    async getRoomPermissions(roomId: string): Promise<RoomPermissionsResult> {
        return this.eventOps.getRoomPermissions(roomId);
    }

    async getRoomResolve(roomId: string): Promise<RoomResolveResult> {
        return this.eventOps.getRoomResolve(roomId);
    }

    async getRoomMessageQueue(
        roomId: string,
        options?: { from?: string; limit?: number },
    ): Promise<RoomMessageQueueResult> {
        return this.eventOps.getRoomMessageQueue(roomId, options);
    }

    async getRoomServiceTypes(roomId: string): Promise<RoomServiceTypesResult> {
        return this.eventOps.getRoomServiceTypes(roomId);
    }

    async getRoomReducedEvents(roomId: string): Promise<RoomReducedEventsResult> {
        return this.eventOps.getRoomReducedEvents(roomId);
    }

    async getRoomRendered(roomId: string): Promise<RoomRenderedResult> {
        return this.eventOps.getRoomRendered(roomId);
    }

    async getRoomFragments(roomId: string, userId: string): Promise<RoomFragmentsResult> {
        return this.eventOps.getRoomFragments(roomId, userId);
    }

    async getRoomDevice(roomId: string, deviceId: string): Promise<RoomDeviceResult> {
        return this.eventOps.getRoomDevice(roomId, deviceId);
    }

    async getRoomEventUrl(roomId: string, eventId: string): Promise<RoomEventUrlResult> {
        return this.eventOps.getRoomEventUrl(roomId, eventId);
    }

    async translateRoomEvent(
        roomId: string,
        eventId: string,
        body: TranslateEventBody = {},
    ): Promise<RoomTranslateResult> {
        return this.eventOps.translateRoomEvent(roomId, eventId, body);
    }

    async convertRoomEvent(
        roomId: string,
        eventId: string,
        body: ConvertEventBody = {},
    ): Promise<RoomConvertResult> {
        return this.eventOps.convertRoomEvent(roomId, eventId, body);
    }

    async signRoomEvent(
        roomId: string,
        eventId: string,
        body: SignEventBody = {},
    ): Promise<RoomSignResult> {
        return this.eventOps.signRoomEvent(roomId, eventId, body);
    }

    async verifyRoomEvent(
        roomId: string,
        eventId: string,
        body: VerifyEventBody = {},
    ): Promise<RoomVerifyResult> {
        return this.eventOps.verifyRoomEvent(roomId, eventId, body);
    }

    async getRoomTurnServer(roomId: string): Promise<TurnServerConfig> {
        return this.eventOps.getRoomTurnServer(roomId);
    }

    async getStickyEvents(roomId: string): Promise<StickyEvent[]> {
        return this.eventOps.getStickyEvents(roomId);
    }

    async setStickyEvent(
        roomId: string,
        eventType: string,
        content: RoomSummaryStateContent,
    ): Promise<StickyEvent> {
        return this.eventOps.setStickyEvent(roomId, eventType, content);
    }

    async deleteStickyEvent(roomId: string, eventType: string): Promise<void> {
        return this.eventOps.deleteStickyEvent(roomId, eventType);
    }

    async getRoomPowerLevels(roomId: string): Promise<RoomAccountDataResult> {
        return this.eventOps.getRoomPowerLevels(roomId);
    }

    // ===== 生命周期 =====

    async start(): Promise<void> {
        // 初始化逻辑（如果需要）
    }

    stop(): void {
        this.clearCache();
    }

    // ===== 私有辅助方法 =====

    private validateRoomId(roomId: string): void {
        if (!roomId || typeof roomId !== "string") {
            throw new InvalidParamError("Room ID is required and must be a string");
        }
        const trimmed = roomId.trim();
        if (trimmed.length === 0) {
            throw new InvalidParamError("Room ID cannot be empty");
        }
        if (!trimmed.startsWith("!") && !trimmed.startsWith("#")) {
            throw new InvalidParamError("Room ID must start with ! (room ID) or # (alias)");
        }
        if (!trimmed.includes(":")) {
            throw new InvalidParamError("Room ID must contain a server name (e.g., !room:server.com)");
        }
    }

    private async requestV3<T>(method: Method, path: string, queryParams?: QueryDict, body?: Body): Promise<T> {
        return await this.client.http.authedRequest<T>(method, path, queryParams, body, {
            prefix: ClientPrefix.V3,
        });
    }

    private async requestInternal<T>(method: Method, path: string, queryParams?: QueryDict, body?: Body): Promise<T> {
        return await this.client.http.authedRequest<T>(method, path, queryParams, body, {
            prefix: "/_synapse/room_summary/v1",
        });
    }

    /**
     * 转换 client.ts 中的 RoomSummary 到本模块的 RoomSummary
     */
    private convertClientSummary(clientSummary: ClientRoomSummary): RoomSummary {
        return {
            room_id: clientSummary.room_id,
            room_type: clientSummary.room_type,
            name: clientSummary.name,
            topic: clientSummary.topic,
            avatar_url: clientSummary.avatar_url,
            canonical_alias: clientSummary.canonical_alias,
            join_rule: clientSummary.join_rule || "invite",
            history_visibility: clientSummary.history_visibility || "shared",
            guest_access: clientSummary.guest_access || "forbidden",
            is_direct: clientSummary.is_direct ?? false,
            is_space: clientSummary.is_space ?? false,
            is_encrypted: clientSummary.is_encrypted ?? false,
            member_count: clientSummary.num_joined_members || 0,
            joined_member_count: clientSummary.num_joined_members || 0,
            invited_member_count: 0,
            heroes: (clientSummary.heroes || []).map((h) => ({
                user_id: typeof h === "string" ? h : h.user_id,
                display_name: typeof h === "string" ? undefined : h.display_name,
                avatar_url: typeof h === "string" ? undefined : h.avatar_url,
            })),
            last_event_ts: clientSummary.last_event_ts,
            last_message_ts: clientSummary.last_message_ts,
        };
    }

    /**
     * 处理错误（保留用于向后兼容，但建议使用 normalizeError）
     * @deprecated 使用 normalizeError 替代
     */
    private handleError(method: string, error: unknown): void {
        const sdkError = this.normalizeError(error, method);
        logger.warn(sdkError.message);
        this.emit(RoomSummaryEvent.Error, sdkError);
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
 */
export function extendMatrixClient(): void {
    if (typeof MatrixClient === "undefined") return;
    MatrixClient.prototype.getRoomSummaryManager = function (): RoomSummaryManager {
        return getOrCreateManager(this, "roomSummary", () => new RoomSummaryManager(this));
    };
}

export default extendMatrixClient;
