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
 * SpaceChildManager - Space 子房间管理（获取子房间、添加/移除子房间、状态）
 */

import { Method } from "../../http-api/method";
import { ClientPrefix } from "../../http-api/prefix";
import type { Body } from "../../http-api/interface";
import type { QueryDict } from "../../http-api/utils";
import { BaseManager, type ManagerOpts } from "../../managers/base-manager";
import { validateRoomId } from "../../common/validators";
import type { MatrixClient } from "../../client";
import { SpaceEvent, type SpaceManagerEventMap } from "../events";
import type { AddChildOptions, Space, SpaceChild, SpaceListResponse, SpaceQueryOptions } from "../types";
import { asBoolean, asNumber, asString, asStringArray, extractSpaces, sp, spacePath } from "../utils";
import type { SpaceManager } from "../index";

type JsonObject = Record<string, unknown>; // Dynamic: arbitrary space child state content

export class SpaceChildManager extends BaseManager<SpaceEvent, SpaceManagerEventMap> {
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

    async getSpaceChildren(spaceId: string, options: SpaceQueryOptions = {}): Promise<SpaceChild[]> {
        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<JsonObject | SpaceChild[]>(
                    Method.Get,
                    spacePath("/spaces/$spaceId/children", spaceId),
                    options,
                );
            }, "getSpaceChildren");
            return this.extractChildren(response, spaceId);
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceChildren"));
            throw error;
        }
    }

    /**
     * 添加子房间到 Space
     *
     * @param spaceId - Space ID（格式：!localpart:homeserver）
     * @param options - 添加选项
     * @param options.room_id - 子房间 ID
     * @param options.via_servers - 服务器列表（可选）
     * @param options.order - 排序（可选）
     * @param options.suggested - 是否推荐（可选）
     *
     * @example
     * ```typescript
     * // 添加房间到 Space
     * await spaceManager.addChild("!space:example.com", {
     *     room_id: "!room:example.com"
     * });
     *
     * // 添加推荐房间
     * await spaceManager.addChild("!space:example.com", {
     *     room_id: "!room:example.com",
     *     suggested: true,
     *     order: "01"
     * });
     *
     * // 监听子房间添加事件
     * spaceManager.on(SpaceEvent.ChildAdded, (spaceId, roomId) => {
     *     console.log(`Room ${roomId} added to space ${spaceId}`);
     * });
     * ```
     *
     * @throws {ValidationError} 如果 Space ID 或房间 ID 格式无效
     * @throws {ApiError} 如果 API 调用失败
     */
    async addChild(spaceId: string, options: AddChildOptions): Promise<void> {
        validateRoomId(spaceId);
        validateRoomId(options.room_id);
        try {
            await this.withRetry(async () => {
                await this.doRequest(Method.Post, spacePath("/spaces/$spaceId/children", spaceId), undefined, {
                    room_id: options.room_id,
                    via_servers: options.via_servers ?? [],
                    suggested: options.suggested,
                });
            }, "addChild");
            this.parent!.query.clearCache();
            this.emit(SpaceEvent.ChildAdded, spaceId, options.room_id);
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "addChild"));
            throw error;
        }
    }

    async removeChild(spaceId: string, roomId: string): Promise<void> {
        try {
            await this.withRetry(async () => {
                await this.doRequest(
                    Method.Delete,
                    sp(`/spaces/${encodeURIComponent(spaceId)}/children/${encodeURIComponent(roomId)}`),
                );
            }, "removeChild");
            this.parent!.query.clearCache();
            this.emit(SpaceEvent.ChildRemoved, spaceId, roomId);
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "removeChild"));
            throw error;
        }
    }

    async getSpaceRooms(spaceId: string, options: SpaceQueryOptions = {}): Promise<Space[]> {
        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<SpaceListResponse>(
                    Method.Get,
                    spacePath("/spaces/$spaceId/rooms", spaceId),
                    options,
                );
            }, "getSpaceRooms");
            return extractSpaces(response);
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceRooms"));
            throw error;
        }
    }

    async getSpaceState(spaceId: string): Promise<unknown[]> {
        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<unknown[] | { events?: unknown[] }>(
                    Method.Get,
                    spacePath("/spaces/$spaceId/state", spaceId),
                );
            }, "getSpaceState");
            if (Array.isArray(response)) return response;
            return Array.isArray(response.events) ? response.events : [];
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceState"));
            throw error;
        }
    }

    private extractChildren(response: unknown, spaceId: string): SpaceChild[] {
        if (Array.isArray(response)) return response.map((item) => this.normalizeChild(item as JsonObject, spaceId));
        const payload = response as JsonObject;
        const rawList = payload.children ?? payload.chunk ?? payload.rooms ?? [];
        if (!Array.isArray(rawList)) return [];
        return rawList.map((item) => this.normalizeChild(item as JsonObject, spaceId));
    }

    private normalizeChild(child: JsonObject = {}, spaceId: string): SpaceChild {
        return {
            ...child,
            space_id: spaceId,
            room_id: asString(child.room_id) || asString(child.child_room_id) || "",
            via_servers: asStringArray(child.via_servers ?? child.via),
            sender: asString(child.sender),
            is_suggested: asBoolean(child.is_suggested ?? child.suggested),
            added_ts: asNumber(child.added_ts ?? child.created_ts),
            order: asString(child.order),
        };
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
