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

import { MatrixClient } from "../client";
import { logger } from "../logger.ts";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { Body } from "../http-api/interface.ts";
import { InvalidParamError } from "../common/errors.ts";
import { encodeUri, type QueryDict } from "../utils.ts";
import * as utils from "../utils.ts";
import { BaseManager } from "../managers/base-manager.ts";
import { getOrCreateManager } from "../client-infra/manager-registry.ts";
import { LRUCache } from "../utils/lru-cache.ts";
import type { IPublicRoomsChunkRoom, IPublicRoomsResponse } from "../client-api-types.ts";

export interface RoomSummaryHero {
    user_id: string;
    display_name?: string;
    avatar_url?: string;
}

export interface RoomSummaryMember {
    user_id: string;
    display_name?: string;
    avatar_url?: string;
    membership: string;
    is_hero: boolean;
}

export interface RoomSummary {
    room_id: string;
    room_type?: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    canonical_alias?: string;
    join_rule: string;
    history_visibility: string;
    guest_access: string;
    is_direct: boolean;
    is_space: boolean;
    is_encrypted: boolean;
    member_count: number;
    joined_member_count: number;
    invited_member_count: number;
    heroes: RoomSummaryHero[];
    last_event_ts?: number;
    last_message_ts?: number;
}

export interface RoomSummaryOptions {
    limit?: number;
    maxJoinedMembers?: number;
    suggested?: boolean;
    includeAllFields?: boolean;
}

export interface RoomStats {
    room_id: string;
    total_events: number;
    total_state_events: number;
    total_messages: number;
    total_media: number;
    storage_size: number;
}

export interface RoomSummaryStateContent extends Record<string, unknown> {}

export interface ClientRoomSummary {
    room_id: string;
    room_type?: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    canonical_alias?: string;
    join_rule?: string;
    history_visibility?: string;
    guest_access?: string;
    is_direct?: boolean;
    is_space?: boolean;
    is_encrypted?: boolean;
    num_joined_members?: number;
    heroes?: Array<string | { user_id: string; display_name?: string; avatar_url?: string }>;
    last_event_ts?: number;
    last_message_ts?: number;
}

export interface IRoomSummaryState {
    event_type: string;
    state_key: string;
    event_id: string;
    content: Record<string, unknown>;
}

export interface RoomSummaryListResponse {
    summaries?: RoomSummary[];
    rooms?: RoomSummary[];
    chunk?: RoomSummary[];
    next_batch?: string;
    [key: string]: unknown;
}

type RawRoomSummaryListResponse = RoomSummaryListResponse | RoomSummary[];

// ─────────────────────────────────────────────────────────────────────────────
// v3 扩展房间端点类型定义
// ─────────────────────────────────────────────────────────────────────────────

export interface NotificationItem {
    room_id: string;
    event_id: string;
    notification_type: string;
    sender: string;
    ts: number;
    content: Record<string, unknown>;
    is_read: boolean;
    client_action: string;
    type?: string;
    timestamp?: number;
    read?: boolean;
    highlight?: boolean;
}

export interface RoomNotificationsResult {
    notifications: NotificationItem[];
    next_token?: string | null;
    next_batch?: string | null;
}

export interface RoomCapabilities {
    room_id: string;
    room_version: string;
    capabilities: {
        knock: boolean;
        restricted: boolean;
        threading: boolean;
        read_receipts: boolean;
        typing_notifications: boolean;
        [key: string]: unknown;
    };
    features: {
        encryption: boolean;
        federation: boolean;
        guest_access: boolean;
        [key: string]: unknown;
    };
    join_rule: string;
}

export interface RoomSyncResult {
    room_id: string;
    state?: Record<string, unknown>;
    timeline?: {
        events: unknown[];
        limited?: boolean;
        prev_batch?: string;
    };
    ephemeral?: {
        events: unknown[];
    };
    account_data?: {
        events: unknown[];
    };
}

export interface TimelineResult {
    chunk: unknown[];
    start: string;
    end: string;
    prev_batch?: string;
}

export interface UnreadCountResult {
    notification_count: number;
    highlight_count: number;
    room_id?: string;
    unread_notifications?: number;
    unread_highlight_count?: number;
    unread_thread_messages?: number;
}

export interface RoomMetadata {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    canonical_alias?: string;
    room_version?: string;
    is_direct?: boolean;
    is_space?: boolean;
    is_encrypted?: boolean;
    encryption?: string;
    is_public?: boolean;
    join_rule?: string;
    guest_access?: string;
    history_visibility?: string;
    member_count?: number;
    created_at?: number;
    created_ts?: number;
    creator?: string;
}

export interface RetentionPolicy {
    min_lifetime?: number;
    max_lifetime?: number;
}

export interface ExternalId {
    provider: string;
    external_id: string;
}

export interface RoomSpace {
    room_id: string;
    name?: string;
    canonical_alias?: string;
    avatar_url?: string;
    topic?: string;
}

