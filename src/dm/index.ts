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
 * Direct Message Manager - 私信管理（门面层）
 *
 * 组合模式拆分为 3 个 sub-managers：
 * - list: 查询 + 缓存（持有 dmRoomsCache / userDmMapCache）
 * - creation: 创建 + m.direct 写入
 * - operation: 离开 + 已读 + 发送
 *
 * 构造顺序：list → creation → operation。所有原有方法向后兼容（@deprecated 标注迁移）。
 * ⚠️ m.direct 是用户级别的 account data，不是房间级别
 */

import { logger } from "../logger";
import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type { LRUCache } from "../utils/lru-cache";
import type { Room } from "../models/room";
import type { IContent } from "../models/event";

import { DMEvent, type DirectMessageManagerEventMap } from "./events";
import { DmRoomListManager } from "./sub-managers/dm-room-list-manager";
import { DmRoomCreationManager } from "./sub-managers/dm-room-creation-manager";
import { DmRoomOperationManager } from "./sub-managers/dm-room-operation-manager";
import type { DmRoomInfo, IDirectRoomsMap, DmPartnerResponse } from "./sub-managers/dm-room-list-types";
import type {
    CreateDmOptions,
    CreateDmRoomResponse,
    CreateDmRoomOptions,
    UpdateDirectRoomResponse,
    UpdateDirectRoomOptions,
} from "./sub-managers/dm-room-creation-types";

// 事件 + 类型 re-export（向后兼容）
export { DMEvent } from "./events";
export type { DirectMessageManagerEventMap } from "./events";
export type {
    DmRoomInfo,
    IDirectRoomsMap,
    DirectRoomsResponse,
    DmRoomCheckResponse,
    DmPartnerResponse,
} from "./sub-managers/dm-room-list-types";
export type {
    CreateDmOptions,
    CreateDmRoomResponse,
    CreateDmRoomOptions,
    UpdateDirectRoomResponse,
    UpdateDirectRoomOptions,
} from "./sub-managers/dm-room-creation-types";
export { DmRoomListManager } from "./sub-managers/dm-room-list-manager";
export { DmRoomCreationManager } from "./sub-managers/dm-room-creation-manager";
export { DmRoomOperationManager } from "./sub-managers/dm-room-operation-manager";

/**
 * Direct Message Manager - 私信管理统一入口
 *
 * 通过组合模式将功能委托到 sub-managers，同时保持完全向后兼容。
 * 推荐新代码直接使用 sub-manager：`dmManager.creation.createDm(...)`。
 */
export class DirectMessageManager extends BaseManager<DMEvent, DirectMessageManagerEventMap> {
    // ===== sub-managers（组合模式） =====
    public readonly list: DmRoomListManager;
    public readonly creation: DmRoomCreationManager;
    public readonly operation: DmRoomOperationManager;

