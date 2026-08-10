/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { EventStatus, type IEvent, type MatrixEvent } from "./models/event";
import type { SendDelayedEventRequestOpts } from "./@types/requests";
import type { QueryDict } from "./utils";
import type { Room } from "./models/room";
import {
    addPendingEventOrThrow,
    attachThreadToLocalEvent,
    bindPendingRelationTarget,
    createLocalEchoEvent,
    ensureTxnId,
    formatSendEventDebugMessage,
    setupLocalEventReemit,
} from "./client-send-complete";

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
    const room = getRoom(roomId);

    // ISSUE-03: 重试复用——若房间内已存在同 txnId 的本地回显（上次尝试失败
    // 被置为 NOT_SENT/QUEUED），直接复用该回显，而不是新建回显后再
    // addPendingEvent（后者对已知 txnId 会抛 "known txnId" 错误）。这样整个
    // 重试生命周期只有一条本地回显，服务端也只会收到同一 txnId 的幂等请求。
    if (!delayOpts) {
        const existing = room?.getPendingEvents().find((e) => e.getTxnId() === resolvedTxnId);
        if (existing) {
            logger.debug(`sendEvent retry reuses local echo for txnId ${resolvedTxnId} in ${roomId}`);
            existing.setStatus(EventStatus.SENDING);
            return { room, localEvent: existing, txnId: resolvedTxnId };
        }
    }

    const localEvent = createLocalEchoEvent(eventObject, roomId, userId, resolvedTxnId);

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