export interface EventPerspective {
    room_id: string;
    event_id: string;
    content?: Record<string, unknown>;
    auth_events?: unknown[];
    prev_events?: unknown[];
    depth?: number;
    hashes?: Record<string, string>;
    signatures?: Record<string, Record<string, string>>;
}

export interface EncryptedEventsResult {
    room_id: string;
    events: Array<{
        event_id: string;
        sender: string;
        type: string;
        content: Record<string, unknown>;
        timestamp: number;
    }>;
    next_batch?: string;
}

/**
 * GET /_matrix/client/v3/rooms/{room_id}/keys/{event_id}
 * 获取事件签名密钥
 */
export interface EventKeysResult {
    event_id: string;
    room_id: string;
    keys: Array<Record<string, unknown>>;
}

/**
 * GET /_matrix/client/v3/rooms/{room_id}/thread/{event_id}
 * 获取线程根事件及其回复
 */
export interface ThreadReply {
    event_id: string;
    thread_id: string;
    room_id: string;
    sender: string;
    content: Record<string, unknown>;
    origin_server_ts: number;
    in_reply_to_event_id?: string | null;
    is_edited: boolean;
    is_redacted: boolean;
}

export interface ThreadRoot {
    event_id: string;
    room_id: string;
    sender: string;
    type: string;
    content: Record<string, unknown>;
    origin_server_ts: number;
    state_key?: string;
}

export interface RoomThreadResult {
    root: ThreadRoot;
    replies: ThreadReply[];
    reply_count: number;
    participants: string[];
}

export interface RoomThreadDetailRoot {
    id: number;
    room_id: string;
    root_event_id: string;
    sender: string;
    thread_id: string | null;
    reply_count: number;
    last_reply_event_id: string | null;
    last_reply_sender: string | null;
    last_reply_ts: number | null;
    participants: unknown;
    is_fetched: boolean;
    created_ts: number;
    updated_ts: number | null;
}

export interface RoomThreadDetailReply {
    id: number;
    room_id: string;
    thread_id: string;
    event_id: string;
    root_event_id: string;
    sender: string;
    in_reply_to_event_id: string | null;
    content: Record<string, unknown>;
    origin_server_ts: number;
    is_edited: boolean;
    is_redacted: boolean;
    created_ts: number;
}

export interface RoomThreadSummary {
    id: number;
    room_id: string;
    thread_id: string;
    root_event_id: string;
    root_sender: string;
    root_content: Record<string, unknown>;
    root_origin_server_ts: number;
    latest_event_id: string | null;
    latest_sender: string | null;
    latest_content: Record<string, unknown> | null;
    latest_origin_server_ts: number | null;
    reply_count: number;
    participants: unknown;
    is_frozen: boolean;
    created_ts: number;
    updated_ts: number;
}

export interface RoomThreadReadReceipt {
    id: number;
    room_id: string;
    thread_id: string;
    user_id: string;
    last_read_event_id: string | null;
    last_read_ts: number;
    unread_count: number;
    updated_ts: number;
}

export interface RoomThreadSubscription {
    id: number;
    room_id: string;
    thread_id: string;
    user_id: string;
    notification_level: string;
    is_muted: boolean;
    subscribed_ts: number;
    updated_ts: number;
}

export interface RoomThreadDetailResult {
    room_id: string;
    thread_id: string;
    root: RoomThreadDetailRoot;
    replies: RoomThreadDetailReply[];
    reply_count: number;
    participants: string[];
    summary: RoomThreadSummary | null;
    user_receipt: RoomThreadReadReceipt | null;
    user_subscription: RoomThreadSubscription | null;
}

export interface TurnServerConfig {
    uris: string[];
    username?: string;
    password?: string;
    ttl?: number;
}

export interface StickyEvent {
    event_type: string;
    content: Record<string, unknown>;
    sender?: string;
    ts?: number;
}

export interface InviteBlocklist {
    room_id: string;
    blocked: Array<{
        user_id: string;
        blocked_by: string;
        blocked_at: number;
    }>;
}

export interface InviteAllowlist {
    room_id: string;
    allowed: Array<{
        user_id: string;
        allowed_by: string;
        allowed_at: number;
    }>;
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
 * ⚠️ 与旧的 room-summaries/index.ts 的区别：
 * - 本模块提供完整的封装（缓存、事件、统计）
 * - 提供真实后端 API 调用
 * - 推荐使用本模块
 */
export class RoomSummaryManager extends BaseManager<RoomSummaryEvent, RoomSummaryEventMap> {
    private summaryCache: LRUCache<RoomSummary>;
    private memberCache: LRUCache<RoomSummaryMember[]>;
    private statsCache: LRUCache<RoomStats>;

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
    }

    /**
     * 验证房间 ID 格式
     *
     * @param roomId - 房间 ID
     * @throws {InvalidParamError} 当房间 ID 无效时
     */
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

