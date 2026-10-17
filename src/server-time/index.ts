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
 * Server Time Manager - 服务器时间管理
 *
 * 提供服务器时间同步功能
 */

import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface ServerTimeManagerEvents {
    time_synced: (data: { diff: number }) => void;
    time_updated: (data: { serverTime: number }) => void;
}

export class ServerTimeManager extends BaseManager<keyof ServerTimeManagerEvents, ServerTimeManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 获取本地时钟与服务器时钟的差值（毫秒）。
     *
     * @returns 时钟差值；未知时返回 0
     *
     * @example
     * ```typescript
     * const diff = client.getServerTimeManager().getServerClockDiff();
     * console.log(diff);
     * ```
     */
    public getServerClockDiff(): number {
        return this.internalClient.serverClockDiff ?? 0;
    }

    /**
     * 将服务器时间换算为本地时间戳。
     *
     * @param serverTime - 服务器时间戳（毫秒）
     * @returns 对应的本地时间戳
     *
     * @example
     * ```typescript
     * const localTs = client.getServerTimeManager().getLocalTimestampForServerTime(serverTime);
     * ```
     */
    public getLocalTimestampForServerTime(serverTime: number): number {
        return serverTime - (this.internalClient.serverClockDiff ?? 0);
    }

    /**
     * 获取当前估计的服务器时间戳。
     *
     * @returns 服务器时间戳（毫秒）
     *
     * @example
     * ```typescript
     * const serverTs = client.getServerTimeManager().getServerTimestamp();
     * ```
     */
    public getServerTimestamp(): number {
        return Date.now() + (this.internalClient.serverClockDiff ?? 0);
    }

    /**
     * 根据服务器返回的时间信息更新时钟差值并触发同步事件。
     *
     * @param serverTime - 服务器时间戳（毫秒）；为 0 时改用 serverDate 解析
     * @param serverDate - 服务器 HTTP Date 头字符串
     *
     * @example
     * ```typescript
     * client.getServerTimeManager().updateServerTimeInfo(1700000000000, new Date().toUTCString());
     * ```
     */
    public updateServerTimeInfo(serverTime: number, serverDate: string): void {
        let diff: number;
        if (serverTime) {
            diff = Date.now() - serverTime;
        } else {
            diff = Date.parse(serverDate) - Date.now();
        }
        this.internalClient.serverClockDiff = diff;
        this.emit("time_synced", { diff });
        this.emit("time_updated", { serverTime });
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getServerTimeManager = function (): ServerTimeManager {
        registerManagerClass("serverTime", ServerTimeManager);
        return getOrCreateManager(this, "serverTime", () => new ServerTimeManager(this));
    };
}
