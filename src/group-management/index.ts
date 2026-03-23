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
 * Group Call Manager - 群组通话管理
 * 
 * 提供群组通话相关功能
 */

import { MatrixClient } from "../client";

export class GroupCallManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get group call for room
     */
    public getGroupCallForRoom(roomId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getGroupCallForRoom(roomId);
    }

    /**
     * Create group call
     */
    public async createGroupCall(roomId: string, options?: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).createGroupCall(roomId, options);
    }

    /**
     * Get use E2E for group call
     */
    public getUseE2eForGroupCall(): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getUseE2eForGroupCall();
    }

    /**
     * Wait until room ready for group calls
     */
    public async waitUntilRoomReadyForGroupCalls(roomId: string): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).waitUntilRoomReadyForGroupCalls(roomId);
    }

    /**
     * Get all active group calls
     */
    public getActiveGroupCalls(): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getActiveGroupCalls();
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getGroupCallManager(): GroupCallManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getGroupCallManager = function (): GroupCallManager {
        return new GroupCallManager(this);
    };
}

export default extendMatrixClient;
