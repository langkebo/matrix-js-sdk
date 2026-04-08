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
import { MatrixEvent } from "../models/event";

export interface ISendEventResponse {
    event_id: string;
}

export interface IImageInfo {
    w?: number;
    h?: number;
    mimetype?: string;
    size?: number;
    thumbnail_url?: string;
    thumbnail_info?: IImageInfo;
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
        key: Record<string, unknown>;
        iv: string;
        hashes: Record<string, string>;
        v: string;
    };
    [key: string]: unknown;
}

export class SendingManager {
    constructor(private client: MatrixClient) {}

    public async sendEvent(
        roomId: string,
        eventType: string | EventType,
        content: Record<string, unknown>,
        txnId?: string,
    ): Promise<ISendEventResponse>;
    public async sendEvent(
        roomId: string,
        threadId: string | null,
        eventType: string | EventType,
        content: Record<string, unknown>,
        txnId?: string,
    ): Promise<ISendEventResponse>;
    public async sendEvent(roomId: string, ...args: unknown[]): Promise<ISendEventResponse> {
        return (this.client as any).sendEvent(roomId, ...args);
    }

    public async sendMessage(roomId: string, content: Record<string, unknown>, txnId?: string): Promise<ISendEventResponse>;
    public async sendMessage(roomId: string, threadId: string | null, content: Record<string, unknown>, txnId?: string): Promise<ISendEventResponse>;
    public async sendMessage(roomId: string, ...args: unknown[]): Promise<ISendEventResponse> {
        return (this.client as any).sendMessage(roomId, ...args);
    }

    public async sendTextMessage(roomId: string, text: string, txnId?: string): Promise<ISendEventResponse>;
    public async sendTextMessage(roomId: string, threadId: string | null, text: string, txnId?: string): Promise<ISendEventResponse>;
    public async sendTextMessage(roomId: string, ...args: unknown[]): Promise<ISendEventResponse> {
        return (this.client as any).sendTextMessage(roomId, ...args);
    }

    public async sendHtmlMessage(roomId: string, body: string, html: string): Promise<ISendEventResponse>;
    public async sendHtmlMessage(roomId: string, threadId: string | null, body: string, html: string): Promise<ISendEventResponse>;
    public async sendHtmlMessage(roomId: string, ...args: unknown[]): Promise<ISendEventResponse> {
        return (this.client as any).sendHtmlMessage(roomId, ...args);
    }

    public async sendEmote(roomId: string, text: string, txnId?: string): Promise<ISendEventResponse>;
    public async sendEmote(roomId: string, threadId: string | null, text: string, txnId?: string): Promise<ISendEventResponse>;
    public async sendEmote(roomId: string, ...args: unknown[]): Promise<ISendEventResponse> {
        return (this.client as any).sendEmoteMessage(roomId, ...args);
    }

    public async sendNotice(roomId: string, body: string, txnId?: string): Promise<ISendEventResponse>;
    public async sendNotice(roomId: string, threadId: string | null, body: string, txnId?: string): Promise<ISendEventResponse>;
    public async sendNotice(roomId: string, ...args: unknown[]): Promise<ISendEventResponse> {
        return (this.client as any).sendNotice(roomId, ...args);
    }

    public async sendImage(roomId: string, url: string, info?: IImageInfo, text?: string): Promise<ISendEventResponse>;
    public async sendImage(roomId: string, threadId: string | null, url: string, info?: IImageInfo, text?: string): Promise<ISendEventResponse>;
    public async sendImage(roomId: string, ...args: unknown[]): Promise<ISendEventResponse> {
        return (this.client as any).sendImageMessage(roomId, ...args);
    }

    public async sendFile(roomId: string, content: IFileContent, txnId?: string): Promise<ISendEventResponse> {
        return (this.client as any).sendMessage(roomId, content, txnId);
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getSendingManager(): SendingManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSendingManager = function (): SendingManager {
        return new SendingManager(this);
    };
}

export default extendMatrixClient;
