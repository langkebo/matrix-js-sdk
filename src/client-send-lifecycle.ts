/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { EventStatus, type IEvent, type MatrixEvent } from "./models/event.ts";
import type { SendDelayedEventRequestOpts } from "./@types/requests.ts";
import type { QueryDict } from "./utils.ts";
import type { Room } from "./models/room.ts";
import {
    addPendingEventOrThrow,
    attachThreadToLocalEvent,
    bindPendingRelationTarget,
    createLocalEchoEvent,
    ensureTxnId,
    formatSendEventDebugMessage,
    setupLocalEventReemit,
} from "./client-send-complete.ts";

interface LoggerLike {
    debug(message: string): void;
}

interface ReEmitterLike {
    reEmit(target: MatrixEvent, events: string[]): void;
}

interface PrepareSendCompleteEventLifecycleArgs {
    roomId: string;
    threadId: string | null;
    eventObject: Partial<IEvent>;
    delayOpts?: SendDelayedEventRequestOpts;
    queryDict?: QueryDict;
    txnId?: string;
    userId: string;
    makeTxnId: () => string;
    getRoom: (roomId: string) => Room | null;
    logger: LoggerLike;
    reEmitter: ReEmitterLike;
}

export interface PreparedSendCompleteEventLifecycle {
    room: Room | null;
    localEvent: MatrixEvent;
    txnId: string;
}

export function prepareSendCompleteEventLifecycle({
    roomId,
    threadId,
    eventObject,
    delayOpts,
    queryDict,
    txnId,
    userId,
    makeTxnId,
    getRoom,
    logger,
    reEmitter,
}: PrepareSendCompleteEventLifecycleArgs): PreparedSendCompleteEventLifecycle {
    const resolvedTxnId = ensureTxnId(txnId, makeTxnId);
    const localEvent = createLocalEchoEvent(eventObject, roomId, userId, resolvedTxnId);
    const room = getRoom(roomId);

    attachThreadToLocalEvent(localEvent, room, threadId);
    if (!delayOpts) {
        setupLocalEventReemit(localEvent, room, reEmitter);
    }

    bindPendingRelationTarget(localEvent, room);

    logger.debug(formatSendEventDebugMessage(localEvent.getType(), roomId, resolvedTxnId, !!delayOpts, queryDict));

    localEvent.setTxnId(resolvedTxnId);
    localEvent.setStatus(EventStatus.SENDING);

    if (!delayOpts) {
        addPendingEventOrThrow(room, localEvent, resolvedTxnId);
    }

    return { room, localEvent, txnId: resolvedTxnId };
}