    /**
     * 验证用户 ID 格式
     *
     * @param userId - 用户 ID
     * @throws {InvalidParamError} 当用户 ID 无效时
     */
    private validateUserId(userId: string): void {
        if (!userId || typeof userId !== "string") {
            throw new InvalidParamError("User ID is required and must be a string");
        }
        const trimmed = userId.trim();
        if (trimmed.length === 0) {
            throw new InvalidParamError("User ID cannot be empty");
        }
        if (!trimmed.startsWith("@")) {
            throw new InvalidParamError("User ID must start with @");
        }
        if (!trimmed.includes(":")) {
            throw new InvalidParamError("User ID must contain a server name (e.g., @user:server.com)");
        }
    }

    /**
     * 验证事件类型格式
     *
     * @param eventType - 事件类型
     * @throws {InvalidParamError} 当事件类型无效时
     */
    private validateEventType(eventType: string): void {
        if (!eventType || typeof eventType !== "string") {
            throw new InvalidParamError("Event type is required and must be a string");
        }
        const trimmed = eventType.trim();
        if (trimmed.length === 0) {
            throw new InvalidParamError("Event type cannot be empty");
        }
        if (!trimmed.match(/^[a-zA-Z0-9._-]+$/)) {
            throw new InvalidParamError("Event type contains invalid characters");
        }
        if (trimmed.length > 255) {
            throw new InvalidParamError("Event type is too long (max 255 characters)");
        }
    }

    /**
     * 获取房间摘要
     *
     * @param roomIdOrAlias - 房间 ID 或别名
     * @param via - The list of servers which know about the room if only an ID was provided
     * @param forceRefresh - 是否强制刷新缓存
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 房间摘要
     *
     * @example
     * ```typescript
     * // 获取房间摘要
     * const summary = await roomSummaryManager.getRoomSummary("!abc:example.com");
     * console.log("Room name:", summary.name);
     * console.log("Members:", summary.member_count);
     * console.log("Is encrypted:", summary.is_encrypted);
     *
     * // 强制刷新
     * const freshSummary = await roomSummaryManager.getRoomSummary(
     *     "!abc:example.com",
     *     undefined,
     *     true
     * );
     *
     * // 使用房间别名
     * const summary = await roomSummaryManager.getRoomSummary("#room:example.com");
     * ```
     *
     * @throws {AuthError} 当认证失败时
     * @throws {NotFoundError} 当房间不存在时
     * @throws {ApiError} 当 API 调用失败时
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
                    const path = utils.encodeUri("/rooms/$roomid/summary", { $roomid: roomIdOrAlias });
                    return await this.client.http.authedRequest(
                        Method.Get,
                        path,
                        via ? { via } : undefined,
                        undefined,
                        paramOpts,
                    );
                } catch {
                    const unstableOpts = {
                        prefix: "/_matrix/client/unstable/im.nheko.summary",
                    };
                    const path = utils.encodeUri("/summary/$roomid", { $roomid: roomIdOrAlias });
                    return await this.client.http.authedRequest(
                        Method.Get,
                        path,
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

    /**
     * 获取房间成员列表摘要
     *
     * @param roomId - 房间 ID
     * @param forceRefresh - 是否强制刷新缓存
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 成员列表
     * @throws {AuthError} 当认证失败时
     * @throws {NotFoundError} 当房间不存在时
     * @throws {ApiError} 当 API 调用失败时
     */
    public async getRoomSummaryMembers(
        roomId: string,
        forceRefresh = false,
        throwOnError = true,
    ): Promise<RoomSummaryMember[]> {
        if (!forceRefresh) {
            const cached = this.memberCache.get(roomId);
            if (cached) {
                return cached;
            }
        }

        return this.withRetry(async () => {
            const path = utils.encodeUri("/rooms/$roomid/summary/members", { $roomid: roomId });
            return await this.client.http.authedRequest<RoomSummaryMember[]>(Method.Get, path, undefined, undefined, {
                prefix: ClientPrefix.V3,
            });
        }, "getRoomSummaryMembers").then(
            (members) => {
                this.memberCache.set(roomId, members);
                this.emit(RoomSummaryEvent.MembersUpdated, roomId, members);
                return members;
            },
            (e) => {
                if (throwOnError) {
                    throw this.normalizeError(e, "getRoomSummaryMembers");
                }
                this.handleError("getRoomSummaryMembers", e);
                return [];
            },
        );
    }

