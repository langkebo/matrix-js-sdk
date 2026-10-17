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
 * Space Manager - Space 空间管理（门面层）
 *
 * 契约基线：docs/api-contract/space.md
 *
 * 采用组合模式，将原 SpaceManager 拆分为 5 个 sub-managers：
 * - lifecycle: CRUD（创建、读取、更新、删除）
 * - query: 查询（公共空间、搜索、统计、用户空间、缓存）
 * - child: 子房间管理
 * - member: 成员管理
 * - hierarchy: 层级管理
 *
 * 通过 sub-manager 访问具体能力：`spaceManager.lifecycle.createSpace(...)`。
 */

import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

import { SpaceEvent, type SpaceManagerEventMap } from "./events";
import type { SpaceManagerMetrics } from "./types";

import { SpaceLifecycleManager } from "./sub-managers/space-lifecycle-manager";
import { SpaceQueryManager } from "./sub-managers/space-query-manager";
import { SpaceChildManager } from "./sub-managers/space-child-manager";
import { SpaceMemberManager } from "./sub-managers/space-member-manager";
import { SpaceHierarchyManager } from "./sub-managers/space-hierarchy-manager";
import { Method } from "../http-api/method";
import * as utils from "../utils";

// 事件 + 类型 re-export（向后兼容）
export { SpaceEvent } from "./events";
export type { SpaceManagerEventMap } from "./events";
export * from "./types";
export { SpaceLifecycleManager } from "./sub-managers/space-lifecycle-manager";
export { SpaceQueryManager } from "./sub-managers/space-query-manager";
export { SpaceChildManager } from "./sub-managers/space-child-manager";
export { SpaceMemberManager } from "./sub-managers/space-member-manager";
export { SpaceHierarchyManager } from "./sub-managers/space-hierarchy-manager";

/**
 * Space Manager - Space 空间管理统一入口
 *
 * 通过组合模式将功能委托到 sub-managers。
 *
 * @example
 * ```typescript
 * const space = await spaceManager.lifecycle.getSpace("!abc:example.com");
 * const children = await spaceManager.child.getSpaceChildren("!abc:example.com");
 * ```
 */
export class SpaceManager extends BaseManager<SpaceEvent, SpaceManagerEventMap> {
    // ===== sub-managers（组合模式） =====
    public readonly lifecycle: SpaceLifecycleManager;
    public readonly query: SpaceQueryManager;
    public readonly child: SpaceChildManager;
    public readonly member: SpaceMemberManager;
    public readonly hierarchy: SpaceHierarchyManager;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
        this.lifecycle = new SpaceLifecycleManager(client, opts);
        this.query = new SpaceQueryManager(client, opts);
        this.child = new SpaceChildManager(client, opts);
        this.member = new SpaceMemberManager(client, opts);
        this.hierarchy = new SpaceHierarchyManager(client, opts);

        // 设置回引，便于 sub-manager 跨域访问（缓存、聚合方法）
        this.lifecycle._setParent(this);
        this.query._setParent(this);
        this.child._setParent(this);
        this.member._setParent(this);
        this.hierarchy._setParent(this);

