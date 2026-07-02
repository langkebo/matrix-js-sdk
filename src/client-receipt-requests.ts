import { Method } from "./http-api/method";
import type { EmptyObject } from "./@types/common";
import type { MatrixClient } from "./client";
import { threadIdForReceipt } from "./client-receipts";
import type { MatrixEvent } from "./models/event";
import { ReceiptType } from "./@types/read_receipts";
import type { Room } from "./models/room";
import * as utils from "./utils";

/**
 * Receipt body data sent with a read receipt request.
 * May contain arbitrary keys like `thread_id` or `hidden`.
 */
export type ReceiptBody = Record<string, unknown>; /* Dynamic: receipt body may contain arbitrary keys like thread_id */

export interface SendReceiptOptions {
    event: MatrixEvent;
    receiptType: ReceiptType;
    body?: ReceiptBody;
    unthreaded: boolean;
    isGuest: boolean;
    supportsThreads: boolean;
    userId: string | null;
}

export function buildReceiptPath(event: MatrixEvent, receiptType: ReceiptType): string {
    return utils.encodeUri("/rooms/$roomId/receipt/$receiptType/$eventId", {
        $roomId: event.getRoomId()!,
        $receiptType: receiptType,
        $eventId: event.getId()!,
    });
}

export function buildReceiptBody(
    body: ReceiptBody | undefined,
    event: MatrixEvent,
    unthreaded: boolean,
    supportsThreads: boolean,
): ReceiptBody | undefined {
    const shouldAddThreadId = !unthreaded && supportsThreads;
    return shouldAddThreadId ? { ...body, thread_id: threadIdForReceipt(event) } : body;
}

export async function sendReceiptRequest(client: MatrixClient, options: SendReceiptOptions): Promise<EmptyObject> {
    if (options.isGuest) {
        return Promise.resolve({});
    }

    const path = buildReceiptPath(options.event, options.receiptType);
    const fullBody = buildReceiptBody(options.body, options.event, options.unthreaded, options.supportsThreads);

    const promise = client.http.authedRequest<EmptyObject>(Method.Post, path, undefined, fullBody || {});

    const room = client.getRoom(options.event.getRoomId());
    if (room && options.userId) {
        room.addLocalEchoReceipt(options.userId, options.event, options.receiptType, options.unthreaded);
    }
    return promise;
}

export interface SetRoomReadMarkersOptions {
    roomId: string;
    rmEventId: string;
    rrEventId?: string;
    rpEventId?: string;
}

export interface ReadMarkersBody {
    "m.fully_read": string;
    "m.read"?: string;
    "m.read.private"?: string;
}

export async function setRoomReadMarkersHttpRequest(
    client: MatrixClient,
    options: SetRoomReadMarkersOptions,
): Promise<EmptyObject> {
    const path = utils.encodeUri("/rooms/$roomId/read_markers", {
        $roomId: options.roomId,
    });

    const body: ReadMarkersBody = {
        "m.fully_read": options.rmEventId,
    };

    if (options.rrEventId) {
        body["m.read"] = options.rrEventId;
    }

    if (options.rpEventId) {
        body["m.read.private"] = options.rpEventId;
    }

    return client.http.authedRequest<EmptyObject>(Method.Post, path, undefined, body);
}

export interface SetRoomReadMarkersFullOptions {
    roomId: string;
    rmEventId: string;
    rrEvent?: MatrixEvent;
    rpEvent?: MatrixEvent;
    userId: string;
}

export async function setRoomReadMarkersWithLocalEcho(
    _client: MatrixClient,
    room: Room | null,
    options: SetRoomReadMarkersFullOptions,
    httpHandler: (roomId: string, rmEventId: string, rrEventId?: string, rpEventId?: string) => Promise<EmptyObject>,
): Promise<EmptyObject> {
    if (room?.hasPendingEvent(options.rmEventId)) {
        throw new Error(`Cannot set read marker to a pending event (${options.rmEventId})`);
    }

    let rrEventId: string | undefined;
    if (options.rrEvent) {
        rrEventId = options.rrEvent.getId()!;
        if (room?.hasPendingEvent(rrEventId)) {
            throw new Error(`Cannot set read receipt to a pending event (${rrEventId})`);
        }
        room?.addLocalEchoReceipt(options.userId, options.rrEvent, ReceiptType.Read);
    }

    let rpEventId: string | undefined;
    if (options.rpEvent) {
        rpEventId = options.rpEvent.getId()!;
        if (room?.hasPendingEvent(rpEventId)) {
            throw new Error(`Cannot set read receipt to a pending event (${rpEventId})`);
        }
        room?.addLocalEchoReceipt(options.userId, options.rpEvent, ReceiptType.ReadPrivate);
    }

    return httpHandler(options.roomId, options.rmEventId, rrEventId, rpEventId);
}
