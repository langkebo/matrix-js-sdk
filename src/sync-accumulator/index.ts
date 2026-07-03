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
 * Sync Accumulator Manager - 同步累积管理
 *
 * 提供同步数据累积相关功能
 */

import { MatrixClient } from "../client";
import { SyncAccumulator, type IJoinedRoom, type IInvitedRoom, type ILeftRoom, type ISyncResponse } from "../sync-accumulator";
import { type IContent } from "../models/event";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface ISyncAccumulatedData {
    rooms?: {
        join?: Record<string, IJoinedRoom>;
        invite?: Record<string, IInvitedRoom>;
        leave?: Record<string, ILeftRoom>;
    };
    account_data?: Array<{
        type: string;
        content: IContent;
    }>;
    presence?: Array<{
        type: string;
        content: IContent;
    }>;
}

export interface SyncAccumulatorManagerEvents {
    data_accumulated: { rooms: number };
    accumulator_reset: void;
}

export class SyncAccumulatorManager extends BaseManager<
    keyof SyncAccumulatorManagerEvents,
    SyncAccumulatorManagerEvents
> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public getSyncAccumulator(): SyncAccumulator | null {
        return this.client.syncAccumulator ?? null;
    }

    public setSyncAccumulator(accumulator: SyncAccumulator): void {
        this.client.syncAccumulator = accumulator;
    }

    public async accumulateSyncData(data: ISyncResponse): Promise<void> {
        return this.withRetry(
            () => this.client.accumulateSyncData(data),
            "accumulateSyncData",
        );
    }

    public getAccumulatedData(): ISyncAccumulatedData | null {
        return this.client.getAccumulatedData();
    }

    public resetAccumulator(): void {
        this.client.resetAccumulator();
    }
}


export function extendMatrixClient(): void {
    MatrixClient.prototype.getSyncAccumulatorManager = function (): SyncAccumulatorManager {
        registerManagerClass("syncAccumulator", SyncAccumulatorManager);
    return getOrCreateManager(this, "syncAccumulator", () => new SyncAccumulatorManager(this));
    };
}

export default extendMatrixClient;
