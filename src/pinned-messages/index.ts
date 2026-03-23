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
 * Pinned Messages Manager - 置顶消息管理
 * 
 * 提供置顶消息相关功能
 */

import { MatrixClient } from "../client";

export class PinnedMessagesManager {
    constructor(private client: MatrixClient) {}

    /**
     * Pin message
     */
    public async pinMessage(roomId: string, eventId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).pinMessage(roomId, eventId);
    }

    /**
     * Unpin message
     */
    public async unpinMessage(roomId: string, eventId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).unpinMessage(roomId, eventId);
    }

    /**
     * Get pinned messages
     */
    public getPinnedMessages(roomId: string): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getPinnedMessages(roomId);
    }

    /**
     * Has pinned messages
     */
    public hasPinnedMessages(roomId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).hasPinnedMessages(roomId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getPinnedMessagesManager(): PinnedMessagesManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getPinnedMessagesManager = function (): PinnedMessagesManager {
        return new PinnedMessagesManager(this);
    };
}

export default extendMatrixClient;
