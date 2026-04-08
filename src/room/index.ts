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
 * Room Manager - 房间管理
 * 
 * 提供房间创建、加入、离开、管理等功能
 * 对应后端: synapse-rust/src/web/routes/room.rs
 * 
 * 优化特性:
 * - LRU 缓存: 房间信息、成员列表、状态事件缓存
 * - 重试机制: 指数退避重试
 * - 监控指标: 请求统计和性能监控
 */

import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { MatrixClient } from "../client";
import { Room } from "../models/room";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { type EmptyObject } from "../@types/common";
import { type ICreateRoomOpts, type IJoinRoomOpts, type KnockRoomOpts, type InviteOpts, type ITagsResponse } from "../@types/requests";
import { type RoomAccountDataEvents } from "../@types/event";
import { InvalidParamError } from "../common/errors.ts";
import { AuthError, NotFoundError, RetryableError, ApiError } from "../errors";
import { MatrixError } from "../http-api/errors.ts";
import * as utils from "../utils";
import { logger } from "../logger.ts";

export enum RoomEvent {
    RoomCreated = "RoomCreated",
    RoomJoined = "RoomJoined",
    RoomLeft = "RoomLeft",
    MemberJoined = "MemberJoined",
    MemberLeft = "MemberLeft",
    StateChanged = "StateChanged",
    Error = "Error",
}

export interface IRoomEvent {
    content: Record<string, unknown>;
    type: string;
    event_id: string;
    sender: string;
    origin_server_ts: number;
    room_id?: string;
    unsigned?: Record<string, unknown>;
}

export interface IStateEvent extends IRoomEvent {
    state_key: string;
}

export interface IRoomMember {
    user_id: string;
    display_name?: string;
    avatar_url?: string;
    membership: "join" | "leave" | "invite" | "ban";
}

export interface IGetMessagesResponse {
    chunk: IRoomEvent[];
    start: string;
    end?: string;
    state?: IStateEvent[];
}

export interface IGetMembersResponse {
    chunk: IStateEvent[];
}

export interface IJoinedMembersResponse {
    joined: {
        [userId: string]: {
            display_name?: string;
            avatar_url?: string;
        };
    };
}

export interface IEventContextResponse {
    event: IRoomEvent;
    events_before: IRoomEvent[];
    events_after: IRoomEvent[];
    start: string;
    end: string;
    state: IStateEvent[];
}

export interface ISendEventResponse {
    event_id: string;
    room_id?: string;
}

export interface IRoomVersionResponse {
    room_version: string;
}

export interface IRoomCapabilitiesResponse {
    capabilities: Record<string, unknown>;
}

export interface IRoomMetadataResponse {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    join_rule?: string;
    history_visibility?: string;
    guest_access?: string;
    created_ts?: number;
}

interface ITagMetadata {
    order?: number;
}

interface RoomManagerEventMap {
    [RoomEvent.RoomCreated]: (roomId: string) => void;
    [RoomEvent.RoomJoined]: (roomId: string) => void;
    [RoomEvent.RoomLeft]: (roomId: string) => void;
    [RoomEvent.MemberJoined]: (roomId: string, userId: string) => void;
    [RoomEvent.MemberLeft]: (roomId: string, userId: string) => void;
    [RoomEvent.StateChanged]: (roomId: string, eventType: string, stateKey: string) => void;
    [RoomEvent.Error]: (error: Error) => void;
}

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

export class RoomManager extends TypedEventEmitter<RoomEvent, RoomManagerEventMap> {
    private client: MatrixClient;
    private roomInfoCache: LRUCache<Record<string, unknown>>;
    private membersCache: LRUCache<IStateEvent[]>;
    private stateCache: LRUCache<IStateEvent[]>;
    private readonly maxRetries = 3;
    private readonly retryDelay = 1000;

    private requestStats = {
        total: 0,
        successful: 0,
        failed: 0,
        retried: 0,
    };

    constructor(client: MatrixClient) {
        super();
        this.client = client;
        
        this.roomInfoCache = new LRUCache<Record<string, unknown>>(100, 5 * 60 * 1000);
        this.membersCache = new LRUCache<IStateEvent[]>(100, 2 * 60 * 1000);
        this.stateCache = new LRUCache<IStateEvent[]>(50, 5 * 60 * 1000);
    }

