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
    TranslateResult,
    RoomConvertResult,
    RoomSignResult,
    RoomVerifyResult,
    RoomAccountDataResult,
    RoomInvitesResult,
    RoomKeyClaimResult,
    RoomKeyCountResult,
    RoomKeysResult,
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
    HeroesRecalcResult,
    UnreadClearResult,
    BatchSummaryResponse,
    BatchSummaryRequest,
    UpdateSummaryBody,
    SyncSummaryResult,
    ProcessUpdatesResult,
    RoomVaultDataResult,
} from "./types";

// 重新导出子 Manager 类型，供直接使用
export { RoomSummaryMemberManager, RoomSummaryMemberEvent } from "./sub-managers/room-member-manager";
export { RoomSummaryStateManager } from "./sub-managers/room-state-manager";
export { RoomSummaryStatsManager, RoomSummaryStatsEvent } from "./sub-managers/room-stats-manager";
export { RoomSummaryThreadManager } from "./sub-managers/room-thread-manager";
export { RoomSummarySearchManager } from "./sub-managers/room-search-manager";
export { RoomSummaryKeyManager } from "./sub-managers/room-key-manager";
export { RoomSummaryEventOperationManager } from "./sub-managers/room-event-operation-manager";

import { MatrixClient } from "../client";
import { logger } from "../logger";
import { Method } from "../http-api/method";
import { ClientPrefix, VendorPrefix } from "../http-api/prefix";
import { Body } from "../http-api/interface";
import { InvalidParamError } from "../common/errors";
import { type QueryDict } from "../http-api/utils";
import { BaseManager, type ManagerOpts, type RequestStats } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { LRUCache } from "../utils/lru-cache";
import type { IPublicRoomsChunkRoom, IPublicRoomsResponse } from "../client-api-types";
import type { IContent } from "../models/event";
import type { ClaimKeysRequest } from "../device-keys/index";
import type { RoomSummaryPath, RoomSummaryPathPattern } from "./__generated__/route-table";

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
    TranslateResult,
    RoomConvertResult,
    RoomSignResult,
    RoomVerifyResult,
    RoomAccountDataResult,
    RoomInvitesResult,
    RoomKeyClaimResult,
    RoomKeyCountResult,
    RoomKeysResult,
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
    HeroesRecalcResult,
    UnreadClearResult,
    BatchSummaryResponse,
    BatchSummaryRequest,
    UpdateSummaryBody,
    SyncSummaryResult,
    ProcessUpdatesResult,
    RoomVaultDataResult,
} from "./types";

// 子 Manager 导入
import { RoomSummaryMemberManager, RoomSummaryMemberEvent } from "./sub-managers/room-member-manager";
import { RoomSummaryStateManager } from "./sub-managers/room-state-manager";
import { RoomSummaryStatsManager, RoomSummaryStatsEvent } from "./sub-managers/room-stats-manager";
import { RoomSummaryThreadManager } from "./sub-managers/room-thread-manager";
import { RoomSummarySearchManager, type RoomSearchBody } from "./sub-managers/room-search-manager";
import { RoomSummaryKeyManager } from "./sub-managers/room-key-manager";
import {
    RoomSummaryEventOperationManager,
    type TranslateEventBody,
    type ConvertEventBody,
    type SignEventBody,
    type VerifyEventBody,
} from "./sub-managers/room-event-operation-manager";
import type { PathAssert, StripInternalSummary, StripR0, StripV3, StripVendor } from "../http-api/strip-prefix";

function rsv<const P extends string>(
    path: P & PathAssert<P, StripV3<RoomSummaryPath> | StripVendor<RoomSummaryPath>>,
): P {
    return path;
}

function _rsr0<const P extends string>(path: P & PathAssert<P, StripR0<RoomSummaryPath>>): P {
    return path;
}

