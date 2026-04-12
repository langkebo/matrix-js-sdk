/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    isSendDelayedEventRequestOpts,
    type ISendEventResponse,
    type SendDelayedEventRequestOpts,
    type SendDelayedEventResponse,
} from "./@types/requests.ts";
import { EventStatus, type MatrixEvent } from "./models/event.ts";
import { MatrixError } from "./http-api/index.ts";
import type { Room } from "./models/room.ts";
import type { MatrixScheduler } from "./scheduler.ts";
import type { QueryDict } from "./utils.ts";
import { queueOrSendEvent } from "./client-send-execution.ts";

interface LoggerLike {
    error(...args: unknown[]): void;
}

interface EncryptAndSendEventArgs {
    room: Room | null;
    event: MatrixEvent;
    delayOptsOrQuery?: SendDelayedEventRequestOpts | QueryDict;
    queryDict?: QueryDict;
    scheduler?: MatrixScheduler<ISendEventResponse>;
    eventsBeingEncrypted: Set<string>;
    encryptEventIfNeeded: (event: MatrixEvent, room?: Room) => Promise<void>;
    sendEventHttpRequest: (
        event: MatrixEvent,
        queryOrDelayOpts?: SendDelayedEventRequestOpts | QueryDict,
        queryDict?: QueryDict,
    ) => Promise<ISendEventResponse | SendDelayedEventResponse>;
    updatePendingEventStatus: (room: Room | null, event: MatrixEvent, newStatus: EventStatus) => void;
    logger: LoggerLike;
}

export async function encryptAndSendEventWorkflow({
    room,
    event,
    delayOptsOrQuery,
    queryDict,
    scheduler,
    eventsBeingEncrypted,
    encryptEventIfNeeded,
    sendEventHttpRequest,
    updatePendingEventStatus,
    logger,
}: EncryptAndSendEventArgs): Promise<ISendEventResponse | SendDelayedEventResponse> {
    let queryOpts = queryDict;
    if (delayOptsOrQuery && isSendDelayedEventRequestOpts(delayOptsOrQuery)) {
        return sendEventHttpRequest(event, delayOptsOrQuery, queryOpts);
    } else if (!queryOpts) {
        queryOpts = delayOptsOrQuery as QueryDict | undefined;
    }

    try {
        let cancelled: boolean;
        eventsBeingEncrypted.add(event.getId()!);
        try {
            await encryptEventIfNeeded(event, room ?? undefined);
        } finally {
            cancelled = !eventsBeingEncrypted.delete(event.getId()!);
        }

        if (cancelled) {
            return {} as ISendEventResponse;
        }

        if (event.status === EventStatus.ENCRYPTING) {
            updatePendingEventStatus(room, event, EventStatus.SENDING);
        }

        return await queueOrSendEvent({
            scheduler,
            room,
            event,
            queryOpts,
            sendEventHttpRequest: (ev, q) => sendEventHttpRequest(ev, q) as Promise<ISendEventResponse>,
            updatePendingEventStatus,
        });
    } catch (err) {
        logger.error("Error sending event", err);
        try {
            event.error = err as MatrixError;
            updatePendingEventStatus(room, event, EventStatus.NOT_SENT);
        } catch (e) {
            logger.error("Exception in error handler!", e);
        }
        if (err instanceof MatrixError) {
            err.event = event;
        }
        throw err;
    }
}