    private normalizeError(error: unknown, method: string): Error {
        if (error instanceof MatrixError) {
            if (error.httpStatus === 404 || error.errcode === "M_NOT_FOUND") {
                return new NotFoundError(`RoomManager.${method} failed: ${error.message}`, error);
            }
            if (error.httpStatus === 401 || error.errcode === "M_UNKNOWN_TOKEN") {
                return new AuthError(`RoomManager.${method} failed: ${error.message}`, error);
            }
            if (this.isRetryableError(error)) {
                return new RetryableError(`RoomManager.${method} failed: ${error.message}`, error);
            }
            return new ApiError(
                `RoomManager.${method} failed: ${error.message}`,
                error.errcode ?? "UNKNOWN",
                error.httpStatus,
                error
            );
        }
        const err = error as Record<string, unknown>;
        const message = (err?.message as string) ?? String(error);
        const httpStatus = err?.httpStatus as number | undefined;
        const errcode = err?.errcode as string | undefined;
        
        if (httpStatus === 404 || errcode === "M_NOT_FOUND") {
            return new NotFoundError(`RoomManager.${method} failed: ${message}`, error as Error);
        }
        if (httpStatus === 401 || errcode === "M_UNKNOWN_TOKEN") {
            return new AuthError(`RoomManager.${method} failed: ${message}`, error as Error);
        }
        if (this.isRetryableError(error)) {
            return new RetryableError(`RoomManager.${method} failed: ${message}`, error as Error);
        }
        return new ApiError(
            `RoomManager.${method} failed: ${message}`,
            errcode ?? "UNKNOWN",
            httpStatus ?? 0,
            error
        );
    }

    private isRetryableError(error: unknown): boolean {
        if (error instanceof MatrixError) {
            const retryableCodes = [
                "M_LIMIT_EXCEEDED",
                "M_SERVER_UNAVAILABLE",
            ];
            const retryableStatus = [429, 500, 502, 503, 504];
            return (
                retryableCodes.includes(error.errcode ?? "") ||
                retryableStatus.includes(error.httpStatus ?? 0)
            );
        }
        const err = error as Record<string, unknown>;
        if (err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT" || err?.code === "ENOTFOUND") {
            return true;
        }
        const httpStatus = err?.httpStatus as number | undefined;
        if (httpStatus && [429, 500, 502, 503, 504].includes(httpStatus)) {
            return true;
        }
        return false;
    }

