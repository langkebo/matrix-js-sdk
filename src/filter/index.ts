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
 * 提供过滤器创建、获取等功能
 */

import { MatrixClient } from "../client";
import { Filter, type IFilterDefinition } from "../filter";
import { Method } from "../http-api/index";
import * as utils from "../utils";

export class FilterManager {
    constructor(private client: MatrixClient) {}

    /**
     * Create a new filter
     */
    public createFilter(content: IFilterDefinition): Promise<Filter> {
        const path = utils.encodeUri("/user/$userId/filter", {
            $userId: this.client.credentials.userId!,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Post, path, undefined, content).then((response: any) => {
            // persist the filter
            const filter = Filter.fromJson(this.client.credentials.userId, response.filter_id, content);
            this.client.store.storeFilter(filter);
            return filter;
        });
    }

    /**
     * Get a filter by ID
     */
    public getFilter(userId: string, filterId: string, allowCached = true): Promise<Filter> {
        if (allowCached) {
            const filter = this.client.store.getFilter(userId, filterId);
            if (filter) {
                return Promise.resolve(filter);
            }
        }

        const path = utils.encodeUri("/user/$userId/filter/$filterId", {
            $userId: userId,
            $filterId: filterId,
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Get, path).then((response: any) => {
            // persist the filter
            const filter = Filter.fromJson(userId, filterId, response);
            this.client.store.storeFilter(filter);
            return filter;
        });
    }

    /**
     * Get or create a filter
     */
    public async getOrCreateFilter(filterName: string, filter: Filter): Promise<string> {
        const filterId = this.client.store.getFilterIdByName(filterName);
        let existingId: string | undefined;

        if (filterId) {
            // check that the existing filter matches our expectations
            try {
                const existingFilter = await this.getFilter(this.client.credentials.userId!, filterId, true);
                if (existingFilter) {
                    const oldDef = existingFilter.getDefinition();
                    const newDef = filter.getDefinition();

                    if (utils.deepCompare(oldDef, newDef)) {
                        existingId = filterId;
                    }
                }
            } catch (error) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                if ((error as any).errcode !== "M_UNKNOWN" && (error as any).errcode !== "M_NOT_FOUND") {
                    throw error;
                }
            }
            // if the filter doesn't exist anymore on the server, remove from store
            if (!existingId) {
                this.client.store.setFilterIdByName(filterName, undefined);
            }
        }

        if (existingId) {
            return existingId;
        }

        // create a new filter
        const createdFilter = await this.createFilter(filter.getDefinition());

        this.client.store.setFilterIdByName(filterName, createdFilter.filterId);
        return createdFilter.filterId!;
    }
}

export default FilterManager;