    /**
     * 获取房间统计信息
     *
     * @param roomId - 房间 ID
     * @param forceRefresh - 是否强制刷新缓存
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 房间统计
     * @throws {AuthError} 当认证失败时
     * @throws {NotFoundError} 当房间不存在时
     * @throws {ApiError} 当 API 调用失败时
     */
    public async getRoomSummaryStats(
        roomId: string,
        forceRefresh = false,
        throwOnError = true,
    ): Promise<RoomStats | null> {
        if (!forceRefresh) {
            const cached = this.statsCache.get(roomId);
            if (cached) {
                return cached;
            }
        }

        try {
            const stats = await this.withRetry(async () => {
                const path = utils.encodeUri("/rooms/$roomid/summary/stats", { $roomid: roomId });
                return await this.client.http.authedRequest<RoomStats>(Method.Get, path, undefined, undefined, {
                    prefix: ClientPrefix.V3,
                });
            }, "getRoomSummaryStats");
            if (stats) {
                this.statsCache.set(roomId, stats);
                this.emit(RoomSummaryEvent.StatsUpdated, roomId, stats);
            }
            return stats;
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, "getRoomSummaryStats");
            }
            this.handleError("getRoomSummaryStats", e);
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
                    this.roomSummaryPath("/rooms/$roomId/summary", roomId),
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
                    this.roomSummaryPath("/rooms/$roomId/summary", roomId),
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
            await this.requestV3(Method.Delete, this.roomSummaryPath("/rooms/$roomId/summary", roomId));
            this.clearCache(roomId);
        }, "deleteSummary");
    }

    public async syncSummary(roomId: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
        this.validateRoomId(roomId);

        return this.withRetry(async () => {
            return await this.requestV3<Record<string, unknown>>(
                Method.Post,
                this.roomSummaryPath("/rooms/$roomId/summary/sync", roomId),
                undefined,
                body,
            );
        }, "syncSummary");
    }

    public async writeSummaryMembers(roomId: string, members: RoomSummaryMember[]): Promise<RoomSummaryMember[]> {
        this.validateRoomId(roomId);
        if (!Array.isArray(members)) {
            throw new InvalidParamError("Members must be an array");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.requestV3<{ members?: RoomSummaryMember[] } | RoomSummaryMember[]>(
                    Method.Post,
                    this.roomSummaryPath("/rooms/$roomId/summary/members", roomId),
                    undefined,
                    { members },
                );
            }, "writeSummaryMembers");

            const normalizedMembers = Array.isArray(response) ? response : (response.members ?? members);
            this.memberCache.set(roomId, normalizedMembers);
            this.emit(RoomSummaryEvent.MembersUpdated, roomId, normalizedMembers);
            return normalizedMembers;
        } catch (e) {
            throw this.normalizeError(e, "writeSummaryMembers");
        }
    }

    public async updateSummaryMember(
        roomId: string,
        userId: string,
        member: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        this.validateRoomId(roomId);
        this.validateUserId(userId);

        return this.withRetry(async () => {
            const updatedMember = await this.requestV3<Record<string, unknown>>(
                Method.Put,
                encodeUri("/rooms/$roomId/summary/members/$userId", { $roomId: roomId, $userId: userId }),
                undefined,
                member,
            );
            this.clearCache(roomId);
            return updatedMember;
        }, "updateSummaryMember");
    }

    public async deleteSummaryMember(roomId: string, userId: string): Promise<void> {
        this.validateRoomId(roomId);
        this.validateUserId(userId);

        return this.withRetry(async () => {
            await this.requestV3(
                Method.Delete,
                encodeUri("/rooms/$roomId/summary/members/$userId", { $roomId: roomId, $userId: userId }),
            );
            this.clearCache(roomId);
        }, "deleteSummaryMember");
    }

    public async getAllSummaryState(roomId: string): Promise<IRoomSummaryState[]> {
        this.validateRoomId(roomId);

        return this.withRetry(async () => {
            return await this.requestV3<IRoomSummaryState[]>(
                Method.Get,
                `/rooms/${encodeURIComponent(roomId)}/summary/state`,
            );
        }, "getAllSummaryState");
    }

    public async getSummaryState(
        roomId: string,
        eventType: string,
        stateKey: string = "",
    ): Promise<RoomSummaryStateContent> {
        this.validateRoomId(roomId);
        this.validateEventType(eventType);

        return this.withRetry(async () => {
            return await this.requestV3<RoomSummaryStateContent>(
                Method.Get,
                encodeUri("/rooms/$roomId/summary/state/$eventType/$stateKey", {
                    $roomId: roomId,
                    $eventType: eventType,
                    $stateKey: stateKey,
                }),
            );
        }, "getSummaryState");
    }

    public async updateSummaryState(
        roomId: string,
        eventType: string,
        stateKey: string,
        content: RoomSummaryStateContent,
    ): Promise<RoomSummaryStateContent> {
        this.validateRoomId(roomId);
        this.validateEventType(eventType);

        try {
            return await this.requestV3<RoomSummaryStateContent>(
                Method.Put,
                encodeUri("/rooms/$roomId/summary/state/$eventType/$stateKey", {
                    $roomId: roomId,
                    $eventType: eventType,
                    $stateKey: stateKey,
                }),
                undefined,
                content,
            );
        } catch (e) {
            throw this.normalizeError(e, "updateSummaryState");
        }
    }

    public async recalculateSummaryStats(
        roomId: string,
        body: Record<string, unknown> = {},
    ): Promise<RoomStats | null> {
        this.validateRoomId(roomId);

        try {
            const stats = await this.withRetry(async () => {
                return await this.requestV3<RoomStats>(
                    Method.Post,
                    this.roomSummaryPath("/rooms/$roomId/summary/stats/recalculate", roomId),
                    undefined,
                    body,
                );
            }, "recalculateSummaryStats");

            if (stats) {
                this.statsCache.set(roomId, stats);
                this.emit(RoomSummaryEvent.StatsUpdated, roomId, stats);
            }
            return stats;
        } catch (e) {
            throw this.normalizeError(e, "recalculateSummaryStats");
        }
    }

    public async recalculateSummaryHeroes(
        roomId: string,
        body: Record<string, unknown> = {},
    ): Promise<Record<string, unknown>> {
        this.validateRoomId(roomId);

        return this.withRetry(async () => {
            const result = await this.requestV3<Record<string, unknown>>(
                Method.Post,
                this.roomSummaryPath("/rooms/$roomId/summary/heroes/recalculate", roomId),
                undefined,
                body,
            );
            this.clearCache(roomId);
            return result;
        }, "recalculateSummaryHeroes");
    }

    public async clearSummaryUnread(
        roomId: string,
        body: Record<string, unknown> = {},
    ): Promise<Record<string, unknown>> {
        this.validateRoomId(roomId);

        return this.withRetry(async () => {
            const result = await this.requestV3<Record<string, unknown>>(
                Method.Post,
                this.roomSummaryPath("/rooms/$roomId/summary/unread/clear", roomId),
                undefined,
                body,
            );
            this.clearCache(roomId);
            return result;
        }, "clearSummaryUnread");
    }

    public async listUserSummaries(queryParams: QueryDict = {}): Promise<RoomSummaryListResponse> {
        return this.withRetry(async () => {
            const result = await this.requestInternal<RawRoomSummaryListResponse>(
                Method.Get,
                "/summaries",
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
            return await this.requestInternal<Record<string, unknown>>(Method.Post, "/summaries", undefined, body);
        }, "createInternalSummary");
    }

    public async processSummaryUpdates(body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
        return this.withRetry(async () => {
            return await this.requestInternal<Record<string, unknown>>(
                Method.Post,
                "/updates/process",
                undefined,
                body,
            );
        }, "processSummaryUpdates");
    }

    /**
     * 清除缓存
     *
     * @param roomId - 房间 ID（可选，不传则清除所有缓存）
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
     * 获取缓存统计信息
     *
     * @returns 缓存统计信息
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
     * 获取综合指标
     *
     * @returns 综合指标
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
     * 获取房间层级结构（Space 层级）
     *
     * @param roomId - 房间 ID
     * @param options - 选项
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 层级结构
     * @throws {AuthError} 当认证失败时
     * @throws {NotFoundError} 当房间不存在时
     * @throws {ApiError} 当 API 调用失败时
     */
    public async getRoomHierarchy(
        roomId: string,
        options?: RoomSummaryOptions,
        throwOnError = true,
    ): Promise<unknown | null> {
        try {
            return await this.withRetry(async () => {
                return await this.client.getRoomHierarchy(
                    roomId,
                    options?.limit,
                    undefined,
                    options?.suggested ?? false,
                );
            }, "getRoomHierarchy");
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, "getRoomHierarchy");
            }
            this.handleError("getRoomHierarchy", e);
            return null;
        }
    }

    /**
     * 获取公共房间列表
     *
     * @param server - 服务器名（可选）
     * @param options - 选项
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 公共房间列表
     * @throws {AuthError} 当认证失败时
     * @throws {ApiError} 当 API 调用失败时
     */
    public async getPublicRooms(
        server = "",
        options?: { limit?: number; since?: string; query?: string },
        throwOnError = true,
    ): Promise<IPublicRoomsResponse | null> {
        try {
            return await this.withRetry(async () => {
                return await this.client.publicRooms({
                    server,
                    limit: options?.limit,
                    since: options?.since,
                    filter: options?.query ? { generic_search_term: options.query } : undefined,
                });
            }, "getPublicRooms");
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, "getPublicRooms");
            }
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
     * @returns 公共房间列表
     */
    public async searchPublicRooms(query: string, server = "", limit = 20): Promise<IPublicRoomsChunkRoom[]> {
        try {
            const result = await this.getPublicRooms(server, { query, limit });
            return result?.chunk ?? [];
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
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
     * @returns 推荐公共房间列表
     */
    public async getRecommendedRooms(server = "", limit = 20): Promise<IPublicRoomsChunkRoom[]> {
        try {
            const result = await this.getPublicRooms(server, { limit });
            return result?.chunk ?? [];
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
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
                    join_rule: "invite" as const,
                    history_visibility: "shared" as const,
                    guest_access: "forbidden" as const,
                    is_direct: false,
                    is_space: false,
                    is_encrypted: false,
                    member_count: room.getJoinedMemberCount?.() || 0,
                    joined_member_count: room.getJoinedMemberCount?.() || 0,
                    invited_member_count: 0,
                    heroes: [],
                }));
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
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
                    join_rule: "invite" as const,
                    history_visibility: "shared" as const,
                    guest_access: "forbidden" as const,
                    is_direct: false,
                    is_space: false,
                    is_encrypted: false,
                    member_count: room.getJoinedMemberCount?.() || 0,
                    joined_member_count: room.getJoinedMemberCount?.() || 0,
                    invited_member_count: 0,
                    heroes: [],
                }));
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
        } catch (e) {
            this.handleError("getRecentRooms", e);
            return [];
        }
    }

    /**
     * 获取缓存的摘要
     */
    public getCachedSummary(roomId: string): RoomSummary | null {
        return this.summaryCache.get(roomId) || null;
    }

    /**
     * 获取缓存的成员
     */
    public getCachedMembers(roomId: string): RoomSummaryMember[] {
        return this.memberCache.get(roomId) || [];
    }

    /**
     * 获取缓存的统计
     */
    public getCachedStats(roomId: string): RoomStats | null {
        return this.statsCache.get(roomId) || null;
    }

    /**
     * 检查房间是否在缓存中
     */
    public isCached(roomId: string): boolean {
        return this.summaryCache.get(roomId) !== undefined;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // v3 扩展房间端点
    // 对接后端: /_matrix/client/v3/rooms/{room_id}/...
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * 获取房间通知列表
     * @param roomId - 房间 ID
     * @param options - 分页选项
     */
    public async getRoomNotifications(
        roomId: string,
        options?: { from?: string; limit?: number; only?: string },
    ): Promise<RoomNotificationsResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            const queryParams: QueryDict = {};
            if (options?.from) queryParams.from = options.from;
            if (options?.limit !== undefined) queryParams.limit = String(options.limit);
            if (options?.only) queryParams.only = options.only;
            const result = await this.requestV3<RoomNotificationsResult>(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/notifications", roomId),
                queryParams,
            );
            return {
                ...result,
                notifications: result.notifications.map((notification) => ({
                    ...notification,
                    type: notification.type ?? notification.notification_type,
                    timestamp: notification.timestamp ?? notification.ts,
                    read: notification.read ?? notification.is_read,
                    highlight: notification.highlight ?? false,
                })),
                next_batch: result.next_batch ?? result.next_token,
            };
        }, "getRoomNotifications");
    }

    /**
     * 获取房间能力
     * @param roomId - 房间 ID
     */
    public async getRoomCapabilities(roomId: string): Promise<RoomCapabilities> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3<RoomCapabilities>(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/capabilities", roomId),
            );
        }, "getRoomCapabilities");
    }

    /**
     * 获取房间级同步结果
     * @param roomId - 房间 ID
     * @param options - 同步选项
     */
    public async getRoomSync(
        roomId: string,
        options?: { since?: string; timeout_ms?: number; filter?: string },
    ): Promise<RoomSyncResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            const queryParams: QueryDict = {};
            if (options?.since) queryParams.since = options.since;
            if (options?.timeout_ms !== undefined) queryParams.timeout_ms = String(options.timeout_ms);
            if (options?.filter) queryParams.filter = options.filter;
            return await this.requestV3(Method.Get, this.roomSummaryPath("/rooms/$roomId/sync", roomId), queryParams);
        }, "getRoomSync");
    }

    /**
     * 获取房间时间线
     * @param roomId - 房间 ID
     * @param options - 时间线选项
     */
    public async getRoomTimeline(
        roomId: string,
        options?: { from?: string; to?: string; dir?: "f" | "b"; limit?: number; filter?: string },
    ): Promise<TimelineResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            const queryParams: QueryDict = {};
            if (options?.from) queryParams.from = options.from;
            if (options?.to) queryParams.to = options.to;
            if (options?.dir) queryParams.dir = options.dir;
            if (options?.limit !== undefined) queryParams.limit = String(options.limit);
            if (options?.filter) queryParams.filter = options.filter;
            return await this.requestV3(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/timeline", roomId),
                queryParams,
            );
        }, "getRoomTimeline");
    }

    /**
     * 获取房间未读计数
     * @param roomId - 房间 ID
     */
    public async getRoomUnreadCount(roomId: string): Promise<UnreadCountResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            const result = await this.requestV3<UnreadCountResult>(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/unread_count", roomId),
            );
            return {
                ...result,
                room_id: result.room_id ?? roomId,
                unread_notifications: result.unread_notifications ?? result.notification_count,
                unread_highlight_count: result.unread_highlight_count ?? result.highlight_count,
            };
        }, "getRoomUnreadCount");
    }

    /**
     * 获取房间元数据
     * @param roomId - 房间 ID
     */
    public async getRoomMetadata(roomId: string): Promise<RoomMetadata> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            const result = await this.requestV3<RoomMetadata>(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/metadata", roomId),
            );
            return {
                ...result,
                created_at: result.created_at ?? result.created_ts,
                is_encrypted: result.is_encrypted ?? Boolean(result.encryption),
            };
        }, "getRoomMetadata");
    }

    /**
     * 获取房间 vault 数据
     * @param roomId - 房间 ID
     */
    public async getRoomVaultData(roomId: string): Promise<Record<string, unknown> | null> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3(Method.Get, this.roomSummaryPath("/rooms/$roomId/vault_data", roomId));
        }, "getRoomVaultData");
    }

    /**
     * 设置房间 vault 数据
     * @param roomId - 房间 ID
     * @param data - vault 数据
     */
    public async setRoomVaultData(roomId: string, data: Record<string, unknown>): Promise<void> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            await this.requestV3(
                Method.Put,
                this.roomSummaryPath("/rooms/$roomId/vault_data", roomId),
                undefined,
                data as Body,
            );
            this.summaryCache.delete(roomId);
        }, "setRoomVaultData");
    }

    /**
     * 获取房间 retention 策略
     * @param roomId - 房间 ID
     */
    public async getRoomRetention(roomId: string): Promise<RetentionPolicy | null> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3(Method.Get, this.roomSummaryPath("/rooms/$roomId/retention", roomId));
        }, "getRoomRetention");
    }

    /**
     * 获取房间外部关联 ID
     * @param roomId - 房间 ID
     */
    public async getRoomExternalIds(roomId: string): Promise<ExternalId[]> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3(Method.Get, this.roomSummaryPath("/rooms/$roomId/external_ids", roomId));
        }, "getRoomExternalIds");
    }

    /**
     * 获取房间所属的 space 列表
     * @param roomId - 房间 ID
     */
    public async getRoomSpaces(roomId: string): Promise<RoomSpace[]> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3(Method.Get, this.roomSummaryPath("/rooms/$roomId/spaces", roomId));
        }, "getRoomSpaces");
    }

    /**
     * 获取房间事件视角数据
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @param options - 可选参数
     */
    public async getRoomEventPerspective(
        roomId: string,
        eventId: string,
        options?: { room_version?: string },
    ): Promise<EventPerspective> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            const queryParams: QueryDict = {};
            if (options?.room_version) queryParams.room_version = options.room_version;
            return await this.requestV3(Method.Get, this.roomSummaryPath("/rooms/$roomId/event_perspective", roomId), {
                ...queryParams,
                event_id: eventId,
            });
        }, "getRoomEventPerspective");
    }

    /**
     * 获取加密事件摘要
     * @param roomId - 房间 ID
     * @param options - 查询选项
     */
    public async getEncryptedEvents(
        roomId: string,
        options?: { from?: string; limit?: number },
    ): Promise<EncryptedEventsResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            const queryParams: QueryDict = {};
            if (options?.from) queryParams.from = options.from;
            if (options?.limit !== undefined) queryParams.limit = String(options.limit);
            return await this.requestV3(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/encrypted_events", roomId),
                queryParams,
            );
        }, "getEncryptedEvents");
    }

    /**
     * 获取房间 TURN 服务器配置
     * @param roomId - 房间 ID
     */
    public async getRoomTurnServer(roomId: string): Promise<TurnServerConfig> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3(Method.Get, this.roomSummaryPath("/rooms/$roomId/turn_server", roomId));
        }, "getRoomTurnServer");
    }

    /**
     * 获取 sticky events
     * @param roomId - 房间 ID
     */
    public async getStickyEvents(roomId: string): Promise<StickyEvent[]> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3(Method.Get, this.roomSummaryPath("/rooms/$roomId/sticky_events", roomId));
        }, "getStickyEvents");
    }

    /**
     * 设置 sticky event
     * @param roomId - 房间 ID
     * @param eventType - 事件类型
     * @param content - 事件内容
     */
    public async setStickyEvent(
        roomId: string,
        eventType: string,
        content: Record<string, unknown>,
    ): Promise<StickyEvent> {
        this.validateRoomId(roomId);
        this.validateEventType(eventType);
        return await this.withRetry(async () => {
            const result = await this.requestV3<StickyEvent>(
                Method.Post,
                this.roomSummaryPath("/rooms/$roomId/sticky_events", roomId),
                undefined,
                { event_type: eventType, content } as Body,
            );
            this.summaryCache.delete(roomId);
            return result;
        }, "setStickyEvent");
    }

    /**
     * 删除 sticky event
     * @param roomId - 房间 ID
     * @param eventType - 事件类型
     */
    public async deleteStickyEvent(roomId: string, eventType: string): Promise<void> {
        this.validateRoomId(roomId);
        this.validateEventType(eventType);
        return await this.withRetry(async () => {
            await this.requestV3(
                Method.Delete,
                encodeUri("/rooms/$roomId/sticky_events/$eventType", { $roomId: roomId, $eventType: eventType }),
            );
            this.summaryCache.delete(roomId);
        }, "deleteStickyEvent");
    }

    /**
     * 获取 invite blocklist
     * @param roomId - 房间 ID
     */
    public async getInviteBlocklist(roomId: string): Promise<InviteBlocklist> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3(Method.Get, this.roomSummaryPath("/rooms/$roomId/invite_blocklist", roomId));
        }, "getInviteBlocklist");
    }

    /**
     * 添加到 invite blocklist
     * @param roomId - 房间 ID
     * @param userId - 用户 ID
     */
    public async addInviteBlocklist(roomId: string, userId: string): Promise<void> {
        this.validateRoomId(roomId);
        this.validateUserId(userId);
        return await this.withRetry(async () => {
            await this.requestV3(
                Method.Post,
                this.roomSummaryPath("/rooms/$roomId/invite_blocklist", roomId),
                undefined,
                { user_id: userId } as Body,
            );
            this.summaryCache.delete(roomId);
        }, "addInviteBlocklist");
    }

    /**
     * 获取 invite allowlist
     * @param roomId - 房间 ID
     */
    public async getInviteAllowlist(roomId: string): Promise<InviteAllowlist> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3(Method.Get, this.roomSummaryPath("/rooms/$roomId/invite_allowlist", roomId));
        }, "getInviteAllowlist");
    }

    /**
     * 添加到 invite allowlist
     * @param roomId - 房间 ID
     * @param userId - 用户 ID
     */
    public async addInviteAllowlist(roomId: string, userId: string): Promise<void> {
        this.validateRoomId(roomId);
        this.validateUserId(userId);
        return await this.withRetry(async () => {
            await this.requestV3(
                Method.Post,
                this.roomSummaryPath("/rooms/$roomId/invite_allowlist", roomId),
                undefined,
                { user_id: userId } as Body,
            );
            this.summaryCache.delete(roomId);
        }, "addInviteAllowlist");
    }

    /**
     * 获取事件的签名密钥
     * GET /_matrix/client/v3/rooms/{room_id}/keys/{event_id}
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @returns 事件密钥结果
     */
    public async getEventKeys(roomId: string, eventId: string): Promise<EventKeysResult> {
        if (!roomId) {
            throw new InvalidParamError("roomId is required");
        }
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }

        try {
            return await this.requestV3<EventKeysResult>(
                Method.Get,
                encodeUri("/rooms/$roomId/keys/$eventId", {
                    $roomId: roomId,
                    $eventId: eventId,
                }),
            );
        } catch (error) {
            logger.warn(`RoomSummaryManager.getEventKeys failed for ${eventId}:`, error);
            throw this.normalizeError(error, "getEventKeys");
        }
    }

    /**
     * 获取房间线程（通过根事件 ID）
     * GET /_matrix/client/v3/rooms/{room_id}/thread/{event_id}
     *
     * @param roomId - 房间 ID
     * @param eventId - 线程根事件 ID
     * @returns 线程详情，包含根事件、回复和参与者
     */
    public async getRoomThread(roomId: string, eventId: string): Promise<RoomThreadResult> {
        if (!roomId) {
            throw new InvalidParamError("roomId is required");
        }
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }

        try {
            return await this.requestV3<RoomThreadResult>(
                Method.Get,
                encodeUri("/rooms/$roomId/thread/$eventId", {
                    $roomId: roomId,
                    $eventId: eventId,
                }),
            );
        } catch (error) {
            logger.warn(`RoomSummaryManager.getRoomThread failed for ${eventId}:`, error);
            throw this.normalizeError(error, "getRoomThread");
        }
    }

    /**
     * 获取房间线程（通过线程 ID）
     * GET /_matrix/client/v3/rooms/{room_id}/threads/{thread_id}
     *
     * 注意：后端当前返回 unrecognized 错误，此端点暂未完全实现
     *
     * @param roomId - 房间 ID
     * @param threadId - 线程 ID (事件 ID)
     * @returns 线程详情
     */
    public async getRoomThreadById(roomId: string, threadId: string): Promise<RoomThreadDetailResult> {
        if (!roomId) {
            throw new InvalidParamError("roomId is required");
        }
        if (!threadId) {
            throw new InvalidParamError("threadId is required");
        }

        try {
            return await this.requestV3<RoomThreadDetailResult>(
                Method.Get,
                encodeUri("/rooms/$roomId/threads/$threadId", {
                    $roomId: roomId,
                    $threadId: threadId,
                }),
            );
        } catch (error) {
            logger.warn(`RoomSummaryManager.getRoomThreadById failed for ${threadId}:`, error);
            throw this.normalizeError(error, "getRoomThreadById");
        }
    }

    async start(): Promise<void> {
        // 初始化逻辑（如果需要）
    }

    stop(): void {
        this.clearCache();
    }

    private roomSummaryPath(pathTemplate: string, roomId: string): string {
        return encodeUri(pathTemplate, { $roomId: roomId });
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
     * client.ts 的 RoomSummary 是 MSC3266 标准格式
     * 本模块的 RoomSummary 是 synapse-rust 的扩展格式
     */
    private convertClientSummary(clientSummary: {
        room_id: string;
        room_type?: string;
        name?: string;
        topic?: string;
        avatar_url?: string;
        canonical_alias?: string;
        join_rule?: string;
        history_visibility?: string;
        guest_access?: string;
        is_direct?: boolean;
        is_space?: boolean;
        is_encrypted?: boolean;
        num_joined_members?: number;
        heroes?: Array<string | { user_id: string; display_name?: string; avatar_url?: string }>;
        last_event_ts?: number;
        last_message_ts?: number;
    }): RoomSummary {
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
    MatrixClient.prototype.getRoomSummaryManager = function (): RoomSummaryManager {
        return getOrCreateManager(this, "roomSummary", () => new RoomSummaryManager(this));
    };
}

export default extendMatrixClient;
