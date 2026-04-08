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
 * Pagination Manager - 分页管理
 * 
 * 提供事件分页相关功能
 */

import { MatrixClient } from "../client";
import { EventTimeline } from "../models/event-timeline";

export interface IPaginateOptions {
    backwards?: boolean;
    limit?: number;
}

export interface ISearchResult {
    results: Array<{
        rank?: number;
        result: Record<string, unknown>;
    }>;
    next_batch?: string;
    count?: number;
}

export class PaginationManager {
    constructor(private client: MatrixClient) {}

    public async paginateEventTimeline(eventTimeline: EventTimeline, opts?: IPaginateOptions): Promise<boolean> {
        return (this.client as unknown as {
            paginateEventTimeline: (eventTimeline: EventTimeline, opts?: IPaginateOptions) => Promise<boolean>;
        }).paginateEventTimeline(eventTimeline, opts);
    }

    public async backPaginateRoomEventsSearch(searchResults: ISearchResult): Promise<ISearchResult> {
        return (this.client as unknown as {
            backPaginateRoomEventsSearch: (searchResults: ISearchResult) => Promise<ISearchResult>;
        }).backPaginateRoomEventsSearch(searchResults);
    }

    public async fetchInitialPaginationData(roomId: string): Promise<Record<string, unknown>> {
        return (this.client as unknown as {
            fetchInitialPaginationData: (roomId: string) => Promise<Record<string, unknown>>;
        }).fetchInitialPaginationData(roomId);
    }

    public getMessagesForTimeline(roomId: string, opts?: IPaginateOptions): Record<string, unknown> {
        return (this.client as unknown as {
            getMessagesForTimeline: (roomId: string, opts?: IPaginateOptions) => Record<string, unknown>;
        }).getMessagesForTimeline(roomId, opts);
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
