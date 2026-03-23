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
 * Sending Manager - 发送管理
 * 
 * 提供消息发送相关功能
 */

import { MatrixClient } from "../client";

export class SendingManager {
    constructor(private client: MatrixClient) {}

    /**
     * Send event
     */
    public async sendEvent(roomId: string, eventType: string, content: any, opts?: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).sendEvent(roomId, eventType, content, opts);
    }

    /**
     * Send message
     */
    public async sendMessage(roomId: string, content: any, opts?: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).sendMessage(roomId, content, opts);
    }

    /**
     * Send text message
     */
    public async sendTextMessage(roomId: string, text: string, opts?: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).sendTextMessage(roomId, text, opts);
    }

    /**
     * Send html message
     */
    public async sendHtmlMessage(roomId: string, body: string, html: string, opts?: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).sendHtmlMessage(roomId, body, html, opts);
    }

    /**
     * Send emote
     */
    public async sendEmote(roomId: string, text: string, opts?: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).sendEmote(roomId, text, opts);
    }

    /**
     * Send notice
     */
    public async sendNotice(roomId: string, body: string, opts?: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).sendNotice(roomId, body, opts);
    }

    /**
     * Send image
     */
    public async sendImage(roomId: string, url: string, info?: any, opts?: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).sendImage(roomId, url, info, opts);
    }

    /**
     * Send file
     */
    public async sendFile(roomId: string, content: any, info?: any, opts?: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).sendFile(roomId, content, info, opts);
    }
}

// Declare prototype extension
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
