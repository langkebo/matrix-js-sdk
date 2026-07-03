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
 * Filter Manager - 消息过滤器管理 API 封装
 *
 * 提供消息过滤器的创建、获取和缓存功能
 * 对接后端: Matrix 标准客户端-服务器协议
 * API 路径: /_matrix/client/v3/user/{userId}/filter
 *
 * 使用方式:
 * ```typescript
 * const manager = client.getFilterManager();
 * // 创建过滤器
 * const filterId = await manager.createFilter({ room: { timeline: { limit: 50 } } });
 * // 获取过滤器
 * const filter = await manager.getFilter(filterId);
 * ```
 */
import { MatrixClient } from "../client";
import { Filter, IFilterDefinition } from "../filter";
import * as utils from "../utils";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { buildCreateFilterPath, buildFilterPath } from "../client-account-data-requests";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { ApiError, NotFoundError, ValidationError } from "../errors";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export class FilterManager extends BaseManager {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public async createFilter(definition: IFilterDefinition): Promise<{ filterId: string }> {
        const userId = this.client.getUserId();
        if (!userId) {
            throw new ValidationError("User ID is required");
        }

        try {
            const path = buildCreateFilterPath(userId);
            const response = await this.client.http.authedRequest<{ filter_id: string }>(
                Method.Post,
                path,
                undefined,
                definition,
                { prefix: ClientPrefix.V3 },
            );

            const filter = Filter.fromJson(userId, response.filter_id, definition);
            this.client.store.storeFilter(filter);
            return { filterId: response.filter_id };
        } catch (e) {
            throw this.normalizeError(e, "createFilter");
        }
    }

    public async getFilter(userId: string, filterId: string, allowCached = true): Promise<Filter> {
        if (allowCached) {
            const filter = this.client.store.getFilter(userId, filterId);
            if (filter) {
                return Promise.resolve(filter);
            }
        }

        const path = buildFilterPath(userId, filterId);

        try {
            const response = await this.client.http.authedRequest<IFilterDefinition>(
                Method.Get,
                path,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );

            const filter = Filter.fromJson(userId, filterId, response);
            this.client.store.storeFilter(filter);
            return filter;
        } catch (e) {
            throw this.normalizeError(e, "getFilter");
        }
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
                const normalized = this.normalizeError(error, "getFilter");
                const isUnknown =
                    normalized instanceof ApiError &&
                    (normalized.errorCode === "M_UNKNOWN" || normalized.errorCode === "UNKNOWN");
                if (!(normalized instanceof NotFoundError) && !isUnknown) {
                    throw normalized;
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


export function extendMatrixClient(): void {
    MatrixClient.prototype.getFilterManager = function (): FilterManager {
        registerManagerClass("filter", FilterManager);
    return getOrCreateManager(this, "filter", () => new FilterManager(this));
    };
}

export default FilterManager;
