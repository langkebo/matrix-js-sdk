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
 * Scheduled Call Manager - 预约通话管理
 * 
 * 提供预约通话相关功能
 */

import { MatrixClient } from "../client";

export class ScheduledCallManager {
    constructor(private client: MatrixClient) {}

    /**
     * Schedule call
     */
    public async scheduleCall(roomId: string, type: string, timestamp: number): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).scheduleCall(roomId, type, timestamp);
    }

    /**
     * Cancel scheduled call
     */
    public async cancelScheduledCall(callId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).cancelScheduledCall(callId);
    }

    /**
     * Get scheduled calls
     */
    public getScheduledCalls(): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getScheduledCalls();
    }

    /**
     * Get scheduled call
     */
    public getScheduledCall(callId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getScheduledCall(callId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getScheduledCallManager(): ScheduledCallManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getScheduledCallManager = function (): ScheduledCallManager {
        return new ScheduledCallManager(this);
    };
}

export default extendMatrixClient;
