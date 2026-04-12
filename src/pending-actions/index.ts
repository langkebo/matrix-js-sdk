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
 * Pending Actions Manager - 待处理操作管理
 *
 * 提供待发送事件管理功能
 */

import { MatrixClient } from "../client";
import { MatrixEvent } from "../models/event";
import { BaseManager } from "../managers/base-manager";
import { type UploadResponse } from "../http-api/index";

export interface PendingActionsManagerEvents {
    pending_event_added: { roomId: string; event: MatrixEvent };
    pending_event_removed: { roomId: string; eventId: string };
    upload_cancelled: { uploadId: string };
}

export class PendingActionsManager extends BaseManager<keyof PendingActionsManagerEvents, PendingActionsManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public getPendingEvents(roomId: string): MatrixEvent[] {
        return this.client.getPendingEvents(roomId);
    }

    public hasPendingEvents(roomId: string): boolean {
        return this.client.hasPendingEvents(roomId);
    }

    public cancelUpload(upload: Promise<UploadResponse>): boolean {
        return this.client.cancelUpload(upload);
    }

    public getUnsentEvents(roomId: string): MatrixEvent[] {
        return this.client.getUnsentEvents(roomId);
    }

    public cancelScheduledEvent(eventId: string): void {
        this.client._unstable_cancelScheduledDelayedEvent(eventId);
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getPendingActionsManager(): PendingActionsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getPendingActionsManager = function (): PendingActionsManager {
        return new PendingActionsManager(this);
    };
}

export default extendMatrixClient;
