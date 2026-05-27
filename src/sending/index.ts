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
import { EventType } from "../@types/event";
import type { ISendEventResponse } from "../@types/requests";
import type { RoomMessageEventContent } from "../@types/events";
import type { IContent } from "../models/event";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface IImageInfo {
    w?: number;
    h?: number;
    mimetype?: string;
    size?: number;
    thumbnail_url?: string;
    thumbnail_info?: IImageInfo;
}

export interface IEncryptedFileKey {
    alg?: string;
    k?: string;
    ext?: boolean;
    key_ops?: string[];
    [key: string]: unknown;
}

export interface IFileContent {
    body: string;
    filename?: string;
    info?: IImageInfo;
    msgtype: string;
    url?: string;
    file?: {
        url: string;
        key: IEncryptedFileKey;
        iv: string;
        hashes: Record<string, string>;
        v: string;
    };
}

export interface SendingManagerEvents {
    event_sent: { roomId: string; eventId: string };
    message_sent: { roomId: string; eventId: string };
    send_failed: { roomId: string; error: Error };
}

export class SendingManager extends BaseManager<keyof SendingManagerEvents, SendingManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async sendEvent(
        roomId: string,
        eventType: string | EventType,
        content: IContent,
        txnId?: string,
    ): Promise<ISendEventResponse>;
    public async sendEvent(
        roomId: string,
        threadId: string | null,
        eventType: string | EventType,
        content: IContent,
        txnId?: string,
    ): Promise<ISendEventResponse>;
    public async sendEvent(
        roomId: string,
        threadIdOrEventType: string | null | EventType,
        eventTypeOrContent: string | EventType | IContent,
        contentOrTxnId?: IContent | string,
        txnId?: string,
    ): Promise<ISendEventResponse> {
        if (typeof threadIdOrEventType === "string" || threadIdOrEventType === null) {
            return this.withRetry(
                () =>
                    this.client.sendEvent(
                        roomId,
                        threadIdOrEventType,
                        eventTypeOrContent as string | EventType,
                        contentOrTxnId as IContent,
                        txnId,
                    ),
                "sendEvent",
            );
        }
        return this.withRetry(
            () =>
                this.client.sendEvent(
                    roomId,
                    eventTypeOrContent as string | EventType,
                    contentOrTxnId as Record<string, unknown>,
                    txnId,
                ),
            "sendEvent",
        );
    }

    public async sendMessage(
        roomId: string,
        content: RoomMessageEventContent,
        txnId?: string,
    ): Promise<ISendEventResponse>;
    public async sendMessage(
        roomId: string,
        threadId: string | null,
        content: RoomMessageEventContent,
        txnId?: string,
    ): Promise<ISendEventResponse>;
    public async sendMessage(
        roomId: string,
        threadIdOrContent: string | null | RoomMessageEventContent,
        contentOrTxnId?: RoomMessageEventContent | string,
        txnId?: string,
    ): Promise<ISendEventResponse> {
        if (typeof threadIdOrContent === "string" || threadIdOrContent === null) {
            return this.withRetry(
                () =>
                    this.client.sendMessage(
                        roomId,
                        threadIdOrContent,
                        contentOrTxnId as RoomMessageEventContent,
                        txnId,
                    ),
                "sendMessage",
            );
        }
        return this.withRetry(
            () =>
                this.client.sendMessage(roomId, threadIdOrContent as RoomMessageEventContent, contentOrTxnId as string),
            "sendMessage",
        );
    }

    public async sendTextMessage(roomId: string, text: string, txnId?: string): Promise<ISendEventResponse>;
    public async sendTextMessage(
        roomId: string,
        threadId: string | null,
        text: string,
        txnId?: string,
    ): Promise<ISendEventResponse>;
    public async sendTextMessage(
        roomId: string,
        threadIdOrText: string | null,
        textOrTxnId?: string,
        txnId?: string,
    ): Promise<ISendEventResponse> {
        if (typeof threadIdOrText === "string" && textOrTxnId !== undefined) {
            const isThreadMode =
                arguments.length >= 4 ||
                (typeof textOrTxnId === "string" && txnId === undefined && arguments.length === 3);
            if (isThreadMode && arguments.length >= 3) {
                return this.withRetry(
                    () => this.client.sendTextMessage(roomId, threadIdOrText as string | null, textOrTxnId!, txnId),
                    "sendTextMessage",
                );
            }
        }
        return this.withRetry(
            () => this.client.sendTextMessage(roomId, threadIdOrText as string, textOrTxnId),
            "sendTextMessage",
        );
    }

    public async sendHtmlMessage(roomId: string, body: string, html: string): Promise<ISendEventResponse>;
    public async sendHtmlMessage(
        roomId: string,
        threadId: string | null,
        body: string,
        html: string,
    ): Promise<ISendEventResponse>;
    public async sendHtmlMessage(
        roomId: string,
        threadIdOrBody: string | null,
        bodyOrHtml?: string,
        html?: string,
    ): Promise<ISendEventResponse> {
        if (typeof threadIdOrBody === "string" && bodyOrHtml !== undefined && html !== undefined) {
            return this.withRetry(
                () => this.client.sendHtmlMessage(roomId, threadIdOrBody as string | null, bodyOrHtml, html),
                "sendHtmlMessage",
            );
        }
        return this.withRetry(
            () => this.client.sendHtmlMessage(roomId, threadIdOrBody as string, bodyOrHtml!),
            "sendHtmlMessage",
        );
    }

    public async sendEmote(roomId: string, text: string, txnId?: string): Promise<ISendEventResponse>;
    public async sendEmote(
        roomId: string,
        threadId: string | null,
        text: string,
        txnId?: string,
    ): Promise<ISendEventResponse>;
    public async sendEmote(
        roomId: string,
        threadIdOrText: string | null,
        textOrTxnId?: string,
        txnId?: string,
    ): Promise<ISendEventResponse> {
        if (typeof threadIdOrText === "string" && textOrTxnId !== undefined) {
            return this.withRetry(
                () => this.client.sendEmoteMessage(roomId, threadIdOrText as string | null, textOrTxnId, txnId),
                "sendEmote",
            );
        }
        return this.withRetry(
            () => this.client.sendEmoteMessage(roomId, threadIdOrText as string, textOrTxnId),
            "sendEmote",
        );
    }

    public async sendNotice(roomId: string, body: string, txnId?: string): Promise<ISendEventResponse>;
    public async sendNotice(
        roomId: string,
        threadId: string | null,
        body: string,
        txnId?: string,
    ): Promise<ISendEventResponse>;
    public async sendNotice(
        roomId: string,
        threadIdOrBody: string | null,
        bodyOrTxnId?: string,
        txnId?: string,
    ): Promise<ISendEventResponse> {
        if (typeof threadIdOrBody === "string" && bodyOrTxnId !== undefined) {
            return this.withRetry(
                () => this.client.sendNotice(roomId, threadIdOrBody as string | null, bodyOrTxnId, txnId),
                "sendNotice",
            );
        }
        return this.withRetry(
            () => this.client.sendNotice(roomId, threadIdOrBody as string, bodyOrTxnId),
            "sendNotice",
        );
    }

    public async sendImage(roomId: string, url: string, info?: IImageInfo, text?: string): Promise<ISendEventResponse>;
    public async sendImage(
        roomId: string,
        threadId: string | null,
        url: string,
        info?: IImageInfo,
        text?: string,
    ): Promise<ISendEventResponse>;
    public async sendImage(
        roomId: string,
        threadIdOrUrl: string | null,
        urlOrInfo?: string | IImageInfo,
        infoOrText?: IImageInfo | string,
        text?: string,
    ): Promise<ISendEventResponse> {
        if (typeof threadIdOrUrl === "string" && typeof urlOrInfo === "string") {
            return this.withRetry(
                () =>
                    this.client.sendImageMessage(
                        roomId,
                        threadIdOrUrl as string | null,
                        urlOrInfo,
                        infoOrText as IImageInfo | undefined,
                        text,
                    ),
                "sendImage",
            );
        }
        return this.withRetry(
            () =>
                this.client.sendImageMessage(
                    roomId,
                    threadIdOrUrl as string,
                    urlOrInfo as IImageInfo | undefined,
                    infoOrText as string | undefined,
                ),
            "sendImage",
        );
    }

    public async sendFile(roomId: string, content: IFileContent, txnId?: string): Promise<ISendEventResponse> {
        return this.withRetry(
            () => this.client.sendMessage(roomId, null, content as RoomMessageEventContent, txnId),
            "sendFile",
        );
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getSendingManager(): SendingManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSendingManager = function (): SendingManager {
        return getOrCreateManager(this, "sending", () => new SendingManager(this));
    };
}

export default extendMatrixClient;