    private isInitialized: boolean = false;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
        // 构造顺序：list → creation → operation（creation/operation 接收 list 引用）
        this.list = new DmRoomListManager(client, opts);
        this.creation = new DmRoomCreationManager(client, this.list, opts);
        this.operation = new DmRoomOperationManager(client, this.list, opts);
        // 转发 sub-manager 事件到顶层（保持 manager.on(DMEvent.X, ...) 向后兼容）
        this.forwardSubManagerEvents();
    }

    /** 将所有 sub-manager 的 DMEvent 转发到顶层（共用 DMEvent enum，直接 re-emit）。 */
    private forwardSubManagerEvents(): void {
        const subManagers: BaseManager<DMEvent, DirectMessageManagerEventMap>[] = [
            this.list,
            this.creation,
            this.operation,
        ];
        for (const sm of subManagers) {
            sm.on(DMEvent.DMCreated, (roomId, userIds) => this.emit(DMEvent.DMCreated, roomId, userIds));
            sm.on(DMEvent.DMLeft, (roomId) => this.emit(DMEvent.DMLeft, roomId));
            sm.on(DMEvent.DMUpdated, (roomId) => this.emit(DMEvent.DMUpdated, roomId));
            sm.on(DMEvent.ListUpdated, () => this.emit(DMEvent.ListUpdated));
        }
    }

    // ===== 缓存访问（向后兼容测试与外部调用方，代理到 list manager） =====

    /** @deprecated 使用 `dmManager.list.dmRoomsCache` 替代 */
    public get dmRoomsCache(): LRUCache<DmRoomInfo> {
        return this.list.dmRoomsCache;
    }

    /** @deprecated 使用 `dmManager.list.userDmMapCache` 替代 */
    public get userDmMapCache(): LRUCache<string> {
        return this.list.userDmMapCache;
    }

    // ===== 顶层协调方法 =====

    /** 初始化 DM 管理器 */
    async start(): Promise<void> {
        if (this.isInitialized) return;
        try {
            const dmMap = await this.list.getDirectRoomsByUser();
            for (const [userId, roomIds] of Object.entries(dmMap)) {
                if (roomIds.length > 0) {
                    this.list.userDmMapCache.set(userId, roomIds[0]);
                }
            }
            this.isInitialized = true;
        } catch (e) {
            logger.warn("DirectMessageManager.start failed:", e);
        }
    }

    /** 停止 DM 管理器 */
    stop(): void {
        this.list.clearCache();
        this.isInitialized = false;
        // 清理 forwardSubManagerEvents 注册的转发监听器，防止 stop() 后事件泄漏
        this.list.removeAllListeners();
        this.creation.removeAllListeners();
        this.operation.removeAllListeners();
    }

    /** 获取缓存统计 */
    public getCacheStats(): {
        dmRooms: { size: number; hits: number; misses: number; hitRate: number };
        userDmMap: { size: number; hits: number; misses: number; hitRate: number };
    } {
        return this.list.getCacheStats();
    }

    // ===== 向后兼容委托方法（@deprecated，推荐直接使用 sub-manager） =====

    /** @deprecated 使用 `dmManager.creation.createDm()` 替代 */
    async createDm(options: CreateDmOptions | string[]): Promise<string> {
        return this.creation.createDm(options);
    }
    /** @deprecated 使用 `dmManager.creation.setDmRoom()` 替代 */
    async setDmRoom(roomId: string, userId: string): Promise<void> {
        return this.creation.setDmRoom(roomId, userId);
    }
    /** @deprecated 使用 `dmManager.creation.removeDmRoom()` 替代 */
    async removeDmRoom(roomId: string, userId: string): Promise<void> {
        return this.creation.removeDmRoom(roomId, userId);
    }
    /** @deprecated 使用 `dmManager.creation.createDmRoomDetailed()` 替代 */
    async createDmRoomDetailed(userId: string, options?: CreateDmRoomOptions): Promise<CreateDmRoomResponse> {
        return this.creation.createDmRoomDetailed(userId, options);
    }
    /** @deprecated 使用 `dmManager.creation.createDmRoom()` 替代 */
    async createDmRoom(userId: string, options?: CreateDmRoomOptions): Promise<string> {
        return this.creation.createDmRoom(userId, options);
    }
    /** @deprecated 使用 `dmManager.creation.updateDirectRoom()` 替代 */
    async updateDirectRoom(roomId: string, userIds: string[]): Promise<UpdateDirectRoomResponse>;
    /** @deprecated 使用 `dmManager.creation.updateDirectRoom()` 替代 */
    async updateDirectRoom(roomId: string, options: UpdateDirectRoomOptions): Promise<UpdateDirectRoomResponse>;
    async updateDirectRoom(
        roomId: string,
        userIdsOrOptions: string[] | UpdateDirectRoomOptions,
    ): Promise<UpdateDirectRoomResponse> {
        // 类型守卫分发到对应 overload（避免 union 类型无法匹配任一 overload 签名）
        return Array.isArray(userIdsOrOptions)
            ? this.creation.updateDirectRoom(roomId, userIdsOrOptions)
            : this.creation.updateDirectRoom(roomId, userIdsOrOptions);
    }

    /** @deprecated 使用 `dmManager.list.getDMRooms()` 替代 */
    async getDMRooms(): Promise<DmRoomInfo[]> {
        return this.list.getDMRooms();
    }
    /** @deprecated 使用 `dmManager.list.getDirectRoomsByUserSync()` 替代 */
    public getDirectRoomsByUserSync(): IDirectRoomsMap {
        return this.list.getDirectRoomsByUserSync();
    }
    /** @deprecated 使用 `dmManager.list.getDmForUser()` 替代 */
    async getDmForUser(userId: string): Promise<string | null> {
        return this.list.getDmForUser(userId);
    }
    /** @deprecated 使用 `dmManager.list.getDirectRoomsByUser()` 替代 */
    async getDirectRoomsByUser(): Promise<IDirectRoomsMap> {
        return this.list.getDirectRoomsByUser();
    }
    /** @deprecated 使用 `dmManager.list.getDmRoomInfo()` 替代 */
    async getDmRoomInfo(roomId: string): Promise<DmRoomInfo | null> {
        return this.list.getDmRoomInfo(roomId);
    }
    /** @deprecated 使用 `dmManager.list.getCachedDmRooms()` 替代 */
    getCachedDmRooms(): DmRoomInfo[] {
        return this.list.getCachedDmRooms();
    }
    /** @deprecated 使用 `dmManager.list.getCachedDmForUser()` 替代 */
    getCachedDmForUser(userId: string): string | null {
        return this.list.getCachedDmForUser(userId);
    }
    /** @deprecated 使用 `dmManager.list.getDmRoomInfos()` 替代 */
    async getDmRoomInfos(): Promise<DmRoomInfo[]> {
        return this.list.getDmRoomInfos();
    }
    /** @deprecated 使用 `dmManager.list.checkRoomIsDm()` 替代 */
    async checkRoomIsDm(roomId: string): Promise<boolean> {
        return this.list.checkRoomIsDm(roomId);
    }
    /** @deprecated 使用 `dmManager.list.getDmPartner()` 替代 */
    async getDmPartner(roomId: string): Promise<string | null> {
        return this.list.getDmPartner(roomId);
    }
    /** @deprecated 使用 `dmManager.list.getDmRoomsByUserIds()` 替代 */
    async getDmRoomsByUserIds(userIds: string[]): Promise<Room[]> {
        return this.list.getDmRoomsByUserIds(userIds);
    }
    /** @deprecated 使用 `dmManager.list.getDmRoom()` 替代 */
    async getDmRoom(roomId: string, throwOnError = true): Promise<Room | null> {
        return this.list.getDmRoom(roomId, throwOnError);
    }
    /** @deprecated 使用 `dmManager.list.getDirectRoomsFromServer()` 替代 */
    async getDirectRoomsFromServer(): Promise<IDirectRoomsMap> {
        return this.list.getDirectRoomsFromServer();
    }
    /** @deprecated 使用 `dmManager.list.isDmRoomFromServer()` 替代 */
    async isDmRoomFromServer(roomId: string, throwOnError = true): Promise<boolean> {
        return this.list.isDmRoomFromServer(roomId, throwOnError);
    }
    /** @deprecated 使用 `dmManager.list.getDmPartnerFromServer()` 替代 */
    async getDmPartnerFromServer(roomId: string, throwOnError = true): Promise<DmPartnerResponse | null> {
        return this.list.getDmPartnerFromServer(roomId, throwOnError);
    }

    /** @deprecated 使用 `dmManager.operation.leaveDm()` 替代 */
    async leaveDm(roomId: string): Promise<void> {
        return this.operation.leaveDm(roomId);
    }
    /** @deprecated 使用 `dmManager.operation.markDmAsRead()` 替代 */
    async markDmAsRead(roomId: string): Promise<void> {
        return this.operation.markDmAsRead(roomId);
    }
    /** @deprecated 使用 `dmManager.operation.sendDmMessage()` 替代 */
    async sendDmMessage(roomId: string, content: string | IContent): Promise<string> {
        return this.operation.sendDmMessage(roomId, content);
    }
}

/**
 * 扩展 MatrixClient 原型
 */
export function extendMatrixClient(): void {
    if (!MatrixClient || !MatrixClient.prototype) return;
    if (MatrixClient.prototype.hasOwnProperty("getDirectMessageManager")) return;

    MatrixClient.prototype.getDirectMessageManager = function (): DirectMessageManager {
        registerManagerClass("dm", DirectMessageManager);
        return getOrCreateManager(this, "dm", () => new DirectMessageManager(this));
    };
}
