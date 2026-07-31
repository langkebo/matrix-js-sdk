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
 * SpaceLifecycleManager - Space CRUD（创建、读取、更新、删除）
 */

import { Method } from "../../http-api/method";
import { ClientPrefix } from "../../http-api/prefix";
import type { Body } from "../../http-api/interface";
import type { QueryDict } from "../../http-api/utils";
import { ValidationError } from "../../errors";
import { BaseManager, type ManagerOpts } from "../../managers/base-manager";
import { validateRoomId } from "../../common/validators";
import type { MatrixClient } from "../../client";
import { SpaceEvent, type SpaceManagerEventMap } from "../events";
import type { CreateSpaceOptions, UpdateSpaceOptions, Space } from "../types";
import { normalizeSpace, sp, spacePath } from "../utils";
import type { SpaceManager } from "../index";

type JsonObject = Record<string, unknown>; // Dynamic: arbitrary space response content

export class SpaceLifecycleManager extends BaseManager<SpaceEvent, SpaceManagerEventMap> {
    private parent: SpaceManager | null = null;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    // 由 SpaceManager 在构造后设置回引，便于跨 sub-manager 访问
    _setParent(parent: SpaceManager): void {
        this.parent = parent;
    }

    /**
     * 创建 Space
     *
     * @param options - 创建选项
     * @param options.name - Space 名称
     * @param options.topic - Space 主题（可选）
     * @param options.avatar_url - 头像 URL（可选）
     * @param options.join_rule - 加入规则（可选）
     * @param options.visibility - 可见性（public/private，可选）
     *
     * @example
     * ```typescript
     * // 创建公开 Space
     * const space = await spaceManager.createSpace({
     *     name: "My Public Space",
     *     topic: "A space for everyone",
     *     visibility: "public"
     * });
     * console.log("Created space:", space.space_id);
     *
     * // 创建私有 Space
     * const privateSpace = await spaceManager.createSpace({
     *     name: "Private Team Space",
     *     visibility: "private",
     *     join_rule: "invite"
     * });
     *
     * // 监听 Space 创建事件
     * spaceManager.on(SpaceEvent.SpaceCreated, (space) => {
     *     console.log(`Space created: ${space.name}`);
     * });
     * ```
     *
     * @throws {ValidationError} 如果名称为空或过长
     * @throws {ApiError} 如果 API 调用失败
     */
    async createSpace(options: CreateSpaceOptions): Promise<Space> {
        if (!options.room_id) {
            throw new ValidationError("Space room_id is required");
        }
        validateRoomId(options.room_id);
        if (options.name && options.name.length > 255) {
            throw new ValidationError("Space name too long (max 255 characters)");
        }
        if (options.topic && options.topic.length > 1000) {
            throw new ValidationError("Space topic too long (max 1000 characters)");
        }
        if (options.avatar_url && options.avatar_url.length > 2048) {
            throw new ValidationError("Space avatar_url too long (max 2048 characters)");
        }
        if (options.join_rule && options.join_rule.length > 50) {
            throw new ValidationError("Space join_rule too long (max 50 characters)");
        }
        if (options.visibility && options.visibility.length > 50) {
            throw new ValidationError("Space visibility too long (max 50 characters)");
        }
        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<JsonObject>(Method.Post, sp("/spaces"), undefined, options);
            }, "createSpace");
            this.parent!.query.clearCache();
            const space = normalizeSpace(response);
            this.emit(SpaceEvent.SpaceCreated, space);
            return space;
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "createSpace"));
            throw error;
        }
    }

    /**
     * 获取 Space 信息
     *
     * @param spaceId - Space ID（格式：!localpart:homeserver）
     * @returns Space 信息
     *
     * @example
     * ```typescript
     * // 获取 Space 信息
     * const space = await spaceManager.getSpace("!abc:example.com");
     * console.log("Space name:", space.name);
     * console.log("Topic:", space.topic);
     * console.log("Members:", space.members);
     *
     * // 使用缓存（第二次调用会使用缓存）
     * const cachedSpace = await spaceManager.getSpace("!abc:example.com");
     * ```
     *
     * @throws {ValidationError} 如果 Space ID 格式无效
     * @throws {NotFoundError} 如果 Space 不存在
     * @throws {ApiError} 如果 API 调用失败
     */
    async getSpace(spaceId: string): Promise<Space> {
        validateRoomId(spaceId);
        const cached = this.parent!.query.getCachedSpace(spaceId);
        if (cached) return cached;

        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<JsonObject>(Method.Get, spacePath("/spaces/$spaceId", spaceId));
            }, "getSpace");
            const space = normalizeSpace(response, spaceId);
            this.parent!.query.setCachedSpace(spaceId, space);
            return space;
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpace"));
            throw error;
        }
    }

    async updateSpace(spaceId: string, options: UpdateSpaceOptions): Promise<Space> {
        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<JsonObject>(
                    Method.Put,
                    spacePath("/spaces/$spaceId", spaceId),
                    undefined,
                    options,
                );
            }, "updateSpace");
            this.parent!.query.clearCache();
            let space: Space;
            if (Object.keys(response ?? {}).length === 0) {
                space = await this.getSpace(spaceId);
            } else {
                space = normalizeSpace(response, spaceId);
            }
            this.emit(SpaceEvent.SpaceUpdated, space);
            return space;
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "updateSpace"));
            throw error;
        }
    }

    async deleteSpace(spaceId: string): Promise<void> {
        try {
            await this.withRetry(async () => {
                await this.doRequest(Method.Delete, spacePath("/spaces/$spaceId", spaceId));
            }, "deleteSpace");
            this.parent!.query.clearCache();
            this.emit(SpaceEvent.SpaceDeleted, spaceId);
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "deleteSpace"));
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
