/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You May obtain a copy of the License at

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
import { MatrixEvent } from "../models/event";

export interface IEditContent {
    msgtype?: string;
    body: string;
    formatted_body?: string;
    format?: string;
    "m.new_content"?: {
        msgtype?: string;
        body: string;
        formatted_body?: string;
        format?: string;
    };
    "m.relates_to"?: {
        rel_type: "m.replace";
        event_id: string;
    };
}

export interface IRedactResponse {
    event_id: string;
}

export interface IEditHistoryEntry {
    event: MatrixEvent;
    timestamp: number;
}

export class EditionsManager {
    constructor(private client: MatrixClient) {}

    public async editMessage(roomId: string, eventId: string, content: IEditContent): Promise<{ event_id: string }> {
        return (this.client as unknown as {
            editMessage: (roomId: string, eventId: string, content: IEditContent) => Promise<{ event_id: string }>;
        }).editMessage(roomId, eventId, content);
    }

    public async redactMessage(roomId: string, eventId: string, reason?: string): Promise<IRedactResponse> {
        return this.client.redactEvent(roomId, eventId, reason);
    }

    public hasEditHistory(roomId: string, eventId: string): boolean {
        return (this.client as unknown as {
            hasEditHistory: (roomId: string, eventId: string) => boolean;
        }).hasEditHistory(roomId, eventId);
    }

    public getEditHistory(roomId: string, eventId: string): IEditHistoryEntry[] {
        return (this.client as unknown as {
            getEditHistory: (roomId: string, eventId: string) => IEditHistoryEntry[];
        }).getEditHistory(roomId, eventId);
    }

    public isEditable(roomId: string, eventId: string): boolean {
        return (this.client as unknown as {
            isEditable: (roomId: string, eventId: string) => boolean;
        }).isEditable(roomId, eventId);
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
