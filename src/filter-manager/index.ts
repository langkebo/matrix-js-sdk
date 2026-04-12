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

import { type IFilterDefinition } from "../filter";
import { FilterManager as CoreFilterManager } from "../filter/index";
import { type MatrixClient } from "../client";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { NotFoundError } from "../errors";
import { BaseManager } from "../managers/base-manager";

export enum FilterEvent {
    FilterCreated = "FilterCreated",
    FilterDeleted = "FilterDeleted",
    FilterUpdated = "FilterUpdated",
    FilterError = "FilterError",
}

/**
 * @deprecated Import `IFilterDefinition` from `../filter` instead.
 */
export type IFilterManagerDefinition = IFilterDefinition;

/**
 * @deprecated Import `FilterManager` from `../filter/index` instead.
 */
export interface IFilterManagerResponse {
    filter_id: string;
}

/**
 * @deprecated Import `FilterManager` from `../filter/index` instead.
 */
export interface IFilterInfo {
    filterId: string;
    definition: IFilterManagerDefinition;
    createdAt: number;
}

interface FilterManagerEventMap {
    [FilterEvent.FilterCreated]: (filterId: string, definition: IFilterManagerDefinition) => void;
    [FilterEvent.FilterDeleted]: (filterId: string) => void;
    [FilterEvent.FilterUpdated]: (filterId: string, definition: IFilterManagerDefinition) => void;
    [FilterEvent.FilterError]: (error: Error) => void;
}

/**
 * @deprecated Use the canonical `FilterManager` from `../filter/index`.
 * This compatibility wrapper keeps the legacy `filter-manager` path working
 * while delegating create/get behavior to the canonical implementation.
 */
export class FilterManager extends BaseManager<FilterEvent, FilterManagerEventMap> {
    private readonly coreManager: CoreFilterManager;
    private filters: Map<string, IFilterInfo> = new Map();
    private filterCache: Map<string, IFilterManagerDefinition> = new Map();
    private defaultFilter: IFilterManagerDefinition | null = null;

    constructor(client: MatrixClient) {
        super(client);
        this.coreManager = new CoreFilterManager(client);
    }

    public async createFilter(definition: IFilterManagerDefinition): Promise<string> {
        if (!definition) {
            throw new Error("Filter definition is required");
        }

        try {
            const { filterId } = await this.coreManager.createFilter(definition);
            this.rememberFilter(filterId, definition);
            this.emit(FilterEvent.FilterCreated, filterId, definition);

            return filterId;
        } catch (error) {
            const normalized = this.normalizeError(error, "createFilter");
            this.emit(FilterEvent.FilterError, normalized);
            throw normalized;
        }
    }

    public async getFilter(filterId: string, allowCached = true): Promise<IFilterManagerDefinition | null> {
        if (!filterId) {
            throw new Error("Filter ID is required");
        }

        if (allowCached && this.filterCache.has(filterId)) {
            return this.filterCache.get(filterId) || null;
        }

        const userId = this.client.getUserId();
        if (!userId) {
            throw new Error("User ID is required");
        }
        return this.coreManager.getFilter(userId, filterId, allowCached).then(
            (filter) => {
                const definition = filter.getDefinition();
                this.rememberFilter(filterId, definition);
                return definition;
            },
            (error) => {
                const normalized = this.normalizeError(error, "getFilter");
                if (normalized instanceof NotFoundError) {
                    return null;
                }
                this.emit(FilterEvent.FilterError, normalized);
                throw normalized;
            },
        );
    }

