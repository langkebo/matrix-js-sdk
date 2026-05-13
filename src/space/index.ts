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
import { NotFoundError } from "../errors";
import { type QueryDict } from "../utils";
import { logger } from "../logger";
import { BaseManager } from "../managers/base-manager";
import { LRUCache } from "../utils/lru-cache.ts";
import { AdminValidators } from "../admin/validators";
import { ValidationError } from "../errors";
import type { SpacePathPattern } from "./__generated__/route-table.ts";
import { getOrCreateManager } from "../client-infra/manager-registry";

type JsonObject = Record<string, unknown>;

type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function sp<P extends StripV3<SpacePathPattern>>(path: P): P {
    return path;
}

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
    updated_ts?: number;
    parent_space_id?: string;
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
    /** 必填：Space 关联的房间 ID（后端 CreateSpaceBody.room_id 是必填字段） */
    room_id: string;
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
    /** 后端 AddChildBody.via_servers 是必填 Vec<String>；缺省时 SDK 自动填 [] */
    via_servers?: string[];
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
export class SpaceManager extends BaseManager<SpaceEvent, SpaceManagerEventMap> {
    private cache: LRUCache<Space[]>;
    private spaceCache: LRUCache<Space>;
    private readonly maxRetries = 3;
    private readonly retryDelay = 1000;

    constructor(client: MatrixClient) {
        super(client);
        this.cache = new LRUCache<Space[]>({ maxSize: 50, ttl: 5 * 60 * 1000, name: "index.ts-space" });
        this.spaceCache = new LRUCache<Space>({ maxSize: 100, ttl: 5 * 60 * 1000, name: "index.ts-space" });
    }

    private isRetryableError(error: unknown): boolean {
        if (error instanceof MatrixError) {
            return (
                ["M_LIMIT_EXCEEDED", "M_SERVER_UNAVAILABLE", "M_UNKNOWN"].includes(error.errcode ?? "") ||
                [429, 502, 503, 504].includes(error.httpStatus ?? 0)
            );
        }
        const err = error as Record<string, unknown>;
        return (
            ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND"].includes(err?.code as string) ||
            [429, 500, 502, 503, 504].includes(err?.httpStatus as number)
        );
    }

