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

import { MatrixClient } from "../client";
import { Filter, IFilterDefinition } from "../filter";
import * as utils from "../utils";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";

export class FilterManager {
    constructor(private client: MatrixClient) {}

    public async createFilter(definition: IFilterDefinition): Promise<{ filterId: string }> {
        const userId = this.client.getUserId();
        if (!userId) {
            throw new Error("User ID is required");
        }

        const path = utils.encodeUri("/user/$userId/filter", { $userId: userId });
        const response = await this.client.http.authedRequest<{ filter_id: string }>(
            Method.Post,
            path,
            undefined,
            definition,
            { prefix: ClientPrefix.V3 }
        );

        const filter = Filter.fromJson(userId, response.filter_id, definition);
        this.client.store.storeFilter(filter);
        
        return { filterId: response.filter_id };
    }

    public async getFilter(userId: string, filterId: string, allowCached = true): Promise<Filter> {
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

        const response = await this.client.http.authedRequest<IFilterDefinition>(
            Method.Get,
            path,
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 }
        );
        
        const filter = Filter.fromJson(userId, filterId, response);
        this.client.store.storeFilter(filter);
        return filter;
    }

    public async getOrCreateFilter(filterName: string, filter: Filter): Promise<string> {
        const filterId = this.client.store.getFilterIdByName(filterName);
        let existingId: string | undefined;

        if (filterId) {
            try {
                const existingFilter = await this.getFilter(this.client.getUserId()!, filterId, true);
                if (existingFilter) {
                    const oldDef = existingFilter.getDefinition();
                    const newDef = filter.getDefinition();

                    if (utils.deepCompare(oldDef, newDef)) {
                        existingId = filterId;
                    }
                }
            } catch (error) {
                const err = error as Error & { errcode?: string };
                if (err.errcode !== "M_UNKNOWN" && err.errcode !== "M_NOT_FOUND") {
                    throw error;
                }
            }
            if (!existingId) {
                this.client.store.setFilterIdByName(filterName, undefined);
            }
        }

        if (existingId) {
            return existingId;
        }

        const createdFilter = await this.createFilter(filter.getDefinition());
        this.client.store.setFilterIdByName(filterName, createdFilter.filterId);
        return createdFilter.filterId;
    }
}

export default FilterManager;