    public async deleteFilter(filterId: string): Promise<void> {
        if (!filterId) {
            throw new Error("Filter ID is required");
        }

        try {
            const userId = this.client.getUserId();
            if (!userId) {
                throw new Error("User ID is required");
            }
            await this.client.http.authedRequest(
                Method.Delete,
                `/user/${encodeURIComponent(userId)}/filter/${encodeURIComponent(filterId)}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );

            this.filters.delete(filterId);
            this.filterCache.delete(filterId);

            this.emit(FilterEvent.FilterDeleted, filterId);
        } catch (error) {
            const normalized = this.normalizeError(error, "deleteFilter");
            this.emit(FilterEvent.FilterError, normalized);
            throw normalized;
        }
    }

    public setDefaultFilter(definition: IFilterManagerDefinition): void {
        this.defaultFilter = definition;
    }

    public getDefaultFilter(): IFilterManagerDefinition | null {
        return this.defaultFilter;
    }

    public async createDefaultFilter(): Promise<string> {
        const definition: IFilterManagerDefinition = {
            room: {
                timeline: {
                    limit: 50,
                    lazy_load_members: true,
                },
                state: {
                    lazy_load_members: true,
                },
            },
            presence: {
                types: ["m.presence"],
            },
        };

        return this.createFilter(definition);
    }

    public async createMessageFilter(limit: number = 100): Promise<string> {
        const definition: IFilterManagerDefinition = {
            room: {
                timeline: {
                    limit,
                    types: ["m.room.message"],
                },
            },
        };

        return this.createFilter(definition);
    }

    public async createStateFilter(): Promise<string> {
        const definition: IFilterManagerDefinition = {
            room: {
                state: {
                    types: ["m.room.member", "m.room.power_levels", "m.room.join_rules", "m.room.history_visibility"],
                    lazy_load_members: true,
                },
            },
        };

        return this.createFilter(definition);
    }

    public async createEphemeralFilter(): Promise<string> {
        const definition: IFilterManagerDefinition = {
            room: {
                ephemeral: {
                    types: ["m.typing", "m.receipt"],
                },
            },
        };

        return this.createFilter(definition);
    }

    public async createRoomFilter(roomIds: string[]): Promise<string> {
        const definition: IFilterManagerDefinition = {
            room: {
                timeline: {
                    rooms: roomIds,
                },
                state: {
                    rooms: roomIds,
                },
                ephemeral: {
                    rooms: roomIds,
                },
            },
        };

        return this.createFilter(definition);
    }

    public async createSenderFilter(senders: string[]): Promise<string> {
        const definition: IFilterManagerDefinition = {
            room: {
                timeline: {
                    senders,
                },
            },
        };

        return this.createFilter(definition);
    }

    public async createTypeFilter(types: string[]): Promise<string> {
        const definition: IFilterManagerDefinition = {
            room: {
                timeline: {
                    types,
                },
            },
        };

        return this.createFilter(definition);
    }

    public async excludeTypes(notTypes: string[]): Promise<string> {
        const definition: IFilterManagerDefinition = {
            room: {
                timeline: {
                    not_types: notTypes,
                },
            },
        };

        return this.createFilter(definition);
    }

    public getCachedFilter(filterId: string): IFilterManagerDefinition | null {
        return this.filterCache.get(filterId) || null;
    }

    public getCachedFilters(): Map<string, IFilterManagerDefinition> {
        return new Map(this.filterCache);
    }

    public getFilterInfo(filterId: string): IFilterInfo | null {
        return this.filters.get(filterId) || null;
    }

    public getAllFilters(): IFilterInfo[] {
        return Array.from(this.filters.values());
    }

    public clearCache(): void {
        this.filters.clear();
        this.filterCache.clear();
    }

    public async start(): Promise<void> {
        if (this.defaultFilter) {
            await this.createFilter(this.defaultFilter);
        }
    }

    public stop(): void {
        this.filters.clear();
        this.filterCache.clear();
    }

    private rememberFilter(filterId: string, definition: IFilterManagerDefinition): void {
        const existing = this.filters.get(filterId);
        const filterInfo: IFilterInfo = {
            filterId,
            definition,
            createdAt: existing?.createdAt ?? Date.now(),
        };

        this.filters.set(filterId, filterInfo);
        this.filterCache.set(filterId, definition);

        if (existing && existing.definition !== definition) {
            this.emit(FilterEvent.FilterUpdated, filterId, definition);
        }
    }
}

/**
 * @deprecated Use plain `IFilterDefinition` objects instead.
 */
export function createFilterDefinition(options: Partial<IFilterManagerDefinition>): IFilterManagerDefinition {
    return {
        room: options.room || {},
        presence: options.presence,
        account_data: options.account_data,
        event_format: options.event_format || "client",
        event_fields: options.event_fields,
    };
}

export default FilterManager;
