/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import type { IContent } from "./models/event";
import type { IRedactOpts } from "./@types/requests";
import type { ImageInfo } from "./@types/media";

export interface NormalizedSendEventArgs {
    threadId: string | null;
    eventType: string;
    content: IContent;
    txnId: string | undefined;
}

export function normalizeSendEventArgs(
    threadIdOrEventType: string | null,
    eventTypeOrContent: string | IContent,
    contentOrTxnId?: IContent | string,
    txnIdOrVoid?: string,
    eventIdPrefix = "$",
): NormalizedSendEventArgs {
    if (!threadIdOrEventType?.startsWith(eventIdPrefix) && threadIdOrEventType !== null) {
        return {
            threadId: null,
            eventType: threadIdOrEventType,
            content: eventTypeOrContent as IContent,
            txnId: contentOrTxnId as string,
        };
    }

    return {
        threadId: threadIdOrEventType,
        eventType: eventTypeOrContent as string,
        content: contentOrTxnId as IContent,
        txnId: txnIdOrVoid,
    };
}

export interface NormalizedRedactEventArgs {
    threadId: string | null;
    eventId: string;
    txnId: string | undefined;
    opts: IRedactOpts | undefined;
}

export function normalizeRedactEventArgs(
    threadId: string | null,
    eventId?: string,
    txnId?: string | IRedactOpts,
    opts?: IRedactOpts,
    eventIdPrefix = "$",
): NormalizedRedactEventArgs {
    if (!eventId?.startsWith(eventIdPrefix)) {
        return {
            threadId: null,
            eventId: threadId!,
            txnId: eventId,
            opts: txnId as IRedactOpts,
        };
    }

    return { threadId, eventId, txnId: txnId as string, opts };
}

export interface NormalizedThreadBodyTxnArgs {
    threadId: string | null;
    body: string;
    txnId: string | undefined;
}

export function normalizeThreadBodyTxnArgs(
    threadId: string | null,
    body: string,
    txnId?: string,
    eventIdPrefix = "$",
): NormalizedThreadBodyTxnArgs {
    if (!threadId?.startsWith(eventIdPrefix) && threadId !== null) {
        return { threadId: null, body: threadId, txnId: body };
    }

    return { threadId, body, txnId };
}

export interface NormalizedThreadHtmlArgs {
    threadId: string | null;
    body: string;
    htmlBody: string;
}

export function normalizeThreadHtmlArgs(
    threadId: string | null,
    body: string,
    htmlBody?: string,
    eventIdPrefix = "$",
): NormalizedThreadHtmlArgs {
    if (!threadId?.startsWith(eventIdPrefix) && threadId !== null) {
        return { threadId: null, body: threadId, htmlBody: body };
    }

    return { threadId, body, htmlBody: htmlBody! };
}

export interface NormalizedThreadMediaArgs {
    threadId: string | null;
    url: string;
    info: ImageInfo;
    text: string;
}

export function normalizeThreadMediaArgs(
    threadId: string | null,
    url?: string | ImageInfo,
    info?: ImageInfo | string,
    text?: string,
    defaultText = "Image",
    eventIdPrefix = "$",
): NormalizedThreadMediaArgs {
    let resolvedThreadId = threadId;
    let resolvedUrl = url;
    let resolvedInfo = info;
    let resolvedText = text ?? defaultText;

    if (!threadId?.startsWith(eventIdPrefix) && threadId !== null) {
        resolvedText = (info as string) || defaultText;
        resolvedInfo = url as ImageInfo;
        resolvedUrl = threadId;
        resolvedThreadId = null;
    }

    return {
        threadId: resolvedThreadId,
        url: resolvedUrl as string,
        info: resolvedInfo as ImageInfo,
        text: resolvedText,
    };
}
