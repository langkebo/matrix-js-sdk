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
 * Sending Queue Manager - 发送队列管理
 * 
 * 提供发送队列相关功能
 */

import { MatrixClient } from "../client";

export class SendingQueueManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get sending queue
     */
    public getSendingQueue(): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).sendingQueue || [];
    }

    /**
     * Add to sending queue
     */
    public addToSendingQueue(event: any): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!((this.client as any).sendingQueue)) {
            (this.client as any).sendingQueue = [];
        }
        (this.client as any).sendingQueue.push(event);
    }

    /**
     * Remove from sending queue
     */
    public removeFromSendingQueue(eventId: string): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const queue = (this.client as any).sendingQueue || [];
        const index = queue.findIndex((e: any) => e.getId() === eventId);
        if (index > -1) {
            queue.splice(index, 1);
        }
    }

    /**
     * Clear sending queue
     */
    public clearSendingQueue(): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).sendingQueue = [];
    }

    /**
     * Is sending queue empty
     */
    public isSendingQueueEmpty(): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return !((this.client as any).sendingQueue?.length > 0);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getSendingQueueManager(): SendingQueueManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSendingQueueManager = function (): SendingQueueManager {
        return new SendingQueueManager(this);
    };
}

export default extendMatrixClient;
