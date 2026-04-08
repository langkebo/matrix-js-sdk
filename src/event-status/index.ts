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

import { MatrixClient } from "../client";
import { EventStatus } from "../models/event";

export class EventStatusManager {
    constructor(private client: MatrixClient) {}

    public getEventStatus(roomId: string, eventId: string): EventStatus | null {
        const room = this.client.getRoom(roomId);
        if (!room) return null;
        
        const event = room.findEventById(eventId);
        return event?.status || null;
    }

    public setEventStatus(roomId: string, eventId: string, status: EventStatus): void {
        const room = this.client.getRoom(roomId);
        if (!room) return;
        
        const event = room.findEventById(eventId);
        if (event) {
            event.setStatus(status);
        }
    }

    public isEventSending(roomId: string, eventId: string): boolean {
        const status = this.getEventStatus(roomId, eventId);
        return status === EventStatus.SENDING || status === EventStatus.QUEUED;
    }

    public isEventSent(roomId: string, eventId: string): boolean {
        const status = this.getEventStatus(roomId, eventId);
        return status === null || status === EventStatus.SENT;
    }

    public isEventFailed(roomId: string, eventId: string): boolean {
        const status = this.getEventStatus(roomId, eventId);
        return status === EventStatus.NOT_SENT;
    }
}

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
