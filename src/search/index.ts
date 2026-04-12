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
 * Search Manager - 搜索管理
 *
 * 提供消息、用户搜索功能
 */

import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";

export interface ISearchOptions {
    term: string;
    room_id?: string;
    limit?: number;
    before_limit?: number;
    after_limit?: number;
    order_by_recency?: boolean;
    include_state?: boolean;
    filter?: {
        rooms?: string[];
        senders?: string[];
        types?: string[];
    };
}

export interface ISearchResult {
    rank?: number;
    result: Record<string, unknown>;
    context?: {
        events_before: Array<Record<string, unknown>>;
        events_after: Array<Record<string, unknown>>;
        profile_info?: Record<string, { displayname?: string; avatar_url?: string }>;
    };
}

export interface ISearchResponse {
    search_categories: {
        room_events?: {
            count: number;
            results: ISearchResult[];
            next_batch?: string;
            highlights?: string[];
            state?: Array<Record<string, unknown>>;
        };
    };
}

export interface IUserDirectorySearchResult {
    user_id: string;
    display_name?: string;
    avatar_url?: string;
}

export interface IUserDirectoryResponse {
    results: IUserDirectorySearchResult[];
    limited?: boolean;
}

export interface SearchManagerEvents {
    search_completed: { term: string; count: number };
    search_failed: { term: string; error: Error };
}

export class SearchManager extends BaseManager<keyof SearchManagerEvents, SearchManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async searchMessageText(opts: ISearchOptions): Promise<ISearchResponse> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        searchMessageText: (opts: ISearchOptions) => Promise<ISearchResponse>;
                    }
                ).searchMessageText(opts),
            "searchMessageText",
        );
    }

    public async searchRoomEvents(opts: ISearchOptions): Promise<ISearchResponse> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        searchRoomEvents: (opts: ISearchOptions) => Promise<ISearchResponse>;
                    }
                ).searchRoomEvents(opts),
            "searchRoomEvents",
        );
    }

    public async searchUserDirectory(opts: { term: string; limit?: number }): Promise<IUserDirectoryResponse> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        searchUserDirectory: (opts: {
                            term: string;
                            limit?: number;
                        }) => Promise<IUserDirectoryResponse>;
                    }
                ).searchUserDirectory(opts),
            "searchUserDirectory",
        );
    }

    public async search(opts: { room_events?: ISearchOptions }): Promise<ISearchResponse> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        search: (opts: { room_events?: ISearchOptions }) => Promise<ISearchResponse>;
                    }
                ).search(opts),
            "search",
        );
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getSearchManager(): SearchManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSearchManager = function (): SearchManager {
        return new SearchManager(this);
    };
}

export default extendMatrixClient;
