import { logger } from "../logger"
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
 * Filter Manager - 过滤器管理
 * 
 * 提供过滤器的创建、存储、查询功能
 */

import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { MatrixClient } from "../client.ts";

export enum FilterEvent {
    FilterCreated = "FilterCreated",
    FilterDeleted = "FilterDeleted",
    FilterUpdated = "FilterUpdated",
    FilterError = "FilterError",
}

export interface IFilterManagerDefinition {
    room?: {
        timeline?: {
            limit?: number;
            types?: string[];
            not_types?: string[];
            rooms?: string[];
            not_rooms?: string[];
            senders?: string[];
            not_senders?: string[];
            contains_url?: boolean;
            lazy_load_members?: boolean;
            include_redundant_members?: boolean;
        };
        state?: {
            types?: string[];
            not_types?: string[];
            rooms?: string[];
            not_rooms?: string[];
            senders?: string[];
            not_senders?: string[];
            lazy_load_members?: boolean;
            include_redundant_members?: boolean;
        };
        ephemeral?: {
            types?: string[];
            not_types?: string[];
            rooms?: string[];
            not_rooms?: string[];
            senders?: string[];
            not_senders?: string[];
        };
        account_data?: {
            types?: string[];
            not_types?: string[];
        };
        include_leave?: boolean;
    };
    presence?: {
        types?: string[];
        not_types?: string[];
        senders?: string[];
        not_senders?: string[];
    };
    account_data?: {
        types?: string[];
        not_types?: string[];
    };
    event_format?: 'client' | 'federation';
    event_fields?: string[];
}

export interface IFilterManagerResponse {
    filter_id: string;
}

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

export class FilterManager extends TypedEventEmitter<FilterEvent, FilterManagerEventMap> {
    private client: MatrixClient;
    private filters: Map<string, IFilterInfo> = new Map();
    private filterCache: Map<string, IFilterManagerDefinition> = new Map();
    private defaultFilter: IFilterManagerDefinition | null = null;

    constructor(client: MatrixClient) {
        super();
        this.client = client;
    }

    async createFilter(definition: IFilterManagerDefinition): Promise<string> {
        if (!definition) {
            throw new Error("Filter definition is required");
        }

        try {
            const userId = this.client.getUserId();
            if (!userId) {
                throw new Error("User ID is required");
            }
            const response = await this.client.http.authedRequest<IFilterManagerResponse>(
                Method.Post,
                `/user/${encodeURIComponent(userId)}/filter`,
                undefined,
                definition,
                { prefix: ClientPrefix.V3 }
            );

            const filterId = response.filter_id;
            
            const filterInfo: IFilterInfo = {
                filterId,
                definition,
                createdAt: Date.now(),
            };

            this.filters.set(filterId, filterInfo);
            this.filterCache.set(filterId, definition);
            
            this.emit(FilterEvent.FilterCreated, filterId, definition);

            return filterId;
        } catch (error) {
            this.emit(FilterEvent.FilterError, error as Error);
            throw error;
        }
    }

    async getFilter(filterId: string): Promise<IFilterManagerDefinition | null> {
        if (!filterId) {
            throw new Error("Filter ID is required");
        }

        if (this.filterCache.has(filterId)) {
            return this.filterCache.get(filterId) || null;
        }

        try {
            const userId = this.client.getUserId();
            if (!userId) {
                throw new Error("User ID is required");
            }
            const response = await this.client.http.authedRequest<IFilterManagerDefinition>(
                Method.Get,
                `/user/${encodeURIComponent(userId)}/filter/${encodeURIComponent(filterId)}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );

            this.filterCache.set(filterId, response);
            
            return response;
        } catch (e) {
            logger.warn('FilterManager.getFilter failed:', e);
            return null;
        }
    }

    async deleteFilter(filterId: string): Promise<void> {
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
                { prefix: ClientPrefix.V3 }
            );

            this.filters.delete(filterId);
            this.filterCache.delete(filterId);
            
            this.emit(FilterEvent.FilterDeleted, filterId);
        } catch (error) {
            this.emit(FilterEvent.FilterError, error as Error);
            throw error;
        }
    }

    setDefaultFilter(definition: IFilterManagerDefinition): void {
        this.defaultFilter = definition;
    }

    getDefaultFilter(): IFilterManagerDefinition | null {
        return this.defaultFilter;
    }

    async createDefaultFilter(): Promise<string> {
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
                types: ['m.presence'],
            },
        };

        return this.createFilter(definition);
    }

    async createMessageFilter(limit: number = 100): Promise<string> {
        const definition: IFilterManagerDefinition = {
            room: {
                timeline: {
                    limit,
                    types: ['m.room.message'],
                },
            },
        };

        return this.createFilter(definition);
    }

    async createStateFilter(): Promise<string> {
        const definition: IFilterManagerDefinition = {
            room: {
                state: {
                    types: ['m.room.member', 'm.room.power_levels', 'm.room.join_rules', 'm.room.history_visibility'],
                    lazy_load_members: true,
                },
            },
        };

        return this.createFilter(definition);
    }

    async createEphemeralFilter(): Promise<string> {
        const definition: IFilterManagerDefinition = {
            room: {
                ephemeral: {
                    types: ['m.typing', 'm.receipt'],
                },
            },
        };

        return this.createFilter(definition);
    }

    async createRoomFilter(roomIds: string[]): Promise<string> {
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

    async createSenderFilter(senders: string[]): Promise<string> {
        const definition: IFilterManagerDefinition = {
            room: {
                timeline: {
                    senders,
                },
            },
        };

        return this.createFilter(definition);
    }

    async createTypeFilter(types: string[]): Promise<string> {
        const definition: IFilterManagerDefinition = {
            room: {
                timeline: {
                    types,
                },
            },
        };

        return this.createFilter(definition);
    }

    async excludeTypes(notTypes: string[]): Promise<string> {
        const definition: IFilterManagerDefinition = {
            room: {
                timeline: {
                    not_types: notTypes,
                },
            },
        };

        return this.createFilter(definition);
    }

    getCachedFilter(filterId: string): IFilterManagerDefinition | null {
        return this.filterCache.get(filterId) || null;
    }

    getCachedFilters(): Map<string, IFilterManagerDefinition> {
        return new Map(this.filterCache);
    }

    getFilterInfo(filterId: string): IFilterInfo | null {
        return this.filters.get(filterId) || null;
    }

    getAllFilters(): IFilterInfo[] {
        return Array.from(this.filters.values());
    }

    clearCache(): void {
        this.filters.clear();
        this.filterCache.clear();
    }

    async start(): Promise<void> {
        if (this.defaultFilter) {
            try {
                await this.createFilter(this.defaultFilter);
            } catch (e) {
                logger.warn('FilterManager.start failed:', e);
            }
        }
    }

    stop(): void {
        this.filters.clear();
        this.filterCache.clear();
    }
}

export function createFilterDefinition(options: Partial<IFilterManagerDefinition>): IFilterManagerDefinition {
    return {
        room: options.room || {},
        presence: options.presence,
        account_data: options.account_data,
        event_format: options.event_format || 'client',
        event_fields: options.event_fields,
    };
}
