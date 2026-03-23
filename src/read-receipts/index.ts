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
 * Read Receipts Manager - 已读回执管理
 * 
 * 提供已读回执相关功能
 */

import { MatrixClient } from "../client";

export class ReadReceiptsManager {
    constructor(private client: MatrixClient) {}

    /**
     * Send read receipt
     */
    public async sendReadReceipt(roomId: string, eventId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).sendReadReceipt(roomId, eventId);
    }

    /**
     * Set read markers
     */
    public async setReadMarkers(roomId: string, eventId: string, fullyReadEventId?: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).setReadMarkers(roomId, eventId, fullyReadEventId);
    }

    /**
     * Set read marker
     */
    public async setReadMarker(roomId: string, eventId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).setReadMarker(roomId, eventId);
    }

    /**
     * Get read receipt
     */
    public getReceipt(roomId: string, eventId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getReceipt(roomId, eventId);
    }

    /**
     * Get read markers
     */
    public getReadMarkers(roomId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getReadMarkers(roomId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getReadReceiptsManager(): ReadReceiptsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getReadReceiptsManager = function (): ReadReceiptsManager {
        return new ReadReceiptsManager(this);
    };
}

export default extendMatrixClient;
