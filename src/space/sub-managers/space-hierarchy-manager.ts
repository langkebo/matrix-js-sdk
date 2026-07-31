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
 * SpaceHierarchyManager - Space 层级管理（层级聚合、分页、V1、摘要、树路径）
 */

import { Method } from "../../http-api/method";
import { ClientPrefix } from "../../http-api/prefix";
import type { Body } from "../../http-api/interface";
import type { QueryDict } from "../../http-api/utils";
import { BaseManager, type ManagerOpts } from "../../managers/base-manager";
import type { MatrixClient } from "../../client";
import { SpaceEvent, type SpaceManagerEventMap } from "../events";
import type { SpaceHierarchy, SpaceHierarchyPage, SpaceQueryOptions } from "../types";
import { spacePath } from "../utils";
import type { SpaceManager } from "../index";

type JsonObject = Record<string, unknown>; // Dynamic: arbitrary space hierarchy response content

export class SpaceHierarchyManager extends BaseManager<SpaceEvent, SpaceManagerEventMap> {
    private parent: SpaceManager | null = null;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * @internal 由 SpaceManager 在构造后设置回引，便于跨 sub-manager 访问
     */
    _setParent(parent: SpaceManager): void {
        this.parent = parent;
    }

    async getSpaceHierarchy(spaceId: string): Promise<SpaceHierarchy> {
        const [space, children, members] = await Promise.all([
            this.parent!.lifecycle.getSpace(spaceId),
            this.parent!.child.getSpaceChildren(spaceId),
            this.parent!.member.getSpaceMembers(spaceId),
        ]);
        return { space, children, members };
    }

    async getSpaceHierarchyPage(spaceId: string, options: SpaceQueryOptions = {}): Promise<SpaceHierarchyPage> {
        try {
            return await this.withRetry(async () => {
                return await this.doRequest<SpaceHierarchyPage>(
                    Method.Get,
                    spacePath("/spaces/$spaceId/hierarchy", spaceId),
                    options,
                );
            }, "getSpaceHierarchyPage");
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceHierarchyPage"));
            throw error;
        }
    }

    async getSpaceHierarchyV1(spaceId: string, options: SpaceQueryOptions = {}): Promise<SpaceHierarchyPage> {
        try {
            return await this.withRetry(async () => {
                return await this.doRequest<SpaceHierarchyPage>(
                    Method.Get,
                    spacePath("/spaces/$spaceId/hierarchy/v1", spaceId),
                    options,
                );
            }, "getSpaceHierarchyV1");
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceHierarchyV1"));
            throw error;
        }
    }

    async getSpaceSummary(spaceId: string, options: SpaceQueryOptions = {}): Promise<JsonObject> {
        try {
            return await this.withRetry(async () => {
                return await this.doRequest<JsonObject>(
                    Method.Get,
                    spacePath("/spaces/$spaceId/summary", spaceId),
                    options,
                );
            }, "getSpaceSummary");
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceSummary"));
            throw error;
        }
    }

    async getSpaceSummaryWithChildren(spaceId: string, options: SpaceQueryOptions = {}): Promise<JsonObject> {
        try {
            return await this.withRetry(async () => {
                return await this.doRequest<JsonObject>(
                    Method.Get,
                    spacePath("/spaces/$spaceId/summary/with_children", spaceId),
                    options,
                );
            }, "getSpaceSummaryWithChildren");
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceSummaryWithChildren"));
            throw error;
        }
    }

    async getSpaceTreePath(spaceId: string, options: SpaceQueryOptions = {}): Promise<JsonObject> {
        try {
            return await this.withRetry(async () => {
                return await this.doRequest<JsonObject>(
                    Method.Get,
                    spacePath("/spaces/$spaceId/tree_path", spaceId),
                    options,
                );
            }, "getSpaceTreePath");
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceTreePath"));
            throw error;
        }
    }

    private async doRequest<T>(method: Method, path: string, queryParams?: QueryDict, body?: Body): Promise<T> {
        return await this.request<T>({
            method: method,
            path: path,
            queryParams: queryParams as Record<string, string | string[]>,
            body: body,
            prefix: ClientPrefix.V3,
        });
    }
}
