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

export class MessageManager {
    constructor(private client: MatrixClient) {}

    /**
     * Send a text message
     */
    public sendTextMessage(roomId: string, body: string, txnId?: string): Promise<any> {
        return (this.client as any).sendTextMessage(roomId, body, txnId);
    }

    /**
     * Send a notice
     */
    public sendNotice(roomId: string, body: string, txnId?: string): Promise<any> {
        return (this.client as any).sendNotice(roomId, body, txnId);
    }

    /**
     * Send an emote message
     */
    public sendEmoteMessage(roomId: string, body: string, txnId?: string): Promise<any> {
        return (this.client as any).sendEmoteMessage(roomId, body, txnId);
    }

    /**
     * Send an HTML message
     */
    public sendHtmlMessage(roomId: string, body: string, htmlBody: string): Promise<any> {
        return (this.client as any).sendHtmlMessage(roomId, body, htmlBody);
    }

    /**
     * Send an HTML notice
     */
    public sendHtmlNotice(roomId: string, body: string, htmlBody: string): Promise<any> {
        return (this.client as any).sendHtmlNotice(roomId, body, htmlBody);
    }

    /**
     * Send an HTML emote
     */
    public sendHtmlEmote(roomId: string, body: string, htmlBody: string): Promise<any> {
        return (this.client as any).sendHtmlEmote(roomId, body, htmlBody);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getMessageManager(): MessageManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getMessageManager = function (): MessageManager {
        return new MessageManager(this);
    };
}

export default extendMatrixClient;
