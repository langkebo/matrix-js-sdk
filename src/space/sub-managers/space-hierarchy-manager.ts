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
 * SpaceHierarchyManager - Space 层级管理（层级聚合、分页、V1、摘要、树路径）
 */

import { Method } from "../../http-api/method";
import { ClientPrefix, VendorPrefix } from "../../http-api/prefix";
import type { Body } from "../../http-api/interface";
import type { QueryDict } from "../../http-api/utils";
import { BaseManager, type ManagerOpts } from "../../managers/base-manager";
import type { MatrixClient } from "../../client";
import { SpaceEvent, type SpaceManagerEventMap } from "../events";
import type { SpaceHierarchy, SpaceHierarchyPage, SpaceQueryOptions } from "../types";
import { spacePath } from "../utils";
import type { SpaceManager } from "../index";
import { UnifiedCacheManager, CacheManagerFactory } from "../../managers/cache-manager";
import { TelemetryManager } from "../../telemetry/index";

type JsonObject = Record<string, unknown>; // Dynamic: arbitrary space hierarchy response content

export class SpaceHierarchyManager extends BaseManager<SpaceEvent, SpaceManagerEventMap> {
    private parent: SpaceManager | null = null;
    private hierarchyCache: UnifiedCacheManager;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
        this.hierarchyCache = CacheManagerFactory.createSpaceCache();
    }

    /**
     * @internal
     */
    _setParent(parent: SpaceManager): void {
        this.parent = parent;
    }

    /**
     * 清空层级缓存（供顶层 SpaceManager.clearCache 委托）。
     *
     * @example
     * ```typescript
     * client.getSpaceManager().hierarchy.clearHierarchyCache();
     * ```
     */
    clearHierarchyCache(): void {
        this.hierarchyCache.invalidate(["*"]);
    }

    /**
     * 获取缓存统计信息（供性能监控使用）。
     *
     * @returns 缓存条目数、命中次数、未命中次数与命中率。
     *
     * @example
     * ```typescript
     * const stats = client.getSpaceManager().hierarchy.getCacheStats();
     * console.log(`命中率 ${(stats.hitRate * 100).toFixed(1)}%（${stats.size} 条）`);
     * ```
     */
    getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        const stats = this.hierarchyCache.getStats();
        return {
            size: stats.size,
            hits: stats.hits,
            misses: stats.misses,
            hitRate: stats.hitRate,
        };
    }

    /**
     * 获取 Space 的完整层级：Space 本体 + 直接子房间 + 成员。
     *
     * 内部并发拉取三份数据（`lifecycle.getSpace` / `child.getSpaceChildren` /
     * `member.getSpaceMembers`）并缓存结果。`child.addChild` / `removeChild` 会失效缓存，
     * 但成员变化不会 —— 成员更新后如需即时反映，传 `forceRefresh = true`。
     *
     * @param spaceId - Space ID（不是底层房间 ID）。
     * @param forceRefresh - 为 `true` 时跳过缓存重新拉取。
     * @returns `{ space, children, members }`。
     *
     * @example
     * ```typescript
     * const h = await client.getSpaceManager().hierarchy.getSpaceHierarchy(spaceId);
     * console.log(`${h.space.name}: ${h.children.length} 个子房间, ${h.members.length} 位成员`);
     * ```
     *
     * @throws {ValidationError} 如果 Space ID 格式无效。
     * @throws {ApiError} 如果任一子请求失败（`Promise.all` 会整体拒绝）。
     */
    async getSpaceHierarchy(spaceId: string, forceRefresh = false): Promise<SpaceHierarchy> {
        const start = performance.now();
        let cacheHit = false;

        if (!forceRefresh) {
            const cached = this.hierarchyCache.get<SpaceHierarchy>(spaceId);
            if (cached) {
                cacheHit = true;
                const duration = performance.now() - start;
                const telemetry = (
                    this.client as MatrixClient & { getTelemetryManager?: () => TelemetryManager }
                ).getTelemetryManager?.();
                telemetry?.trackCacheHitMiss("hierarchy", cacheHit, duration);
                telemetry?.trackRequestTiming(
                    "GET",
                    duration,
                    "success",
                    `/spaces/${encodeURIComponent(spaceId)}/hierarchy`,
                );
                telemetry?.trackPerformanceBaseline("getSpaceHierarchy", duration, 100);
                return cached;
            }
        }

        // 使用 getOrFetch 简化逻辑
        const hierarchy = await this.hierarchyCache.getOrFetch(spaceId, async () => {
            const [space, children, members] = await Promise.all([
                this.parent!.lifecycle.getSpace(spaceId),
                this.parent!.child.getSpaceChildren(spaceId),
                this.parent!.member.getSpaceMembers(spaceId),
            ]);

            const hierarchy: SpaceHierarchy = { space, children, members };
            const duration = performance.now() - start;
            const telemetry = (
                this.client as MatrixClient & { getTelemetryManager?: () => TelemetryManager }
            ).getTelemetryManager?.();
            telemetry?.trackCacheHitMiss("hierarchy", cacheHit, duration);
            telemetry?.trackRequestTiming(
                "GET",
                duration,
                "success",
                `/spaces/${encodeURIComponent(spaceId)}/hierarchy`,
            );
            telemetry?.trackPerformanceBaseline("getSpaceHierarchy", duration, 100);

            return hierarchy;
        });

        return hierarchy;
    }

    /**
     * 分页获取 Space 层级（`/_matrix/client/v3` 的 `hierarchy` 端点）。
     *
     * 与 `getSpaceHierarchy` 不同，本方法不做本地缓存，把 `options` 直接透传给后端，
     * 适合按 `from` / `limit` 翻页遍历大型层级。
     *
     * @param spaceId - Space ID（不是底层房间 ID）。
     * @param options - 分页与查询参数（如 `limit` / `from` / `max_depth`）。
     * @returns 层级分页结果：`rooms` 为当前页房间列表，`next_batch` 为下一页游标。
     *
     * @example
     * ```typescript
     * const page = await client.getSpaceManager().hierarchy.getSpaceHierarchyPage(spaceId, { limit: 20 });
     * console.log(`本页 ${page.rooms?.length ?? 0} 个房间，下一页 ${page.next_batch ?? "无"}`);
     * ```
     *
     * @throws {ApiError} 当后端请求失败时抛出。
     */
    async getSpaceHierarchyPage(spaceId: string, options: SpaceQueryOptions = {}): Promise<SpaceHierarchyPage> {
        try {
            return await this.withRetry(async () => {
                return await this.doRequest<SpaceHierarchyPage>(
                    Method.Get,
                    spacePath("/spaces/$spaceId/hierarchy", spaceId),
                    options,
                );
            }, "getSpaceHierarchyPage");
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceHierarchyPage"));
            throw error;
        }
    }

    /**
     * 分页获取 Space 层级（`hierarchy/v1` 变体）。
     *
     * 与 `getSpaceHierarchyPage` 取同一份数据，仅路径带 `/v1`；后端对 v1/v3 双份注册，
     * 需要显式命中 v1 语义时使用。
     *
     * @param spaceId - Space ID（不是底层房间 ID）。
     * @param options - 分页与查询参数（如 `limit` / `from` / `max_depth`）。
     * @returns 层级分页结果：`rooms` 为当前页房间列表，`next_batch` 为下一页游标。
     *
     * @example
     * ```typescript
     * const page = await client.getSpaceManager().hierarchy.getSpaceHierarchyV1(spaceId, { limit: 20 });
     * console.log(page.rooms ?? []);
     * ```
     *
     * @throws {ApiError} 当后端请求失败时抛出。
     */
    async getSpaceHierarchyV1(spaceId: string, options: SpaceQueryOptions = {}): Promise<SpaceHierarchyPage> {
        try {
            return await this.withRetry(async () => {
                return await this.doRequest<SpaceHierarchyPage>(
                    Method.Get,
                    spacePath("/spaces/$spaceId/hierarchy/v1", spaceId),
                    options,
                );
            }, "getSpaceHierarchyV1");
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceHierarchyV1"));
            throw error;
        }
    }

    /**
     * 获取 Space 摘要（`/_matrix/vendor/v1/spaces/{spaceId}/summary`）。
     *
     * 摘要只含概览字段，不展开子房间明细，适合列表/卡片场景。返回结构较宽松，
     * 未做归一化，请按需读取字段。
     *
     * @param spaceId - Space ID（不是底层房间 ID）。
     * @param options - 查询参数（透传给后端）。
     * @returns 后端原始摘要对象。
     *
     * @example
     * ```typescript
     * const summary = await client.getSpaceManager().hierarchy.getSpaceSummary(spaceId);
     * console.log(summary);
     * ```
     *
     * @throws {ApiError} 当后端请求失败时抛出。
     */
    async getSpaceSummary(spaceId: string, options: SpaceQueryOptions = {}): Promise<JsonObject> {
        try {
            return await this.withRetry(async () => {
                return await this.doRequestVendor<JsonObject>(
                    Method.Get,
                    spacePath("/spaces/$spaceId/summary", spaceId),
                    options,
                );
            }, "getSpaceSummary");
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceSummary"));
            throw error;
        }
    }

    /**
     * 获取 Space 摘要，并附带子房间（`.../summary/with_children`）。
     *
     * 相比 `getSpaceSummary` 会多展开一层子房间，适合需要展示「Space + 其直属房间」
     * 的层级视图。
     *
     * @param spaceId - Space ID（不是底层房间 ID）。
     * @param options - 查询参数（透传给后端）。
     * @returns 含子房间的后端原始摘要对象。
     *
     * @example
     * ```typescript
     * const summary = await client.getSpaceManager().hierarchy.getSpaceSummaryWithChildren(spaceId);
     * console.log(summary);
     * ```
     *
     * @throws {ApiError} 当后端请求失败时抛出。
     */
    async getSpaceSummaryWithChildren(spaceId: string, options: SpaceQueryOptions = {}): Promise<JsonObject> {
        try {
            return await this.withRetry(async () => {
                return await this.doRequestVendor<JsonObject>(
                    Method.Get,
                    spacePath("/spaces/$spaceId/summary/with_children", spaceId),
                    options,
                );
            }, "getSpaceSummaryWithChildren");
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceSummaryWithChildren"));
            throw error;
        }
    }

    /**
     * 获取从根 Space 到目标 Space 的树路径（`.../tree_path`）。
     *
     * 用于面包屑导航或判断 Space 的祖先链。
     *
     * @param spaceId - Space ID（不是底层房间 ID）。
     * @param options - 查询参数（透传给后端）。
     * @returns 后端原始树路径对象。
     *
     * @example
     * ```typescript
     * const path = await client.getSpaceManager().hierarchy.getSpaceTreePath(spaceId);
     * console.log(path);
     * ```
     *
     * @throws {ApiError} 当后端请求失败时抛出。
     */
    async getSpaceTreePath(spaceId: string, options: SpaceQueryOptions = {}): Promise<JsonObject> {
        try {
            return await this.withRetry(async () => {
                return await this.doRequestVendor<JsonObject>(
                    Method.Get,
                    spacePath("/spaces/$spaceId/tree_path", spaceId),
                    options,
                );
            }, "getSpaceTreePath");
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceTreePath"));
            throw error;
        }
    }

    /**
     * `/_matrix/client/v3` 前缀（`hierarchy` / `hierarchy/v1` —— 后端 v1/v3 双份注册，v3 合法）。
     */
    private async doRequest<T>(method: Method, path: string, queryParams?: QueryDict, body?: Body): Promise<T> {
        return await this.request<T>({
            method: method,
            path: path,
            queryParams: queryParams as Record<string, string | string[]>,
            body: body,
            prefix: ClientPrefix.V3,
        });
    }

    /**
     * `/_matrix/vendor/v1` 前缀 —— space 的私有扩展（`summary` / `summary/with_children` /
     * `tree_path`）已归位 vendor（后端 Batch 1–3），不能再走 `doRequest`（那会打 client v3 并 404）。
     *
     * ⚠️ 本文件是 `src/space/` 下**唯一混用两个前缀**的文件（其余 4 个 sub-manager 整族 vendor）；
     * `verify-path-contract.mjs` 的 `doRequest` byDir 因此对本文件单独声明。
     */
    private async doRequestVendor<T>(method: Method, path: string, queryParams?: QueryDict, body?: Body): Promise<T> {
        return await this.request<T>({
            method: method,
            path: path,
            queryParams: queryParams as Record<string, string | string[]>,
            body: body,
            prefix: VendorPrefix,
        });
    }
}
