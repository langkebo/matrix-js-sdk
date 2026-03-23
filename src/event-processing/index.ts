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

export class EventProcessingManager {
    constructor(private client: MatrixClient) {}

    /**
     * Process event
     */
    public async processEvent(event: any): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).processEvent(event);
    }

    /**
     * Handle event
     */
    public async handleEvent(event: any): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).handleEvent(event);
    }

    /**
     * Emit event
     */
    public emit(eventName: string, ...args: any[]): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).emit(eventName, ...args);
    }

    /**
     * On event
     */
    public on(eventName: string, listener: Function): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).on(eventName, listener);
    }

    /**
     * Off event
     */
    public off(eventName: string, listener: Function): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).off(eventName, listener);
    }

    /**
     * Once event
     */
    public once(eventName: string, listener: Function): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).once(eventName, listener);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getEventProcessingManager(): EventProcessingManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getEventProcessingManager = function (): EventProcessingManager {
        return new EventProcessingManager(this);
    };
}

export default extendMatrixClient;
