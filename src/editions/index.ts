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
 * Editions Manager - 消息编辑管理
 * 
 * 提供消息编辑相关功能
 */

import { MatrixClient } from "../client";

export class EditionsManager {
    constructor(private client: MatrixClient) {}

    /**
     * Edit message
     */
    public async editMessage(roomId: string, eventId: string, content: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).editMessage(roomId, eventId, content);
    }

    /**
     * Redact message
     */
    public async redactMessage(roomId: string, eventId: string, reason?: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).redactMessage(roomId, eventId, reason);
    }

    /**
     * Has edit history
     */
    public hasEditHistory(roomId: string, eventId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).hasEditHistory(roomId, eventId);
    }

    /**
     * Get edit history
     */
    public getEditHistory(roomId: string, eventId: string): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getEditHistory(roomId, eventId);
    }

    /**
     * Is editable
     */
    public isEditable(roomId: string, eventId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isEditable(roomId, eventId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getEditionsManager(): EditionsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getEditionsManager = function (): EditionsManager {
        return new EditionsManager(this);
    };
}

export default extendMatrixClient;
