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
 * Event Processing Manager - 事件处理管理
 *
 * 提供事件处理相关功能
 */

import { MatrixClient } from "../client";
import { MatrixEvent } from "../models/event";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface EventProcessingManagerEvents {
    event_processed: { eventId: string };
    event_failed: { eventId: string; error: Error };
}

export class EventProcessingManager extends BaseManager<
    keyof EventProcessingManagerEvents,
    EventProcessingManagerEvents
> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async processEvent(event: MatrixEvent): Promise<void> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        processEvent: (event: MatrixEvent) => Promise<void>;
                    }
                ).processEvent(event),
            "processEvent",
        );
    }

    public async handleEvent(event: MatrixEvent): Promise<void> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        handleEvent: (event: MatrixEvent) => Promise<void>;
                    }
                ).handleEvent(event),
            "handleEvent",
        );
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getEventProcessingManager(): EventProcessingManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getEventProcessingManager = function (): EventProcessingManager {
        return getOrCreateManager(this, "eventProcessing", () => new EventProcessingManager(this));
    };
}

export default extendMatrixClient;
