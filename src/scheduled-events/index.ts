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
 * Scheduled Events Manager - 预定事件管理
 * 
 * 提供预定事件相关功能
 */

import { MatrixClient } from "../client";

export class ScheduledEventsManager {
    constructor(private client: MatrixClient) {}

    /**
     * Send delayed event
     */
    public async sendDelayedEvent(eventType: string, roomId: string, content: any, delayMs: number): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any)._unstable_sendDelayedEvent(eventType, roomId, content, delayMs);
    }

    /**
     * Send sticky delayed event
     */
    public async sendStickyDelayedEvent(eventType: string, roomId: string, content: any, delayMs: number): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any)._unstable_sendStickyDelayedEvent(eventType, roomId, content, delayMs);
    }

    /**
     * Send delayed state event
     */
    public async sendDelayedStateEvent(roomId: string, eventType: string, stateKey: string, content: any, delayMs: number): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any)._unstable_sendDelayedStateEvent(roomId, eventType, stateKey, content, delayMs);
    }

    /**
     * Get delayed events
     */
    public async getDelayedEvents(): Promise<any[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any)._unstable_getDelayedEvents();
    }

    /**
     * Update delayed event
     */
    public async updateDelayedEvent(eventId: string, timeoutMs: number): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any)._unstable_updateDelayedEvent(eventId, timeoutMs);
    }

    /**
     * Restart scheduled delayed event
     */
    public async restartScheduledDelayedEvent(eventId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any)._unstable_restartScheduledDelayedEvent(eventId);
    }

    /**
     * Send scheduled delayed event
     */
    public async sendScheduledDelayedEvent(eventId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any)._unstable_sendScheduledDelayedEvent(eventId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getScheduledEventsManager(): ScheduledEventsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getScheduledEventsManager = function (): ScheduledEventsManager {
        return new ScheduledEventsManager(this);
    };
}

export default extendMatrixClient;
