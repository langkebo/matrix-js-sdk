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
import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { logger } from "../logger.ts";
import { MatrixError } from "../http-api/errors.ts";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { Body } from "../http-api/interface.ts";
import { AuthError, NotFoundError, RetryableError, ApiError, SdkError } from "../errors.ts";
import { InvalidParamError } from "../common/errors.ts";
import { encodeUri, type QueryDict } from "../utils.ts";
import * as utils from "../utils.ts";

interface CacheEntry<T> {
    value: T;
    timestamp: number;
}

class LRUCache<T> {
    private cache = new Map<string, CacheEntry<T>>();
    private readonly maxSize: number;
    private readonly ttl: number;
    private hits = 0;
    private misses = 0;

    constructor(maxSize: number, ttl: number) {
        this.maxSize = maxSize;
        this.ttl = ttl;
    }

    get(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) {
            this.misses++;
            return undefined;
        }

        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            this.misses++;
            return undefined;
        }

        this.hits++;
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.value;
    }

    set(key: string, value: T): void {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }

        this.cache.set(key, {
            value,
            timestamp: Date.now(),
        });
    }

    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    clear(): void {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }

    size(): number {
        return this.cache.size;
    }

    getStats(): { size: number; hits: number; misses: number; hitRate: number } {
        const total = this.hits + this.misses;
        return {
            size: this.cache.size,
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? this.hits / total : 0,
        };
    }
}

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
export class RoomSummaryManager extends TypedEventEmitter<RoomSummaryEvent, RoomSummaryEventMap> {
    private client: MatrixClient;
    private summaryCache: LRUCache<RoomSummary>;
    private memberCache: LRUCache<RoomSummaryMember[]>;
    private statsCache: LRUCache<RoomStats>;
    private readonly maxRetries = 3;
    private readonly retryDelay = 1000; // 1 秒

    public constructor(client: MatrixClient) {
        super();
        this.client = client;
        
        this.summaryCache = new LRUCache<RoomSummary>(1000, 5 * 60 * 1000);
        this.memberCache = new LRUCache<RoomSummaryMember[]>(500, 5 * 60 * 1000);
        this.statsCache = new LRUCache<RoomStats>(500, 10 * 60 * 1000);
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

    private requestStats = {
        total: 0,
        successful: 0,
        failed: 0,
        retried: 0,
    };

    private recordRequest(success: boolean, retried = false): void {
        this.requestStats.total++;
        if (success) {
            this.requestStats.successful++;
        } else {
            this.requestStats.failed++;
        }
        if (retried) {
            this.requestStats.retried++;
        }
    }

    public getRequestStats(): typeof this.requestStats {
        return { ...this.requestStats };
    }

    public resetRequestStats(): void {
        this.requestStats = {
            total: 0,
            successful: 0,
            failed: 0,
            retried: 0,
        };
    }

    /**
     * 带重试的请求封装
     * 
     * @param requestFn - 请求函数
     * @param method - 方法名（用于错误信息和监控）
     * @param retries - 重试次数
     * @returns 请求结果
     */
    private async withRetry<T>(
        requestFn: () => Promise<T>,
        method: string,
        retries = this.maxRetries
    ): Promise<T> {
        let lastError: unknown;
        const startTime = Date.now();
        
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const result = await requestFn();
                this.recordRequest(true, attempt > 0);
                
                if (attempt > 0) {
                    logger.info(`RoomSummaryManager.${method} succeeded after ${attempt} retries`, {
                        method,
                        attempts: attempt + 1,
                        duration: Date.now() - startTime,
                    });
                }
                
                return result;
            } catch (error: unknown) {
                lastError = error;
                
                if (!this.isRetryableError(error)) {
                    this.recordRequest(false, false);
                    this.emitMetric('api_error', method, { 
                        error: this.getErrorType(error),
                        attempt: attempt + 1,
                        retryable: false 
                    });
                    throw this.normalizeError(error, method);
                }
                
                if (attempt < retries) {
                    const delay = this.retryDelay * Math.pow(2, attempt);
                    logger.warn(`RoomSummaryManager.${method} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms`, {
                        method,
                        attempt: attempt + 1,
                        maxAttempts: retries + 1,
                        delay,
                        error: this.getErrorType(error),
                    });
                    
                    this.emitMetric('api_retry', method, { 
                        attempt: attempt + 1,
                        delay,
                        error: this.getErrorType(error)
                    });
                    
                    await this.sleep(delay);
                }
            }
        }
        
        this.recordRequest(false, true);
        const duration = Date.now() - startTime;
        this.emitMetric('api_failure', method, { 
            attempts: retries + 1,
            duration,
            error: this.getErrorType(lastError)
        });
        
