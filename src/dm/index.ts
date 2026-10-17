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
 * 构造顺序：list → creation → operation。通过 sub-manager 访问具体能力。
 * ⚠️ m.direct 是用户级别的 account data，不是房间级别
 */

import { logger } from "../logger";
import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

import { DMEvent, type DirectMessageManagerEventMap } from "./events";
import { DmRoomListManager } from "./sub-managers/dm-room-list-manager";
import { DmRoomCreationManager } from "./sub-managers/dm-room-creation-manager";
import { DmRoomOperationManager } from "./sub-managers/dm-room-operation-manager";

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
 * 通过组合模式将功能委托到 sub-managers。
 * 通过 sub-manager 访问具体能力：`dmManager.creation.createDm(...)`。
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

    // ===== 顶层协调方法 =====

    // 进行中的 start() Promise：并发调用复用同一份初始化（FT-115）
    private startPromise: Promise<void> | null = null;

    /**
     * 初始化 DM 管理器。
     *
     * @example
     * await client.getDirectMessageManager().start();
     */
    async start(): Promise<void> {
        if (this.isInitialized) return;
        if (this.startPromise) {
            return this.startPromise;
        }
        this.startPromise = (async () => {
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
                // 本轮初始化失败：清空 promise 让下次重试；成功路径由 isInitialized 持续守卫。
                this.startPromise = null;
            }
        })();
        return this.startPromise;
    }

    /**
     * 停止 DM 管理器。
     *
     * @example
     * client.getDirectMessageManager().stop();
     */
    stop(): void {
        this.list.clearCache();
        this.isInitialized = false;
        // 必须同时清空 startPromise：start() 的第二个守卫是 `if (this.startPromise) return this.startPromise`，
        // 只重置 isInitialized 的话，stop() 之后的 start() 会直接返回上一次已 resolve 的 promise，
        // 永远不会重新拉取 m.direct —— 表现为「stop 后重启无效」，且不报错、很难定位。
        this.startPromise = null;
        // 清理 forwardSubManagerEvents 注册的转发监听器，防止 stop() 后事件泄漏
        this.list.removeAllListeners();
        this.creation.removeAllListeners();
        this.operation.removeAllListeners();
    }

    /**
     * 获取缓存统计。
     *
     * @example
     * const stats = client.getDirectMessageManager().getCacheStats();
     * console.log("DM 房间缓存命中率:", stats.dmRooms.hitRate);
     */
    public getCacheStats(): {
        dmRooms: { size: number; hits: number; misses: number; hitRate: number };
        userDmMap: { size: number; hits: number; misses: number; hitRate: number };
    } {
        return this.list.getCacheStats();
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