    private getErrorType(error: unknown): string {
        if (error instanceof MatrixError) {
            return error.errcode ?? `http_${error.httpStatus}`;
        }
        if (error instanceof Error) {
            return error.name ?? "UnknownError";
        }
        return "UnknownError";
    }

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
                    logger.info(`RoomManager.${method} succeeded after ${attempt} retries`, {
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
                    logger.warn(`RoomManager.${method} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms`, {
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

    private recordRequest(success: boolean, retried: boolean): void {
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

    private emitMetric(type: string, method: string, data: Record<string, unknown>): void {
        try {
            logger.debug(`Metric: ${type}.${method}`, { type, method, ...data, timestamp: Date.now() });
        } catch {
            // 忽略监控发送错误，不影响主流程
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private validateRoomId(roomId: string): void {
        if (!roomId || typeof roomId !== "string") {
            throw new InvalidParamError("roomId is required and must be a string");
        }
        const trimmed = roomId.trim();
        if (trimmed.length === 0) {
            throw new InvalidParamError("roomId cannot be empty");
        }
    }

    private validateUserId(userId: string): void {
        if (!userId || typeof userId !== "string") {
            throw new InvalidParamError("userId is required and must be a string");
        }
        const trimmed = userId.trim();
        if (trimmed.length === 0) {
            throw new InvalidParamError("userId cannot be empty");
        }
    }

    // ==================== Room Info ====================

    public getRoom(roomId: string | undefined): Room | null {
        return this.client.store.getRoom(roomId!);
    }

    public getRooms(): Room[] {
        return this.client.store.getRooms();
    }

    public getVisibleRooms(msc3946ProcessDynamicPredecessor = false): Room[] {
        return this.client.store.getRooms();
    }

    public async getRoomVersion(roomId: string, forceRefresh = false): Promise<string> {
        this.validateRoomId(roomId);

        const cacheKey = `version:${roomId}`;
        if (!forceRefresh) {
            const cached = this.roomInfoCache.get(cacheKey);
            if (cached?.room_version) {
                return cached.room_version as string;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<IRoomVersionResponse>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/version", { $roomId: roomId }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getRoomVersion');

        this.roomInfoCache.set(cacheKey, { room_version: response.room_version });
        return response.room_version;
    }

    public async getRoomCapabilities(roomId: string, forceRefresh = false): Promise<IRoomCapabilitiesResponse> {
        this.validateRoomId(roomId);

        const cacheKey = `capabilities:${roomId}`;
        if (!forceRefresh) {
            const cached = this.roomInfoCache.get(cacheKey);
            if (cached) {
                return cached as unknown as IRoomCapabilitiesResponse;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<IRoomCapabilitiesResponse>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/capabilities", { $roomId: roomId }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getRoomCapabilities');

        this.roomInfoCache.set(cacheKey, response as IRoomCapabilitiesResponse as unknown as Record<string, unknown>);
        return response;
    }

    public async getRoomMetadata(roomId: string, forceRefresh = false): Promise<IRoomMetadataResponse> {
        this.validateRoomId(roomId);

        const cacheKey = `metadata:${roomId}`;
        if (!forceRefresh) {
            const cached = this.roomInfoCache.get(cacheKey);
            if (cached) {
                return cached as unknown as IRoomMetadataResponse;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<IRoomMetadataResponse>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/metadata", { $roomId: roomId }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getRoomMetadata');

        this.roomInfoCache.set(cacheKey, response as unknown as Record<string, unknown>);
        return response;
    }

    // ==================== Room Lifecycle ====================

    public async createRoom(options: ICreateRoomOpts): Promise<{ room_id: string }> {
        const invitesNeedingToken = (options.invite_3pid || []).filter((i: { id_access_token?: string }) => !i.id_access_token);
        const clientWithIdentity = this.client as MatrixClient & { identityServer?: { getAccessToken?: () => Promise<string> } };
        if (invitesNeedingToken.length > 0 && clientWithIdentity.identityServer?.getAccessToken) {
            const identityAccessToken = await clientWithIdentity.identityServer.getAccessToken();
            if (identityAccessToken) {
                for (const invite of invitesNeedingToken) {
                    (invite as { id_access_token?: string }).id_access_token = identityAccessToken;
                }
            }
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{ room_id: string }>(
                Method.Post,
                "/createRoom",
                undefined,
                options
            );
        }, 'createRoom');

        this.emit(RoomEvent.RoomCreated, response.room_id);
        return response;
    }

    public async joinRoom(roomIdOrAlias: string, opts: IJoinRoomOpts = {}): Promise<Room> {
        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{ room_id: string }>(
                Method.Post,
                utils.encodeUri("/join/$roomId", { $roomId: roomIdOrAlias }),
                undefined,
                opts,
                { prefix: ClientPrefix.V3 }
            );
        }, 'joinRoom');

        this.emit(RoomEvent.RoomJoined, response.room_id);
        const newRoom = this.client.getRoom(response.room_id)!;
        return newRoom;
    }

    public async knockRoom(roomIdOrAlias: string, opts: KnockRoomOpts = {}): Promise<{ room_id: string }> {
        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{ room_id: string }>(
                Method.Post,
                utils.encodeUri("/knock/$roomId", { $roomId: roomIdOrAlias }),
                undefined,
                opts,
                { prefix: ClientPrefix.V3 }
            );
        }, 'knockRoom');

        return response;
    }

    public async leave(roomId: string): Promise<EmptyObject> {
        this.validateRoomId(roomId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Post,
                utils.encodeUri("/rooms/$roomId/leave", { $roomId: roomId }),
                undefined,
                {},
                { prefix: ClientPrefix.V3 }
            );
        }, 'leave');

        this.emit(RoomEvent.RoomLeft, roomId);
        this.clearRoomCache(roomId);
        return response;
    }

    public async forget(roomId: string, deleteRoom = true): Promise<EmptyObject> {
        this.validateRoomId(roomId);

        if (deleteRoom) {
            this.client.store.removeRoom(roomId);
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Post,
                utils.encodeUri("/rooms/$roomId/forget", { $roomId: roomId }),
                undefined,
                { delete_room: deleteRoom },
                { prefix: ClientPrefix.V3 }
            );
        }, 'forget');

        this.clearRoomCache(roomId);
        return response;
    }

    // ==================== Members ====================

    public async getMembers(roomId: string, params?: {
        membership?: string;
        not_membership?: string;
        at?: string;
    }, forceRefresh = false): Promise<IStateEvent[]> {
        this.validateRoomId(roomId);

        const cacheKey = `members:${roomId}:${JSON.stringify(params || {})}`;
        if (!forceRefresh && !params) {
            const cached = this.membersCache.get(`members:${roomId}`);
            if (cached) {
                return cached;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<IGetMembersResponse>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/members", { $roomId: roomId }),
                params as Record<string, string>,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getMembers');

        if (!params) {
            this.membersCache.set(`members:${roomId}`, response.chunk);
        }
        return response.chunk;
    }

    public async getJoinedMembers(roomId: string, forceRefresh = false): Promise<IJoinedMembersResponse> {
        this.validateRoomId(roomId);

        const cacheKey = `joined_members:${roomId}`;
        if (!forceRefresh) {
            const cached = this.roomInfoCache.get(cacheKey);
            if (cached) {
                return cached as unknown as IJoinedMembersResponse;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<IJoinedMembersResponse>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/joined_members", { $roomId: roomId }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getJoinedMembers');

        this.roomInfoCache.set(cacheKey, response as unknown as Record<string, unknown>);
        return response;
    }

    public async getMembership(roomId: string, userId: string): Promise<IStateEvent | null> {
        this.validateRoomId(roomId);
        this.validateUserId(userId);

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IStateEvent>(
                    Method.Get,
                    utils.encodeUri("/rooms/$roomId/membership/$userId", {
                        $roomId: roomId,
                        $userId: userId,
                    }),
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 }
                );
            }, 'getMembership');

            return response;
        } catch (error: unknown) {
            const err = error as Record<string, unknown>;
            const httpStatus = err?.httpStatus as number | undefined;
            if (httpStatus === 404) {
                return null;
            }
            throw error;
        }
    }

    // ==================== Member Actions ====================

    public async invite(roomId: string, userId: string, opts: InviteOpts | string = {}): Promise<EmptyObject> {
        this.validateRoomId(roomId);
        this.validateUserId(userId);

        const body: Record<string, unknown> = typeof opts === "string"
            ? { user_id: opts }
            : { user_id: userId, ...opts };

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Post,
                utils.encodeUri("/rooms/$roomId/invite", { $roomId: roomId }),
                undefined,
                body,
                { prefix: ClientPrefix.V3 }
            );
        }, 'invite');

        this.membersCache.delete(`members:${roomId}`);
        this.emit(RoomEvent.MemberJoined, roomId, userId);
        return response;
    }

    public async kick(roomId: string, userId: string, reason?: string): Promise<EmptyObject> {
        this.validateRoomId(roomId);
        this.validateUserId(userId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Post,
                utils.encodeUri("/rooms/$roomId/kick", { $roomId: roomId }),
                undefined,
                { user_id: userId, reason },
                { prefix: ClientPrefix.V3 }
            );
        }, 'kick');

