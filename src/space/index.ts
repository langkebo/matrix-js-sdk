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
 * 所有原有方法保持向后兼容（委托到 sub-manager，`@deprecated` 标注迁移路径）。
 * 推荐新代码直接使用 sub-manager：`spaceManager.lifecycle.createSpace(...)`。
 */

import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

import { SpaceEvent, type SpaceManagerEventMap } from "./events";
import type {
    AddChildOptions,
    CreateSpaceOptions,
    Space,
    SpaceChild,
    SpaceHierarchy,
    SpaceHierarchyPage,
    SpaceListResponse,
    SpaceManagerMetrics,
    SpaceMember,
    SpaceQueryOptions,
    SpaceStatistics,
    UpdateSpaceOptions,
} from "./types";

import { SpaceLifecycleManager } from "./sub-managers/space-lifecycle-manager";
import { SpaceQueryManager } from "./sub-managers/space-query-manager";
import { SpaceChildManager } from "./sub-managers/space-child-manager";
import { SpaceMemberManager } from "./sub-managers/space-member-manager";
import { SpaceHierarchyManager } from "./sub-managers/space-hierarchy-manager";

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
 * 通过组合模式将功能委托到 sub-managers，同时保持完全向后兼容。
 *
 * @example
 * ```typescript
 * // 向后兼容：直接在 SpaceManager 上调用方法
 * const space = await spaceManager.getSpace("!abc:example.com");
 *
 * // 推荐新方式：通过 sub-manager 访问
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

    public getMetrics(): SpaceManagerMetrics {
        const cacheStats = this.query.getCacheStats();
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
        return { cache: cacheStats, requests: stats };
    }

    clearCache(): void {
        this.query.clearCache();
    }

    start(): void {
        this.query.clearCache();
    }

    stop(): void {
        this.query.clearCache();
    }

    // ===== 向后兼容委托方法（@deprecated，推荐直接使用 sub-manager） =====

    /** @deprecated 使用 `spaceManager.lifecycle.createSpace()` 替代 */
    async createSpace(options: CreateSpaceOptions): Promise<Space> {
        return this.lifecycle.createSpace(options);
    }

    /** @deprecated 使用 `spaceManager.lifecycle.getSpace()` 替代 */
    async getSpace(spaceId: string): Promise<Space> {
        return this.lifecycle.getSpace(spaceId);
    }

    /** @deprecated 使用 `spaceManager.lifecycle.updateSpace()` 替代 */
    async updateSpace(spaceId: string, options: UpdateSpaceOptions): Promise<Space> {
        return this.lifecycle.updateSpace(spaceId, options);
    }

    /** @deprecated 使用 `spaceManager.lifecycle.deleteSpace()` 替代 */
    async deleteSpace(spaceId: string): Promise<void> {
        return this.lifecycle.deleteSpace(spaceId);
    }

    /** @deprecated 使用 `spaceManager.query.getPublicSpaces()` 替代 */
    async getPublicSpaces(options: SpaceQueryOptions = {}): Promise<SpaceListResponse> {
        return this.query.getPublicSpaces(options);
    }

    /** @deprecated 使用 `spaceManager.query.searchSpaces()` 替代 */
    async searchSpaces(query: string, limit: number = 10): Promise<Space[]> {
        return this.query.searchSpaces(query, limit);
    }

    /** @deprecated 使用 `spaceManager.query.getSpaceStatistics()` 替代 */
    async getSpaceStatistics(): Promise<SpaceStatistics> {
        return this.query.getSpaceStatistics();
    }

    /** @deprecated 使用 `spaceManager.query.getUserSpaces()` 替代 */
    async getUserSpaces(forceRefresh = false): Promise<Space[]> {
        return this.query.getUserSpaces(forceRefresh);
    }

    /** @deprecated 使用 `spaceManager.query.getSpaceByRoom()` 替代 */
    async getSpaceByRoom(roomId: string): Promise<Space> {
        return this.query.getSpaceByRoom(roomId);
    }

    /** @deprecated 使用 `spaceManager.query.getRoomParentSpaces()` 替代 */
    async getRoomParentSpaces(roomId: string, options: SpaceQueryOptions = {}): Promise<Space[]> {
        return this.query.getRoomParentSpaces(roomId, options);
    }

    /** @deprecated 使用 `spaceManager.query.isSpace()` 替代 */
    async isSpace(roomId: string): Promise<boolean> {
        return this.query.isSpace(roomId);
    }

    /** @deprecated 使用 `spaceManager.query.getSpaceStats()` 替代 */
    async getSpaceStats(spaceId: string): Promise<{ memberCount: number; childCount: number }> {
        return this.query.getSpaceStats(spaceId);
    }

    /** @deprecated 使用 `spaceManager.child.getSpaceChildren()` 替代 */
    async getSpaceChildren(spaceId: string, options: SpaceQueryOptions = {}): Promise<SpaceChild[]> {
        return this.child.getSpaceChildren(spaceId, options);
    }

    /** @deprecated 使用 `spaceManager.child.addChild()` 替代 */
    async addChild(spaceId: string, options: AddChildOptions): Promise<void> {
        return this.child.addChild(spaceId, options);
    }

    /** @deprecated 使用 `spaceManager.child.removeChild()` 替代 */
    async removeChild(spaceId: string, roomId: string): Promise<void> {
        return this.child.removeChild(spaceId, roomId);
    }

    /** @deprecated 使用 `spaceManager.child.getSpaceRooms()` 替代 */
    async getSpaceRooms(spaceId: string, options: SpaceQueryOptions = {}): Promise<Space[]> {
        return this.child.getSpaceRooms(spaceId, options);
    }

    /** @deprecated 使用 `spaceManager.child.getSpaceState()` 替代 */
    async getSpaceState(spaceId: string): Promise<unknown[]> {
        return this.child.getSpaceState(spaceId);
    }

    /** @deprecated 使用 `spaceManager.member.getSpaceMembers()` 替代 */
    async getSpaceMembers(spaceId: string, options: SpaceQueryOptions = {}): Promise<SpaceMember[]> {
        return this.member.getSpaceMembers(spaceId, options);
    }

    /** @deprecated 使用 `spaceManager.member.inviteToSpace()` 替代 */
    async inviteToSpace(spaceId: string, userId: string, body: Record<string, unknown> = {}): Promise<void> {
        return this.member.inviteToSpace(spaceId, userId, body);
    }

    /** @deprecated 使用 `spaceManager.member.joinSpace()` 替代 */
    async joinSpace(spaceId: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
        return this.member.joinSpace(spaceId, body);
    }

    /** @deprecated 使用 `spaceManager.member.leaveSpace()` 替代 */
    async leaveSpace(spaceId: string, body: Record<string, unknown> = {}): Promise<void> {
        return this.member.leaveSpace(spaceId, body);
    }

    /** @deprecated 使用 `spaceManager.hierarchy.getSpaceHierarchy()` 替代 */
    async getSpaceHierarchy(spaceId: string): Promise<SpaceHierarchy> {
        return this.hierarchy.getSpaceHierarchy(spaceId);
    }

    /** @deprecated 使用 `spaceManager.hierarchy.getSpaceHierarchyPage()` 替代 */
    async getSpaceHierarchyPage(spaceId: string, options: SpaceQueryOptions = {}): Promise<SpaceHierarchyPage> {
        return this.hierarchy.getSpaceHierarchyPage(spaceId, options);
    }

    /** @deprecated 使用 `spaceManager.hierarchy.getSpaceHierarchyV1()` 替代 */
    async getSpaceHierarchyV1(spaceId: string, options: SpaceQueryOptions = {}): Promise<SpaceHierarchyPage> {
        return this.hierarchy.getSpaceHierarchyV1(spaceId, options);
    }

    /** @deprecated 使用 `spaceManager.hierarchy.getSpaceSummary()` 替代 */
    async getSpaceSummary(spaceId: string, options: SpaceQueryOptions = {}): Promise<Record<string, unknown>> {
        return this.hierarchy.getSpaceSummary(spaceId, options);
    }

    /** @deprecated 使用 `spaceManager.hierarchy.getSpaceSummaryWithChildren()` 替代 */
    async getSpaceSummaryWithChildren(
        spaceId: string,
        options: SpaceQueryOptions = {},
    ): Promise<Record<string, unknown>> {
        return this.hierarchy.getSpaceSummaryWithChildren(spaceId, options);
    }

    /** @deprecated 使用 `spaceManager.hierarchy.getSpaceTreePath()` 替代 */
    async getSpaceTreePath(spaceId: string, options: SpaceQueryOptions = {}): Promise<Record<string, unknown>> {
        return this.hierarchy.getSpaceTreePath(spaceId, options);
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSpaceManager = function (): SpaceManager {
        registerManagerClass("space", SpaceManager);
        return getOrCreateManager(this, "space", () => new SpaceManager(this));
    };
}
