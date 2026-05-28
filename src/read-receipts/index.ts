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
import { CachedReceipt, Receipt, ReceiptType } from "../@types/read_receipts";
import type { EmptyObject } from "../@types/common";
import type { MatrixEvent } from "../models/event";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";
import { sendReceiptRequest, setRoomReadMarkersWithLocalEcho } from "../client-receipt-requests";
import { setRoomReadMarkersRequest } from "../client-batch-requests";

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

    /**
     * Send a receipt.
     * @param event - The event being acknowledged
     * @param receiptType - The kind of receipt e.g. "m.read". Other than
     * ReceiptType.Read are experimental!
     * @param body - Additional content to send alongside the receipt.
     * @param unthreaded - An unthreaded receipt will clear room+thread notifications
     * @returns Promise which resolves: to an empty object `{}`
     * @returns Rejects: with an error response.
     */
    public async sendReceipt(
        event: MatrixEvent,
        receiptType: ReceiptType,
        body?: Record<string, unknown>, // Dynamic: receipt body may contain arbitrary keys like thread_id
        unthreaded = false,
    ): Promise<EmptyObject> {
        return sendReceiptRequest(this.client, {
            event,
            receiptType,
            body,
            unthreaded,
            isGuest: this.client.isGuest(),
            supportsThreads: this.client.supportsThreads(),
            userId: this.client.credentials.userId,
        });
    }

    /**
     * Send a read receipt.
     * @param event - The event that has been read.
     * @param receiptType - other than ReceiptType.Read are experimental! Optional.
     * @returns Promise which resolves: to an empty object `{}`
     * @returns Rejects: with an error response.
     */
    public async sendReadReceipt(
        event: MatrixEvent | null,
        receiptType = ReceiptType.Read,
        unthreaded = false,
    ): Promise<EmptyObject | undefined> {
        if (!event) return;
        const eventId = event.getId()!;
        const room = this.client.getRoom(event.getRoomId());
        if (room?.hasPendingEvent(eventId)) {
            throw new Error(`Cannot set read receipt to a pending event (${eventId})`);
        }

        return this.sendReceipt(event, receiptType, {}, unthreaded);
    }

    /**
     * Set a marker to indicate the point in a room before which the user has read every
     * event. This can be retrieved from room account data (the event type is `m.fully_read`)
     * and displayed as a horizontal line in the timeline that is visually distinct to the
     * position of the user's own read receipt.
     * @param roomId - ID of the room that has been read
     * @param rmEventId - ID of the event that has been read
     * @param rrEvent - the event tracked by the read receipt. This is here for
     * convenience because the RR and the RM are commonly updated at the same time as each
     * other. The local echo of this receipt will be done if set. Optional.
     * @param rpEvent - the m.read.private read receipt event for when we don't
     * want other users to see the read receipts. This is experimental. Optional.
     * @returns Promise which resolves: the empty object, `{}`.
     */
    public async setRoomReadMarkers(
        roomId: string,
        rmEventId: string,
        rrEvent?: MatrixEvent,
        rpEvent?: MatrixEvent,
    ): Promise<EmptyObject> {
        return setRoomReadMarkersWithLocalEcho(
            this.client,
            this.client.getRoom(roomId),
            { roomId, rmEventId, rrEvent, rpEvent, userId: this.client.credentials.userId! },
            (this.client as unknown as { setRoomReadMarkersHttpRequest?: typeof ReadReceiptsManager.prototype.setRoomReadMarkersHttpRequest }).setRoomReadMarkersHttpRequest?.bind(this.client) ??
                this.setRoomReadMarkersHttpRequest.bind(this),
        );
    }

    /**
     * Send an HTTP request to set room read markers.
     * @param roomId - ID of the room
     * @param rmEventId - ID of the event that has been read (fully read marker)
     * @param rrEventId - ID of the event tracked by the read receipt. Optional.
     * @param rpEventId - ID of the m.read.private read receipt event. Optional.
     * @returns Promise which resolves: the empty object, `{}`.
     */
    public async setRoomReadMarkersHttpRequest(
        roomId: string,
        rmEventId: string,
        rrEventId?: string,
        rpEventId?: string,
    ): Promise<EmptyObject> {
        return setRoomReadMarkersRequest(
            roomId,
            rmEventId,
            rrEventId,
            rpEventId,
            async () =>
                (await this.client.doesServerSupportUnstableFeature("org.matrix.msc2285.stable")) ||
                (await this.client.isVersionSupported("v1.4")),
            this.client.http.authedRequest.bind(this.client.http),
        );
    }

    public async sendReadReceiptByEventId(roomId: string, eventId: string): Promise<void> {
        const room = this.client.getRoom(roomId);
        const event = room?.findEventById(eventId);
        if (event) {
            await this.sendReadReceipt(event);
        }
    }

    public async setReadMarkers(roomId: string, eventId: string, fullyReadEventId?: string): Promise<void> {
        const room = this.client.getRoom(roomId);
        const rrEvent = eventId ? room?.findEventById(eventId) : undefined;
        await this.setRoomReadMarkers(roomId, fullyReadEventId || eventId, rrEvent);
    }

    public async setReadMarker(roomId: string, eventId: string): Promise<void> {
        await this.setRoomReadMarkers(roomId, eventId, undefined);
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
