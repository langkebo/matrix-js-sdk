/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import type { IContent, IEvent, MatrixEvent } from "./models/event.ts";
import { applyThreadRelationIfNeeded } from "./client-thread-relations.ts";
import { normalizeSendEventArgs } from "./client-send-args.ts";

interface ThreadLike {
    lastReply: (predicate: (event: MatrixEvent) => boolean) => MatrixEvent | null | undefined;
}

export interface PrepareSendEventParamsArgs {
    roomId: string;
    threadIdOrEventType: string | null;
    eventTypeOrContent?: string | IContent;
    contentOrTxnId?: IContent | string;
    txnIdOrVoid?: string;
    eventIdPrefix: string;
    threadRelationTypeName: string;
    getThread: (roomId: string, threadId: string) => ThreadLike | undefined;
}

export interface PreparedSendEventParams {
    threadId: string | null;
    eventObject: Partial<IEvent>;
    txnId?: string;
}

export function prepareSendEventParams({
    roomId,
    threadIdOrEventType,
    eventTypeOrContent,
    contentOrTxnId,
    txnIdOrVoid,
    eventIdPrefix,
    threadRelationTypeName,
    getThread,
}: PrepareSendEventParamsArgs): PreparedSendEventParams {
    const { threadId, eventType, content, txnId } = normalizeSendEventArgs(
        threadIdOrEventType,
        eventTypeOrContent as string | IContent,
        contentOrTxnId,
        txnIdOrVoid,
        eventIdPrefix,
    );

    applyThreadRelationIfNeeded(content, threadId, threadRelationTypeName, (id) => {
        return getThread(roomId, id);
    });

    return {
        threadId,
        eventObject: {
            type: eventType,
            content,
        },
        txnId,
    };
}
