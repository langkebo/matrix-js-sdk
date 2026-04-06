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
 * 契约基线：docs/api-contract/space.md
 * 目标：统一通过 `/spaces/*` HTTP 路由封装核心读写能力，
 * 同时保留少量向后兼容的聚合方法。
 *
 * 优化特性:
 * - LRU 缓存: Space 数据缓存
 * - 重试机制: 指数退避重试
 * - 监控指标: 请求统计和性能监控
 * - 事件系统: TypedEventEmitter
 */

import { MatrixClient } from "../client";
import { MatrixError } from "../http-api/errors";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { Body } from "../http-api/interface";
import { AuthError, NotFoundError, RetryableError, ApiError, SdkError } from "../errors";
import { encodeUri, type QueryDict } from "../utils";
import { TypedEventEmitter } from "../models/typed-event-emitter";
import { logger } from "../logger";

type JsonObject = Record<string, unknown>;

export enum SpaceEvent {
    SpaceCreated = "SpaceCreated",
    SpaceUpdated = "SpaceUpdated",
    SpaceDeleted = "SpaceDeleted",
    ChildAdded = "ChildAdded",
    ChildRemoved = "ChildRemoved",
    MemberJoined = "MemberJoined",
    MemberLeft = "MemberLeft",
    SpaceError = "SpaceError",
}

export interface Space {
    space_id: string;
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    creator?: string;
    join_rule?: string;
    visibility?: string;
    is_public?: boolean;
    created_ts?: number;
    [key: string]: unknown;
}

export interface SpaceChild {
    space_id: string;
    room_id: string;
    via_servers: string[];
    sender?: string;
    is_suggested?: boolean;
    added_ts?: number;
    order?: string;
    [key: string]: unknown;
}

export interface SpaceMember {
    space_id: string;
    user_id: string;
    membership?: string;
    joined_ts?: number;
    [key: string]: unknown;
}

export interface SpaceHierarchy {
    space: Space;
    children: SpaceChild[];
    members: SpaceMember[];
}

export interface SpaceListResponse {
    chunk?: Space[];
    spaces?: Space[];
    rooms?: Space[];
    next_batch?: string;
    prev_batch?: string;
    total_room_count_estimate?: number;
    [key: string]: unknown;
}

export interface SpaceHierarchyPage {
    rooms?: unknown[];
    next_batch?: string;
    [key: string]: unknown;
}

export interface SpaceStatistics {
    total_spaces?: number;
    public_spaces?: number;
    private_spaces?: number;
    joined_spaces?: number;
    [key: string]: unknown;
}

export interface SpaceQueryOptions extends QueryDict {
    limit?: number;
    from?: string;
    since?: string;
    max_depth?: number;
    suggested_only?: boolean;
    server?: string;
    search_term?: string;
}

export interface CreateSpaceOptions {
    room_id?: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    join_rule?: string;
    visibility?: "public" | "private";
    is_public?: boolean;
    parent_space_id?: string;
}

export interface UpdateSpaceOptions {
    name?: string;
    topic?: string;
    avatar_url?: string;
    join_rule?: string;
    visibility?: "public" | "private";
    is_public?: boolean;
}

export interface AddChildOptions {
    room_id: string;
    via_servers?: string[];
    order?: string;
    suggested?: boolean;
}

export interface SpaceManagerMetrics {
    cache: { size: number; hits: number; misses: number; hitRate: number };
    requests: { total: number; successful: number; failed: number; retried: number };
}

interface SpaceManagerEventMap {
    [SpaceEvent.SpaceCreated]: (space: Space) => void;
    [SpaceEvent.SpaceUpdated]: (space: Space) => void;
    [SpaceEvent.SpaceDeleted]: (spaceId: string) => void;
    [SpaceEvent.ChildAdded]: (spaceId: string, roomId: string) => void;
    [SpaceEvent.ChildRemoved]: (spaceId: string, roomId: string) => void;
    [SpaceEvent.MemberJoined]: (spaceId: string, userId: string) => void;
    [SpaceEvent.MemberLeft]: (spaceId: string, userId: string) => void;
    [SpaceEvent.SpaceError]: (error: Error) => void;
}

interface CacheEntry<T> { value: T; timestamp: number; }

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
        if (!entry) { this.misses++; return undefined; }
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
        if (this.cache.has(key)) { this.cache.delete(key); }
        else if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) this.cache.delete(firstKey);
        }
        this.cache.set(key, { value, timestamp: Date.now() });
    }

    delete(key: string): boolean { return this.cache.delete(key); }
    clear(): void { this.cache.clear(); this.hits = 0; this.misses = 0; }
    size(): number { return this.cache.size; }
    getStats(): { size: number; hits: number; misses: number; hitRate: number } {
        const total = this.hits + this.misses;
        return { size: this.cache.size, hits: this.hits, misses: this.misses, hitRate: total > 0 ? this.hits / total : 0 };
    }
}

