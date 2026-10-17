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
import { logger } from "../../logger";
import { VendorPrefix } from "../../http-api/prefix";
import type { Body } from "../../http-api/interface";
import type { QueryDict } from "../../http-api/utils";
import { NotFoundError } from "../../errors";
import { BaseManager, type ManagerOpts } from "../../managers/base-manager";
import { LRUCache } from "../../utils/lru-cache";
import type { MatrixClient } from "../../client";
import { SpaceEvent, type SpaceManagerEventMap } from "../events";
import type { Space, SpaceListResponse, SpaceQueryOptions, SpaceStatistics } from "../types";
import { extractSpaces, normalizeSpace, sp } from "../utils";
import type { SpaceManager } from "../index";

type JsonObject = Record<string, unknown>; // Dynamic: arbitrary space response content

/**
 * 分级缓存配置
 *
 * 高频数据：用户空间列表、公共空间列表（访问频率高，变化相对缓慢）
 * 低频数据：单个 Space 详情、搜索结果（访问频率低，实时性要求高）
 */
const CACHE_CONFIGS = {
    highFrequency: {
        maxSize: 100,
        ttl: 10 * 60 * 1000, // 10 分钟 TTL
        name: "space-query-highfreq",
    },
    lowFrequency: {
        maxSize: 50,
        ttl: 3 * 60 * 1000, // 3 分钟 TTL
        name: "space-query-lowfreq",
    },
    singleSpace: {
        maxSize: 100,
        ttl: 5 * 60 * 1000, // 5 分钟 TTL
        name: "space-query-single",
    },
} as const;

/**
 * 遥测指标 - 缓存统计
 */
interface CacheTelemetry {
    totalRequests: number;
    cacheHits: number;
    cacheMisses: number;
    hitRate: number;
    latencies: number[];
    avgLatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
}

/**
 * 遥测指标 - 完整指标
 */
export interface SpaceQueryTelemetry {
    cache: CacheTelemetry;
    lastUpdated: number;
}

export class SpaceQueryManager extends BaseManager<SpaceEvent, SpaceManagerEventMap> {
    // 高频缓存：用户空间列表、公共空间列表
    private highFreqCache: LRUCache<Space[]>;
    // 低频缓存：搜索结果、统计信息
    private lowFreqCache: LRUCache<Space[]>;
    // 单个 Space 缓存
    private spaceCache: LRUCache<Space>;
    private parent: SpaceManager | null = null;

