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
import { AdminValidators } from "../admin/validators";
import { ValidationError } from "../errors";
import { getOrCreateManager } from "../client-infra/manager-registry";

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

    /**
     * 搜索消息文本
     *
     * @param opts - 搜索选项
     * @param opts.term - 搜索关键词
     * @param opts.room_id - 房间 ID（可选）
     * @param opts.limit - 结果数量限制（可选）
     * @param opts.order_by_recency - 是否按时间排序（可选）
     *
     * @example
     * ```typescript
     * // 搜索所有房间的消息
     * const results = await searchManager.searchMessageText({
     *     term: "hello"
     * });
     * console.log(`Found ${results.search_categories.room_events?.count} results`);
     *
     * // 在特定房间搜索
     * const roomResults = await searchManager.searchMessageText({
     *     term: "meeting",
     *     room_id: "!abc:example.com",
     *     limit: 20
     * });
     *
     * // 按时间排序
     * const recentResults = await searchManager.searchMessageText({
     *     term: "update",
     *     order_by_recency: true
     * });
     * ```
     *
     * @throws {ValidationError} 如果搜索关键词为空或房间 ID 格式无效
     * @throws {ApiError} 如果 API 调用失败
     */
    public async searchMessageText(opts: ISearchOptions): Promise<ISearchResponse> {
        if (!opts.term || opts.term.trim().length === 0) {
            throw new ValidationError("Search term is required");
        }
        if (opts.room_id) {
            AdminValidators.validateRoomId(opts.room_id);
        }
        if (opts.limit !== undefined) {
            AdminValidators.validateLimit(opts.limit);
        }
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

    /**
     * 搜索用户目录
     *
     * @param opts - 搜索选项
     * @param opts.term - 搜索关键词
     * @param opts.limit - 结果数量限制（可选）
     *
     * @example
     * ```typescript
     * // 搜索用户
     * const users = await searchManager.searchUserDirectory({
     *     term: "alice"
     * });
     * users.results.forEach(user => {
     *     console.log(`${user.display_name} (${user.user_id})`);
     * });
     *
     * // 限制结果数量
     * const limitedUsers = await searchManager.searchUserDirectory({
     *     term: "bob",
     *     limit: 10
     * });
     * ```
     *
     * @throws {ValidationError} 如果搜索关键词为空或 limit 超出范围
     * @throws {ApiError} 如果 API 调用失败
     */
    public async searchUserDirectory(opts: { term: string; limit?: number }): Promise<IUserDirectoryResponse> {
        if (!opts.term || opts.term.trim().length === 0) {
            throw new ValidationError("Search term is required");
        }
        if (opts.limit !== undefined) {
            AdminValidators.validateLimit(opts.limit);
        }
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

    public async searchRecipients(opts: {
        term: string;
        limit?: number;
    }): Promise<{ results: unknown[]; count: number; next_batch: string | null }> {
        if (!opts.term || opts.term.trim().length === 0) {
            throw new ValidationError("Search term is required");
        }
        if (opts.limit !== undefined) {
            AdminValidators.validateLimit(opts.limit);
        }
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        searchRecipients: (searchTerm: string, limit?: number) => Promise<{
                            results: unknown[];
                            count: number;
                            next_batch: string | null;
                        }>;
                    }
                ).searchRecipients(opts.term, opts.limit),
            "searchRecipients",
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
        return getOrCreateManager(this, "search", () => new SearchManager(this));
    };
}

export default extendMatrixClient;
