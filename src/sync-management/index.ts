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
 * Sync Manager - 同步管理
 * 
 * 提供数据同步相关功能
 */

import { MatrixClient } from "../client";

export class SyncManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get sync token
     */
    public getSyncToken(): string | undefined {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).syncToken;
    }

    /**
     * Get sync state
     */
    public getSyncState(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).syncState;
    }

    /**
     * Get sync state data
     */
    public getSyncStateData(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).syncStateData;
    }

    /**
     * Is syncing
     */
    public isSyncing(): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).syncing || false;
    }

    /**
     * Get rooms
     */
    public getRooms(): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).rooms || [];
    }

    /**
     * Get joined rooms
     */
    public getJoinedRooms(): string[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getJoinedRooms();
    }

    /**
     * Get invited rooms
     */
    public getInvitedRooms(): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getInvitedRooms();
    }

    /**
     * Get left rooms
     */
    public getLeftRooms(): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getLeftRooms();
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getSyncManager(): SyncManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSyncManager = function (): SyncManager {
        return new SyncManager(this);
    };
}

export default extendMatrixClient;
