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
 * SpaceMemberManager - Space 成员管理（获取成员、邀请、加入、离开）
 */

import { Method } from "../../http-api/method";
import { VendorPrefix } from "../../http-api/prefix";
import type { Body } from "../../http-api/interface";
import type { QueryDict } from "../../http-api/utils";
import { BaseManager, type ManagerOpts } from "../../managers/base-manager";
import type { MatrixClient } from "../../client";
import { SpaceEvent, type SpaceManagerEventMap } from "../events";
import type { SpaceMember, SpaceQueryOptions } from "../types";
import { asNumber, asString, spacePath } from "../utils";
import type { SpaceManager } from "../index";
import { CacheManagerFactory } from "../../managers/cache-manager";

type JsonObject = Record<string, unknown>; // Dynamic: arbitrary space member state content

export class SpaceMemberManager extends BaseManager<SpaceEvent, SpaceManagerEventMap> {
    private parent: SpaceManager | null = null;
    private memberCache = CacheManagerFactory.createSpaceCache();

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * @internal
     */
    _setParent(parent: SpaceManager): void {
        this.parent = parent;
    }

    /**
     * 获取指定 Space 的成员列表。
     *
     * 结果默认走成员缓存；传 `options.forceRefresh = true` 可跳过缓存强制拉取。
     *
     * @param spaceId - Space ID（不是底层房间 ID）。
     * @param options - 查询选项；`forceRefresh` 为 `true` 时忽略缓存。
     * @returns 归一化后的成员数组（每项回填 `space_id`）。
     * @throws {ValidationError} 当 Space ID 格式无效时抛出。
     * @throws {ApiError} 当后端请求失败时抛出。
     * @example
     * const members = await client.getSpaceManager().member.getSpaceMembers("!abc:example.com");
     * console.log(members.length);
     */
    async getSpaceMembers(spaceId: string, options: SpaceQueryOptions = {}): Promise<SpaceMember[]> {
        try {
            // 使用 getOrFetch 自动处理缓存
            const forceRefresh = options.forceRefresh === true;
            const cacheKey = forceRefresh ? `members:${spaceId}:fresh` : `members:${spaceId}`;
            const members = await this.memberCache.getOrFetch(cacheKey, async () => {
                const response = await this.withRetry(async () => {
                    return await this.doRequest<JsonObject | SpaceMember[]>(
                        Method.Get,
                        spacePath("/spaces/$spaceId/members", spaceId),
                        options,
                    );
                }, "getSpaceMembers");
                return this.extractMembers(response, spaceId);
            });
            return members;
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceMembers"));
            throw error;
        }
    }

    /**
     * 邀请指定用户加入 Space。
     *
     * `body` 会与 `{ user_id }` 合并后提交，可用于附加额外邀请参数。邀请成功后会
     * 失效该 Space 的成员缓存。
     *
     * @param spaceId - Space ID（不是底层房间 ID）。
     * @param userId - 被邀请用户的 Matrix ID（如 `@alice:example.com`）。
     * @param body - 附加的请求体字段，会与 `user_id` 合并。
     * @throws {ValidationError} 当 Space ID 无效时抛出。
     * @throws {ApiError} 当后端请求失败时抛出。
     * @example
     * await client.getSpaceManager().member.inviteToSpace("!abc:example.com", "@alice:example.com");
     */
    async inviteToSpace(spaceId: string, userId: string, body: JsonObject = {}): Promise<void> {
        try {
            await this.withRetry(async () => {
                await this.doRequest(Method.Post, spacePath("/spaces/$spaceId/invite", spaceId), undefined, {
                    user_id: userId,
                    ...body,
                });
            }, "inviteToSpace");
            // 邀请成功后清除成员缓存
            this.memberCache.invalidate([`members:${spaceId}`]);
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "inviteToSpace"));
            throw error;
        }
    }

    /**
     * 当前用户加入指定 Space。
     *
     * 加入成功后会失效成员缓存，并触发 `SpaceEvent.MemberJoined` 事件。
     *
     * @param spaceId - Space ID（不是底层房间 ID）。
     * @param body - 可选的加入请求体（如 `reason`）。
     * @returns 后端返回的原始响应对象。
     * @throws {ValidationError} 当 Space ID 无效时抛出。
     * @throws {ApiError} 当后端请求失败时抛出。
     * @example
     * const result = await client.getSpaceManager().member.joinSpace("!abc:example.com");
     * console.log(result);
     */
    async joinSpace(spaceId: string, body: JsonObject = {}): Promise<JsonObject> {
        try {
            const result = await this.withRetry(async () => {
                return await this.doRequest<JsonObject>(
                    Method.Post,
                    spacePath("/spaces/$spaceId/join", spaceId),
                    undefined,
                    body,
                );
            }, "joinSpace");
            // 加入成功后清除成员缓存
            this.memberCache.invalidate([`members:${spaceId}`]);
            this.emit(SpaceEvent.MemberJoined, spaceId, this.client.getUserId() || "");
            return result;
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "joinSpace"));
            throw error;
        }
    }

    /**
     * 当前用户离开指定 Space。
     *
     * 离开成功后会失效成员缓存、清空 query 缓存，并触发 `SpaceEvent.MemberLeft` 事件。
     *
     * @param spaceId - Space ID（不是底层房间 ID）。
     * @param body - 可选的离开请求体（如 `reason`）。
     * @throws {ValidationError} 当 Space ID 无效时抛出。
     * @throws {ApiError} 当后端请求失败时抛出。
     * @example
     * await client.getSpaceManager().member.leaveSpace("!abc:example.com");
     */
    async leaveSpace(spaceId: string, body: JsonObject = {}): Promise<void> {
        try {
            await this.withRetry(async () => {
                await this.doRequest(Method.Post, spacePath("/spaces/$spaceId/leave", spaceId), undefined, body);
            }, "leaveSpace");
            // 离开成功后清除成员缓存
            this.memberCache.invalidate([`members:${spaceId}`]);
            this.parent!.query.clearCache();
            this.emit(SpaceEvent.MemberLeft, spaceId, this.client.getUserId() || "");
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "leaveSpace"));
            throw error;
        }
    }

    private extractMembers(response: unknown, spaceId: string): SpaceMember[] {
        if (Array.isArray(response)) return response.map((item) => this.normalizeMember(item as JsonObject, spaceId));
        const payload = response as JsonObject;
        const rawList = payload.members ?? payload.chunk ?? [];
        if (!Array.isArray(rawList)) return [];
        return rawList.map((item) => this.normalizeMember(item as JsonObject, spaceId));
    }

    private normalizeMember(member: JsonObject = {}, spaceId: string): SpaceMember {
        return {
            ...member,
            space_id: spaceId,
            user_id: asString(member.user_id) ?? "",
            membership: asString(member.membership),
            joined_ts: asNumber(member.joined_ts ?? member.created_ts),
        };
    }

    private async doRequest<T>(method: Method, path: string, queryParams?: QueryDict, body?: Body): Promise<T> {
        return await this.request<T>({
            method: method,
            path: path,
            queryParams: queryParams as Record<string, string | string[]>,
            body: body,
            prefix: VendorPrefix,
        });
    }
}
