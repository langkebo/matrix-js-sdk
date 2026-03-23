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
 * Event Manager - 事件管理
 * 
 * 提供事件重发、取消、删除等功能
 */

import { MatrixClient } from "../client";
import { MatrixEvent } from "../models/event";
import { Room } from "../models/room";

export class EventManager {
    constructor(private client: MatrixClient) {}

    /**
     * Resend an event
     */
    public async resendEvent(event: MatrixEvent, room: Room): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).resendEvent(event, room);
    }

    /**
     * Cancel a pending event
     */
    public cancelPendingEvent(event: MatrixEvent): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).cancelPendingEvent(event);
    }

    /**
     * Redact an event
     */
    public async redactEvent(roomId: string, eventId: string, reason?: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).redactEvent(roomId, eventId, reason);
    }

    /**
     * Get event
     */
    public async getEvent(roomId: string, eventId: string): Promise<MatrixEvent> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getEvent(roomId, eventId);
    }

    /**
     * Get room events
     */
    public async getRoomEvents(roomId: string, start: string, limit: number): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomEvents(roomId, start, limit);
    }

    /**
     * Get state events
     */
    public async getStateEvents(roomId: string, eventType: string, stateKey?: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getStateEvents(roomId, eventType, stateKey);
    }

    /**
     * Fetch event
     */
    public async fetchEvent(roomId: string, eventId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).fetchEvent(roomId, eventId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getEventManager(): EventManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getEventManager = function (): EventManager {
        return new EventManager(this);
    };
}

export default extendMatrixClient;
