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
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { Body } from "../http-api/interface";
import { NotFoundError } from "../errors";
import { type QueryDict } from "../utils";
import { BaseManager } from "../managers/base-manager";
import { LRUCache } from "../utils/lru-cache";
import { validateRoomId } from "../common/validators";
import { ValidationError } from "../errors";
import type { SpacePathPattern } from "./__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

type JsonObject = Record<string, unknown>; // Dynamic: arbitrary space child state content

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
}

export interface SpaceChild {
    space_id: string;
    room_id: string;
    via_servers: string[];
    sender?: string;
    is_suggested?: boolean;
    added_ts?: number;
    order?: string;
}

export interface SpaceMember {
    space_id: string;
    user_id: string;
    membership?: string;
    joined_ts?: number;
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
}

export interface SpaceHierarchyPage {
    rooms?: unknown[];
    next_batch?: string;
}

export interface SpaceStatistics {
    total_spaces?: number;
    public_spaces?: number;
    private_spaces?: number;
    joined_spaces?: number;
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

    constructor(client: MatrixClient) {
        super(client);
        this.cache = new LRUCache<Space[]>({ maxSize: 50, ttl: 5 * 60 * 1000, name: "index.ts-space" });
        this.spaceCache = new LRUCache<Space>({ maxSize: 100, ttl: 5 * 60 * 1000, name: "index.ts-space" });
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
        validateRoomId(options.room_id);
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
        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<JsonObject>(Method.Post, sp("/spaces"), undefined, options);
            }, "createSpace");
            this.clearCache();
            const space = this.normalizeSpace(response);
            this.emit(SpaceEvent.SpaceCreated, space);
            return space;
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "createSpace"));
            throw error;
        }
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
        validateRoomId(spaceId);
        const cached = this.spaceCache.get(spaceId);
        if (cached) return cached;

        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<JsonObject>(Method.Get, this.spacePath("/spaces/$spaceId", spaceId));
            }, "getSpace");
            const space = this.normalizeSpace(response, spaceId);
            this.spaceCache.set(spaceId, space);
            return space;
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpace"));
            throw error;
        }
    }

    async updateSpace(spaceId: string, options: UpdateSpaceOptions): Promise<Space> {
        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<JsonObject>(
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
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "updateSpace"));
            throw error;
        }
    }

    async deleteSpace(spaceId: string): Promise<void> {
        try {
            await this.withRetry(async () => {
                await this.doRequest(Method.Delete, this.spacePath("/spaces/$spaceId", spaceId));
            }, "deleteSpace");
            this.clearCache();
            this.emit(SpaceEvent.SpaceDeleted, spaceId);
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "deleteSpace"));
            throw error;
        }
    }

    async getPublicSpaces(options: SpaceQueryOptions = {}): Promise<SpaceListResponse> {
        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<SpaceListResponse>(Method.Get, sp("/spaces/public"), options);
            }, "getPublicSpaces");
            return this.normalizeSpaceListResponse(response);
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getPublicSpaces"));
            throw error;
        }
    }

    async searchSpaces(query: string, limit: number = 10): Promise<Space[]> {
        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<SpaceListResponse>(Method.Get, sp("/spaces/search"), {
                    search_term: query,
                    limit,
                });
            }, "searchSpaces");
            return this.extractSpaces(response);
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "searchSpaces"));
            throw error;
        }
    }

    async getSpaceStatistics(): Promise<SpaceStatistics> {
        try {
            return await this.withRetry(async () => {
                return await this.doRequest<SpaceStatistics>(Method.Get, sp("/spaces/statistics"));
            }, "getSpaceStatistics");
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceStatistics"));
            throw error;
        }
    }

    async getUserSpaces(forceRefresh = false): Promise<Space[]> {
        const cacheKey = "user_spaces";
        if (!forceRefresh) {
            const cached = this.cache.get(cacheKey);
            if (cached) return cached;
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<SpaceListResponse>(Method.Get, sp("/spaces/user"));
            }, "getUserSpaces");
            const spaces = this.extractSpaces(response);
            this.cache.set(cacheKey, spaces);
            return spaces;
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getUserSpaces"));
            throw error;
        }
    }

    async getSpaceChildren(spaceId: string, options: SpaceQueryOptions = {}): Promise<SpaceChild[]> {
        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<JsonObject | SpaceChild[]>(
                    Method.Get,
                    this.spacePath("/spaces/$spaceId/children", spaceId),
                    options,
                );
            }, "getSpaceChildren");
            return this.extractChildren(response, spaceId);
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceChildren"));
            throw error;
        }
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
        validateRoomId(spaceId);
        validateRoomId(options.room_id);
        try {
            await this.withRetry(async () => {
                await this.doRequest(Method.Post, this.spacePath("/spaces/$spaceId/children", spaceId), undefined, {
                    room_id: options.room_id,
                    via_servers: options.via_servers ?? [],
                    suggested: options.suggested,
                });
            }, "addChild");
            this.clearCache();
            this.emit(SpaceEvent.ChildAdded, spaceId, options.room_id);
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "addChild"));
            throw error;
        }
    }

    async removeChild(spaceId: string, roomId: string): Promise<void> {
        try {
            await this.withRetry(async () => {
                await this.doRequest(
                    Method.Delete,
                    sp(`/spaces/${encodeURIComponent(spaceId)}/children/${encodeURIComponent(roomId)}`),
                );
            }, "removeChild");
            this.clearCache();
            this.emit(SpaceEvent.ChildRemoved, spaceId, roomId);
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "removeChild"));
            throw error;
        }
    }

    async getSpaceMembers(spaceId: string, options: SpaceQueryOptions = {}): Promise<SpaceMember[]> {
        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<JsonObject | SpaceMember[]>(
                    Method.Get,
                    this.spacePath("/spaces/$spaceId/members", spaceId),
                    options,
                );
            }, "getSpaceMembers");
            return this.extractMembers(response, spaceId);
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceMembers"));
            throw error;
        }
    }

    async getSpaceRooms(spaceId: string, options: SpaceQueryOptions = {}): Promise<Space[]> {
        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<SpaceListResponse>(
                    Method.Get,
                    this.spacePath("/spaces/$spaceId/rooms", spaceId),
                    options,
                );
            }, "getSpaceRooms");
            return this.extractSpaces(response);
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceRooms"));
            throw error;
        }
    }

    async getSpaceState(spaceId: string): Promise<unknown[]> {
        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<unknown[] | { events?: unknown[] }>(
                    Method.Get,
                    this.spacePath("/spaces/$spaceId/state", spaceId),
                );
            }, "getSpaceState");
            if (Array.isArray(response)) return response;
            return Array.isArray(response.events) ? response.events : [];
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceState"));
            throw error;
        }
    }

    async inviteToSpace(spaceId: string, userId: string, body: JsonObject = {}): Promise<void> {
        try {
            await this.withRetry(async () => {
                await this.doRequest(Method.Post, this.spacePath("/spaces/$spaceId/invite", spaceId), undefined, {
                    user_id: userId,
                    ...body,
                });
            }, "inviteToSpace");
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "inviteToSpace"));
            throw error;
        }
    }

    async joinSpace(spaceId: string, body: JsonObject = {}): Promise<JsonObject> {
        try {
            const result = await this.withRetry(async () => {
                return await this.doRequest<JsonObject>(
                    Method.Post,
                    this.spacePath("/spaces/$spaceId/join", spaceId),
                    undefined,
                    body,
                );
            }, "joinSpace");
            this.emit(SpaceEvent.MemberJoined, spaceId, this.client.getUserId() || "");
            return result;
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "joinSpace"));
            throw error;
        }
    }

    async leaveSpace(spaceId: string, body: JsonObject = {}): Promise<void> {
        try {
            await this.withRetry(async () => {
                await this.doRequest(Method.Post, this.spacePath("/spaces/$spaceId/leave", spaceId), undefined, body);
            }, "leaveSpace");
            this.clearCache();
            this.emit(SpaceEvent.MemberLeft, spaceId, this.client.getUserId() || "");
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "leaveSpace"));
            throw error;
        }
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
        try {
            return await this.withRetry(async () => {
                return await this.doRequest<SpaceHierarchyPage>(
                    Method.Get,
                    this.spacePath("/spaces/$spaceId/hierarchy", spaceId),
                    options,
                );
            }, "getSpaceHierarchyPage");
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceHierarchyPage"));
            throw error;
        }
    }

    async getSpaceHierarchyV1(spaceId: string, options: SpaceQueryOptions = {}): Promise<SpaceHierarchyPage> {
        try {
            return await this.withRetry(async () => {
                return await this.doRequest<SpaceHierarchyPage>(
                    Method.Get,
                    this.spacePath("/spaces/$spaceId/hierarchy/v1", spaceId),
                    options,
                );
            }, "getSpaceHierarchyV1");
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceHierarchyV1"));
            throw error;
        }
    }

    async getSpaceSummary(spaceId: string, options: SpaceQueryOptions = {}): Promise<JsonObject> {
        try {
            return await this.withRetry(async () => {
                return await this.doRequest<JsonObject>(
                    Method.Get,
                    this.spacePath("/spaces/$spaceId/summary", spaceId),
                    options,
                );
            }, "getSpaceSummary");
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceSummary"));
            throw error;
        }
    }

    async getSpaceSummaryWithChildren(spaceId: string, options: SpaceQueryOptions = {}): Promise<JsonObject> {
        try {
            return await this.withRetry(async () => {
                return await this.doRequest<JsonObject>(
                    Method.Get,
                    this.spacePath("/spaces/$spaceId/summary/with_children", spaceId),
                    options,
                );
            }, "getSpaceSummaryWithChildren");
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceSummaryWithChildren"));
            throw error;
        }
    }

    async getSpaceTreePath(spaceId: string, options: SpaceQueryOptions = {}): Promise<JsonObject> {
        try {
            return await this.withRetry(async () => {
                return await this.doRequest<JsonObject>(
                    Method.Get,
                    this.spacePath("/spaces/$spaceId/tree_path", spaceId),
                    options,
                );
            }, "getSpaceTreePath");
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceTreePath"));
            throw error;
        }
    }

    async getSpaceByRoom(roomId: string): Promise<Space> {
        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<JsonObject>(Method.Get, sp(`/spaces/room/${encodeURIComponent(roomId)}`));
            }, "getSpaceByRoom");
            return this.normalizeSpace(response);
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceByRoom"));
            throw error;
        }
    }

    async getRoomParentSpaces(roomId: string, options: SpaceQueryOptions = {}): Promise<Space[]> {
        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<SpaceListResponse>(
                    Method.Get,
                    sp(`/spaces/room/${encodeURIComponent(roomId)}/parents`),
                    options,
                );
            }, "getRoomParentSpaces");
            return this.extractSpaces(response);
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getRoomParentSpaces"));
            throw error;
        }
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

    private async doRequest<T>(method: Method, path: string, queryParams?: QueryDict, body?: Body): Promise<T> {
        return await this.request<T>({ method: method, path: path, queryParams: queryParams as Record<string, string | string[]>, body: body, prefix: ClientPrefix.V3 });
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


export function extendMatrixClient(): void {
    MatrixClient.prototype.getSpaceManager = function (): SpaceManager {
        registerManagerClass("space", SpaceManager);
    return getOrCreateManager(this, "space", () => new SpaceManager(this));
    };
}

export default extendMatrixClient;