        // 转发 sub-manager 事件到顶层（保持 manager.on(SpaceEvent.X, ...) 向后兼容）
        this.forwardSubManagerEvents();
    }

    /**
     * 将所有 sub-manager 的 SpaceEvent 转发到顶层 SpaceManager。
     * 由于 sub-manager 和顶层共用 SpaceEvent enum，直接 re-emit 即可。
     */
    private forwardSubManagerEvents(): void {
        const subManagers: BaseManager<SpaceEvent, SpaceManagerEventMap>[] = [
            this.lifecycle,
            this.query,
            this.child,
            this.member,
            this.hierarchy,
        ];
        for (const sm of subManagers) {
            sm.on(SpaceEvent.SpaceCreated, (space) => this.emit(SpaceEvent.SpaceCreated, space));
            sm.on(SpaceEvent.SpaceUpdated, (space) => this.emit(SpaceEvent.SpaceUpdated, space));
            sm.on(SpaceEvent.SpaceDeleted, (spaceId) => this.emit(SpaceEvent.SpaceDeleted, spaceId));
            sm.on(SpaceEvent.ChildAdded, (spaceId, roomId) => this.emit(SpaceEvent.ChildAdded, spaceId, roomId));
            sm.on(SpaceEvent.ChildRemoved, (spaceId, roomId) => this.emit(SpaceEvent.ChildRemoved, spaceId, roomId));
            sm.on(SpaceEvent.MemberJoined, (spaceId, userId) => this.emit(SpaceEvent.MemberJoined, spaceId, userId));
            sm.on(SpaceEvent.MemberLeft, (spaceId, userId) => this.emit(SpaceEvent.MemberLeft, spaceId, userId));
            sm.on(SpaceEvent.SpaceError, (error) => this.emit(SpaceEvent.SpaceError, error));
        }
    }

    // ===== 顶层协调方法 =====

    /**
     * 聚合所有 sub-manager 的缓存与请求统计，用于性能监控。
     *
     * 缓存维度分别汇总 query（高/低频、space、总计）与 hierarchy 的命中率；请求维度
     * 汇总 5 个 sub-manager 的 total / successful / failed / retried 计数。
     *
     * @returns SpaceManagerMetrics —— 缓存统计与请求统计的快照。
     * @example
     * const metrics = client.getSpaceManager().getMetrics();
     * console.log(`${metrics.requests.total} 次请求，失败 ${metrics.requests.failed} 次`);
     */
    public getMetrics(): SpaceManagerMetrics {
        const queryAggregated = this.query.getAggregatedCacheStats();
        const hierarchyCache = this.hierarchy.getCacheStats();
        const stats = [this.lifecycle, this.query, this.child, this.member, this.hierarchy]
            .map((m) => m.getRequestStats())
            .reduce(
                (acc, s) => ({
                    total: acc.total + s.total,
                    successful: acc.successful + s.successful,
                    failed: acc.failed + s.failed,
                    retried: acc.retried + s.retried,
                }),
                { total: 0, successful: 0, failed: 0, retried: 0 },
            );
        return {
            cache: {
                query: {
                    highFreq: queryAggregated.highFreq,
                    lowFreq: queryAggregated.lowFreq,
                    space: queryAggregated.space,
                    total: queryAggregated.total,
                },
                hierarchy: hierarchyCache,
            },
            requests: stats,
        };
    }

    /**
     * 清空 query 与 hierarchy 两个 sub-manager 的缓存。
     *
     * 适用于缓存数据可能已过期、需要强制重新拉取的场景（如切换账号或长时间离线后）。
     *
     * @example
     * client.getSpaceManager().clearCache();
     */
    clearCache(): void {
        this.query.clearCache();
        this.hierarchy.clearHierarchyCache();
    }

    /**
     * 启动 SpaceManager —— 当前实现为清空 query 缓存，确保以干净状态开始。
     *
     * @example
     * client.getSpaceManager().start();
     */
    start(): void {
        this.query.clearCache();
    }

    /**
     * 停止 SpaceManager：清空 query 缓存，并移除所有 sub-manager 上的事件转发监听器，
     * 防止 stop() 之后仍收到事件回调（监听器泄漏）。
     *
     * @example
     * client.getSpaceManager().stop();
     */
    stop(): void {
        this.query.clearCache();
        // 清理 forwardSubManagerEvents 注册的转发监听器，防止 stop() 后事件泄漏
        this.lifecycle.removeAllListeners();
        this.query.removeAllListeners();
        this.child.removeAllListeners();
        this.member.removeAllListeners();
        this.hierarchy.removeAllListeners();
    }

    // ===== 顶层工具方法 =====

    /**
     * Get all state events for a room via the standard Matrix /rooms/{roomId}/state endpoint.
     * Unlike getSpaceState (which uses /spaces/{spaceId}/state), this uses the standard
     * room state endpoint and returns raw state events.
     *
     * @param roomId - The room ID (typically a space room)
     * @returns Array of raw state event objects
     * @example
     * const events = await client.getSpaceManager().getRoomStateEventsRaw("!abc:example.com");
     * console.log(`${events.length} 个状态事件`);
     */
    public async getRoomStateEventsRaw(roomId: string): Promise<Array<Record<string, unknown>>> {
        const path = utils.encodeUri("/rooms/$roomId/state", { $roomId: roomId });
        return await this.withRetry(async () => {
            return await this.request<Array<Record<string, unknown>>>({
                method: Method.Get,
                path: path,
            });
        }, "getRoomStateEventsRaw");
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSpaceManager = function (): SpaceManager {
        registerManagerClass("space", SpaceManager);
        return getOrCreateManager(this, "space", () => new SpaceManager(this));
    };
}