    private async withRetryRequest<T>(
        requestFn: () => Promise<T>,
        method: string,
        retries = this.maxRetries,
    ): Promise<T> {
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
                    const normalized = this.normalizeError(error, method);
                    this.emit(SpaceEvent.SpaceError, normalized);
                    throw normalized;
                }
                if (attempt < retries) {
                    const delay = this.retryDelay * Math.pow(2, attempt);
                    logger.warn(`SpaceManager.${method} failed, retrying in ${delay}ms`);
                    await new Promise((r) => setTimeout(r, delay));
                }
            }
        }
        this.recordRequest(false, true);
        const normalized = this.normalizeError(lastError, method);
        this.emit(SpaceEvent.SpaceError, normalized);
        throw normalized;
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

    /**
     * 创建 Space
     *
     * @param options - 创建选项
     * @param options.name - Space 名称
     * @param options.topic - Space 主题（可选）
     * @param options.avatar_url - 头像 URL（可选）
     * @param options.join_rule - 加入规则（可选）
     * @param options.visibility - 可见性（public/private，可选）
     *
     * @example
     * ```typescript
     * // 创建公开 Space
     * const space = await spaceManager.createSpace({
     *     name: "My Public Space",
     *     topic: "A space for everyone",
     *     visibility: "public"
     * });
     * console.log("Created space:", space.space_id);
     *
     * // 创建私有 Space
     * const privateSpace = await spaceManager.createSpace({
     *     name: "Private Team Space",
     *     visibility: "private",
     *     join_rule: "invite"
     * });
     *
     * // 监听 Space 创建事件
     * spaceManager.on(SpaceEvent.SpaceCreated, (space) => {
     *     console.log(`Space created: ${space.name}`);
     * });
     * ```
     *
     * @throws {ValidationError} 如果名称为空或过长
     * @throws {ApiError} 如果 API 调用失败
     */
    async createSpace(options: CreateSpaceOptions): Promise<Space> {
        if (!options.room_id) {
            throw new ValidationError("Space room_id is required");
        }
        AdminValidators.validateRoomId(options.room_id);
        if (options.name && options.name.length > 255) {
            throw new ValidationError("Space name too long (max 255 characters)");
        }
        if (options.topic && options.topic.length > 1000) {
            throw new ValidationError("Space topic too long (max 1000 characters)");
        }
        if (options.avatar_url && options.avatar_url.length > 2048) {
            throw new ValidationError("Space avatar_url too long (max 2048 characters)");
        }
        if (options.join_rule && options.join_rule.length > 50) {
            throw new ValidationError("Space join_rule too long (max 50 characters)");
        }
        if (options.visibility && options.visibility.length > 50) {
            throw new ValidationError("Space visibility too long (max 50 characters)");
        }
        const response = await this.withRetryRequest(async () => {
            return await this.request<JsonObject>(Method.Post, sp("/spaces"), undefined, options);
        }, "createSpace");
        this.clearCache();
        const space = this.normalizeSpace(response);
        this.emit(SpaceEvent.SpaceCreated, space);
        return space;
    }

    /**
     * 获取 Space 信息
     *
     * @param spaceId - Space ID（格式：!localpart:homeserver）
     * @returns Space 信息
     *
     * @example
     * ```typescript
     * // 获取 Space 信息
     * const space = await spaceManager.getSpace("!abc:example.com");
     * console.log("Space name:", space.name);
     * console.log("Topic:", space.topic);
     * console.log("Members:", space.members);
     *
     * // 使用缓存（第二次调用会使用缓存）
     * const cachedSpace = await spaceManager.getSpace("!abc:example.com");
     * ```
     *
     * @throws {ValidationError} 如果 Space ID 格式无效
     * @throws {NotFoundError} 如果 Space 不存在
     * @throws {ApiError} 如果 API 调用失败
     */
    async getSpace(spaceId: string): Promise<Space> {
        AdminValidators.validateRoomId(spaceId);
        const cached = this.spaceCache.get(spaceId);
        if (cached) return cached;

        const response = await this.withRetryRequest(async () => {
            return await this.request<JsonObject>(Method.Get, this.spacePath("/spaces/$spaceId", spaceId));
        }, "getSpace");
        const space = this.normalizeSpace(response, spaceId);
        this.spaceCache.set(spaceId, space);
        return space;
    }

    async updateSpace(spaceId: string, options: UpdateSpaceOptions): Promise<Space> {
        const response = await this.withRetryRequest(async () => {
            return await this.request<JsonObject>(
                Method.Put,
                this.spacePath("/spaces/$spaceId", spaceId),
                undefined,
                options,
            );
        }, "updateSpace");
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
        await this.withRetryRequest(async () => {
            await this.request(Method.Delete, this.spacePath("/spaces/$spaceId", spaceId));
        }, "deleteSpace");
        this.clearCache();
        this.emit(SpaceEvent.SpaceDeleted, spaceId);
    }

    async getPublicSpaces(options: SpaceQueryOptions = {}): Promise<SpaceListResponse> {
        const response = await this.withRetryRequest(async () => {
            return await this.request<SpaceListResponse>(Method.Get, sp("/spaces/public"), options);
        }, "getPublicSpaces");
        return this.normalizeSpaceListResponse(response);
    }

    async searchSpaces(query: string, limit: number = 10): Promise<Space[]> {
        const response = await this.withRetryRequest(async () => {
            return await this.request<SpaceListResponse>(Method.Get, sp("/spaces/search"), {
                search_term: query,
                limit,
            });
        }, "searchSpaces");
        return this.extractSpaces(response);
    }

    async getSpaceStatistics(): Promise<SpaceStatistics> {
        return this.withRetryRequest(async () => {
            return await this.request<SpaceStatistics>(Method.Get, sp("/spaces/statistics"));
        }, "getSpaceStatistics");
    }

    async getUserSpaces(forceRefresh = false): Promise<Space[]> {
        const cacheKey = "user_spaces";
        if (!forceRefresh) {
            const cached = this.cache.get(cacheKey);
            if (cached) return cached;
        }

        const response = await this.withRetryRequest(async () => {
            return await this.request<SpaceListResponse>(Method.Get, sp("/spaces/user"));
        }, "getUserSpaces");
        const spaces = this.extractSpaces(response);
        this.cache.set(cacheKey, spaces);
        return spaces;
    }

    async getSpaceChildren(spaceId: string, options: SpaceQueryOptions = {}): Promise<SpaceChild[]> {
        const response = await this.withRetryRequest(async () => {
            return await this.request<JsonObject | SpaceChild[]>(
                Method.Get,
                this.spacePath("/spaces/$spaceId/children", spaceId),
                options,
            );
        }, "getSpaceChildren");
        return this.extractChildren(response, spaceId);
    }

    /**
     * 添加子房间到 Space
     *
     * @param spaceId - Space ID（格式：!localpart:homeserver）
     * @param options - 添加选项
     * @param options.room_id - 子房间 ID
     * @param options.via_servers - 服务器列表（可选）
     * @param options.order - 排序（可选）
     * @param options.suggested - 是否推荐（可选）
     *
     * @example
     * ```typescript
     * // 添加房间到 Space
     * await spaceManager.addChild("!space:example.com", {
     *     room_id: "!room:example.com"
     * });
     *
     * // 添加推荐房间
     * await spaceManager.addChild("!space:example.com", {
     *     room_id: "!room:example.com",
     *     suggested: true,
     *     order: "01"
     * });
     *
     * // 监听子房间添加事件
     * spaceManager.on(SpaceEvent.ChildAdded, (spaceId, roomId) => {
     *     console.log(`Room ${roomId} added to space ${spaceId}`);
     * });
     * ```
     *
     * @throws {ValidationError} 如果 Space ID 或房间 ID 格式无效
     * @throws {ApiError} 如果 API 调用失败
     */
    async addChild(spaceId: string, options: AddChildOptions): Promise<void> {
        AdminValidators.validateRoomId(spaceId);
        AdminValidators.validateRoomId(options.room_id);
        await this.withRetryRequest(async () => {
            await this.request(Method.Post, this.spacePath("/spaces/$spaceId/children", spaceId), undefined, {
                room_id: options.room_id,
                via_servers: options.via_servers ?? [],
                suggested: options.suggested,
            });
        }, "addChild");
        this.clearCache();
        this.emit(SpaceEvent.ChildAdded, spaceId, options.room_id);
    }

    async removeChild(spaceId: string, roomId: string): Promise<void> {
        await this.withRetryRequest(async () => {
            await this.request(
                Method.Delete,
                sp(`/spaces/${encodeURIComponent(spaceId)}/children/${encodeURIComponent(roomId)}`),
            );
        }, "removeChild");
        this.clearCache();
        this.emit(SpaceEvent.ChildRemoved, spaceId, roomId);
    }

    async getSpaceMembers(spaceId: string, options: SpaceQueryOptions = {}): Promise<SpaceMember[]> {
        const response = await this.withRetryRequest(async () => {
            return await this.request<JsonObject | SpaceMember[]>(
                Method.Get,
                this.spacePath("/spaces/$spaceId/members", spaceId),
                options,
            );
        }, "getSpaceMembers");
        return this.extractMembers(response, spaceId);
    }

    async getSpaceRooms(spaceId: string, options: SpaceQueryOptions = {}): Promise<Space[]> {
        const response = await this.withRetryRequest(async () => {
            return await this.request<SpaceListResponse>(
                Method.Get,
                this.spacePath("/spaces/$spaceId/rooms", spaceId),
                options,
            );
        }, "getSpaceRooms");
        return this.extractSpaces(response);
    }

    async getSpaceState(spaceId: string): Promise<unknown[]> {
        const response = await this.withRetryRequest(async () => {
            return await this.request<unknown[] | { events?: unknown[] }>(
                Method.Get,
                this.spacePath("/spaces/$spaceId/state", spaceId),
            );
        }, "getSpaceState");
        if (Array.isArray(response)) return response;
        return Array.isArray(response.events) ? response.events : [];
    }

    async inviteToSpace(spaceId: string, userId: string, body: JsonObject = {}): Promise<void> {
        await this.withRetryRequest(async () => {
            await this.request(Method.Post, this.spacePath("/spaces/$spaceId/invite", spaceId), undefined, {
                user_id: userId,
                ...body,
            });
        }, "inviteToSpace");
    }

    async joinSpace(spaceId: string, body: JsonObject = {}): Promise<JsonObject> {
        const result = await this.withRetryRequest(async () => {
            return await this.request<JsonObject>(
                Method.Post,
                this.spacePath("/spaces/$spaceId/join", spaceId),
                undefined,
                body,
            );
        }, "joinSpace");
        this.emit(SpaceEvent.MemberJoined, spaceId, this.client.getUserId() || "");
        return result;
    }

    async leaveSpace(spaceId: string, body: JsonObject = {}): Promise<void> {
        await this.withRetryRequest(async () => {
            await this.request(Method.Post, this.spacePath("/spaces/$spaceId/leave", spaceId), undefined, body);
        }, "leaveSpace");
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
        return this.withRetryRequest(async () => {
            return await this.request<SpaceHierarchyPage>(
                Method.Get,
                this.spacePath("/spaces/$spaceId/hierarchy", spaceId),
                options,
            );
        }, "getSpaceHierarchyPage");
    }

    async getSpaceHierarchyV1(spaceId: string, options: SpaceQueryOptions = {}): Promise<SpaceHierarchyPage> {
        return this.withRetryRequest(async () => {
            return await this.request<SpaceHierarchyPage>(
                Method.Get,
                this.spacePath("/spaces/$spaceId/hierarchy/v1", spaceId),
                options,
            );
        }, "getSpaceHierarchyV1");
    }

    async getSpaceSummary(spaceId: string, options: SpaceQueryOptions = {}): Promise<JsonObject> {
        return this.withRetryRequest(async () => {
            return await this.request<JsonObject>(
                Method.Get,
                this.spacePath("/spaces/$spaceId/summary", spaceId),
                options,
            );
        }, "getSpaceSummary");
    }

    async getSpaceSummaryWithChildren(spaceId: string, options: SpaceQueryOptions = {}): Promise<JsonObject> {
        return this.withRetryRequest(async () => {
            return await this.request<JsonObject>(
                Method.Get,
                this.spacePath("/spaces/$spaceId/summary/with_children", spaceId),
                options,
            );
        }, "getSpaceSummaryWithChildren");
    }

    async getSpaceTreePath(spaceId: string, options: SpaceQueryOptions = {}): Promise<JsonObject> {
        return this.withRetryRequest(async () => {
            return await this.request<JsonObject>(
                Method.Get,
                this.spacePath("/spaces/$spaceId/tree_path", spaceId),
                options,
            );
        }, "getSpaceTreePath");
    }

    async getSpaceByRoom(roomId: string): Promise<Space> {
        const response = await this.withRetryRequest(async () => {
            return await this.request<JsonObject>(Method.Get, sp(`/spaces/room/${encodeURIComponent(roomId)}`));
        }, "getSpaceByRoom");
        return this.normalizeSpace(response);
    }

    /**
     * @deprecated Use {@link getSpaceByRoom}. Kept for backward compatibility.
     */
    async getRoomSpace(roomId: string): Promise<Space> {
        return this.getSpaceByRoom(roomId);
    }

    async getRoomParentSpaces(roomId: string, options: SpaceQueryOptions = {}): Promise<Space[]> {
        const response = await this.withRetryRequest(async () => {
            return await this.request<SpaceListResponse>(
                Method.Get,
                sp(`/spaces/room/${encodeURIComponent(roomId)}/parents`),
                options,
            );
        }, "getRoomParentSpaces");
        return this.extractSpaces(response);
    }

    async isSpace(roomId: string): Promise<boolean> {
        try {
            await this.getSpaceByRoom(roomId);
            return true;
            // @swallow-error { owner: "space", expires: "2026-12-31" }
        } catch (error) {
            if (error instanceof NotFoundError) return false;
            const room = this.client.getRoom(roomId);
            return room?.isSpaceRoom?.() ?? false;
        }
    }

    async getSpaceStats(spaceId: string): Promise<{ memberCount: number; childCount: number }> {
        const [members, children] = await Promise.all([this.getSpaceMembers(spaceId), this.getSpaceChildren(spaceId)]);
        return { memberCount: members.length, childCount: children.length };
    }

    private async request<T>(method: Method, path: string, queryParams?: QueryDict, body?: Body): Promise<T> {
        return await this.client.http.authedRequest<T>(method, path, queryParams, body, {
            prefix: ClientPrefix.V3,
        });
    }

    private spacePath(pathTemplate: string, spaceId: string): string {
        return sp(pathTemplate.replace("$spaceId", encodeURIComponent(spaceId)) as StripV3<SpacePathPattern>);
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
            updated_ts: this.asNumber(space.updated_ts),
            parent_space_id: this.asString(space.parent_space_id),
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

    private asString(value: unknown): string | undefined {
        return typeof value === "string" ? value : undefined;
    }
    private asNumber(value: unknown): number | undefined {
        return typeof value === "number" ? value : undefined;
    }
    private asBoolean(value: unknown): boolean | undefined {
        return typeof value === "boolean" ? value : undefined;
    }
    private asStringArray(value: unknown): string[] {
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    }

    private clearCache(): void {
        this.cache.clear();
        this.spaceCache.clear();
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
        return getOrCreateManager(this, "space", () => new SpaceManager(this));
    };
}

export default extendMatrixClient;
