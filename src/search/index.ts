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
import { Method } from "../http-api/index";
import {
    type ISearchRequestBody,
    type ISearchResponse,
    type ISearchResults,
    SearchOrderBy,
    type SearchKey,
} from "../@types/search";
import type { IEventSearchOpts } from "../@types/requests";
import type { IUserDirectoryResponse } from "../client-internal-types";
import { buildSearchMessageRequestBody } from "../client-batch-requests";
import { performSearchRequest } from "../client-crypto-requests";
import { searchRecipientsRequest } from "../client-secure-backup-requests";
import { SearchResult } from "../models/search-result";
import { eventMapperFor } from "../event-mapper";

export interface ISearchOptions {
    term: string;
    keys?: SearchKey[];
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
        return this.withRetry(async () => {
            const body = buildSearchMessageRequestBody({ query: opts.term, keys: opts.keys });
            return performSearchRequest<ISearchResponse>(body, undefined, undefined, this.client.http.authedRequest.bind(this.client.http));
        }, "searchMessageText");
    }

    public async searchRoomEvents(opts: ISearchOptions): Promise<ISearchResponse> {
        return this.withRetry(async () => {
            const roomEvents: ISearchRequestBody["search_categories"]["room_events"] = {
                search_term: opts.term,
                order_by: SearchOrderBy.Recent,
                event_context: {
                    before_limit: opts.before_limit ?? 1,
                    after_limit: opts.after_limit ?? 1,
                    include_profile: true,
                },
            };
            if (opts.filter) {
                roomEvents.filter = {
                    rooms: opts.filter.rooms,
                    senders: opts.filter.senders,
                    types: opts.filter.types,
                };
            }
            if (opts.include_state !== undefined) {
                roomEvents.include_state = opts.include_state;
            }
            const body: ISearchRequestBody = {
                search_categories: {
                    room_events: roomEvents,
                },
            };
            return performSearchRequest<ISearchResponse>(body, undefined, undefined, this.client.http.authedRequest.bind(this.client.http));
        }, "searchRoomEvents");
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
        return this.withRetry(async () => {
            const body: Record<string, unknown> = {
                search_term: opts.term,
            };
            if (opts.limit !== undefined) {
                body.limit = opts.limit;
            }
            return this.client.http.authedRequest<IUserDirectoryResponse>(
                Method.Post,
                "/user_directory/search",
                undefined,
                body,
            );
        }, "searchUserDirectory");
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
                searchRecipientsRequest<{ results: unknown[]; count: number; next_batch: string | null }>(
                    this.client.http.authedRequest.bind(this.client.http),
                    opts.term,
                    opts.limit,
                ),
            "searchRecipients",
        );
    }

    public async search(
        { body, next_batch, abortSignal }: { body: ISearchRequestBody; next_batch?: string; abortSignal?: AbortSignal },
    ): Promise<ISearchResponse> {
        return this.withRetry(
            () =>
                performSearchRequest<ISearchResponse>(
                    body,
                    next_batch,
                    abortSignal,
                    this.client.http.authedRequest.bind(this.client.http),
                ),
            "search",
        );
    }

    /**
     * Perform a server-side search for room events, returning processed search results.
     *
     * The returned promise resolves to an ISearchResults object containing the fields:
     * count, next_batch, highlights, results
     *
     * @param opts - search options including term and optional filter
     * @returns Promise which resolves: ISearchResults object
     */
    public async searchRoomEventsProcessed(opts: IEventSearchOpts): Promise<ISearchResults> {
        const body = {
            search_categories: {
                room_events: {
                    search_term: opts.term,
                    filter: opts.filter,
                    order_by: SearchOrderBy.Recent,
                    event_context: {
                        before_limit: 1,
                        after_limit: 1,
                        include_profile: true,
                    },
                },
            },
        };

        const searchResults: ISearchResults = {
            _query: body,
            results: [],
            highlights: [],
        };

        const res = await this.searchRoomEvents({ term: opts.term, filter: opts.filter as unknown as import("../filter").IRoomEventFilter });
        return this.processRoomEventsSearch(searchResults, res);
    }

    /**
     * Take a result from an earlier searchRoomEvents call, and backfill results.
     *
     * @param searchResults - the results object to be updated
     * @returns Promise which resolves: updated result object
     */
    public backPaginateRoomEventsSearch<T extends ISearchResults>(searchResults: T): Promise<T> {
        if (!searchResults.next_batch) {
            return Promise.reject(new Error("Cannot backpaginate event search any further"));
        }

        if (searchResults.pendingRequest) {
            return searchResults.pendingRequest as Promise<T>;
        }

        const searchOpts = {
            body: searchResults._query!,
            next_batch: searchResults.next_batch,
        };

        const promise = this.search({ body: searchOpts.body, next_batch: searchOpts.next_batch, abortSignal: searchResults.abortSignal })
            .then((res) => this.processRoomEventsSearch(searchResults, res))
            .finally(() => {
                searchResults.pendingRequest = undefined;
            });
        searchResults.pendingRequest = promise;

        return promise;
    }

    /**
     * Helper for searchRoomEvents and backPaginateRoomEventsSearch. Processes the
     * response from the API call and updates the searchResults.
     *
     * @returns searchResults
     * @internal
     */
    public processRoomEventsSearch<T extends ISearchResults>(searchResults: T, response: ISearchResponse): T {
        const roomEvents = response.search_categories.room_events;

        searchResults.count = roomEvents.count;
        searchResults.next_batch = roomEvents.next_batch;

        // combine the highlight list with our existing list;
        const highlights = new Set<string>(roomEvents.highlights);
        searchResults.highlights.forEach((hl) => {
            highlights.add(hl);
        });

        // turn it back into a list.
        searchResults.highlights = Array.from(highlights);

        const mapper = eventMapperFor(this.client, {});

        // append the new results to our existing results
        const resultsLength = roomEvents.results?.length ?? 0;
        for (let i = 0; i < resultsLength; i++) {
            const sr = SearchResult.fromJson(roomEvents.results![i], mapper);
            const room = this.client.getRoom(sr.context.getEvent().getRoomId());
            if (room) {
                for (const ev of sr.context.getTimeline()) {
                    ev.setMetadata(room.currentState, false);
                }
            }
            searchResults.results.push(sr);
        }
        return searchResults;
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
