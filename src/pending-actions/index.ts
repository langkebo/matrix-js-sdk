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
 * Pending Actions Manager - 待处理操作管理
 * 
 * 提供待发送事件管理功能
 */

import { MatrixClient } from "../client";
import { MatrixEvent } from "../models/event";

export class PendingActionsManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get pending events
     */
    public getPendingEvents(roomId: string): MatrixEvent[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getPendingEvents(roomId);
    }

    /**
     * Has pending events
     */
    public hasPendingEvents(roomId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).hasPendingEvents(roomId);
    }

    /**
     * Cancel upload
     */
    public cancelUpload(upload: Promise<any>): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).cancelUpload(upload);
    }

    /**
     * Get unsent events
     */
    public getUnsentEvents(roomId: string): MatrixEvent[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getUnsentEvents(roomId);
    }

    /**
     * Cancel scheduled event
     */
    public async cancelScheduledEvent(eventId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any)._unstable_cancelScheduledDelayedEvent(eventId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getPendingActionsManager(): PendingActionsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getPendingActionsManager = function (): PendingActionsManager {
        return new PendingActionsManager(this);
    };
}

export default extendMatrixClient;
