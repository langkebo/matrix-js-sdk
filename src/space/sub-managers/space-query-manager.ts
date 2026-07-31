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
 * SpaceQueryManager - Space 查询（公共空间、搜索、统计、用户空间、缓存）
 */

import { Method } from "../../http-api/method";
import { ClientPrefix } from "../../http-api/prefix";
import type { Body } from "../../http-api/interface";
import type { QueryDict } from "../../http-api/utils";
import { NotFoundError } from "../../errors";
import { BaseManager, type ManagerOpts } from "../../managers/base-manager";
import { LRUCache } from "../../utils/lru-cache";
import type { MatrixClient } from "../../client";
import { SpaceEvent, type SpaceManagerEventMap } from "../events";
import type { Space, SpaceListResponse, SpaceQueryOptions, SpaceStatistics } from "../types";
import { extractSpaces, normalizeSpace, normalizeSpaceListResponse, sp } from "../utils";
import type { SpaceManager } from "../index";

type JsonObject = Record<string, unknown>; // Dynamic: arbitrary space response content

export class SpaceQueryManager extends BaseManager<SpaceEvent, SpaceManagerEventMap> {
    private cache: LRUCache<Space[]>;
    private spaceCache: LRUCache<Space>;
    private parent: SpaceManager | null = null;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
        this.cache = new LRUCache<Space[]>({ maxSize: 50, ttl: 5 * 60 * 1000, name: "index.ts-space" });
        this.spaceCache = new LRUCache<Space>({ maxSize: 100, ttl: 5 * 60 * 1000, name: "index.ts-space" });
    }

    /**
     * @internal 由 SpaceManager 在构造后设置回引，便于跨 sub-manager 访问
     */
    _setParent(parent: SpaceManager): void {
        this.parent = parent;
    }

    // 读取单个 Space 缓存（供 SpaceLifecycleManager.getSpace 使用）
    getCachedSpace(spaceId: string): Space | undefined {
        return this.spaceCache.get(spaceId);
    }

    // 写入单个 Space 缓存（供 SpaceLifecycleManager.getSpace 使用）
    setCachedSpace(spaceId: string, space: Space): void {
        this.spaceCache.set(spaceId, space);
    }

    /** 清空所有缓存（供顶层 SpaceManager.clearCache 委托 + 其他 sub-manager 失效缓存调用） */
    clearCache(): void {
        this.cache.clear();
        this.spaceCache.clear();
    }

    // 返回列表缓存的统计信息（供 SpaceManager.getMetrics 使用）
    getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        return this.cache.getStats();
    }

    async getPublicSpaces(options: SpaceQueryOptions = {}): Promise<SpaceListResponse> {
        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<SpaceListResponse>(Method.Get, sp("/spaces/public"), options);
            }, "getPublicSpaces");
            return normalizeSpaceListResponse(response);
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
            return extractSpaces(response);
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
            const spaces = extractSpaces(response);
            this.cache.set(cacheKey, spaces);
            return spaces;
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getUserSpaces"));
            throw error;
        }
    }

    async getSpaceByRoom(roomId: string): Promise<Space> {
        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<JsonObject>(Method.Get, sp(`/spaces/room/${encodeURIComponent(roomId)}`));
            }, "getSpaceByRoom");
            return normalizeSpace(response);
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
            return extractSpaces(response);
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
        const [members, children] = await Promise.all([
            this.parent!.member.getSpaceMembers(spaceId),
            this.parent!.child.getSpaceChildren(spaceId),
        ]);
        return { memberCount: members.length, childCount: children.length };
    }

    private async doRequest<T>(method: Method, path: string, queryParams?: QueryDict, body?: Body): Promise<T> {
        return await this.request<T>({
            method: method,
            path: path,
            queryParams: queryParams as Record<string, string | string[]>,
            body: body,
            prefix: ClientPrefix.V3,
        });
    }
}
