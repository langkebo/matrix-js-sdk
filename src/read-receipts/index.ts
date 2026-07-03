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
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { sendReceiptRequest, setRoomReadMarkersWithLocalEcho, type ReceiptBody } from "../client-receipt-requests";
import { setRoomReadMarkersRequest } from "../client-batch-requests";

export interface IReadReceipt {
    eventId: string;
    ts: number;
    userId: string;
    data?: Receipt;
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
    // 防抖：按房间合并短时间内的多次已读回执请求，只发送最新的一条
    // 避免快速滚动时产生大量 HTTP 请求
    private pendingReceiptTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private pendingReceiptData: Map<string, { event: MatrixEvent; receiptType: ReceiptType; body?: ReceiptBody; unthreaded: boolean }> = new Map();
    private pendingReceiptResolvers: Map<string, { resolve: (v: EmptyObject) => void; reject: (e: unknown) => void }[]> = new Map();
    private readonly RECEIPT_DEBOUNCE_MS = 500;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
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
        body?: ReceiptBody,
        unthreaded = false,
    ): Promise<EmptyObject> {
        const roomId = event.getRoomId();
        // 如果无法获取 roomId，直接发送不做防抖
        if (!roomId) {
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

        // 防抖：同一房间 500ms 内的多次回执请求合并为最后一次
        return new Promise<EmptyObject>((resolve, reject) => {
            // 清除之前的定时器
            const existingTimer = this.pendingReceiptTimers.get(roomId);
            if (existingTimer) {
                clearTimeout(existingTimer);
            }

            // 存储最新的回执数据
            this.pendingReceiptData.set(roomId, { event, receiptType, body, unthreaded });

            // 追加 resolver（之前的调用者也会被 resolve）
            const resolvers = this.pendingReceiptResolvers.get(roomId) ?? [];
            resolvers.push({ resolve, reject });
            this.pendingReceiptResolvers.set(roomId, resolvers);

            // 设置新的定时器
            const timer = setTimeout(async () => {
                this.pendingReceiptTimers.delete(roomId);
                const latestData = this.pendingReceiptData.get(roomId);
                const pendingResolvers = this.pendingReceiptResolvers.get(roomId) ?? [];
                this.pendingReceiptData.delete(roomId);
                this.pendingReceiptResolvers.delete(roomId);

                if (!latestData) {
                    pendingResolvers.forEach(({ resolve: r }) => r({}));
                    return;
                }

                try {
                    const result = await sendReceiptRequest(this.client, {
                        event: latestData.event,
                        receiptType: latestData.receiptType,
                        body: latestData.body,
                        unthreaded: latestData.unthreaded,
                        isGuest: this.client.isGuest(),
                        supportsThreads: this.client.supportsThreads(),
                        userId: this.client.credentials.userId,
                    });
                    pendingResolvers.forEach(({ resolve: r }) => r(result));
                } catch (err) {
                    pendingResolvers.forEach(({ reject: rj }) => rj(err));
                }
            }, this.RECEIPT_DEBOUNCE_MS);

            this.pendingReceiptTimers.set(roomId, timer);
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
            data: r.data,
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


export function extendMatrixClient(): void {
    MatrixClient.prototype.getReadReceiptsManager = function (): ReadReceiptsManager {
        registerManagerClass("readReceipts", ReadReceiptsManager);
    return getOrCreateManager(this, "readReceipts", () => new ReadReceiptsManager(this));
    };
}

export default extendMatrixClient;