        this.membersCache.delete(`members:${roomId}`);
        this.emit(RoomEvent.MemberLeft, roomId, userId);
        return response;
    }

    public async ban(roomId: string, userId: string, reason?: string): Promise<EmptyObject> {
        this.validateRoomId(roomId);
        this.validateUserId(userId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Post,
                utils.encodeUri("/rooms/$roomId/ban", { $roomId: roomId }),
                undefined,
                { user_id: userId, reason },
                { prefix: ClientPrefix.V3 }
            );
        }, 'ban');

        this.membersCache.delete(`members:${roomId}`);
        return response;
    }

    public async unban(roomId: string, userId: string): Promise<EmptyObject> {
        this.validateRoomId(roomId);
        this.validateUserId(userId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Post,
                utils.encodeUri("/rooms/$roomId/unban", { $roomId: roomId }),
                undefined,
                { user_id: userId },
                { prefix: ClientPrefix.V3 }
            );
        }, 'unban');

        this.membersCache.delete(`members:${roomId}`);
        return response;
    }

    // ==================== Messages ====================

    public async getMessages(roomId: string, params: {
        from: string;
        dir: "f" | "b";
        to?: string;
        limit?: number;
        filter?: Record<string, unknown>;
    }): Promise<IGetMessagesResponse> {
        this.validateRoomId(roomId);

        const queryParams: Record<string, string> = {
            from: params.from,
            dir: params.dir,
        };
        if (params.to) queryParams.to = params.to;
        if (params.limit) queryParams.limit = params.limit.toString();
        if (params.filter) queryParams.filter = JSON.stringify(params.filter);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<IGetMessagesResponse>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/messages", { $roomId: roomId }),
                queryParams,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getMessages');

        return response;
    }

    public async sendEvent(
        roomId: string,
        eventType: string,
        content: Record<string, unknown>,
        txnId?: string
    ): Promise<ISendEventResponse> {
        this.validateRoomId(roomId);
        if (!eventType) {
            throw new InvalidParamError("eventType is required");
        }

        const txn = txnId || `m${Date.now()}`;
        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<ISendEventResponse>(
                Method.Put,
                utils.encodeUri("/rooms/$roomId/send/$eventType/$txnId", {
                    $roomId: roomId,
                    $eventType: eventType,
                    $txnId: txn,
                }),
                undefined,
                content,
                { prefix: ClientPrefix.V3 }
            );
        }, 'sendEvent');

        return response;
    }

    // ==================== State ====================

    public async getState(roomId: string, forceRefresh = false): Promise<IStateEvent[]> {
        this.validateRoomId(roomId);

        const cacheKey = `state:${roomId}`;
        if (!forceRefresh) {
            const cached = this.stateCache.get(cacheKey);
            if (cached) {
                return cached;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<IStateEvent[]>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/state", { $roomId: roomId }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getState');

        this.stateCache.set(cacheKey, response);
        return response;
    }

    public async getStateEvent(
        roomId: string,
        eventType: string,
        stateKey = ""
    ): Promise<Record<string, unknown>> {
        this.validateRoomId(roomId);
        if (!eventType) {
            throw new InvalidParamError("eventType is required");
        }

        const path = stateKey
            ? utils.encodeUri("/rooms/$roomId/state/$eventType/$stateKey", {
                  $roomId: roomId,
                  $eventType: eventType,
                  $stateKey: stateKey,
              })
            : utils.encodeUri("/rooms/$roomId/state/$eventType", {
                  $roomId: roomId,
                  $eventType: eventType,
              });

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Get,
                path,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getStateEvent');

        return response;
    }

    public async sendStateEvent(
        roomId: string,
        eventType: string,
        content: Record<string, unknown>,
        stateKey = ""
    ): Promise<ISendEventResponse> {
        this.validateRoomId(roomId);
        if (!eventType) {
            throw new InvalidParamError("eventType is required");
        }

        const path = stateKey
            ? utils.encodeUri("/rooms/$roomId/state/$eventType/$stateKey", {
                  $roomId: roomId,
                  $eventType: eventType,
                  $stateKey: stateKey,
              })
            : utils.encodeUri("/rooms/$roomId/state/$eventType", {
                  $roomId: roomId,
                  $eventType: eventType,
              });

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<ISendEventResponse>(
                Method.Put,
                path,
                undefined,
                content,
                { prefix: ClientPrefix.V3 }
            );
        }, 'sendStateEvent');

        this.stateCache.delete(`state:${roomId}`);
        this.emit(RoomEvent.StateChanged, roomId, eventType, stateKey);
        return response;
    }

    public setRoomName(roomId: string, name: string): Promise<ISendEventResponse> {
        return this.sendStateEvent(roomId, "m.room.name", { name }, "");
    }

    public setRoomTopic(roomId: string, topic?: string, htmlTopic?: string): Promise<ISendEventResponse> {
        return this.sendStateEvent(roomId, "m.room.topic", { topic, formatted_topic: htmlTopic }, "");
    }

    // ==================== Events ====================

    public async getEvent(roomId: string, eventId: string): Promise<IRoomEvent> {
        this.validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<IRoomEvent>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/event/$eventId", {
                    $roomId: roomId,
                    $eventId: eventId,
                }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getEvent');

        return response;
    }

    public async getEventContext(
        roomId: string,
        eventId: string,
        params?: { limit?: number; filter?: Record<string, unknown> }
    ): Promise<IEventContextResponse> {
        this.validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }

        const queryParams: Record<string, string> = {};
        if (params?.limit) queryParams.limit = params.limit.toString();
        if (params?.filter) queryParams.filter = JSON.stringify(params.filter);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<IEventContextResponse>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/context/$eventId", {
                    $roomId: roomId,
                    $eventId: eventId,
                }),
                Object.keys(queryParams).length > 0 ? queryParams : undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getEventContext');

        return response;
    }

    public async redactEvent(
        roomId: string,
        eventId: string,
        reason?: string,
        txnId?: string
    ): Promise<ISendEventResponse> {
        this.validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }

        const txn = txnId || `m${Date.now()}`;
        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<ISendEventResponse>(
                Method.Put,
                utils.encodeUri("/rooms/$roomId/redact/$eventId/$txnId", {
                    $roomId: roomId,
                    $eventId: eventId,
                    $txnId: txn,
                }),
                undefined,
                reason ? { reason } : {},
                { prefix: ClientPrefix.V3 }
            );
        }, 'redactEvent');

        return response;
    }

    // ==================== Tags ====================

    public async getRoomTags(roomId: string): Promise<ITagsResponse> {
        this.validateRoomId(roomId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<ITagsResponse>(
                Method.Get,
                utils.encodeUri("/user/$userId/rooms/$roomId/tags", {
                    $userId: this.client.getUserId()!,
                    $roomId: roomId,
                }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getRoomTags');

        return response;
    }

    public async setRoomTag(roomId: string, tagName: string, metadata: ITagMetadata = {}): Promise<EmptyObject> {
        this.validateRoomId(roomId);
        if (!tagName) {
            throw new InvalidParamError("tagName is required");
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Put,
                utils.encodeUri("/user/$userId/rooms/$roomId/tags/$tag", {
                    $userId: this.client.getUserId()!,
                    $roomId: roomId,
                    $tag: tagName,
                }),
                undefined,
                metadata,
                { prefix: ClientPrefix.V3 }
            );
        }, 'setRoomTag');

        return response;
    }

    public async deleteRoomTag(roomId: string, tagName: string): Promise<EmptyObject> {
        this.validateRoomId(roomId);
        if (!tagName) {
            throw new InvalidParamError("tagName is required");
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Delete,
                utils.encodeUri("/user/$userId/rooms/$roomId/tags/$tag", {
                    $userId: this.client.getUserId()!,
                    $roomId: roomId,
                    $tag: tagName,
                }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'deleteRoomTag');

        return response;
    }

    // ==================== Account Data ====================

    public async setRoomAccountData<K extends keyof RoomAccountDataEvents>(
        roomId: string,
        eventType: K,
        content: RoomAccountDataEvents[K],
    ): Promise<EmptyObject> {
        this.validateRoomId(roomId);
        if (!eventType) {
            throw new InvalidParamError("eventType is required");
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Put,
                utils.encodeUri("/rooms/$roomId/account_data/$type", {
                    $roomId: roomId,
                    $type: eventType,
                }),
                undefined,
                content,
                { prefix: ClientPrefix.V3 }
            );
        }, 'setRoomAccountData');

        return response;
    }

    // ==================== Room Info Extended ====================

    public async getUnreadCount(roomId: string): Promise<{ unread_count: number; highlight_count: number }> {
        this.validateRoomId(roomId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{ unread_count: number; highlight_count: number }>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/unread_count", { $roomId: roomId }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getUnreadCount');

        return response;
    }

    public async getRoomTurnServer(roomId: string): Promise<{
        uris: string[];
        username?: string;
        password?: string;
        ttl: number;
    }> {
        this.validateRoomId(roomId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{
                uris: string[];
                username?: string;
                password?: string;
                ttl: number;
            }>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/turn_server", { $roomId: roomId }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getRoomTurnServer');

        return response;
    }

    public async getRoomRetention(roomId: string): Promise<{
        min_lifetime?: number;
        max_lifetime?: number;
    }> {
        this.validateRoomId(roomId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{
                min_lifetime?: number;
                max_lifetime?: number;
            }>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/retention", { $roomId: roomId }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getRoomRetention');

        return response;
    }

    // ==================== Data Storage ====================

    public async getVaultData(roomId: string): Promise<Record<string, unknown>> {
        this.validateRoomId(roomId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/vault_data", { $roomId: roomId }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getVaultData');

        return response;
    }

    public async setVaultData(roomId: string, data: Record<string, unknown>): Promise<EmptyObject> {
        this.validateRoomId(roomId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Put,
                utils.encodeUri("/rooms/$roomId/vault_data", { $roomId: roomId }),
                undefined,
                data,
                { prefix: ClientPrefix.V3 }
            );
        }, 'setVaultData');

        return response;
    }

    public async getExternalIds(roomId: string): Promise<{ external_ids: string[] }> {
        this.validateRoomId(roomId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{ external_ids: string[] }>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/external_ids", { $roomId: roomId }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getExternalIds');

        return response;
    }

    // ==================== Spaces ====================

    public async getRoomSpaces(roomId: string): Promise<{ spaces: string[] }> {
        this.validateRoomId(roomId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{ spaces: string[] }>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/spaces", { $roomId: roomId }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getRoomSpaces');

        return response;
    }

    // ==================== Event Processing ====================

    public async getEventPerspective(roomId: string, eventId: string): Promise<{
        event: IRoomEvent;
        perspective: Record<string, unknown>;
    }> {
        this.validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{
                event: IRoomEvent;
                perspective: Record<string, unknown>;
            }>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/event_perspective", { $roomId: roomId }),
                { event_id: eventId },
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getEventPerspective');

        return response;
    }

    public async getEncryptedEvents(roomId: string, params?: {
        from?: string;
        limit?: number;
    }): Promise<{
        chunk: IRoomEvent[];
        next_batch?: string;
    }> {
        this.validateRoomId(roomId);

        const queryParams: Record<string, string> = {};
        if (params?.from) queryParams.from = params.from;
        if (params?.limit) queryParams.limit = params.limit.toString();

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{
                chunk: IRoomEvent[];
                next_batch?: string;
            }>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/encrypted_events", { $roomId: roomId }),
                Object.keys(queryParams).length > 0 ? queryParams : undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getEncryptedEvents');

        return response;
    }

    public async getReducedEvents(roomId: string, params?: {
        from?: string;
        limit?: number;
    }): Promise<{
        chunk: IRoomEvent[];
        next_batch?: string;
    }> {
        this.validateRoomId(roomId);

        const queryParams: Record<string, string> = {};
        if (params?.from) queryParams.from = params.from;
        if (params?.limit) queryParams.limit = params.limit.toString();

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{
                chunk: IRoomEvent[];
                next_batch?: string;
            }>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/reduced_events", { $roomId: roomId }),
                Object.keys(queryParams).length > 0 ? queryParams : undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getReducedEvents');

        return response;
    }

    public async getRenderedEvent(roomId: string, eventId: string, format?: string): Promise<{
        rendered: string;
        format: string;
    }> {
        this.validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }

        const queryParams: Record<string, string> = { event_id: eventId };
        if (format) queryParams.format = format;

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{
                rendered: string;
                format: string;
            }>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/rendered/", { $roomId: roomId }),
                queryParams,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getRenderedEvent');

        return response;
    }

    // ==================== Content Transformation ====================

    public async translateEvent(roomId: string, eventId: string, targetLanguage: string): Promise<{
        translated_text: string;
        source_language: string;
    }> {
        this.validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }
        if (!targetLanguage) {
            throw new InvalidParamError("targetLanguage is required");
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{
                translated_text: string;
                source_language: string;
            }>(
                Method.Post,
                utils.encodeUri("/rooms/$roomId/translate/$eventId", {
                    $roomId: roomId,
                    $eventId: eventId,
                }),
                undefined,
                { target_language: targetLanguage },
                { prefix: ClientPrefix.V3 }
            );
        }, 'translateEvent');

        return response;
    }

    public async convertEvent(roomId: string, eventId: string, targetFormat: string): Promise<{
        converted_content: Record<string, unknown>;
        format: string;
    }> {
        this.validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }
        if (!targetFormat) {
            throw new InvalidParamError("targetFormat is required");
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{
                converted_content: Record<string, unknown>;
                format: string;
            }>(
                Method.Post,
                utils.encodeUri("/rooms/$roomId/convert/$eventId", {
                    $roomId: roomId,
                    $eventId: eventId,
                }),
                undefined,
                { target_format: targetFormat },
                { prefix: ClientPrefix.V3 }
            );
        }, 'convertEvent');

        return response;
    }

    public async signEvent(roomId: string, eventId: string): Promise<{
        signatures: Record<string, Record<string, string>>;
    }> {
        this.validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{
                signatures: Record<string, Record<string, string>>;
            }>(
                Method.Put,
                utils.encodeUri("/rooms/$roomId/sign/$eventId", {
                    $roomId: roomId,
                    $eventId: eventId,
                }),
                undefined,
                {},
                { prefix: ClientPrefix.V3 }
            );
        }, 'signEvent');

        return response;
    }

    public async verifyEvent(roomId: string, eventId: string): Promise<{
        valid: boolean;
        reason?: string;
    }> {
        this.validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{
                valid: boolean;
                reason?: string;
            }>(
                Method.Post,
                utils.encodeUri("/rooms/$roomId/verify/$eventId", {
                    $roomId: roomId,
                    $eventId: eventId,
                }),
                undefined,
                {},
                { prefix: ClientPrefix.V3 }
            );
        }, 'verifyEvent');

        return response;
    }

    // ==================== Message Queue ====================

    public async getMessageQueue(roomId: string): Promise<{
        messages: Array<{
            event_id: string;
            txn_id: string;
            status: string;
            created_ts: number;
        }>;
    }> {
        this.validateRoomId(roomId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{
                messages: Array<{
                    event_id: string;
                    txn_id: string;
                    status: string;
                    created_ts: number;
                }>;
            }>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/message_queue", { $roomId: roomId }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getMessageQueue');

        return response;
    }

    // ==================== Device ====================

    public async getRoomDevice(roomId: string, deviceId: string): Promise<{
        device_id: string;
        display_name?: string;
        last_seen_ts?: number;
        last_seen_ip?: string;
    }> {
        this.validateRoomId(roomId);
        if (!deviceId) {
            throw new InvalidParamError("deviceId is required");
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{
                device_id: string;
                display_name?: string;
                last_seen_ts?: number;
                last_seen_ip?: string;
            }>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/device/$deviceId", {
                    $roomId: roomId,
                    $deviceId: deviceId,
                }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getRoomDevice');

        return response;
    }

    // ==================== Widgets ====================

    public async getWidgetCapabilities(roomId: string, widgetId: string): Promise<{
        capabilities: string[];
    }> {
        this.validateRoomId(roomId);
        if (!widgetId) {
            throw new InvalidParamError("widgetId is required");
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{
                capabilities: string[];
            }>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/widgets/$widgetId/capabilities", {
                    $roomId: roomId,
                    $widgetId: widgetId,
                }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getWidgetCapabilities');

        return response;
    }

    public async sendWidgetMessage(roomId: string, widgetId: string, message: Record<string, unknown>): Promise<{
        response: Record<string, unknown>;
    }> {
        this.validateRoomId(roomId);
        if (!widgetId) {
            throw new InvalidParamError("widgetId is required");
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{
                response: Record<string, unknown>;
            }>(
                Method.Post,
                utils.encodeUri("/rooms/$roomId/widgets/$widgetId/send", {
                    $roomId: roomId,
                    $widgetId: widgetId,
                }),
                undefined,
                message,
                { prefix: ClientPrefix.V3 }
            );
        }, 'sendWidgetMessage');

        return response;
    }

    // ==================== Event URL ====================

    public async getEventUrl(roomId: string, eventId: string): Promise<{
        url: string;
        thumbnail_url?: string;
        mimetype?: string;
        size?: number;
    }> {
        this.validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{
                url: string;
                thumbnail_url?: string;
                mimetype?: string;
                size?: number;
            }>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/event/$eventId/url", {
                    $roomId: roomId,
                    $eventId: eventId,
                }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getEventUrl');

        return response;
    }

    // ==================== Room Sync ====================

    public async roomSync(roomId: string, params?: {
        since?: string;
        full_state?: boolean;
    }): Promise<{
        next_batch: string;
        state?: IStateEvent[];
        timeline?: { events: IRoomEvent[]; limited: boolean; prev_batch?: string };
    }> {
        this.validateRoomId(roomId);

        const queryParams: Record<string, string> = {};
        if (params?.since) queryParams.since = params.since;
        if (params?.full_state) queryParams.full_state = "true";

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{
                next_batch: string;
                state?: IStateEvent[];
                timeline?: { events: IRoomEvent[]; limited: boolean; prev_batch?: string };
            }>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/sync", { $roomId: roomId }),
                Object.keys(queryParams).length > 0 ? queryParams : undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'roomSync');

        return response;
    }

    // ==================== Service Types ====================

    public async getServiceTypes(roomId: string): Promise<{
        service_types: string[];
    }> {
        this.validateRoomId(roomId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{
                service_types: string[];
            }>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/service_types", { $roomId: roomId }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getServiceTypes');

        return response;
    }

    // ==================== Fragments ====================

    public async getUserFragments(roomId: string, userId: string): Promise<{
        fragments: Array<{
            fragment_id: string;
            event_type: string;
            state_key: string;
            content: Record<string, unknown>;
        }>;
    }> {
        this.validateRoomId(roomId);
        this.validateUserId(userId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{
                fragments: Array<{
                    fragment_id: string;
                    event_type: string;
                    state_key: string;
                    content: Record<string, unknown>;
                }>;
            }>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/fragments/$userId", {
                    $roomId: roomId,
                    $userId: userId,
                }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        }, 'getUserFragments');

        return response;
    }

    // ==================== Cache Management ====================

    public clearRoomCache(roomId: string): void {
        this.roomInfoCache.delete(`version:${roomId}`);
        this.roomInfoCache.delete(`capabilities:${roomId}`);
        this.roomInfoCache.delete(`metadata:${roomId}`);
        this.roomInfoCache.delete(`joined_members:${roomId}`);
        this.membersCache.delete(`members:${roomId}`);
        this.stateCache.delete(`state:${roomId}`);
    }

    public clearAllCaches(): void {
        this.roomInfoCache.clear();
        this.membersCache.clear();
        this.stateCache.clear();
    }

    // ==================== Metrics ====================

    public getCacheStats(): {
        roomInfo: { size: number; hits: number; misses: number; hitRate: number };
        members: { size: number; hits: number; misses: number; hitRate: number };
        state: { size: number; hits: number; misses: number; hitRate: number };
    } {
        return {
            roomInfo: this.roomInfoCache.getStats(),
            members: this.membersCache.getStats(),
            state: this.stateCache.getStats(),
        };
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

    public getMetrics(): {
        cache: {
            roomInfo: { size: number; hitRate: number };
            members: { size: number; hitRate: number };
            state: { size: number; hitRate: number };
        };
        requests: { total: number; successful: number; failed: number; retried: number };
    } {
        const cacheStats = this.getCacheStats();
        return {
            cache: {
                roomInfo: { size: cacheStats.roomInfo.size, hitRate: cacheStats.roomInfo.hitRate },
                members: { size: cacheStats.members.size, hitRate: cacheStats.members.hitRate },
                state: { size: cacheStats.state.size, hitRate: cacheStats.state.hitRate },
            },
            requests: this.getRequestStats(),
        };
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getRoomManager(): RoomManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomManager = function (): RoomManager {
        return new RoomManager(this);
    };
}

export default extendMatrixClient;
