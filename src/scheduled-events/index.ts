/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may May obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * Scheduled Events Manager - 预定事件管理
 *
 * 提供预定事件相关功能
 */

import { MatrixClient } from "../client";
import { type IContent } from "../models/event";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface IDelayedEventResponse {
    event_id: string;
    delay_id?: string;
}

export interface IDelayedEvent {
    delay_id: string;
    event_id?: string;
    room_id: string;
    event_type: string;
    state_key?: string;
    content: IContent;
    delay_ms: number;
    created_at: number;
}

export interface ScheduledEventsManagerEvents {
    event_scheduled: { eventId: string; delayMs: number };
    event_sent: { eventId: string };
    event_cancelled: { eventId: string };
}

type DelayedEventClientMethodInvoker = (...args: unknown[]) => Promise<unknown>;

export class ScheduledEventsManager extends BaseManager<
    keyof ScheduledEventsManagerEvents,
    ScheduledEventsManagerEvents
> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async sendDelayedEvent(
        eventType: string,
        roomId: string,
        content: IContent,
        delayMs: number,
    ): Promise<IDelayedEventResponse> {
        const client = this.client as unknown as Record<string, DelayedEventClientMethodInvoker>;
        return this.withRetry(
            () =>
                client["_unstable_sendDelayedEvent"](
                    eventType,
                    roomId,
                    content,
                    delayMs,
                ) as Promise<IDelayedEventResponse>,
            "sendDelayedEvent",
        );
    }

    public async sendStickyDelayedEvent(
        eventType: string,
        roomId: string,
        content: IContent,
        delayMs: number,
    ): Promise<IDelayedEventResponse> {
        const client = this.client as unknown as Record<string, DelayedEventClientMethodInvoker>;
        return this.withRetry(
            () =>
                client["_unstable_sendStickyDelayedEvent"](
                    eventType,
                    roomId,
                    content,
                    delayMs,
                ) as Promise<IDelayedEventResponse>,
            "sendStickyDelayedEvent",
        );
    }

    public async sendDelayedStateEvent(
        roomId: string,
        eventType: string,
        stateKey: string,
        content: IContent,
        delayMs: number,
    ): Promise<IDelayedEventResponse> {
        const client = this.client as unknown as Record<string, DelayedEventClientMethodInvoker>;
        return this.withRetry(
            () =>
                client["_unstable_sendDelayedStateEvent"](
                    roomId,
                    eventType,
                    stateKey,
                    content,
                    delayMs,
                ) as Promise<IDelayedEventResponse>,
            "sendDelayedStateEvent",
        );
    }

    public async getDelayedEvents(): Promise<IDelayedEvent[]> {
        const client = this.client as unknown as Record<string, DelayedEventClientMethodInvoker>;
        return this.withRetry(
            () => client["_unstable_getDelayedEvents"]() as Promise<IDelayedEvent[]>,
            "getDelayedEvents",
        );
    }

    public async updateDelayedEvent(eventId: string, timeoutMs: number): Promise<IDelayedEventResponse> {
        const client = this.client as unknown as Record<string, DelayedEventClientMethodInvoker>;
        return this.withRetry(
            () => client["_unstable_updateDelayedEvent"](eventId, timeoutMs) as Promise<IDelayedEventResponse>,
            "updateDelayedEvent",
        );
    }

    public async restartScheduledDelayedEvent(eventId: string): Promise<IDelayedEventResponse> {
        const client = this.client as unknown as Record<string, DelayedEventClientMethodInvoker>;
        return this.withRetry(
            () => client["_unstable_restartScheduledDelayedEvent"](eventId) as Promise<IDelayedEventResponse>,
            "restartScheduledDelayedEvent",
        );
    }

    public async sendScheduledDelayedEvent(eventId: string): Promise<IDelayedEventResponse> {
        const client = this.client as unknown as Record<string, DelayedEventClientMethodInvoker>;
        return this.withRetry(
            () => client["_unstable_sendScheduledDelayedEvent"](eventId) as Promise<IDelayedEventResponse>,
            "sendScheduledDelayedEvent",
        );
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getScheduledEventsManager(): ScheduledEventsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getScheduledEventsManager = function (): ScheduledEventsManager {
        return getOrCreateManager(this, "scheduledEvents", () => new ScheduledEventsManager(this));
    };
}

export default extendMatrixClient;