    // 遥测指标
    private telemetry: CacheTelemetry = {
        totalRequests: 0,
        cacheHits: 0,
        cacheMisses: 0,
        hitRate: 0,
        latencies: [],
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
    };

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
        this.highFreqCache = new LRUCache<Space[]>(CACHE_CONFIGS.highFrequency);
        this.lowFreqCache = new LRUCache<Space[]>(CACHE_CONFIGS.lowFrequency);
        this.spaceCache = new LRUCache<Space>(CACHE_CONFIGS.singleSpace);
    }

    /**
     * @internal
     */
    _setParent(parent: SpaceManager): void {
        this.parent = parent;
    }

    /**
     * 读取单个 Space 缓存（供 SpaceLifecycleManager.getSpace 使用）。
     *
     * @param spaceId - Space ID（不是底层房间 ID）。
     * @returns 命中时返回缓存的 `Space`，否则返回 `undefined`。
     *
     * @example
     * ```typescript
     * const cached = client.getSpaceManager().query.getCachedSpace("!abc:example.com");
     * if (cached) console.log(cached.name);
     * ```
     */
    getCachedSpace(spaceId: string): Space | undefined {
        return this.spaceCache.get(spaceId);
    }

    /**
     * 写入单个 Space 缓存（供 SpaceLifecycleManager.getSpace 使用）。
     *
     * @param spaceId - Space ID（不是底层房间 ID）。
     * @param space - 待缓存的 Space 对象。
     *
     * @example
     * ```typescript
     * const space = await client.getSpaceManager().lifecycle.getSpace("!abc:example.com");
     * client.getSpaceManager().query.setCachedSpace(space.space_id, space);
     * ```
     */
    setCachedSpace(spaceId: string, space: Space): void {
        this.spaceCache.set(spaceId, space);
    }

    /**
     * 清空所有缓存（供顶层 SpaceManager.clearCache 委托 + 其他 sub-manager 失效缓存调用）。
     *
     * @example
     * ```typescript
     * client.getSpaceManager().query.clearCache();
     * ```
     */
    clearCache(): void {
        this.highFreqCache.clear();
        this.lowFreqCache.clear();
        this.spaceCache.clear();
    }

    /**
     * 获取高频缓存统计信息（用户空间列表、公共空间列表）。
     *
     * @returns 缓存条目数、命中次数、未命中次数与命中率。
     *
     * @example
     * ```typescript
     * const stats = client.getSpaceManager().query.getHighFreqCacheStats();
     * console.log(`高频缓存命中率 ${(stats.hitRate * 100).toFixed(1)}%`);
     * ```
     */
    getHighFreqCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        return this.highFreqCache.getStats();
    }

    /**
     * 获取低频缓存统计信息（搜索结果、统计信息）。
     *
     * @returns 缓存条目数、命中次数、未命中次数与命中率。
     *
     * @example
     * ```typescript
     * const stats = client.getSpaceManager().query.getLowFreqCacheStats();
     * console.log(`低频缓存命中率 ${(stats.hitRate * 100).toFixed(1)}%`);
     * ```
     */
    getLowFreqCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        return this.lowFreqCache.getStats();
    }

    /**
     * 获取聚合缓存统计信息（高频 + 低频 + 单个 Space）。
     *
     * @returns 各分层的统计对象，以及三层合并后的 `total`。
     *
     * @example
     * ```typescript
     * const stats = client.getSpaceManager().query.getAggregatedCacheStats();
     * console.log(`总条目 ${stats.total.size}，总命中率 ${(stats.total.hitRate * 100).toFixed(1)}%`);
     * ```
     */
    getAggregatedCacheStats(): {
        highFreq: { size: number; hits: number; misses: number; hitRate: number };
        lowFreq: { size: number; hits: number; misses: number; hitRate: number };
        space: { size: number; hits: number; misses: number; hitRate: number };
        total: { size: number; hits: number; misses: number; hitRate: number };
    } {
        const highFreq = this.highFreqCache.getStats();
        const lowFreq = this.lowFreqCache.getStats();
        const space = this.spaceCache.getStats();

        const totalHits = highFreq.hits + lowFreq.hits + space.hits;
        const totalMisses = highFreq.misses + lowFreq.misses + space.misses;
        const totalSize = highFreq.size + lowFreq.size + space.size;

        return {
            highFreq,
            lowFreq,
            space,
            total: {
                size: totalSize,
                hits: totalHits,
                misses: totalMisses,
                hitRate: totalHits + totalMisses > 0 ? totalHits / (totalHits + totalMisses) : 0,
            },
        };
    }

    /**
     * 获取公共 Space 列表（服务发现场景）。
     *
     * 结果进高频缓存；需要绕过缓存时在 `options` 里传 `forceRefresh: true`。
     *
     * @param options - 查询参数，支持 `limit` / `from` 以及 `forceRefresh`。
     * @returns 服务端**原始响应**（未归一化）。若命中缓存则是 `{ chunk }`；
     *   否则是后端原样结构，列表可能落在 `chunk` / `spaces` / `rooms` 任一字段上，
     *   读取时请自行兜底（本方法不改变返回形态，以免破坏既有调用方）。
     *
     * @example
     * ```typescript
     * const { chunk } = await client.getSpaceManager().query.getPublicSpaces({ limit: 20 });
     * console.log(`发现 ${chunk?.length ?? 0} 个公共空间`);
     *
     * // 绕过缓存
     * await client.getSpaceManager().query.getPublicSpaces({ limit: 20, forceRefresh: true });
     * ```
     *
     * @throws {ApiError} 如果 API 调用失败。
     */
    async getPublicSpaces(options: SpaceQueryOptions = {}): Promise<SpaceListResponse> {
        const start = performance.now();
        this.telemetry.totalRequests++;

        try {
            const cacheKey = "public_spaces";
            const cached = this.highFreqCache.get(cacheKey);
            if (cached && !options.forceRefresh) {
                this.telemetry.cacheHits++;
                this.telemetry.latencies.push(performance.now() - start);
                return { chunk: cached };
            }

            const response = await this.withRetry(async () => {
                return await this.doRequest<SpaceListResponse>(Method.Get, sp("/spaces/public"), options);
            }, "getPublicSpaces");
            const spaces = extractSpaces(response);
            this.telemetry.cacheMisses++;
            // 公共空间列表放入高频缓存（访问频率高）
            this.highFreqCache.set(cacheKey, spaces);
            this.telemetry.latencies.push(performance.now() - start);
            return response;
        } catch (error) {
            this.telemetry.latencies.push(performance.now() - start);
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getPublicSpaces"));
            throw error;
        }
    }

    /**
     * 按关键词搜索 Space。
     *
     * 结果按 `search_{query}_{limit}` 进低频缓存（实时性要求高，缓存收益低时按需绕过）。
     *
     * @param query - 搜索词。
     * @param limit - 返回上限，默认 10。
     * @returns 匹配的 Space 数组（已归一化）。
     *
     * @example
     * ```typescript
     * const found = await client.getSpaceManager().query.searchSpaces("工程", 5);
     * console.log(found.map((s) => s.name ?? s.space_id).join(", "));
     * ```
     *
     * @throws {ApiError} 如果 API 调用失败。
     */
    async searchSpaces(query: string, limit: number = 10): Promise<Space[]> {
        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<SpaceListResponse>(Method.Get, sp("/spaces/search"), {
                    search_term: query,
                    limit,
                });
            }, "searchSpaces");
            const spaces = extractSpaces(response);
            // 搜索结果放入低频缓存（访问频率低，实时性要求高）
            const cacheKey = `search_${query}_${limit}`;
            this.lowFreqCache.set(cacheKey, spaces);
            return spaces;
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "searchSpaces"));
            throw error;
        }
    }

    /**
     * 获取 Space 统计信息（总数、公共/私有/已加入数量）。
     *
     * @returns 统计结果，字段可能缺失（后端按需返回）。
     *
     * @example
     * ```typescript
     * const stats = await client.getSpaceManager().query.getSpaceStatistics();
     * console.log(`共 ${stats.total_spaces ?? 0} 个 Space`);
     * ```
     *
     * @throws {ApiError} 当后端请求失败时抛出。
     */
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

    /**
     * 获取当前用户已加入的 Space 列表。
     *
     * 结果进高频缓存（`user_spaces`）；传 `forceRefresh = true` 可跳过缓存强制拉取。
     *
     * @param forceRefresh - 为 `true` 时跳过缓存重新拉取。
     * @returns 已归一化的 Space 数组。
     *
     * @example
     * ```typescript
     * const spaces = await client.getSpaceManager().query.getUserSpaces();
     * console.log(`已加入 ${spaces.length} 个 Space`);
     *
     * // 强制刷新
     * await client.getSpaceManager().query.getUserSpaces(true);
     * ```
     *
     * @throws {ApiError} 当后端请求失败时抛出。
     */
    async getUserSpaces(forceRefresh = false): Promise<Space[]> {
        const cacheKey = "user_spaces";
        if (!forceRefresh) {
            const cached = this.highFreqCache.get(cacheKey);
            if (cached) return cached;
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<SpaceListResponse>(Method.Get, sp("/spaces/user"));
            }, "getUserSpaces");
            const spaces = extractSpaces(response);
            // 用户空间列表放入高频缓存（最高频访问）
            this.highFreqCache.set(cacheKey, spaces);
            return spaces;
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getUserSpaces"));
            throw error;
        }
    }

    /**
     * 根据房间 ID 反查其所属的 Space。
     *
     * @param roomId - 房间 ID。
     * @returns 归一化后的 Space。
     *
     * @example
     * ```typescript
     * const space = await client.getSpaceManager().query.getSpaceByRoom("!room:example.com");
     * console.log(space.name);
     * ```
     *
     * @throws {ApiError} 当后端请求失败时抛出（房间不属于任何 Space 时通常为 404）。
     */
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

    /**
     * 获取某个房间所属的全部父 Space。
     *
     * @param roomId - 房间 ID。
     * @param options - 查询参数（透传给后端）。
     * @returns 已归一化的父 Space 数组。
     *
     * @example
     * ```typescript
     * const parents = await client.getSpaceManager().query.getRoomParentSpaces("!room:example.com");
     * console.log(parents.map((s) => s.name ?? s.space_id).join(", "));
     * ```
     *
     * @throws {ApiError} 当后端请求失败时抛出。
     */
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

    /**
     * 判断指定房间是否是一个 Space。
     *
     * 先尝试按房间反查所属 Space（命中即 `true`），失败时回退到本地房间的
     * `isSpaceRoom()` 判定；两侧都不成立则返回 `false`（本方法不抛错）。
     *
     * @param roomId - 房间 ID。
     * @returns 是 Space 时为 `true`，否则为 `false`。
     *
     * @example
     * ```typescript
     * const isSpace = await client.getSpaceManager().query.isSpace("!room:example.com");
     * console.log(isSpace ? "是 Space" : "不是 Space");
     * ```
     */
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

    /**
     * 缓存预热：预加载常用数据
     *
     * 应用场景：应用启动时、用户登录后、从后台恢复时
     * 预加载内容：用户空间列表、每个空间的层级信息
     *
     * @param options.maxSpaces - 最多预加载的空间数量（默认 20）
     * @param options.parallelLimit - 并发请求限制（默认 5）
     * @returns 预热结果：总数/加载成功/加载失败
     *
     * @example
     * ```typescript
     * // 应用启动时预热
     * const result = await spaceManager.query.preloadCommonSpaces();
     * console.log(`预热完成：${result.loaded}/${result.total} 个空间`);
     *
     * // 自定义参数
     * await spaceManager.query.preloadCommonSpaces({ maxSpaces: 10, parallelLimit: 3 });
     * ```
     */
    async preloadCommonSpaces(options: { maxSpaces?: number; parallelLimit?: number } = {}): Promise<{
        total: number;
        loaded: number;
        failed: number;
    }> {
        const { maxSpaces = 20, parallelLimit = 5 } = options;

        try {
            // 1. 获取用户空间列表（强制刷新以确保最新）
            const spaces = await this.getUserSpaces(true);
            const toLoad = spaces.slice(0, maxSpaces);

            if (toLoad.length === 0) {
                return { total: 0, loaded: 0, failed: 0 };
            }

            // 2. 分批预加载层级数据
            const results = { total: toLoad.length, loaded: 0, failed: 0 };

            for (let i = 0; i < toLoad.length; i += parallelLimit) {
                const batch = toLoad.slice(i, i + parallelLimit);
                const promises = batch.map(async (space) => {
                    try {
                        // 预加载单个空间的层级数据（委托给 hierarchy manager，forceRefresh=true）
                        await this.parent!.hierarchy.getSpaceHierarchy(space.room_id, true);
                        results.loaded++;
                    } catch (error) {
                        results.failed++;
                        // 静默失败，不中断整体预热流程
                        logger.warn(`Failed to preload space ${space.room_id}`, error);
                    }
                });

                // 等待当前批次完成
                await Promise.all(promises);
            }

            logger.info(`Space cache preload complete: ${results.loaded}/${results.total} loaded`);
            return results;
        } catch (error) {
            logger.error("Failed to preload spaces", error);
            return { total: 0, loaded: 0, failed: 0 };
        }
    }

    /**
     * 获取单个 Space 的成员数与子房间数（本地组合 `member` / `child` 两份数据）。
     *
     * @param spaceId - Space ID（不是底层房间 ID）。
     * @returns `{ memberCount, childCount }`。
     *
     * @example
     * ```typescript
     * const { memberCount, childCount } = await client.getSpaceManager().query.getSpaceStats("!abc:example.com");
     * console.log(`${memberCount} 位成员 / ${childCount} 个子房间`);
     * ```
     */
    async getSpaceStats(spaceId: string): Promise<{ memberCount: number; childCount: number }> {
        const [members, children] = await Promise.all([
            this.parent!.member.getSpaceMembers(spaceId),
            this.parent!.child.getSpaceChildren(spaceId),
        ]);
        return { memberCount: members.length, childCount: children.length };
    }

    /**
     * 获取遥测指标 — 包括缓存命中率、请求延迟分布
     * 供监控埋点使用
     *
     * @returns 缓存遥测指标（命中率、P95/P99 延迟等）与最近更新时间戳。
     *
     * @example
     * ```typescript
     * const telemetry = client.getSpaceManager().query.getTelemetry();
     * console.log(`P95 延迟 ${telemetry.cache.p95LatencyMs.toFixed(1)}ms`);
     * ```
     */
    public getTelemetry(): SpaceQueryTelemetry {
        const stats = this.getAggregatedCacheStats();
        const totalRequests = stats.total.hits + stats.total.misses;
        const cacheHitRate = totalRequests > 0 ? stats.total.hits / totalRequests : 0;

        const latencies = this.telemetry.latencies.slice(-100);
        const sorted = [...latencies].sort((a, b) => a - b);

        return {
            cache: {
                totalRequests: this.telemetry.totalRequests,
                cacheHits: this.telemetry.cacheHits,
                cacheMisses: this.telemetry.cacheMisses,
                hitRate: cacheHitRate,
                latencies: latencies,
                avgLatencyMs: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
                p95LatencyMs: sorted.length > 0 ? (sorted[Math.floor(sorted.length * 0.95)] ?? 0) : 0,
                p99LatencyMs: sorted.length > 0 ? (sorted[Math.floor(sorted.length * 0.99)] ?? 0) : 0,
            },
            lastUpdated: Date.now(),
        };
    }

    private async doRequest<T>(method: Method, path: string, queryParams?: QueryDict, body?: Body): Promise<T> {
        return await this.request<T>({
            method: method,
            path: path,
            queryParams: queryParams as Record<string, string | string[]>,
            body: body,
            prefix: VendorPrefix,
        });
    }
}