        throw this.normalizeError(lastError, method);
    }

    /**
     * 发送监控指标
     * 
     * @param type - 指标类型
     * @param method - 方法名
     * @param data - 指标数据
     */
    private emitMetric(type: string, method: string, data: Record<string, unknown>): void {
        try {
            this.emit(RoomSummaryEvent.Error, new Error(`Metric: ${type}.${method}`));
            logger.debug(`Metric: ${type}.${method}`, { type, method, ...data, timestamp: Date.now() });
        } catch {
            // 忽略监控发送错误，不影响主流程
        }
    }

    /**
     * 获取错误类型
     * 
     * @param error - 错误对象
     * @returns 错误类型字符串
     */
    private getErrorType(error: unknown): string {
        if (error instanceof MatrixError) {
            return error.errcode || `http_${error.httpStatus}`;
        }
        if (error instanceof Error) {
            return error.name || 'UnknownError';
        }
        return 'UnknownError';
    }

    /**
     * 延迟函数
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 获取房间摘要
     *
     * @param roomIdOrAlias - 房间 ID 或别名
     * @param via - The list of servers which know about the room if only an ID was provided
     * @param forceRefresh - 是否强制刷新缓存
     * @param throwOnError - 是否抛出错误（默认 false，向后兼容）
     * @returns 房间摘要
     * @throws {AuthError} 当认证失败时
     * @throws {NotFoundError} 当房间不存在时
     * @throws {ApiError} 当 API 调用失败时
     */
    public async getRoomSummary(
        roomIdOrAlias: string,
        via?: string[],
        forceRefresh = false,
        throwOnError = false
    ): Promise<RoomSummary | null> {
        if (!forceRefresh) {
            const cached = this.summaryCache.get(roomIdOrAlias);
            if (cached) {
                return cached;
            }
        }

        try {
            // Direct API call instead of using deleted client method
            const paramOpts = {
                prefix: ClientPrefix.V3,
            };
            let clientSummary;
            try {
                const path = utils.encodeUri("/rooms/$roomid/summary", { $roomid: roomIdOrAlias });
                clientSummary = await this.client.http.authedRequest(Method.Get, path, via ? { via } : undefined, undefined, paramOpts);
            } catch (e) {
                // Try unstable endpoint as fallback
                const unstableOpts = {
                    prefix: "/_matrix/client/unstable/im.nheko.summary",
                };
                const path = utils.encodeUri("/summary/$roomid", { $roomid: roomIdOrAlias });
                clientSummary = await this.client.http.authedRequest(Method.Get, path, via ? { via } : undefined, undefined, unstableOpts);
            }

            const summary = this.convertClientSummary(clientSummary as Parameters<typeof this.convertClientSummary>[0]);
            this.summaryCache.set(roomIdOrAlias, summary);
            this.emit(RoomSummaryEvent.Updated, roomIdOrAlias, summary);
            return summary;
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, 'getRoomSummary');
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
     * @param throwOnError - 是否抛出错误（默认 false，向后兼容）
     * @returns 成员列表
     * @throws {AuthError} 当认证失败时
     * @throws {NotFoundError} 当房间不存在时
     * @throws {ApiError} 当 API 调用失败时
     */
    public async getRoomSummaryMembers(
        roomId: string, 
        forceRefresh = false,
        throwOnError = false
    ): Promise<RoomSummaryMember[]> {
        if (!forceRefresh) {
            const cached = this.memberCache.get(roomId);
            if (cached) {
                return cached;
            }
        }

        try {
            // Direct API call instead of using deleted client method
            const path = utils.encodeUri("/rooms/$roomid/summary/members", { $roomid: roomId });
            const members = await this.client.http.authedRequest<RoomSummaryMember[]>(Method.Get, path, undefined, undefined, {
                prefix: ClientPrefix.V3,
            });
            this.memberCache.set(roomId, members);
            this.emit(RoomSummaryEvent.MembersUpdated, roomId, members);
            return members;
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, 'getRoomSummaryMembers');
            }
            this.handleError("getRoomSummaryMembers", e);
            return [];
        }
    }

    /**
     * 获取房间统计信息
     * 
     * @param roomId - 房间 ID
     * @param forceRefresh - 是否强制刷新缓存
     * @param throwOnError - 是否抛出错误（默认 false，向后兼容）
     * @returns 房间统计
     * @throws {AuthError} 当认证失败时
     * @throws {NotFoundError} 当房间不存在时
     * @throws {ApiError} 当 API 调用失败时
     */
    public async getRoomSummaryStats(
        roomId: string, 
        forceRefresh = false,
        throwOnError = false
    ): Promise<RoomStats | null> {
        if (!forceRefresh) {
            const cached = this.statsCache.get(roomId);
            if (cached) {
                return cached;
            }
        }

        try {
            // Direct API call instead of using deleted client method
            const path = utils.encodeUri("/rooms/$roomid/summary/stats", { $roomid: roomId });
            const stats = await this.client.http.authedRequest<RoomStats>(Method.Get, path, undefined, undefined, {
                prefix: ClientPrefix.V3,
            });
            if (stats) {
                this.statsCache.set(roomId, stats);
                this.emit(RoomSummaryEvent.StatsUpdated, roomId, stats);
            }
            return stats;
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, 'getRoomSummaryStats');
            }
            this.handleError("getRoomSummaryStats", e);
            return null;
        }
    }

    public async createOrRefreshSummary(roomId: string, body: Record<string, unknown> = {}): Promise<RoomSummary | null> {
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
            
            const normalizedMembers = Array.isArray(response) ? response : response.members ?? members;
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

    public async recalculateSummaryStats(roomId: string, body: Record<string, unknown> = {}): Promise<RoomStats | null> {
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

    public async recalculateSummaryHeroes(roomId: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
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

    public async clearSummaryUnread(roomId: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
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
            return await this.requestInternal<RoomSummaryListResponse>(Method.Get, "/summaries", queryParams);
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
            return await this.requestInternal<Record<string, unknown>>(Method.Post, "/updates/process", undefined, body);
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
     * @param throwOnError - 是否抛出错误（默认 false，向后兼容）
     * @returns 层级结构
     * @throws {AuthError} 当认证失败时
     * @throws {NotFoundError} 当房间不存在时
     * @throws {ApiError} 当 API 调用失败时
     */
    public async getRoomHierarchy(
        roomId: string, 
        options?: RoomSummaryOptions,
        throwOnError = false
    ): Promise<unknown | null> {
        try {
            return await this.client.getRoomHierarchy(
                roomId,
                options?.limit,
                undefined,
                options?.suggested ?? false
            );
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, 'getRoomHierarchy');
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
     * @param throwOnError - 是否抛出错误（默认 false，向后兼容）
     * @returns 公共房间列表
     * @throws {AuthError} 当认证失败时
     * @throws {ApiError} 当 API 调用失败时
     */
    public async getPublicRooms(
        server = "",
        options?: { limit?: number; since?: string; query?: string },
        throwOnError = false
    ): Promise<unknown | null> {
        try {
            return await this.client.publicRooms({
                server,
                limit: options?.limit,
                since: options?.since,
                filter: options?.query ? { generic_search_term: options.query } : undefined,
            });
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, 'getPublicRooms');
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

    start(): void {
        // 初始化逻辑（如果需要）
    }

    stop(): void {
        this.clearCache();
    }

    /**
     * 标准化错误处理
     * 将原始错误转换为 SDK 标准错误类型
     * 
     * @param error - 原始错误
     * @param method - 方法名
     * @returns SDK 标准错误
     */
    private normalizeError(error: unknown, method: string): SdkError {
        const err = error as Error;
        if (error instanceof MatrixError) {
            if (error.httpStatus === 401 || error.errcode === "M_UNKNOWN_TOKEN") {
                return new AuthError(`RoomSummaryManager.${method} failed: ${err.message}`, error);
            }
            if (error.httpStatus === 404 || error.errcode === "M_NOT_FOUND") {
                return new NotFoundError(`RoomSummaryManager.${method} failed: ${err.message}`, error);
            }
            if (this.isRetryableError(error)) {
                return new RetryableError(`RoomSummaryManager.${method} failed: ${err.message}`, error);
            }
            return new ApiError(`RoomSummaryManager.${method} failed: ${err.message}`, error.errcode, error.httpStatus, error);
        }
        return new ApiError(`RoomSummaryManager.${method} failed: ${err?.message ?? String(error)}`, "UNKNOWN", 0, error);
    }

    private roomSummaryPath(pathTemplate: string, roomId: string): string {
        return encodeUri(pathTemplate, { $roomId: roomId });
    }

    private async requestV3<T>(
        method: Method,
        path: string,
        queryParams?: QueryDict,
        body?: Body,
    ): Promise<T> {
        return await this.client.http.authedRequest<T>(method, path, queryParams, body, {
            prefix: ClientPrefix.V3,
        });
    }

    private async requestInternal<T>(
        method: Method,
        path: string,
        queryParams?: QueryDict,
        body?: Body,
    ): Promise<T> {
        return await this.client.http.authedRequest<T>(method, path, queryParams, body, {
            prefix: "/_synapse/room_summary/v1",
        });
    }

    /**
     * 检查是否为可重试错误
     */
    private isRetryableError(error: unknown): boolean {
        if (!(error instanceof MatrixError)) {
            return true;
        }
        const retryableCodes = ["M_LIMIT_EXCEEDED", "M_SERVER_UNAVAILABLE", "M_UNKNOWN"];
        const retryableStatus = [429, 502, 503, 504];
        return (error.errcode !== undefined && retryableCodes.includes(error.errcode)) || 
               (error.httpStatus !== undefined && retryableStatus.includes(error.httpStatus));
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
                user_id: typeof h === 'string' ? h : h.user_id,
                display_name: typeof h === 'string' ? undefined : h.display_name,
                avatar_url: typeof h === 'string' ? undefined : h.avatar_url,
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
