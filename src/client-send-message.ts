/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { MsgType } from "./@types/event";
import type { RoomMessageEventContent, StickerEventContent } from "./@types/events";
import type { ImageInfo } from "./@types/media";
import * as ContentHelpers from "./content-helpers";
import { normalizeThreadBodyTxnArgs, normalizeThreadHtmlArgs, normalizeThreadMediaArgs } from "./client-send-args";

export interface NormalizedSendMessageArgs {
    threadId: string | null;
    content: RoomMessageEventContent;
    txnId?: string;
}

export function normalizeSendMessageArgs(
    threadId: string | null | RoomMessageEventContent,
    content?: RoomMessageEventContent | string,
    txnId?: string,
): NormalizedSendMessageArgs {
    if (typeof threadId !== "string" && threadId !== null) {
        return {
            threadId: null,
            content: threadId,
            txnId: content as string | undefined,
        };
    }

    return {
        threadId,
        content: content as RoomMessageEventContent,
        txnId,
    };
}

export function buildTextMessagePayload(
    threadId: string | null,
    body: string,
    txnId: string | undefined,
    eventIdPrefix: string,
): NormalizedSendMessageArgs {
    const normalized = normalizeThreadBodyTxnArgs(threadId, body, txnId, eventIdPrefix);
    return {
        threadId: normalized.threadId,
        content: ContentHelpers.makeTextMessage(normalized.body),
        txnId: normalized.txnId,
    };
}

export function buildNoticeMessagePayload(
    threadId: string | null,
    body: string,
    txnId: string | undefined,
    eventIdPrefix: string,
): NormalizedSendMessageArgs {
    const normalized = normalizeThreadBodyTxnArgs(threadId, body, txnId, eventIdPrefix);
    return {
        threadId: normalized.threadId,
        content: ContentHelpers.makeNotice(normalized.body),
        txnId: normalized.txnId,
    };
}

export function buildEmoteMessagePayload(
    threadId: string | null,
    body: string,
    txnId: string | undefined,
    eventIdPrefix: string,
): NormalizedSendMessageArgs {
    const normalized = normalizeThreadBodyTxnArgs(threadId, body, txnId, eventIdPrefix);
    return {
        threadId: normalized.threadId,
        content: ContentHelpers.makeEmoteMessage(normalized.body),
        txnId: normalized.txnId,
    };
}

export function buildHtmlMessagePayload(
    threadId: string | null,
    body: string,
    htmlBody: string | undefined,
    eventIdPrefix: string,
): Pick<NormalizedSendMessageArgs, "threadId" | "content"> {
    const normalized = normalizeThreadHtmlArgs(threadId, body, htmlBody, eventIdPrefix);
    return {
        threadId: normalized.threadId,
        content: ContentHelpers.makeHtmlMessage(normalized.body, normalized.htmlBody),
    };
}

export function buildHtmlNoticePayload(
    threadId: string | null,
    body: string,
    htmlBody: string | undefined,
    eventIdPrefix: string,
): Pick<NormalizedSendMessageArgs, "threadId" | "content"> {
    const normalized = normalizeThreadHtmlArgs(threadId, body, htmlBody, eventIdPrefix);
    return {
        threadId: normalized.threadId,
        content: ContentHelpers.makeHtmlNotice(normalized.body, normalized.htmlBody),
    };
}

export function buildHtmlEmotePayload(
    threadId: string | null,
    body: string,
    htmlBody: string | undefined,
    eventIdPrefix: string,
): Pick<NormalizedSendMessageArgs, "threadId" | "content"> {
    const normalized = normalizeThreadHtmlArgs(threadId, body, htmlBody, eventIdPrefix);
    return {
        threadId: normalized.threadId,
        content: ContentHelpers.makeHtmlEmote(normalized.body, normalized.htmlBody),
    };
}

export function buildImageMessagePayload(
    threadId: string | null,
    url?: string | ImageInfo,
    info?: ImageInfo | string,
    text = "Image",
    eventIdPrefix = "$",
): Pick<NormalizedSendMessageArgs, "threadId" | "content"> {
    const normalized = normalizeThreadMediaArgs(threadId, url, info, text, "Image", eventIdPrefix);
    return {
        threadId: normalized.threadId,
        content: {
            msgtype: MsgType.Image,
            url: normalized.url,
            info: normalized.info,
            body: normalized.text,
        } satisfies RoomMessageEventContent,
    };
}

export function buildStickerMessagePayload(
    threadId: string | null,
    url?: string | ImageInfo,
    info?: ImageInfo | string,
    text = "Sticker",
    eventIdPrefix = "$",
): { threadId: string | null; content: StickerEventContent } {
    const normalized = normalizeThreadMediaArgs(threadId, url, info, text, "Sticker", eventIdPrefix);
    return {
        threadId: normalized.threadId,
        content: {
            url: normalized.url,
            info: normalized.info,
            body: normalized.text,
        } satisfies StickerEventContent,
    };
}
