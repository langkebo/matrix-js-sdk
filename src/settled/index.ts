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
import { BaseManager } from "../managers/base-manager";

export interface SettledManagerEvents {
    sync_complete: void;
    sync_started: void;
    sync_error: { error: Error };
}

export class SettledManager extends BaseManager<keyof SettledManagerEvents, SettledManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async waitForPendingRequests(timeoutMs?: number): Promise<void> {
        return this.withRetry(() => this.client.waitForPendingRequests(timeoutMs ?? 0), "waitForPendingRequests");
    }

    public isInitialSyncComplete(): boolean {
        return this.client.isInitialSyncComplete();
    }

    public hasStartedSync(): boolean {
        return this.client.hasStartedSync();
    }

    public isSyncing(): boolean {
        return this.client.isSyncing();
    }

    public async waitForSync(): Promise<void> {
        return this.client.waitForSync();
    }
}

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
