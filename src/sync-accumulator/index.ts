/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You May obtain a copy of the License at

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
import { SyncAccumulator } from "../sync-accumulator";

export interface ISyncAccumulatedData {
    rooms?: {
        join?: Record<string, unknown>;
        invite?: Record<string, unknown>;
        leave?: Record<string, unknown>;
    };
    account_data?: Array<{
        type: string;
        content: Record<string, unknown>;
    }>;
    presence?: Array<{
        type: string;
        content: Record<string, unknown>;
    }>;
}

export class SyncAccumulatorManager {
    constructor(private client: MatrixClient) {}

    public getSyncAccumulator(): SyncAccumulator | null {
        return (this.client as unknown as { syncAccumulator?: SyncAccumulator }).syncAccumulator ?? null;
    }

    public setSyncAccumulator(accumulator: SyncAccumulator): void {
        (this.client as unknown as { syncAccumulator?: SyncAccumulator }).syncAccumulator = accumulator;
    }

    public async accumulateSyncData(data: Record<string, unknown>): Promise<void> {
        return (this.client as unknown as {
            accumulateSyncData: (data: Record<string, unknown>) => Promise<void>;
        }).accumulateSyncData(data);
    }

    public getAccumulatedData(): ISyncAccumulatedData | null {
        return (this.client as unknown as {
            getAccumulatedData: () => ISyncAccumulatedData | null;
        }).getAccumulatedData();
    }

    public resetAccumulator(): void {
        (this.client as unknown as {
            resetAccumulator: () => void;
        }).resetAccumulator();
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getSyncAccumulatorManager(): SyncAccumulatorManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSyncAccumulatorManager = function (): SyncAccumulatorManager {
        return new SyncAccumulatorManager(this);
    };
}

export default extendMatrixClient;
