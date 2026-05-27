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
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface ServerTimeManagerEvents {
    time_synced: (data: { diff: number }) => void;
    time_updated: (data: { serverTime: number }) => void;
}

export class ServerTimeManager extends BaseManager<keyof ServerTimeManagerEvents, ServerTimeManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public getServerClockDiff(): number {
        return (this.client as any).serverClockDiff ?? 0;
    }

    public getLocalTimestampForServerTime(serverTime: number): number {
        return serverTime - ((this.client as any).serverClockDiff ?? 0);
    }

    public getServerTimestamp(): number {
        return Date.now() + ((this.client as any).serverClockDiff ?? 0);
    }

    public updateServerTimeInfo(serverTime: number, serverDate: string): void {
        let diff: number;
        if (serverTime) {
            diff = Date.now() - serverTime;
        } else {
            diff = Date.parse(serverDate) - Date.now();
        }
        (this.client as any).serverClockDiff = diff;
        this.emit("time_synced", { diff });
        this.emit("time_updated", { serverTime });
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getServerTimeManager(): ServerTimeManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getServerTimeManager = function (): ServerTimeManager {
        return getOrCreateManager(this, "serverTime", () => new ServerTimeManager(this));
    };
}

export default extendMatrixClient;
