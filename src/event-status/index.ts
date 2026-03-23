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
 * Event Status Manager - 事件状态管理
 * 
 * 提供事件状态相关功能
 */

import { MatrixClient } from "../client";

export class EventStatusManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get event status
     */
    public getEventStatus(roomId: string, eventId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getEventStatus(roomId, eventId);
    }

    /**
     * Set event status
     */
    public setEventStatus(roomId: string, eventId: string, status: any): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).setEventStatus(roomId, eventId, status);
    }

    /**
     * Is event sending
     */
    public isEventSending(roomId: string, eventId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isEventSending(roomId, eventId);
    }

    /**
     * Is event sent
     */
    public isEventSent(roomId: string, eventId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isEventSent(roomId, eventId);
    }

    /**
     * Is event failed
     */
    public isEventFailed(roomId: string, eventId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isEventFailed(roomId, eventId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getEventStatusManager(): EventStatusManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getEventStatusManager = function (): EventStatusManager {
        return new EventStatusManager(this);
    };
}

export default extendMatrixClient;
