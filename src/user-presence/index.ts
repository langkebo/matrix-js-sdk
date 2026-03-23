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
 * User Presence Manager - 用户在线状态管理
 * 
 * 提供用户在线状态相关功能
 */

import { MatrixClient } from "../client";

export class UserPresenceManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get user presence
     */
    public async getUserPresence(userId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getUserPresence(userId);
    }

    /**
     * Set presence
     */
    public async setPresence(presence: string, statusMsg?: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).setPresence(presence, statusMsg);
    }

    /**
     * Get cached presence
     */
    public getCachedPresence(userId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getCachedPresence(userId);
    }

    /**
     * Is presence available
     */
    public isPresenceAvailable(): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isPresenceAvailable();
    }

    /**
     * Subscribe to presence
     */
    public async subscribeToPresence(userIds: string[]): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).subscribeToPresence(userIds);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getUserPresenceManager(): UserPresenceManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getUserPresenceManager = function (): UserPresenceManager {
        return new UserPresenceManager(this);
    };
}

export default extendMatrixClient;
