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
import { EventType, MsgType } from "../@types/event";
import type { ISendEventResponse } from "../@types/requests";
import type { RoomMessageEventContent } from "../@types/events";
import type { IContent } from "../models/event";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

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
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * ISSUE-03: 在一次逻辑发送的整个重试生命周期内复用同一 txnId。
     *
     * 此前 txnId 在 `client.sendEvent` 内部每次尝试都重新生成
     * （`ensureTxnId(undefined, makeTxnId)`），弱网/超时重试会产生多条
     * 本地回显与服务端重复消息。现在在进入 `withRetry` 前解析一次，
     * 所有重试尝试共享同一 txnId：服务端按 txnId 幂等去重（后端有
     * 缓存 + DB 唯一约束双保险），本地回显以 txnId 为 key 复用
     * （见 `client-send-lifecycle.ts`）。
     */
    private resolveTxnId(txnId?: string): string {
        return txnId ?? this.client.makeTxnId();
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
        // 两种调用形式：5 参 (roomId, threadId, eventType, content, txnId)
        // 与 4 参 (roomId, eventType, content, txnId)——后者 txnId 落在
        // contentOrTxnId 形参上（eventTypeOrContent 为 content 对象）。
        if (typeof eventTypeOrContent === "object") {
            const effectiveTxnId = this.resolveTxnId(contentOrTxnId as string | undefined);
            return this.withRetry(
                () =>
                    this.client.sendEvent(
                        roomId,
                        threadIdOrEventType as string | EventType,
                        eventTypeOrContent as IContent,
                        effectiveTxnId,
                    ),
                "sendEvent",
            );
        }
        const effectiveTxnId = this.resolveTxnId(txnId);
        return this.withRetry(
            () =>
                this.client.sendEvent(
                    roomId,
                    threadIdOrEventType,
                    eventTypeOrContent as string | EventType,
                    contentOrTxnId as IContent,
                    effectiveTxnId,
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
        // 两种调用形式：4 参 (roomId, threadId, content, txnId)
        // 与 3 参 (roomId, content, txnId)——后者 txnId 落在 contentOrTxnId
        // 形参上（threadIdOrContent 为 content 对象）。
        if (typeof threadIdOrContent === "string" || threadIdOrContent === null) {
            const effectiveTxnId = this.resolveTxnId(txnId);
            return this.withRetry(
                () =>
                    this.client.sendMessage(
                        roomId,
                        threadIdOrContent,
                        contentOrTxnId as RoomMessageEventContent,
                        effectiveTxnId,
                    ),
                "sendMessage",
            );
        }
        const effectiveTxnId = this.resolveTxnId(contentOrTxnId as string | undefined);
        return this.withRetry(
            () => this.client.sendMessage(roomId, threadIdOrContent as RoomMessageEventContent, effectiveTxnId),
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
        // ISSUE-03: 在进入 withRetry 前解析 txnId 一次，整个重试生命周期复用。
        // 形参消解与 client.sendTextMessage 一致（threadId 为 null 或以 "$" 开头）：
        // thread 形式的 txnId 在第 4 位；非 thread 形式的 txnId 落在 textOrTxnId 上。
        const isThreadForm = threadIdOrText === null || threadIdOrText.startsWith("$");
        if (isThreadForm) {
            const effectiveTxnId = this.resolveTxnId(txnId);
            return this.withRetry(
                () =>
                    this.client.sendTextMessage(roomId, threadIdOrText as string | null, textOrTxnId!, effectiveTxnId),
                "sendTextMessage",
            );
        }
        const effectiveTxnId = this.resolveTxnId(textOrTxnId);
        return this.withRetry(
            () => this.client.sendTextMessage(roomId, threadIdOrText as string, effectiveTxnId),
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
        // ISSUE-03: 改走 this.sendMessage（内部复用 txnId），content 构造与
        // client.sendHtmlMessage 一致；形参消解同样按 "$" 前缀判定 threadId。
        const isThreadForm = threadIdOrBody === null || threadIdOrBody.startsWith("$");
        const threadId = isThreadForm ? threadIdOrBody : null;
        const plainBody = isThreadForm ? bodyOrHtml! : threadIdOrBody;
        const htmlBody = isThreadForm ? html! : bodyOrHtml!;
        return this.sendMessage(roomId, threadId, {
            msgtype: MsgType.Text,
            body: plainBody,
            format: "org.matrix.custom.html",
            formatted_body: htmlBody,
        } as RoomMessageEventContent);
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
        // ISSUE-03: 同 sendTextMessage 的形参消解（threadId 为 null 或以 "$" 开头）
        const isThreadForm = threadIdOrText === null || threadIdOrText.startsWith("$");
        if (isThreadForm) {
            const effectiveTxnId = this.resolveTxnId(txnId);
            return this.withRetry(
                () =>
                    this.client.sendEmoteMessage(roomId, threadIdOrText as string | null, textOrTxnId!, effectiveTxnId),
                "sendEmote",
            );
        }
        const effectiveTxnId = this.resolveTxnId(textOrTxnId);
        return this.withRetry(
            () => this.client.sendEmoteMessage(roomId, threadIdOrText as string, effectiveTxnId),
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
        // ISSUE-03: 同 sendTextMessage 的形参消解（threadId 为 null 或以 "$" 开头）
        const isThreadForm = threadIdOrBody === null || threadIdOrBody.startsWith("$");
        if (isThreadForm) {
            const effectiveTxnId = this.resolveTxnId(txnId);
            return this.withRetry(
                () => this.client.sendNotice(roomId, threadIdOrBody as string | null, bodyOrTxnId!, effectiveTxnId),
                "sendNotice",
            );
        }
        const effectiveTxnId = this.resolveTxnId(bodyOrTxnId);
        return this.withRetry(
            () => this.client.sendNotice(roomId, threadIdOrBody as string, effectiveTxnId),
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
        // ISSUE-03: 改走 this.sendMessage（内部复用 txnId），content 构造与
        // client.sendImageMessage 一致。
        if (typeof threadIdOrUrl === "string" && typeof urlOrInfo === "string") {
            return this.sendMessage(roomId, threadIdOrUrl, {
                msgtype: MsgType.Image,
                url: urlOrInfo,
                info: infoOrText as IImageInfo | undefined,
                body: text ?? "Image",
            } as RoomMessageEventContent);
        }
        return this.sendMessage(roomId, null, {
            msgtype: MsgType.Image,
            url: threadIdOrUrl as string,
            info: urlOrInfo as IImageInfo | undefined,
            body: (infoOrText as string | undefined) ?? "Image",
        } as RoomMessageEventContent);
    }

    public async sendFile(roomId: string, content: IFileContent, txnId?: string): Promise<ISendEventResponse> {
        const effectiveTxnId = this.resolveTxnId(txnId);
        return this.withRetry(
            () => this.client.sendMessage(roomId, null, content as RoomMessageEventContent, effectiveTxnId),
            "sendFile",
        );
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSendingManager = function (): SendingManager {
        registerManagerClass("sending", SendingManager);
        return getOrCreateManager(this, "sending", () => new SendingManager(this));
    };
}
