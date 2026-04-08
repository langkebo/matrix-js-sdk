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
import { MatrixEvent } from "../models/event";

export interface IQueuedEvent {
    event: MatrixEvent;
    priority: number;
    retries: number;
}

export class SendingQueueManager {
    constructor(private client: MatrixClient) {}

    public getSendingQueue(): IQueuedEvent[] {
        return (this.client as unknown as { sendingQueue?: IQueuedEvent[] }).sendingQueue || [];
    }

    public addToSendingQueue(event: MatrixEvent, priority = 0): void {
        const clientWithQueue = this.client as unknown as { sendingQueue?: IQueuedEvent[] };
        if (!clientWithQueue.sendingQueue) {
            clientWithQueue.sendingQueue = [];
        }
        clientWithQueue.sendingQueue.push({ event, priority, retries: 0 });
    }

    public removeFromSendingQueue(eventId: string): void {
        const clientWithQueue = this.client as unknown as { sendingQueue?: IQueuedEvent[] };
        const queue = clientWithQueue.sendingQueue || [];
        const index = queue.findIndex((e) => e.event.getId() === eventId);
        if (index > -1) {
            queue.splice(index, 1);
        }
    }

    public clearSendingQueue(): void {
        (this.client as unknown as { sendingQueue?: IQueuedEvent[] }).sendingQueue = [];
    }

    public isSendingQueueEmpty(): boolean {
        const queue = (this.client as unknown as { sendingQueue?: IQueuedEvent[] }).sendingQueue;
        return !(queue && queue.length > 0);
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
