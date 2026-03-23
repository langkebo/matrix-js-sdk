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

export class SyncAccumulatorManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get sync accumulator
     */
    public getSyncAccumulator(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).syncAccumulator;
    }

    /**
     * Set sync accumulator
     */
    public setSyncAccumulator(accumulator: any): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).syncAccumulator = accumulator;
    }

    /**
     * Accumulate sync data
     */
    public async accumulateSyncData(data: any): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).accumulateSyncData(data);
    }

    /**
     * Get accumulated data
     */
    public getAccumulatedData(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getAccumulatedData();
    }

    /**
     * Reset accumulator
     */
    public resetAccumulator(): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).resetAccumulator();
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
