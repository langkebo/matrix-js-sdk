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
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface EventStatusManagerEvents {
    status_changed: { roomId: string; eventId: string; status: EventStatus | null };
    event_sending: { roomId: string; eventId: string };
    event_sent: { roomId: string; eventId: string };
    event_failed: { roomId: string; eventId: string };
}

export class EventStatusManager extends BaseManager<keyof EventStatusManagerEvents, EventStatusManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

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

export function extendMatrixClient(): void {
    MatrixClient.prototype.getEventStatusManager = function (): EventStatusManager {
        registerManagerClass("eventStatus", EventStatusManager);
        return getOrCreateManager(this, "eventStatus", () => new EventStatusManager(this));
    };
}
