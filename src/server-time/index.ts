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
import { BaseManager } from "../managers/base-manager";

export interface ServerTimeManagerEvents {
    time_synced: { diff: number };
    time_updated: { serverTime: number };
}

export class ServerTimeManager extends BaseManager<keyof ServerTimeManagerEvents, ServerTimeManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public getServerClockDiff(): number {
        return this.client.serverClockDiff ?? 0;
    }

    public getLocalTimestampForServerTime(serverTime: number): number {
        return this.client.getLocalTimestampForServerTime(serverTime);
    }

    public getServerTimestamp(): number {
        return this.client.getServerTimestamp();
    }

    public updateServerTimeInfo(serverTime: number, serverDate: string): void {
        this.client.updateServerTimeInfo(serverTime, serverDate);
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getServerTimeManager(): ServerTimeManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getServerTimeManager = function (): ServerTimeManager {
        return new ServerTimeManager(this);
    };
}

export default extendMatrixClient;