function rsi<const P extends string>(
    path: P & PathAssert<P, StripInternalSummary<RoomSummaryPath> | "/summaries/batch">,
): P {
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
    public readonly eventOps: RoomSummaryEventOperationManager;

    public constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);

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
        this.eventOps = new RoomSummaryEventOperationManager(
            client,
            onCacheInvalidation,
            onError,
            this.summaryCache,
            (roomId, summary) => {
                this.emit(RoomSummaryEvent.Updated, roomId, summary);
            },
        );

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

    private summaryReadPath(roomId: string): StripV3<RoomSummaryPathPattern> | StripVendor<RoomSummaryPathPattern> {
        return rsv(`/rooms/${encodeURIComponent(roomId)}/summary`);
    }

    private internalSummaryPath(path: "/summaries" | "/updates/process"): StripInternalSummary<RoomSummaryPath> {
        return rsi(path);
    }

    /**
     * 获取房间摘要
     *
     * @throws {Error} 当 `throwOnError` 为 `true` 且请求失败时抛出
     * @example
     * ```typescript
     * const summary = await client.getRoomSummaryManager().getRoomSummary("!room:example.com");
     * ```
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
                try {
                    return await this.request({
                        method: Method.Get,
                        path: this.summaryReadPath(roomIdOrAlias),
                        queryParams: via ? { via } : undefined,
                        /**
                         * 后端只在 `/_matrix/vendor/v1` 与 `/_matrix/client/v1` 注册
                         * `rooms/{room_id}/summary`（**没有 v3**）。此前这里有个从未被使用的
                         * `_paramOpts`，实际落回 `request()` 的默认 v3 ⇒ 该读路径恒 404。
                         */
                        prefix: VendorPrefix,
                    });
                } catch {
                    return await this.request({
                        method: Method.Get,
                        path: `/summary/${encodeURIComponent(roomIdOrAlias)}`,
                        queryParams: via ? { via } : undefined,
                        prefix: "/_matrix/client/unstable/im.nheko.summary",
                    });
                }
            }, "getRoomSummary");

            const summary = this.convertClientSummary(clientSummary as ClientRoomSummary);
            this.summaryCache.set(roomIdOrAlias, summary);
            this.emit(RoomSummaryEvent.Updated, roomIdOrAlias, summary);
            return summary;
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, "getRoomSummary");
            }
            const sdkError = this.normalizeError(e, "getRoomSummary");
            logger.warn(sdkError.message);
            this.emit(RoomSummaryEvent.Error, sdkError);
        }
        return null;
    }

    /**
     * 创建或刷新指定房间的摘要。
     *
     * 委托到 `eventOps` 子 Manager 发起后端创建/刷新请求。
     *
     * @param roomId - 房间 ID
     * @param body - 可选的事件内容体，默认 `{}`
     * @returns 创建或刷新后的房间摘要；失败时返回 `null`
     * @example
     * ```typescript
     * const summary = await client.getRoomSummaryManager().createOrRefreshSummary("!room:example.com");
     * ```
     */
    public async createOrRefreshSummary(roomId: string, body: IContent = {}): Promise<RoomSummary | null> {
        return this.eventOps.createOrRefreshSummary(roomId, body);
    }

    /**
     * 更新指定房间的摘要。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param body - 摘要更新请求体
     * @returns 更新后的房间摘要；失败时返回 `null`
     * @example
     * ```typescript
     * const summary = await client.getRoomSummaryManager().updateSummary("!room:example.com", { name: "新名称" });
     * ```
     */
    public async updateSummary(roomId: string, body: UpdateSummaryBody): Promise<RoomSummary | null> {
        return this.eventOps.updateSummary(roomId, body);
    }

    /**
     * 删除指定房间的摘要。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @returns 无返回值
     * @example
     * ```typescript
     * await client.getRoomSummaryManager().deleteSummary("!room:example.com");
     * ```
     */
    public async deleteSummary(roomId: string): Promise<void> {
        return this.eventOps.deleteSummary(roomId);
    }

    /**
     * 同步指定房间的摘要。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param body - 可选的事件内容体，默认 `{}`
     * @returns 摘要同步结果
     * @example
     * ```typescript
     * const result = await client.getRoomSummaryManager().syncSummary("!room:example.com");
     * ```
     */
    public async syncSummary(roomId: string, body: IContent = {}): Promise<SyncSummaryResult> {
        return this.eventOps.syncSummary(roomId, body);
    }

    /**
     * 列出当前用户的房间摘要列表。
     *
     * 使用后端内部接口 `GET /summaries`，并把数组响应归一化为带
     * `summaries`/`rooms`/`chunk` 字段的统一结构。
     *
     * @param queryParams - 可选查询参数，默认 `{}`
     * @returns 房间摘要列表响应
     * @example
     * ```typescript
     * const list = await client.getRoomSummaryManager().listUserSummaries({ limit: 20 });
     * ```
     */
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

    /**
     * 通过内部接口创建一个房间摘要。
     *
     * 使用后端内部接口 `POST /summaries`。
     *
     * @param body - 事件内容体
     * @returns 新建的房间摘要
     * @throws {InvalidParamError} 当 `body` 不是对象时抛出
     * @example
     * ```typescript
     * const summary = await client.getRoomSummaryManager().createInternalSummary({ room_id: "!room:example.com" });
     * ```
     */
    public async createInternalSummary(body: IContent): Promise<RoomSummary> {
        if (!body || typeof body !== "object") {
            throw new InvalidParamError("Body must be an object");
        }

        return this.withRetry(async () => {
            return await this.requestInternal<RoomSummary>(
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
     *
     * @example
     * ```typescript
     * const summaries = await client
     *     .getRoomSummaryManager()
     *     .batchGetRoomSummaries(["!room1:example.com", "!room2:example.com"], { suggestedOnly: true });
     * ```
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
            }>(Method.Post, rsi("/summaries/batch"), undefined, {
                rooms: roomIds,
                suggested_only: options?.suggestedOnly ?? false,
            });

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
    public async batchGetSummaries(rooms: string[], isSuggestedOnly?: boolean): Promise<BatchSummaryResponse> {
        if (!rooms.length) return {};

        return this.withRetry(async () => {
            return await this.requestInternal<BatchSummaryResponse>(Method.Post, rsi("/summaries/batch"), undefined, {
                rooms,
                // ⚠️ 线上键名必须与后端一致：后端 `RoomSummaryBatchRequest` 用
                // `#[serde(deny_unknown_fields, rename = "suggested_only")]`；写成
                // `is_suggested_only` 会被判为未知字段并**直接 400**（2026-10-09 实测）。
                suggested_only: isSuggestedOnly ?? false,
            });
        }, "batchGetSummaries");
    }

    /**
     * Fetch room summaries in batch (MSC3266 route-surface driven capability).
     *
     * Uses the backend `POST /_synapse/room_summary/v1/summaries/batch` endpoint
     * to fetch multiple summaries in a single HTTP request, returning the raw
     * batch response without converting or caching individual summaries.
     *
     * @param request - Batch fetch request body
     * @param request.rooms - Array of room IDs to fetch summaries for
     * @param request.suggested_only - Whether to only return suggested rooms (default: false)。
     *   **这是线上键名**；`request.is_suggested_only` 仅为 SDK 侧别名（后端 deny_unknown_fields，
     *   发别名会 400）。
     * @returns Raw batch response with room summaries
     *
     * @example
     * ```typescript
     * const result = await roomSummaryManager.fetchBatchSummaries({
     *     rooms: ["!room1:server.com", "!room2:server.com"],
     *     suggested_only: true,
     * });
     * console.log(result.rooms?.length);
     * ```
     *
     * @throws {InvalidParamError} If the request body is missing or `rooms` is empty
     */
    public async fetchBatchSummaries(request: BatchSummaryRequest): Promise<BatchSummaryResponse> {
        if (!request || typeof request !== "object") {
            throw new InvalidParamError("Request body must be an object");
        }
        if (!Array.isArray(request.rooms) || !request.rooms.length) {
            throw new InvalidParamError("request.rooms must be a non-empty array");
        }

        return this.withRetry(async () => {
            return await this.requestInternal<BatchSummaryResponse>(Method.Post, rsi("/summaries/batch"), undefined, {
                rooms: request.rooms,
                // 同 `batchGetSummaries`：线上键名是 `suggested_only`（后端 deny_unknown_fields）。
                // `is_suggested_only` 仅作 SDK 侧别名接受，两个都给时以 `suggested_only` 为准。
                suggested_only: request.suggested_only ?? request.is_suggested_only ?? false,
            });
        }, "fetchBatchSummaries");
    }

    /**
     * 处理待更新的房间摘要。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param body - 可选处理选项，`limit` 限制本次处理数量，默认 `{}`
     * @returns 摘要更新处理结果
     * @example
     * ```typescript
     * const result = await client.getRoomSummaryManager().processSummaryUpdates({ limit: 100 });
     * ```
     */
    public async processSummaryUpdates(body: { limit?: number } = {}): Promise<ProcessUpdatesResult> {
        return this.eventOps.processSummaryUpdates(body);
    }

    // ===== 缓存管理 =====

    /**
     * 清除房间摘要缓存。
     *
     * 传入 `roomId` 时仅清除该房间的摘要、成员与统计缓存；
     * 不传时清空全部三类缓存。
     *
     * @param roomId - 可选房间 ID
     * @returns 无返回值
     * @example
     * ```typescript
     * client.getRoomSummaryManager().clearCache("!room:example.com");
     * client.getRoomSummaryManager().clearCache();
     * ```
     */
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

    /**
     * 获取聚合的请求统计（包含顶层及所有子 Manager 的请求）。
     *
     * RoomSummaryManager 是门面：大部分请求由子 Manager 发出，
     * 此方法聚合所有子 Manager 的统计，提供完整的请求视图。
     *
     * @example
     * ```typescript
     * const stats = client.getRoomSummaryManager().getRequestStats();
     * ```
     */
    public getRequestStats(): RequestStats {
        const aggregated: RequestStats = { total: 0, successful: 0, failed: 0, retried: 0 };
        const subManagers = [this.members, this.state, this.stats, this.threads, this.search, this.keys, this.eventOps];
        for (const sm of subManagers) {
            const s = sm.getRequestStats();
            aggregated.total += s.total;
            aggregated.successful += s.successful;
            aggregated.failed += s.failed;
            aggregated.retried += s.retried;
        }
        const own = super.getRequestStats();
        aggregated.total += own.total;
        aggregated.successful += own.successful;
        aggregated.failed += own.failed;
        aggregated.retried += own.retried;
        return aggregated;
    }

    /**
     * 重置顶层及所有子 Manager 的请求统计。
     *
     * @example
     * ```typescript
     * client.getRoomSummaryManager().resetRequestStats();
     * ```
     */
    public resetRequestStats(): void {
        super.resetRequestStats();
        for (const sm of [this.members, this.state, this.stats, this.threads, this.search, this.keys, this.eventOps]) {
            sm.resetRequestStats();
        }
    }

    /**
     * 获取摘要、成员、统计三类缓存的命中统计。
     *
     * @returns 各类缓存的 `size`/`hits`/`misses`/`hitRate`
     * @example
     * ```typescript
     * const stats = client.getRoomSummaryManager().getCacheStats();
     * console.log(stats.summary.hitRate);
     * ```
     */
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

    /**
     * 获取缓存与请求的聚合指标。
     *
     * 汇总各缓存的规模/命中率以及顶层与子 Manager 的请求统计。
     *
     * @returns 包含 `cache` 与 `requests` 的指标对象
     * @example
     * ```typescript
     * const metrics = client.getRoomSummaryManager().getMetrics();
     * console.log(metrics.requests.total);
     * ```
     */
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

    /**
     * 从缓存读取房间摘要（不发起网络请求）。
     *
     * @param roomId - 房间 ID
     * @returns 命中的摘要；未命中返回 `null`
     * @example
     * ```typescript
     * const summary = client.getRoomSummaryManager().getCachedSummary("!room:example.com");
     * ```
     */
    public getCachedSummary(roomId: string): RoomSummary | null {
        return this.summaryCache.get(roomId) || null;
    }

    /**
     * 从缓存读取房间摘要成员（不发起网络请求）。
     *
     * @param roomId - 房间 ID
     * @returns 命中的成员数组；未命中返回空数组
     * @example
     * ```typescript
     * const members = client.getRoomSummaryManager().getCachedMembers("!room:example.com");
     * ```
     */
    public getCachedMembers(roomId: string): RoomSummaryMember[] {
        return this.memberCache.get(roomId) || [];
    }

    /**
     * 从缓存读取房间统计信息（不发起网络请求）。
     *
     * @param roomId - 房间 ID
     * @returns 命中的统计信息；未命中返回 `null`
     * @example
     * ```typescript
     * const stats = client.getRoomSummaryManager().getCachedStats("!room:example.com");
     * ```
     */
    public getCachedStats(roomId: string): RoomStats | null {
        return this.statsCache.get(roomId) || null;
    }

    /**
     * 判断指定房间的摘要是否已缓存。
     *
     * @param roomId - 房间 ID
     * @returns 命中缓存返回 `true`，否则 `false`
     * @example
     * ```typescript
     * if (client.getRoomSummaryManager().isCached("!room:example.com")) { ... }
     * ```
     */
    public isCached(roomId: string): boolean {
        return this.summaryCache.get(roomId) !== undefined;
    }

    // ===== 向后兼容委托方法 =====
    // 所有原有方法委托到对应的子 Manager，保持 API 完全兼容

    // ----- 成员管理（委托 → members） -----

    /**
     * 获取房间摘要成员列表。
     *
     * 委托到 `members` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param forceRefresh - 是否强制刷新缓存，默认 `false`
     * @param throwOnError - 出错时是否抛出，默认 `true`
     * @returns 房间摘要成员数组
     * @example
     * ```typescript
     * const members = await client.getRoomSummaryManager().getRoomSummaryMembers("!room:example.com");
     * ```
     */
    async getRoomSummaryMembers(
        roomId: string,
        forceRefresh = false,
        throwOnError = true,
    ): Promise<RoomSummaryMember[]> {
        return this.members.getRoomSummaryMembers(roomId, forceRefresh, throwOnError);
    }

    /**
     * 批量写入房间摘要成员。
     *
     * 委托到 `members` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param members - 要写入的成员数组
     * @returns 写入后的成员数组
     * @example
     * ```typescript
     * const members = await client.getRoomSummaryManager().writeSummaryMembers("!room:example.com", memberList);
     * ```
     */
    async writeSummaryMembers(roomId: string, members: RoomSummaryMember[]): Promise<RoomSummaryMember[]> {
        return this.members.writeSummaryMembers(roomId, members);
    }

    /**
     * 更新单个房间摘要成员。
     *
     * 委托到 `members` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param userId - 成员的用户 ID
     * @param member - 需要更新的成员字段（部分）
     * @returns 更新后的成员
     * @example
     * ```typescript
     * const member = await client.getRoomSummaryManager().updateSummaryMember("!room:example.com", "@alice:example.com", { display_name: "Alice" });
     * ```
     */
    async updateSummaryMember(
        roomId: string,
        userId: string,
        member: Partial<RoomSummaryMember>,
    ): Promise<RoomSummaryMember> {
        return this.members.updateSummaryMember(roomId, userId, member);
    }

    /**
     * 删除指定房间摘要成员。
     *
     * 委托到 `members` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param userId - 成员的用户 ID
     * @returns 无返回值
     * @example
     * ```typescript
     * await client.getRoomSummaryManager().deleteSummaryMember("!room:example.com", "@alice:example.com");
     * ```
     */
    async deleteSummaryMember(roomId: string, userId: string): Promise<void> {
        return this.members.deleteSummaryMember(roomId, userId);
    }

    /**
     * 获取房间最近的成员列表。
     *
     * 委托到 `members` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param options - 可选分页与数量限制
     * @returns 最近成员结果
     * @example
     * ```typescript
     * const recent = await client.getRoomSummaryManager().getRoomMembersRecent("!room:example.com", { limit: 10 });
     * ```
     */
    async getRoomMembersRecent(
        roomId: string,
        options?: { from?: string; limit?: number },
    ): Promise<RoomMembersRecentResult> {
        return this.members.getRoomMembersRecent(roomId, options);
    }

    // ----- 状态管理（委托 → state） -----

    /**
     * 获取房间的全部摘要状态。
     *
     * 委托到 `state` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @returns 摘要状态数组
     * @example
     * ```typescript
     * const states = await client.getRoomSummaryManager().getAllSummaryState("!room:example.com");
     * ```
     */
    async getAllSummaryState(roomId: string): Promise<IRoomSummaryState[]> {
        return this.state.getAllSummaryState(roomId);
    }

    /**
     * 获取指定事件类型的摘要状态。
     *
     * 委托到 `state` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param eventType - 事件类型
     * @param stateKey - 状态键，默认空字符串
     * @returns 摘要状态内容
     * @example
     * ```typescript
     * const state = await client.getRoomSummaryManager().getSummaryState("!room:example.com", "m.room.name");
     * ```
     */
    async getSummaryState(roomId: string, eventType: string, stateKey: string = ""): Promise<RoomSummaryStateContent> {
        return this.state.getSummaryState(roomId, eventType, stateKey);
    }

    /**
     * 更新指定事件类型的摘要状态。
     *
     * 委托到 `state` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param eventType - 事件类型
     * @param stateKey - 状态键
     * @param content - 新的状态内容
     * @returns 更新后的摘要状态内容
     * @example
     * ```typescript
     * const state = await client.getRoomSummaryManager().updateSummaryState("!room:example.com", "m.room.name", "", { name: "新名称" });
     * ```
     */
    async updateSummaryState(
        roomId: string,
        eventType: string,
        stateKey: string,
        content: RoomSummaryStateContent,
    ): Promise<RoomSummaryStateContent> {
        return this.state.updateSummaryState(roomId, eventType, stateKey, content);
    }

    // ----- 统计管理（委托 → stats） -----

    /**
     * 获取房间统计信息。
     *
     * 委托到 `stats` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param forceRefresh - 是否强制刷新缓存，默认 `false`
     * @param throwOnError - 出错时是否抛出，默认 `true`
     * @returns 房间统计信息；失败时返回 `null`
     * @example
     * ```typescript
     * const stats = await client.getRoomSummaryManager().getRoomSummaryStats("!room:example.com");
     * ```
     */
    async getRoomSummaryStats(roomId: string, forceRefresh = false, throwOnError = true): Promise<RoomStats | null> {
        return this.stats.getRoomSummaryStats(roomId, forceRefresh, throwOnError);
    }

    /**
     * 重新计算房间统计信息。
     *
     * 委托到 `stats` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param body - 可选的事件内容体，默认 `{}`
     * @returns 重算后的房间统计信息；失败时返回 `null`
     * @example
     * ```typescript
     * const stats = await client.getRoomSummaryManager().recalculateSummaryStats("!room:example.com");
     * ```
     */
    async recalculateSummaryStats(roomId: string, body: IContent = {}): Promise<RoomStats | null> {
        return this.stats.recalculateSummaryStats(roomId, body);
    }

    /**
     * 重新计算房间摘要的 heroes（代表成员）。
     *
     * 委托到 `stats` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param body - 可选的事件内容体，默认 `{}`
     * @returns heroes 重算结果
     * @example
     * ```typescript
     * const result = await client.getRoomSummaryManager().recalculateSummaryHeroes("!room:example.com");
     * ```
     */
    async recalculateSummaryHeroes(roomId: string, body: IContent = {}): Promise<HeroesRecalcResult> {
        return this.stats.recalculateSummaryHeroes(roomId, body);
    }

    /**
     * 清除房间摘要的未读标记。
     *
     * 委托到 `stats` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param body - 可选的事件内容体，默认 `{}`
     * @returns 未读清除结果
     * @example
     * ```typescript
     * const result = await client.getRoomSummaryManager().clearSummaryUnread("!room:example.com");
     * ```
     */
    async clearSummaryUnread(roomId: string, body: IContent = {}): Promise<UnreadClearResult> {
        return this.stats.clearSummaryUnread(roomId, body);
    }

    // ----- 线程管理（委托 → threads） -----

    /**
     * 获取指定事件的密钥信息。
     *
     * 委托到 `threads` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @returns 事件密钥结果
     * @example
     * ```typescript
     * const keys = await client.getRoomSummaryManager().getEventKeys("!room:example.com", "$eventId");
     * ```
     */
    async getEventKeys(roomId: string, eventId: string): Promise<EventKeysResult> {
        return this.threads.getEventKeys(roomId, eventId);
    }

    /**
     * 获取指定事件的线程信息。
     *
     * 委托到 `threads` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param eventId - 线程根事件 ID
     * @returns 房间线程结果
     * @example
     * ```typescript
     * const thread = await client.getRoomSummaryManager().getRoomThread("!room:example.com", "$eventId");
     * ```
     */
    async getRoomThread(roomId: string, eventId: string): Promise<RoomThreadResult> {
        return this.threads.getRoomThread(roomId, eventId);
    }

    /**
     * 按线程 ID 获取线程详情。
     *
     * 委托到 `threads` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param threadId - 线程 ID
     * @returns 线程详情结果
     * @example
     * ```typescript
     * const thread = await client.getRoomSummaryManager().getRoomThreadById("!room:example.com", "t1");
     * ```
     */
    async getRoomThreadById(roomId: string, threadId: string): Promise<RoomThreadDetailResult> {
        return this.threads.getRoomThreadById(roomId, threadId);
    }

    // ----- 搜索/发现（委托 → search） -----

    /**
     * 获取房间层级（space 子房间树）。
     *
     * 委托到 `search` 子 Manager。
     *
     * @param roomId - 房间（space）ID
     * @param options - 可选查询选项
     * @param throwOnError - 出错时是否抛出，默认 `true`
     * @returns 房间层级数据；失败时返回 `null`
     * @example
     * ```typescript
     * const hierarchy = await client.getRoomSummaryManager().getRoomHierarchy("!space:example.com");
     * ```
     */
    async getRoomHierarchy(roomId: string, options?: RoomSummaryOptions, throwOnError = true): Promise<unknown | null> {
        return this.search.getRoomHierarchy(roomId, options, throwOnError);
    }

    /**
     * 获取公共房间列表。
     *
     * 委托到 `search` 子 Manager。
     *
     * @param server - 服务器名，默认空字符串（使用本服务器）
     * @param options - 可选分页与查询选项
     * @param throwOnError - 出错时是否抛出，默认 `true`
     * @returns 公共房间响应；失败时返回 `null`
     * @example
     * ```typescript
     * const rooms = await client.getRoomSummaryManager().getPublicRooms("example.com", { limit: 20 });
     * ```
     */
    async getPublicRooms(
        server = "",
        options?: { limit?: number; since?: string; query?: string },
        throwOnError = true,
    ): Promise<IPublicRoomsResponse | null> {
        return this.search.getPublicRooms(server, options, throwOnError);
    }

    /**
     * 搜索公共房间。
     *
     * 委托到 `search` 子 Manager。
     *
     * @param query - 搜索关键词
     * @param server - 服务器名，默认空字符串
     * @param limit - 返回数量上限，默认 `20`
     * @returns 匹配的公共房间数组
     * @example
     * ```typescript
     * const rooms = await client.getRoomSummaryManager().searchPublicRooms("matrix", "example.com", 10);
     * ```
     */
    async searchPublicRooms(query: string, server = "", limit = 20): Promise<IPublicRoomsChunkRoom[]> {
        return this.search.searchPublicRooms(query, server, limit);
    }

    /**
     * 获取推荐房间。
     *
     * 委托到 `search` 子 Manager。
     *
     * @param server - 服务器名，默认空字符串
     * @param limit - 返回数量上限，默认 `20`
     * @returns 推荐房间数组
     * @example
     * ```typescript
     * const rooms = await client.getRoomSummaryManager().getRecommendedRooms("example.com", 10);
     * ```
     */
    async getRecommendedRooms(server = "", limit = 20): Promise<IPublicRoomsChunkRoom[]> {
        return this.search.getRecommendedRooms(server, limit);
    }

    /**
     * 获取收藏房间摘要列表。
     *
     * 委托到 `search` 子 Manager。
     *
     * @returns 收藏房间摘要数组
     * @example
     * ```typescript
     * const rooms = await client.getRoomSummaryManager().getFavoriteRooms();
     * ```
     */
    async getFavoriteRooms(): Promise<RoomSummary[]> {
        return this.search.getFavoriteRooms();
    }

    /**
     * 获取最近访问房间摘要列表。
     *
     * 委托到 `search` 子 Manager。
     *
     * @param limit - 返回数量上限，默认 `10`
     * @returns 最近房间摘要数组
     * @example
     * ```typescript
     * const rooms = await client.getRoomSummaryManager().getRecentRooms(5);
     * ```
     */
    async getRecentRooms(limit = 10): Promise<RoomSummary[]> {
        return this.search.getRecentRooms(limit);
    }

    /**
     * 在指定房间内搜索消息。
     *
     * 委托到 `search` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param body - 搜索请求体
     * @returns 房间搜索结果
     * @example
     * ```typescript
     * const result = await client.getRoomSummaryManager().searchRoom("!room:example.com", { search_term: "hello" });
     * ```
     */
    async searchRoom(roomId: string, body: RoomSearchBody): Promise<RoomSearchResult> {
        return this.search.searchRoom(roomId, body);
    }

    // ----- 密钥管理（委托 → keys） -----

    /**
     * 申领房间密钥。
     *
     * 委托到 `keys` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param body - 密钥申领请求体
     * @returns 密钥申领结果
     * @example
     * ```typescript
     * const result = await client.getRoomSummaryManager().claimRoomKeys("!room:example.com", claimRequest);
     * ```
     */
    async claimRoomKeys(roomId: string, body: ClaimKeysRequest): Promise<RoomKeyClaimResult> {
        return this.keys.claimRoomKeys(roomId, body);
    }

    /**
     * 获取房间密钥数量。
     *
     * 委托到 `keys` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @returns 密钥数量结果
     * @example
     * ```typescript
     * const count = await client.getRoomSummaryManager().getRoomKeyCount("!room:example.com");
     * ```
     */
    async getRoomKeyCount(roomId: string): Promise<RoomKeyCountResult> {
        return this.keys.getRoomKeyCount(roomId);
    }

    /**
     * 获取房间密钥列表（`GET /rooms/{room_id}/keys`）。
     *
     * @param roomId - 房间 ID
     * @returns 该房间当前备份版本下的逐条会话密钥
     * @example
     * ```typescript
     * const result = await client.getRoomSummaryManager().getRoomKeys("!room:example.com");
     * console.log(result.version, result.keys.length);
     * ```
     */
    async getRoomKeys(roomId: string): Promise<RoomKeysResult> {
        return this.keys.getRoomKeys(roomId);
    }

    /**
     * 获取房间密钥版本。
     *
     * 委托到 `keys` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @returns 密钥版本结果
     * @example
     * ```typescript
     * const version = await client.getRoomSummaryManager().getRoomKeysVersion("!room:example.com");
     * ```
     */
    async getRoomKeysVersion(roomId: string): Promise<RoomKeysVersionResult> {
        return this.keys.getRoomKeysVersion(roomId);
    }

    /**
     * 转发房间密钥。
     *
     * 委托到 `keys` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param body - 转发请求体
     * @returns 密钥转发结果
     * @example
     * ```typescript
     * const result = await client.getRoomSummaryManager().forwardRoomKeys("!room:example.com", forwardBody);
     * ```
     */
    async forwardRoomKeys(roomId: string, body: IContent): Promise<RoomForwardKeysResult> {
        return this.keys.forwardRoomKeys(roomId, body);
    }

    /**
     * 获取房间内的加密事件。
     *
     * 委托到 `keys` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param options - 可选分页与数量限制
     * @returns 加密事件结果
     * @example
     * ```typescript
     * const events = await client.getRoomSummaryManager().getEncryptedEvents("!room:example.com", { limit: 50 });
     * ```
     */
    async getEncryptedEvents(
        roomId: string,
        options?: { from?: string; limit?: number },
    ): Promise<EncryptedEventsResult> {
        return this.keys.getEncryptedEvents(roomId, options);
    }

    // 邀请策略（黑名单/白名单）由 `InviteBlocklistManager` 唯一提供（`client.getInviteBlocklistManager()`）：
    // 本类原先的 `invitePolicy` 子管理器是它的**子集重复实现**，且用 client v3 打只存在于
    // `/_matrix/vendor/v1` 的 `invite_*list`（必然 404），已按"重复实现一律删除"原则移除。

    // ----- 事件操作（委托 → eventOps） -----

    /**
     * 获取房间通知。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param options - 可选分页、数量与类型过滤
     * @returns 房间通知结果
     * @example
     * ```typescript
     * const notifications = await client.getRoomSummaryManager().getRoomNotifications("!room:example.com", { limit: 20 });
     * ```
     */
    async getRoomNotifications(
        roomId: string,
        options?: { from?: string; limit?: number; only?: string },
    ): Promise<RoomNotificationsResult> {
        return this.eventOps.getRoomNotifications(roomId, options);
    }

    /**
     * 获取房间能力集。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @returns 房间能力集
     * @example
     * ```typescript
     * const caps = await client.getRoomSummaryManager().getRoomCapabilities("!room:example.com");
     * ```
     */
    async getRoomCapabilities(roomId: string): Promise<RoomCapabilities> {
        return this.eventOps.getRoomCapabilities(roomId);
    }

    /**
     * 对指定房间执行增量同步。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param options - 可选同步选项（`since`/`timeout_ms`/`filter`）
     * @returns 房间同步结果
     * @example
     * ```typescript
     * const sync = await client.getRoomSummaryManager().getRoomSync("!room:example.com", { timeout_ms: 30000 });
     * ```
     */
    async getRoomSync(
        roomId: string,
        options?: { since?: string; timeout_ms?: number; filter?: string },
    ): Promise<RoomSyncResult> {
        return this.eventOps.getRoomSync(roomId, options);
    }

    /**
     * 获取房间账户数据。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param type - 账户数据类型
     * @returns 房间账户数据结果
     * @example
     * ```typescript
     * const data = await client.getRoomSummaryManager().getRoomAccountData("!room:example.com", "m.fully_read");
     * ```
     */
    async getRoomAccountData(roomId: string, type: string): Promise<RoomAccountDataResult> {
        return this.eventOps.getRoomAccountData(roomId, type);
    }

    /**
     * 设置房间账户数据（v3 接口）。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param type - 账户数据类型
     * @param content - 账户数据内容
     * @returns 设置后的账户数据结果
     * @example
     * ```typescript
     * const data = await client.getRoomSummaryManager().setRoomAccountDataV3("!room:example.com", "m.fully_read", { event_id: "$eventId" });
     * ```
     */
    async setRoomAccountDataV3(
        roomId: string,
        type: string,
        content: RoomSummaryStateContent,
    ): Promise<RoomAccountDataResult> {
        return this.eventOps.setRoomAccountDataV3(roomId, type, content);
    }

    /**
     * 获取房间邀请。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @returns 房间邀请结果
     * @example
     * ```typescript
     * const invites = await client.getRoomSummaryManager().getRoomInvites("!room:example.com");
     * ```
     */
    async getRoomInvites(roomId: string): Promise<RoomInvitesResult> {
        return this.eventOps.getRoomInvites(roomId);
    }

    /**
     * 获取房间回执。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param receiptType - 回执类型（如 `m.read`）
     * @param eventId - 事件 ID
     * @returns 房间回执结果
     * @example
     * ```typescript
     * const receipts = await client.getRoomSummaryManager().getRoomReceipts("!room:example.com", "m.read", "$eventId");
     * ```
     */
    async getRoomReceipts(roomId: string, receiptType: string, eventId: string): Promise<RoomReceiptsResult> {
        return this.eventOps.getRoomReceipts(roomId, receiptType, eventId);
    }

    /**
     * 获取房间时间线。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param options - 可选分页、方向、数量与过滤选项
     * @returns 时间线结果
     * @example
     * ```typescript
     * const timeline = await client.getRoomSummaryManager().getRoomTimeline("!room:example.com", { dir: "b", limit: 50 });
     * ```
     */
    async getRoomTimeline(
        roomId: string,
        options?: { from?: string; to?: string; dir?: "f" | "b"; limit?: number; filter?: string },
    ): Promise<TimelineResult> {
        return this.eventOps.getRoomTimeline(roomId, options);
    }

    /**
     * 获取房间未读数量。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @returns 未读数量结果
     * @example
     * ```typescript
     * const unread = await client.getRoomSummaryManager().getRoomUnreadCount("!room:example.com");
     * ```
     */
    async getRoomUnreadCount(roomId: string): Promise<UnreadCountResult> {
        return this.eventOps.getRoomUnreadCount(roomId);
    }

    /**
     * 获取房间元数据。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @returns 房间元数据
     * @example
     * ```typescript
     * const metadata = await client.getRoomSummaryManager().getRoomMetadata("!room:example.com");
     * ```
     */
    async getRoomMetadata(roomId: string): Promise<RoomMetadata> {
        return this.eventOps.getRoomMetadata(roomId);
    }

    /**
     * 获取房间保险库数据。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @returns 房间保险库数据；不存在时返回 `null`
     * @example
     * ```typescript
     * const data = await client.getRoomSummaryManager().getRoomVaultData("!room:example.com");
     * ```
     */
    async getRoomVaultData(roomId: string): Promise<RoomVaultDataResult | null> {
        return this.eventOps.getRoomVaultData(roomId);
    }

    /**
     * 设置房间保险库数据。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param data - 保险库数据内容
     * @returns 无返回值
     * @example
     * ```typescript
     * await client.getRoomSummaryManager().setRoomVaultData("!room:example.com", { key: "value" });
     * ```
     */
    async setRoomVaultData(roomId: string, data: IContent): Promise<void> {
        return this.eventOps.setRoomVaultData(roomId, data);
    }

    /**
     * 获取房间保留策略。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @returns 保留策略；未设置时返回 `null`
     * @example
     * ```typescript
     * const policy = await client.getRoomSummaryManager().getRoomRetention("!room:example.com");
     * ```
     */
    async getRoomRetention(roomId: string): Promise<RetentionPolicy | null> {
        return this.eventOps.getRoomRetention(roomId);
    }

    /**
     * 获取房间的外部 ID 列表。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @returns 外部 ID 数组
     * @example
     * ```typescript
     * const ids = await client.getRoomSummaryManager().getRoomExternalIds("!room:example.com");
     * ```
     */
    async getRoomExternalIds(roomId: string): Promise<ExternalId[]> {
        return this.eventOps.getRoomExternalIds(roomId);
    }

    /**
     * 获取房间所属的 space 列表。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @returns space 数组
     * @example
     * ```typescript
     * const spaces = await client.getRoomSummaryManager().getRoomSpaces("!room:example.com");
     * ```
     */
    async getRoomSpaces(roomId: string): Promise<RoomSpace[]> {
        return this.eventOps.getRoomSpaces(roomId);
    }

    /**
     * 获取事件的透视视图。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @param options - 可选选项，可指定 `room_version`
     * @returns 事件透视结果
     * @example
     * ```typescript
     * const perspective = await client
     *     .getRoomSummaryManager()
     *     .getRoomEventPerspective("!room:example.com", "$eventId");
     * ```
     */
    async getRoomEventPerspective(
        roomId: string,
        eventId: string,
        options?: { room_version?: string },
    ): Promise<EventPerspective> {
        return this.eventOps.getRoomEventPerspective(roomId, eventId, options);
    }

    /**
     * 获取房间权限信息。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @returns 房间权限结果
     * @example
     * ```typescript
     * const permissions = await client.getRoomSummaryManager().getRoomPermissions("!room:example.com");
     * ```
     */
    async getRoomPermissions(roomId: string): Promise<RoomPermissionsResult> {
        return this.eventOps.getRoomPermissions(roomId);
    }

    /**
     * 解析房间标识。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @returns 房间解析结果
     * @example
     * ```typescript
     * const resolved = await client.getRoomSummaryManager().getRoomResolve("!room:example.com");
     * ```
     */
    async getRoomResolve(roomId: string): Promise<RoomResolveResult> {
        return this.eventOps.getRoomResolve(roomId);
    }

    /**
     * 获取房间消息队列。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param options - 可选分页选项（`from`、`limit`）
     * @returns 房间消息队列结果
     * @example
     * ```typescript
     * const queue = await client.getRoomSummaryManager().getRoomMessageQueue("!room:example.com", { limit: 20 });
     * ```
     */
    async getRoomMessageQueue(
        roomId: string,
        options?: { from?: string; limit?: number },
    ): Promise<RoomMessageQueueResult> {
        return this.eventOps.getRoomMessageQueue(roomId, options);
    }

    /**
     * 获取房间支持的服务类型。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @returns 房间服务类型结果
     * @example
     * ```typescript
     * const types = await client.getRoomSummaryManager().getRoomServiceTypes("!room:example.com");
     * ```
     */
    async getRoomServiceTypes(roomId: string): Promise<RoomServiceTypesResult> {
        return this.eventOps.getRoomServiceTypes(roomId);
    }

    /**
     * 获取房间的精简事件列表。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @returns 精简事件结果
     * @example
     * ```typescript
     * const reduced = await client.getRoomSummaryManager().getRoomReducedEvents("!room:example.com");
     * ```
     */
    async getRoomReducedEvents(roomId: string): Promise<RoomReducedEventsResult> {
        return this.eventOps.getRoomReducedEvents(roomId);
    }

    /**
     * 获取房间的渲染结果。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @returns 渲染结果
     * @example
     * ```typescript
     * const rendered = await client.getRoomSummaryManager().getRoomRendered("!room:example.com");
     * ```
     */
    async getRoomRendered(roomId: string): Promise<RoomRenderedResult> {
        return this.eventOps.getRoomRendered(roomId);
    }

    /**
     * 获取指定用户在房间中的片段信息。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param userId - 用户 ID
     * @returns 房间片段结果
     * @example
     * ```typescript
     * const fragments = await client
     *     .getRoomSummaryManager()
     *     .getRoomFragments("!room:example.com", "@alice:example.com");
     * ```
     */
    async getRoomFragments(roomId: string, userId: string): Promise<RoomFragmentsResult> {
        return this.eventOps.getRoomFragments(roomId, userId);
    }

    /**
     * 获取房间关联的设备信息。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param deviceId - 设备 ID
     * @returns 房间设备结果
     * @example
     * ```typescript
     * const device = await client.getRoomSummaryManager().getRoomDevice("!room:example.com", "DEVICEID");
     * ```
     */
    async getRoomDevice(roomId: string, deviceId: string): Promise<RoomDeviceResult> {
        return this.eventOps.getRoomDevice(roomId, deviceId);
    }

    /**
     * 获取事件的链接地址。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @returns 事件链接结果
     * @example
     * ```typescript
     * const url = await client.getRoomSummaryManager().getRoomEventUrl("!room:example.com", "$eventId");
     * ```
     */
    async getRoomEventUrl(roomId: string, eventId: string): Promise<RoomEventUrlResult> {
        return this.eventOps.getRoomEventUrl(roomId, eventId);
    }

    /**
     * 翻译指定房间事件。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @param body - 翻译参数，默认空对象
     * @returns 房间翻译结果
     * @example
     * ```typescript
     * const result = await client
     *     .getRoomSummaryManager()
     *     .translateRoomEvent("!room:example.com", "$eventId", { target_lang: "zh" });
     * ```
     */
    async translateRoomEvent(
        roomId: string,
        eventId: string,
        body: TranslateEventBody = {},
    ): Promise<RoomTranslateResult> {
        return this.eventOps.translateRoomEvent(roomId, eventId, body);
    }

    /**
     * 翻译文本内容。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param content - 待翻译的文本内容
     * @param sourceLang - 可选的源语言
     * @param targetLang - 可选的目标语言
     * @returns 翻译结果
     * @example
     * ```typescript
     * const result = await client.getRoomSummaryManager().translate("hello", "en", "zh");
     * ```
     */
    async translate(content: string, sourceLang?: string, targetLang?: string): Promise<TranslateResult> {
        return this.eventOps.translate(content, sourceLang, targetLang);
    }

    /**
     * 转换指定房间事件。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @param body - 转换参数，默认空对象
     * @returns 房间转换结果
     * @example
     * ```typescript
     * const result = await client.getRoomSummaryManager().convertRoomEvent("!room:example.com", "$eventId");
     * ```
     */
    async convertRoomEvent(roomId: string, eventId: string, body: ConvertEventBody = {}): Promise<RoomConvertResult> {
        return this.eventOps.convertRoomEvent(roomId, eventId, body);
    }

    /**
     * 对指定房间事件进行签名。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @param body - 签名参数，默认空对象
     * @returns 房间签名结果
     * @example
     * ```typescript
     * const result = await client.getRoomSummaryManager().signRoomEvent("!room:example.com", "$eventId");
     * ```
     */
    async signRoomEvent(roomId: string, eventId: string, body: SignEventBody = {}): Promise<RoomSignResult> {
        return this.eventOps.signRoomEvent(roomId, eventId, body);
    }

    /**
     * 校验指定房间事件的签名。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @param body - 校验参数，默认空对象
     * @returns 房间校验结果
     * @example
     * ```typescript
     * const result = await client.getRoomSummaryManager().verifyRoomEvent("!room:example.com", "$eventId");
     * ```
     */
    async verifyRoomEvent(roomId: string, eventId: string, body: VerifyEventBody = {}): Promise<RoomVerifyResult> {
        return this.eventOps.verifyRoomEvent(roomId, eventId, body);
    }

    /**
     * 获取房间的 TURN 服务器配置。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @returns TURN 服务器配置
     * @example
     * ```typescript
     * const turn = await client.getRoomSummaryManager().getRoomTurnServer("!room:example.com");
     * ```
     */
    async getRoomTurnServer(roomId: string): Promise<TurnServerConfig> {
        return this.eventOps.getRoomTurnServer(roomId);
    }

    /**
     * 获取房间的防截屏开关状态。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @returns 包含 `enabled` 字段的开关状态
     * @example
     * ```typescript
     * const { enabled } = await client.getRoomSummaryManager().getAntiScreenshot("!room:example.com");
     * ```
     */
    async getAntiScreenshot(roomId: string): Promise<{ enabled: boolean }> {
        return this.eventOps.getAntiScreenshot(roomId);
    }

    /**
     * 设置房间的防截屏开关。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param enabled - 是否启用防截屏
     * @returns 无返回值
     * @example
     * ```typescript
     * await client.getRoomSummaryManager().setAntiScreenshot("!room:example.com", true);
     * ```
     */
    async setAntiScreenshot(roomId: string, enabled: boolean): Promise<void> {
        return this.eventOps.setAntiScreenshot(roomId, enabled);
    }

    /**
     * 获取房间的置顶事件列表。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @returns 置顶事件列表
     * @example
     * ```typescript
     * const sticky = await client.getRoomSummaryManager().getStickyEvents("!room:example.com");
     * ```
     */
    async getStickyEvents(roomId: string): Promise<StickyEvent[]> {
        return this.eventOps.getStickyEvents(roomId);
    }

    /**
     * 设置一个房间置顶事件。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param eventType - 事件类型
     * @param content - 置顶事件内容
     * @returns 设置后的置顶事件
     * @example
     * ```typescript
     * const sticky = await client
     *     .getRoomSummaryManager()
     *     .setStickyEvent("!room:example.com", "m.room.topic", { topic: "Hello" });
     * ```
     */
    async setStickyEvent(roomId: string, eventType: string, content: RoomSummaryStateContent): Promise<StickyEvent> {
        return this.eventOps.setStickyEvent(roomId, eventType, content);
    }

    /**
     * 删除一个房间置顶事件。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @param eventType - 事件类型
     * @returns 无返回值
     * @example
     * ```typescript
     * await client.getRoomSummaryManager().deleteStickyEvent("!room:example.com", "m.room.topic");
     * ```
     */
    async deleteStickyEvent(roomId: string, eventType: string): Promise<void> {
        return this.eventOps.deleteStickyEvent(roomId, eventType);
    }

    /**
     * 获取房间的电源级别（权限级别）信息。
     *
     * 委托到 `eventOps` 子 Manager。
     *
     * @param roomId - 房间 ID
     * @returns 房间账户数据结果
     * @example
     * ```typescript
     * const levels = await client.getRoomSummaryManager().getRoomPowerLevels("!room:example.com");
     * ```
     */
    async getRoomPowerLevels(roomId: string): Promise<RoomAccountDataResult> {
        return this.eventOps.getRoomPowerLevels(roomId);
    }

    // ===== 生命周期 =====

    /**
     * 启动房间摘要 Manager。
     *
     * 执行必要的初始化逻辑（当前为空实现）。
     *
     * @returns 无返回值
     * @example
     * ```typescript
     * await client.getRoomSummaryManager().start();
     * ```
     */
    async start(): Promise<void> {
        // 初始化逻辑（如果需要）
    }

    /**
     * 停止房间摘要 Manager。
     *
     * 清空缓存并移除 `members`、`stats` 子 Manager 上注册的转发监听器，
     * 防止 `stop()` 后事件泄漏。
     *
     * @returns 无返回值
     * @example
     * ```typescript
     * client.getRoomSummaryManager().stop();
     * ```
     */
    stop(): void {
        this.clearCache();
        // 清理 forwardSubManagerEvents 注册的转发监听器，防止 stop() 后事件泄漏
        this.members.removeAllListeners();
        this.stats.removeAllListeners();
    }

    // ===== 私有辅助方法 =====

    private async requestV3<T>(method: Method, path: string, queryParams?: QueryDict, body?: Body): Promise<T> {
        return await this.request<T>({
            method: method,
            path: path,
            queryParams: queryParams,
            body: body,
            prefix: ClientPrefix.V3,
        });
    }

    private async requestInternal<T>(method: Method, path: string, queryParams?: QueryDict, body?: Body): Promise<T> {
        return await this.request<T>({
            method: method,
            path: path,
            queryParams: queryParams,
            body: body,
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
}

// Type declaration for MatrixClient extension

/**
 * 扩展 MatrixClient 原型
 */
export function extendMatrixClient(): void {
    if (typeof MatrixClient === "undefined") return;
    MatrixClient.prototype.getRoomSummaryManager = function (): RoomSummaryManager {
        registerManagerClass("roomSummary", RoomSummaryManager);
        return getOrCreateManager(this, "roomSummary", () => new RoomSummaryManager(this));
    };
}
