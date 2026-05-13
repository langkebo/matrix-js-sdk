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

/**
 * Message Manager - 消息管理
 *
 * 提供消息发送功能
 */

import { MatrixClient } from "../client";
import type { ISendEventResponse } from "../@types/requests";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface MessageManagerEvents {
    message_sent: { roomId: string; eventId: string };
    message_failed: { roomId: string; error: Error };
}

export class MessageManager extends BaseManager<keyof MessageManagerEvents, MessageManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async sendTextMessage(roomId: string, body: string, txnId?: string): Promise<ISendEventResponse> {
        return this.withRetry(() => this.client.sendTextMessage(roomId, body, txnId), "sendTextMessage");
    }

    public async sendNotice(roomId: string, body: string, txnId?: string): Promise<ISendEventResponse> {
        return this.withRetry(() => this.client.sendNotice(roomId, body, txnId), "sendNotice");
    }

    public async sendEmoteMessage(roomId: string, body: string, txnId?: string): Promise<ISendEventResponse> {
        return this.withRetry(() => this.client.sendEmoteMessage(roomId, body, txnId), "sendEmoteMessage");
    }

    public async sendHtmlMessage(roomId: string, body: string, htmlBody: string): Promise<ISendEventResponse> {
        return this.withRetry(() => this.client.sendHtmlMessage(roomId, body, htmlBody), "sendHtmlMessage");
    }

    public async sendHtmlNotice(roomId: string, body: string, htmlBody: string): Promise<ISendEventResponse> {
        return this.withRetry(() => this.client.sendHtmlNotice(roomId, body, htmlBody), "sendHtmlNotice");
    }

    public async sendHtmlEmote(roomId: string, body: string, htmlBody: string): Promise<ISendEventResponse> {
        return this.withRetry(() => this.client.sendHtmlEmote(roomId, body, htmlBody), "sendHtmlEmote");
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getMessageManager(): MessageManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getMessageManager = function (): MessageManager {
        return getOrCreateManager(this, "message", () => new MessageManager(this));
    };
}

export default extendMatrixClient;
