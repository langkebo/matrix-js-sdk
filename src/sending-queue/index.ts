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
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface IQueuedEvent {
    event: MatrixEvent;
    priority: number;
    retries: number;
}

export interface SendingQueueManagerEvents {
    event_queued: { eventId: string; priority: number };
    event_dequeued: { eventId: string };
    queue_cleared: void;
}

export class SendingQueueManager extends BaseManager<keyof SendingQueueManagerEvents, SendingQueueManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public getSendingQueue(): IQueuedEvent[] {
        return this.client.sendingQueue || [];
    }

    public addToSendingQueue(event: MatrixEvent, priority = 0): void {
        if (!this.client.sendingQueue) {
            this.client.sendingQueue = [];
        }
        this.client.sendingQueue.push({ event, priority, retries: 0 });
    }

    public removeFromSendingQueue(eventId: string): void {
        const queue = this.client.sendingQueue || [];
        const index = queue.findIndex((e) => e.event.getId() === eventId);
        if (index > -1) {
            queue.splice(index, 1);
        }
    }

    public clearSendingQueue(): void {
        this.client.sendingQueue = [];
    }

    public isSendingQueueEmpty(): boolean {
        const queue = this.client.sendingQueue;
        return !(queue && queue.length > 0);
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSendingQueueManager = function (): SendingQueueManager {
        registerManagerClass("sendingQueue", SendingQueueManager);
        return getOrCreateManager(this, "sendingQueue", () => new SendingQueueManager(this));
    };
}
