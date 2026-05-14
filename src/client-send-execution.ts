/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { EventStatus, type MatrixEvent } from "./models/event";
import type { ISendEventResponse } from "./@types/requests";
import type { Room } from "./models/room";
import type { MatrixScheduler } from "./scheduler";
import type { QueryDict } from "./utils";

interface SendExecutionArgs {
    scheduler?: MatrixScheduler<ISendEventResponse>;
    room: Room | null;
    event: MatrixEvent;
    queryOpts?: QueryDict;
    sendEventHttpRequest: (event: MatrixEvent, queryDict?: QueryDict) => Promise<ISendEventResponse>;
    updatePendingEventStatus: (room: Room | null, event: MatrixEvent, status: EventStatus) => void;
}

export function queueOrSendEvent({
    scheduler,
    room,
    event,
    queryOpts,
    sendEventHttpRequest,
    updatePendingEventStatus,
}: SendExecutionArgs): Promise<ISendEventResponse> {
    let promise: Promise<ISendEventResponse> | null = null;
    if (scheduler) {
        promise = scheduler.queueEvent(event);
        if (promise && scheduler.getQueueForEvent(event)!.length > 1) {
            updatePendingEventStatus(room, event, EventStatus.QUEUED);
        }
    }

    if (!promise) {
        promise = sendEventHttpRequest(event, queryOpts);
        if (room) {
            promise = promise.then((res) => {
                room.updatePendingEvent(event, EventStatus.SENT, res["event_id"]);
                return res;
            });
        }
    }
    return promise;
}
