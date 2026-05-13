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
import { CachedReceipt, Receipt } from "../@types/read_receipts";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface IReadReceipt {
    eventId: string;
    ts: number;
    userId: string;
    data?: Record<string, unknown>;
}

export interface IReadMarkers {
    m_read?: string;
    m_fully_read?: string;
}

export interface ReadReceiptsManagerEvents {
    receipt_sent: { roomId: string; eventId: string };
    markers_updated: { roomId: string; markers: IReadMarkers };
}

export class ReadReceiptsManager extends BaseManager<keyof ReadReceiptsManagerEvents, ReadReceiptsManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async sendReadReceipt(roomId: string, eventId: string): Promise<void> {
        const room = this.client.getRoom(roomId);
        const event = room?.findEventById(eventId);
        if (event) {
            await this.client.sendReadReceipt(event);
        }
    }

    public async setReadMarkers(roomId: string, eventId: string, fullyReadEventId?: string): Promise<void> {
        const room = this.client.getRoom(roomId);
        const rrEvent = eventId ? room?.findEventById(eventId) : undefined;
        await this.client.setRoomReadMarkers(roomId, fullyReadEventId || eventId, rrEvent);
    }

    public async setReadMarker(roomId: string, eventId: string): Promise<void> {
        await this.client.setRoomReadMarkers(roomId, eventId, undefined);
    }

    public getReceipt(roomId: string, eventId: string): IReadReceipt[] {
        const room = this.client.getRoom(roomId);
        if (!room) return [];

        const event = room.findEventById(eventId);
        if (!event) return [];

        const receipts = room.getReceiptsForEvent?.(event) || [];
        return receipts.map((r: CachedReceipt) => ({
            eventId: (r.data as Receipt & { event_id?: string }).event_id || eventId,
            ts: (r.data as Receipt).ts || 0,
            userId: r.userId,
            data: r.data as unknown as Record<string, unknown>,
        }));
    }

    public getReadMarkers(roomId: string): IReadMarkers {
        const room = this.client.getRoom(roomId);
        if (!room) return {};

        const readMarker = room.getAccountData("m.fully_read");
        const readReceipt = room.getAccountData("m.read");
        const readReceiptContent = readReceipt?.getContent<{ event_id?: string }>();
        const readMarkerContent = readMarker?.getContent<{ event_id?: string }>();

        return {
            m_read: readReceiptContent?.event_id,
            m_fully_read: readMarkerContent?.event_id,
        };
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getReadReceiptsManager(): ReadReceiptsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getReadReceiptsManager = function (): ReadReceiptsManager {
        return getOrCreateManager(this, "readReceipts", () => new ReadReceiptsManager(this));
    };
}

export default extendMatrixClient;
