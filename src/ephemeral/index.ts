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
 * Ephemeral Manager - 临时消息管理
 * 
 * 提供临时消息(阅后即焚)相关功能
 */

import { MatrixClient } from "../client";

export class EphemeralManager {
    constructor(private client: MatrixClient) {}

    /**
     * Send ephemeral event
     */
    public async sendEphemeralEvent(roomId: string, type: string, content: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).sendEphemeralEvent(roomId, type, content);
    }

    /**
     * Get ephemeral events
     */
    public getEphemeralEvents(roomId: string): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getEphemeralEvents(roomId);
    }

    /**
     * Has ephemeral events
     */
    public hasEphemeralEvents(roomId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).hasEphemeralEvents(roomId);
    }

    /**
     * Clear ephemeral events
     */
    public clearEphemeralEvents(roomId: string): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).clearEphemeralEvents(roomId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getEphemeralManager(): EphemeralManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getEphemeralManager = function (): EphemeralManager {
        return new EphemeralManager(this);
    };
}

export default extendMatrixClient;
