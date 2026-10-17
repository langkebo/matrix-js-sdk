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

import { MatrixClient } from "../client";
import { Room } from "../models/room";
import { SyncApi, SyncState, type ISyncStateData } from "../sync";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { logger } from "../logger";

export interface SyncManagerEvents {
    sync_started: void;
    sync_stopped: void;
    sync_state_changed: { state: SyncState };
    sync_error: { error: Error };
}

export class SyncManager extends BaseManager<keyof SyncManagerEvents, SyncManagerEvents> {
    private syncedLeftRooms = false;
    private syncLeftRoomsPromise: Promise<Room[]> | undefined;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 获取当前同步 token。
     *
     * @returns 同步 token；尚未开始同步时返回 undefined
     *
     * @example
     * ```typescript
     * const token = client.getSyncManager().getSyncToken();
     * console.log(token);
     * ```
     */
    public getSyncToken(): string | undefined {
        return this.client.syncToken ?? undefined;
    }

    /**
     * 获取当前同步状态。
     *
     * @returns 同步状态；同步未启动时返回 null
     *
     * @example
     * ```typescript
     * const state = client.getSyncManager().getSyncState();
     * console.log(state);
     * ```
     */
    public getSyncState(): SyncState | null {
        return this.internalClient.syncApi?.getSyncState() ?? null;
    }

    /**
     * 获取当前同步状态的附加数据。
     *
     * @returns 同步状态数据；同步未启动时返回 null
     *
     * @example
     * ```typescript
     * const data = client.getSyncManager().getSyncStateData();
     * console.log(data);
     * ```
     */
    public getSyncStateData(): ISyncStateData | null {
        const syncApi = this.internalClient.syncApi;
        if (!syncApi) {
            return null;
        }
        return syncApi.getSyncStateData();
    }

    /**
     * 判断客户端当前是否正在同步。
     *
     * @returns 正在同步返回 true，否则返回 false
     *
     * @example
     * ```typescript
     * const syncing = client.getSyncManager().isSyncing();
     * console.log(syncing);
     * ```
     */
    public isSyncing(): boolean {
        return this.client.syncing || false;
    }

    /**
     * 获取已存储的所有房间。
     *
     * @returns 本地存储中的房间列表
     *
     * @example
     * ```typescript
     * const rooms = client.getSyncManager().getRooms();
     * console.log(rooms.length);
     * ```
     */
    public getRooms(): Room[] {
        return this.client.store.getRooms();
    }

    /**
     * 获取当前用户已加入的房间 ID 列表。
     *
     * @returns 已加入的房间 ID 数组
     *
     * @example
     * ```typescript
     * const joinedRoomIds = await client.getSyncManager().getJoinedRooms();
     * console.log(joinedRoomIds);
     * ```
     */
    public async getJoinedRooms(): Promise<string[]> {
        return this.withRetry(async () => {
            const response = await this.client.getJoinedRooms();
            return response.joined_rooms;
        }, "getJoinedRooms");
    }

    /**
     * 获取当前用户被邀请加入的房间列表。
     *
     * @returns 成员状态为 invite 的房间列表
     *
     * @example
     * ```typescript
     * const invited = client.getSyncManager().getInvitedRooms();
     * console.log(invited.length);
     * ```
     */
    public getInvitedRooms(): Room[] {
        return this.client.store.getRooms().filter((r) => r.getMyMembership() === "invite");
    }

    /**
     * 获取当前用户已离开的房间列表。
     *
     * @returns 成员状态为 leave 的房间列表
     *
     * @example
     * ```typescript
     * const left = client.getSyncManager().getLeftRooms();
     * console.log(left.length);
     * ```
     */
    public getLeftRooms(): Room[] {
        return this.client.store.getRooms().filter((r) => r.getMyMembership() === "leave");
    }

    /**
     * 同步已离开房间的初始状态。
     *
     * 重复调用时：首次成功后直接返回空数组，进行中的请求则复用同一个 Promise。
     *
     * @returns 同步得到的房间列表
     *
     * @example
     * ```typescript
     * const leftRooms = await client.getSyncManager().syncLeftRooms();
     * console.log(leftRooms.length);
     * ```
     */
    public syncLeftRooms(): Promise<Room[]> {
        // Guard against multiple calls whilst ongoing and multiple calls post success
        if (this.syncedLeftRooms) {
            return Promise.resolve([]); // don't call syncRooms again if it succeeded.
        }
        if (this.syncLeftRoomsPromise) {
            return this.syncLeftRoomsPromise; // return the ongoing request
        }
        const clientInternals = this.internalClient;
        const syncApi = new SyncApi(this.client, clientInternals.clientOpts, clientInternals.buildSyncApiOptions());
        this.syncLeftRoomsPromise = syncApi.syncLeftRooms();

        // cleanup locks
        this.syncLeftRoomsPromise
            .then(() => {
                logger.debug("Marking success of sync left room request");
                this.syncedLeftRooms = true; // flip the bit on success
            })
            .finally(() => {
                this.syncLeftRoomsPromise = undefined; // cleanup ongoing request state
            });

        return this.syncLeftRoomsPromise;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSyncManager = function (): SyncManager {
        registerManagerClass("syncManagement", SyncManager);
        return getOrCreateManager(this, "syncManagement", () => new SyncManager(this));
    };
}