export class SpaceManager extends TypedEventEmitter<SpaceEvent, SpaceManagerEventMap> {
    private client: MatrixClient;
    private cache: LRUCache<Space[]>;
    private spaceCache: LRUCache<Space>;
    private readonly maxRetries = 3;
    private readonly retryDelay = 1000;
    private requestStats = { total: 0, successful: 0, failed: 0, retried: 0 };

    constructor(client: MatrixClient) {
        super();
        this.client = client;
        this.cache = new LRUCache<Space[]>(50, 5 * 60 * 1000);
        this.spaceCache = new LRUCache<Space>(100, 5 * 60 * 1000);
    }

    private isRetryableError(error: unknown): boolean {
        if (error instanceof MatrixError) {
            return ["M_LIMIT_EXCEEDED", "M_SERVER_UNAVAILABLE", "M_UNKNOWN"].includes(error.errcode ?? "") ||
                [429, 502, 503, 504].includes(error.httpStatus ?? 0);
        }
        const err = error as Record<string, unknown>;
        return ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND"].includes(err?.code as string) ||
            [429, 500, 502, 503, 504].includes(err?.httpStatus as number);
    }

    private async withRetry<T>(requestFn: () => Promise<T>, method: string, retries = this.maxRetries): Promise<T> {
        let lastError: unknown;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const result = await requestFn();
                this.recordRequest(true, attempt > 0);
                return result;
            } catch (error: unknown) {
                lastError = error;
                if (!this.isRetryableError(error)) {
                    this.recordRequest(false, false);
                    throw this.normalizeError(error, method);
                }
                if (attempt < retries) {
                    const delay = this.retryDelay * Math.pow(2, attempt);
                    logger.warn(`SpaceManager.${method} failed, retrying in ${delay}ms`);
                    await new Promise(r => setTimeout(r, delay));
                }
            }
        }
        this.recordRequest(false, true);
        throw this.normalizeError(lastError, method);
    }

    private recordRequest(success: boolean, retried: boolean): void {
        this.requestStats.total++;
        if (success) this.requestStats.successful++;
        else this.requestStats.failed++;
        if (retried) this.requestStats.retried++;
    }

    public getMetrics(): SpaceManagerMetrics {
        return { cache: this.cache.getStats(), requests: { ...this.requestStats } };
    }

    async createSpace(options: CreateSpaceOptions): Promise<Space> {
        const response = await this.withRetry(async () => {
            return await this.request<JsonObject>(Method.Post, "/spaces", undefined, options);
        }, 'createSpace');
        this.clearCache();
        const space = this.normalizeSpace(response);
        this.emit(SpaceEvent.SpaceCreated, space);
        return space;
    }

    async getSpace(spaceId: string): Promise<Space> {
        const cached = this.spaceCache.get(spaceId);
        if (cached) return cached;

        const response = await this.withRetry(async () => {
            return await this.request<JsonObject>(Method.Get, this.spacePath("/spaces/$spaceId", spaceId));
        }, 'getSpace');
        const space = this.normalizeSpace(response, spaceId);
        this.spaceCache.set(spaceId, space);
        return space;
    }

    async updateSpace(spaceId: string, options: UpdateSpaceOptions): Promise<Space> {
        const response = await this.withRetry(async () => {
            return await this.request<JsonObject>(Method.Put, this.spacePath("/spaces/$spaceId", spaceId), undefined, options);
        }, 'updateSpace');
        this.clearCache();
        let space: Space;
        if (Object.keys(response ?? {}).length === 0) {
            space = await this.getSpace(spaceId);
        } else {
            space = this.normalizeSpace(response, spaceId);
        }
        this.emit(SpaceEvent.SpaceUpdated, space);
        return space;
    }

    async deleteSpace(spaceId: string): Promise<void> {
        await this.withRetry(async () => {
            await this.request(Method.Delete, this.spacePath("/spaces/$spaceId", spaceId));
        }, 'deleteSpace');
        this.clearCache();
        this.emit(SpaceEvent.SpaceDeleted, spaceId);
    }

    async getPublicSpaces(options: SpaceQueryOptions = {}): Promise<SpaceListResponse> {
        const response = await this.withRetry(async () => {
            return await this.request<SpaceListResponse>(Method.Get, "/spaces/public", options);
        }, 'getPublicSpaces');
        return this.normalizeSpaceListResponse(response);
    }

    async searchSpaces(query: string, limit: number = 10): Promise<Space[]> {
        const response = await this.withRetry(async () => {
            return await this.request<SpaceListResponse>(Method.Get, "/spaces/search", {
                search_term: query,
                limit,
            });
        }, 'searchSpaces');
        return this.extractSpaces(response);
    }

    async getSpaceStatistics(): Promise<SpaceStatistics> {
        return this.withRetry(async () => {
            return await this.request<SpaceStatistics>(Method.Get, "/spaces/statistics");
        }, 'getSpaceStatistics');
    }

    async getUserSpaces(forceRefresh = false): Promise<Space[]> {
        const cacheKey = "user_spaces";
        if (!forceRefresh) {
            const cached = this.cache.get(cacheKey);
            if (cached) return cached;
        }

        const response = await this.withRetry(async () => {
            return await this.request<SpaceListResponse>(Method.Get, "/spaces/user");
        }, 'getUserSpaces');
        const spaces = this.extractSpaces(response);
        this.cache.set(cacheKey, spaces);
        return spaces;
    }

    async getSpaceChildren(spaceId: string, options: SpaceQueryOptions = {}): Promise<SpaceChild[]> {
        const response = await this.withRetry(async () => {
            return await this.request<JsonObject | SpaceChild[]>(
                Method.Get,
                this.spacePath("/spaces/$spaceId/children", spaceId),
                options,
            );
        }, 'getSpaceChildren');
        return this.extractChildren(response, spaceId);
    }

    async addChild(spaceId: string, options: AddChildOptions): Promise<void> {
        await this.withRetry(async () => {
            await this.request(Method.Post, this.spacePath("/spaces/$spaceId/children", spaceId), undefined, {
                room_id: options.room_id,
                via_servers: options.via_servers,
                order: options.order,
                suggested: options.suggested,
            });
        }, 'addChild');
        this.clearCache();
        this.emit(SpaceEvent.ChildAdded, spaceId, options.room_id);
    }

    async removeChild(spaceId: string, roomId: string): Promise<void> {
        await this.withRetry(async () => {
            await this.request(
                Method.Delete,
                encodeUri("/spaces/$spaceId/children/$roomId", { $spaceId: spaceId, $roomId: roomId }),
            );
        }, 'removeChild');
        this.clearCache();
        this.emit(SpaceEvent.ChildRemoved, spaceId, roomId);
    }

    async getSpaceMembers(spaceId: string, options: SpaceQueryOptions = {}): Promise<SpaceMember[]> {
        const response = await this.withRetry(async () => {
            return await this.request<JsonObject | SpaceMember[]>(
                Method.Get,
                this.spacePath("/spaces/$spaceId/members", spaceId),
                options,
            );
        }, 'getSpaceMembers');
        return this.extractMembers(response, spaceId);
    }

    async getSpaceRooms(spaceId: string, options: SpaceQueryOptions = {}): Promise<Space[]> {
        const response = await this.withRetry(async () => {
            return await this.request<SpaceListResponse>(
                Method.Get,
                this.spacePath("/spaces/$spaceId/rooms", spaceId),
                options,
            );
        }, 'getSpaceRooms');
        return this.extractSpaces(response);
    }

    async getSpaceState(spaceId: string): Promise<unknown[]> {
        const response = await this.withRetry(async () => {
            return await this.request<unknown[] | { events?: unknown[] }>(
                Method.Get,
                this.spacePath("/spaces/$spaceId/state", spaceId),
            );
        }, 'getSpaceState');
        if (Array.isArray(response)) return response;
        return Array.isArray(response.events) ? response.events : [];
    }

    async inviteToSpace(spaceId: string, userId: string, body: JsonObject = {}): Promise<void> {
        await this.withRetry(async () => {
            await this.request(Method.Post, this.spacePath("/spaces/$spaceId/invite", spaceId), undefined, {
                user_id: userId,
                ...body,
            });
        }, 'inviteToSpace');
    }

    async joinSpace(spaceId: string, body: JsonObject = {}): Promise<JsonObject> {
        const result = await this.withRetry(async () => {
            return await this.request<JsonObject>(Method.Post, this.spacePath("/spaces/$spaceId/join", spaceId), undefined, body);
        }, 'joinSpace');
        this.emit(SpaceEvent.MemberJoined, spaceId, this.client.getUserId() || "");
        return result;
    }

    async leaveSpace(spaceId: string, body: JsonObject = {}): Promise<void> {
        await this.withRetry(async () => {
            await this.request(Method.Post, this.spacePath("/spaces/$spaceId/leave", spaceId), undefined, body);
        }, 'leaveSpace');
        this.clearCache();
        this.emit(SpaceEvent.MemberLeft, spaceId, this.client.getUserId() || "");
    }

    async getSpaceHierarchy(spaceId: string): Promise<SpaceHierarchy> {
        const [space, children, members] = await Promise.all([
            this.getSpace(spaceId),
            this.getSpaceChildren(spaceId),
            this.getSpaceMembers(spaceId),
        ]);
        return { space, children, members };
    }

    async getSpaceHierarchyPage(spaceId: string, options: SpaceQueryOptions = {}): Promise<SpaceHierarchyPage> {
        return this.withRetry(async () => {
            return await this.request<SpaceHierarchyPage>(
                Method.Get,
                this.spacePath("/spaces/$spaceId/hierarchy", spaceId),
                options,
            );
        }, 'getSpaceHierarchyPage');
    }

    async getSpaceHierarchyV1(spaceId: string, options: SpaceQueryOptions = {}): Promise<SpaceHierarchyPage> {
        return this.withRetry(async () => {
            return await this.request<SpaceHierarchyPage>(
                Method.Get,
                this.spacePath("/spaces/$spaceId/hierarchy/v1", spaceId),
                options,
            );
        }, 'getSpaceHierarchyV1');
    }

    async getSpaceSummary(spaceId: string, options: SpaceQueryOptions = {}): Promise<JsonObject> {
        return this.withRetry(async () => {
            return await this.request<JsonObject>(Method.Get, this.spacePath("/spaces/$spaceId/summary", spaceId), options);
        }, 'getSpaceSummary');
    }

    async getSpaceSummaryWithChildren(spaceId: string, options: SpaceQueryOptions = {}): Promise<JsonObject> {
        return this.withRetry(async () => {
            return await this.request<JsonObject>(
                Method.Get,
                this.spacePath("/spaces/$spaceId/summary/with_children", spaceId),
                options,
            );
        }, 'getSpaceSummaryWithChildren');
    }

    async getSpaceTreePath(spaceId: string, options: SpaceQueryOptions = {}): Promise<JsonObject> {
        return this.withRetry(async () => {
            return await this.request<JsonObject>(Method.Get, this.spacePath("/spaces/$spaceId/tree_path", spaceId), options);
        }, 'getSpaceTreePath');
    }

    async getRoomSpace(roomId: string): Promise<Space> {
        const response = await this.withRetry(async () => {
            return await this.request<JsonObject>(
                Method.Get,
                encodeUri("/spaces/room/$roomId", { $roomId: roomId }),
            );
        }, 'getRoomSpace');
        return this.normalizeSpace(response);
    }

    async getRoomParentSpaces(roomId: string, options: SpaceQueryOptions = {}): Promise<Space[]> {
        const response = await this.withRetry(async () => {
            return await this.request<SpaceListResponse>(
                Method.Get,
                encodeUri("/spaces/room/$roomId/parents", { $roomId: roomId }),
                options,
            );
        }, 'getRoomParentSpaces');
        return this.extractSpaces(response);
    }

    async isSpace(roomId: string): Promise<boolean> {
        try {
            await this.getRoomSpace(roomId);
            return true;
        } catch (error) {
            if (error instanceof NotFoundError) return false;
            const room = this.client.getRoom(roomId);
            return room?.isSpaceRoom?.() ?? false;
        }
    }

    async getSpaceStats(spaceId: string): Promise<{ memberCount: number; childCount: number }> {
        const [members, children] = await Promise.all([
            this.getSpaceMembers(spaceId),
            this.getSpaceChildren(spaceId),
        ]);
        return { memberCount: members.length, childCount: children.length };
    }

    private async request<T>(
        method: Method,
        path: string,
        queryParams?: QueryDict,
        body?: Body,
    ): Promise<T> {
        return await this.client.http.authedRequest<T>(method, path, queryParams, body, {
            prefix: ClientPrefix.V3,
        });
    }

    private spacePath(pathTemplate: string, spaceId: string): string {
        return encodeUri(pathTemplate, { $spaceId: spaceId });
    }

    private normalizeSpaceListResponse(response: SpaceListResponse): SpaceListResponse {
        return { ...response, chunk: this.extractSpaces(response) };
    }

    private extractSpaces(response: unknown): Space[] {
        if (Array.isArray(response)) return response.map((item) => this.normalizeSpace(item as JsonObject));
        const payload = response as JsonObject;
        const rawList = payload.spaces ?? payload.chunk ?? payload.rooms ?? [];
        if (!Array.isArray(rawList)) return [];
        return rawList.map((item) => this.normalizeSpace(item as JsonObject));
    }

    private extractChildren(response: unknown, spaceId: string): SpaceChild[] {
        if (Array.isArray(response)) return response.map((item) => this.normalizeChild(item as JsonObject, spaceId));
        const payload = response as JsonObject;
        const rawList = payload.children ?? payload.chunk ?? payload.rooms ?? [];
        if (!Array.isArray(rawList)) return [];
        return rawList.map((item) => this.normalizeChild(item as JsonObject, spaceId));
    }

    private extractMembers(response: unknown, spaceId: string): SpaceMember[] {
        if (Array.isArray(response)) return response.map((item) => this.normalizeMember(item as JsonObject, spaceId));
        const payload = response as JsonObject;
        const rawList = payload.members ?? payload.chunk ?? [];
        if (!Array.isArray(rawList)) return [];
        return rawList.map((item) => this.normalizeMember(item as JsonObject, spaceId));
    }

    private normalizeSpace(space: JsonObject = {}, fallbackId = ""): Space {
        const roomId = this.asString(space.room_id) || this.asString(space.space_id) || fallbackId;
        const joinRule = this.asString(space.join_rule);
        const visibility = this.asString(space.visibility);
        return {
            ...space,
            space_id: this.asString(space.space_id) || roomId,
            room_id: roomId,
            name: this.asString(space.name),
            topic: this.asString(space.topic),
            avatar_url: this.asString(space.avatar_url),
            creator: this.asString(space.creator),
            join_rule: joinRule,
            visibility,
            is_public: this.asBoolean(space.is_public) ?? (visibility === "public" || joinRule === "public"),
            created_ts: this.asNumber(space.created_ts),
        };
    }

    private normalizeChild(child: JsonObject = {}, spaceId: string): SpaceChild {
        return {
            ...child,
            space_id: spaceId,
            room_id: this.asString(child.room_id) || this.asString(child.child_room_id) || "",
            via_servers: this.asStringArray(child.via_servers ?? child.via),
            sender: this.asString(child.sender),
            is_suggested: this.asBoolean(child.is_suggested ?? child.suggested),
            added_ts: this.asNumber(child.added_ts ?? child.created_ts),
            order: this.asString(child.order),
        };
    }

    private normalizeMember(member: JsonObject = {}, spaceId: string): SpaceMember {
        return {
            ...member,
            space_id: spaceId,
            user_id: this.asString(member.user_id) ?? "",
            membership: this.asString(member.membership),
            joined_ts: this.asNumber(member.joined_ts ?? member.created_ts),
        };
    }

    private asString(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
    private asNumber(value: unknown): number | undefined { return typeof value === "number" ? value : undefined; }
    private asBoolean(value: unknown): boolean | undefined { return typeof value === "boolean" ? value : undefined; }
    private asStringArray(value: unknown): string[] {
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    }

    private normalizeError(error: unknown, method: string): SdkError {
        const err = error as Error;
        if (error instanceof MatrixError) {
            if (error.httpStatus === 401 || error.errcode === "M_UNKNOWN_TOKEN") {
                return new AuthError(`SpaceManager.${method} failed: ${err?.message ?? "Unknown error"}`, error);
            }
            if (error.httpStatus === 404 || error.errcode === "M_NOT_FOUND") {
                return new NotFoundError(`SpaceManager.${method} failed: ${err?.message ?? "Unknown error"}`, error);
            }
            if (this.isRetryableError(error)) {
                return new RetryableError(`SpaceManager.${method} failed: ${err?.message ?? "Unknown error"}`, error);
            }
            return new ApiError(
                `SpaceManager.${method} failed: ${err?.message ?? "Unknown error"}`,
                error.errcode,
                error.httpStatus,
                error,
            );
        }
        return new ApiError(`SpaceManager.${method} failed: ${err?.message ?? String(error)}`, "UNKNOWN", 0, error);
    }

    private clearCache(): void {
        this.cache.clear();
        this.spaceCache.clear();
    }

    start(): void { this.clearCache(); }
    stop(): void { this.clearCache(); }
}

declare module "../client.ts" {
    interface MatrixClient { getSpaceManager(): SpaceManager; }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSpaceManager = function (): SpaceManager { return new SpaceManager(this); };
}

export default extendMatrixClient;
