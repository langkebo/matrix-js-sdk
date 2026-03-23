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
 * Pagination Manager - 分页管理
 * 
 * 提供事件分页相关功能
 */

import { MatrixClient } from "../client";

export class PaginationManager {
    constructor(private client: MatrixClient) {}

    /**
     * Paginate event timeline
     */
    public async paginateEventTimeline(eventTimeline: any, opts?: any): Promise<boolean> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).paginateEventTimeline(eventTimeline, opts);
    }

    /**
     * Back paginate room events search
     */
    public async backPaginateRoomEventsSearch(searchResults: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).backPaginateRoomEventsSearch(searchResults);
    }

    /**
     * Fetch initial pagination data
     */
    public async fetchInitialPaginationData(roomId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).fetchInitialPaginationData(roomId);
    }

    /**
     * Get message for pagination
     */
    public getMessagesForTimeline(roomId: string, opts?: any): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getMessagesForTimeline(roomId, opts);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getPaginationManager(): PaginationManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getPaginationManager = function (): PaginationManager {
        return new PaginationManager(this);
    };
}

export default extendMatrixClient;
