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
 * Settled Manager - Promise管理
 * 
 * 提供Settled Promise相关功能
 */

import { MatrixClient } from "../client";

export class SettledManager {
    constructor(private client: MatrixClient) {}

    /**
     * Wait for pending requests
     */
    public async waitForPendingRequests(timeoutMs?: number): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).waitForPendingRequests(timeoutMs);
    }

    /**
     * Is initial sync complete
     */
    public isInitialSyncComplete(): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isInitialSyncComplete();
    }

    /**
     * Has started sync
     */
    public hasStartedSync(): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).hasStartedSync();
    }

    /**
     * Is syncing
     */
    public isSyncing(): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isSyncing();
    }

    /**
     * Wait for sync
     */
    public async waitForSync(): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).waitForSync();
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getSettledManager(): SettledManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSettledManager = function (): SettledManager {
        return new SettledManager(this);
    };
}

export default extendMatrixClient;
