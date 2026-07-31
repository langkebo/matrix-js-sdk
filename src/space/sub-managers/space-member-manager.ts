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
import { ClientPrefix } from "../../http-api/prefix";
import type { Body } from "../../http-api/interface";
import type { QueryDict } from "../../http-api/utils";
import { BaseManager, type ManagerOpts } from "../../managers/base-manager";
import type { MatrixClient } from "../../client";
import { SpaceEvent, type SpaceManagerEventMap } from "../events";
import type { SpaceMember, SpaceQueryOptions } from "../types";
import { asNumber, asString, spacePath } from "../utils";
import type { SpaceManager } from "../index";

type JsonObject = Record<string, unknown>; // Dynamic: arbitrary space member state content

export class SpaceMemberManager extends BaseManager<SpaceEvent, SpaceManagerEventMap> {
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

    async getSpaceMembers(spaceId: string, options: SpaceQueryOptions = {}): Promise<SpaceMember[]> {
        try {
            const response = await this.withRetry(async () => {
                return await this.doRequest<JsonObject | SpaceMember[]>(
                    Method.Get,
                    spacePath("/spaces/$spaceId/members", spaceId),
                    options,
                );
            }, "getSpaceMembers");
            return this.extractMembers(response, spaceId);
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "getSpaceMembers"));
            throw error;
        }
    }

    async inviteToSpace(spaceId: string, userId: string, body: JsonObject = {}): Promise<void> {
        try {
            await this.withRetry(async () => {
                await this.doRequest(Method.Post, spacePath("/spaces/$spaceId/invite", spaceId), undefined, {
                    user_id: userId,
                    ...body,
                });
            }, "inviteToSpace");
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "inviteToSpace"));
            throw error;
        }
    }

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
            this.emit(SpaceEvent.MemberJoined, spaceId, this.client.getUserId() || "");
            return result;
        } catch (error) {
            this.emit(SpaceEvent.SpaceError, this.normalizeError(error, "joinSpace"));
            throw error;
        }
    }

    async leaveSpace(spaceId: string, body: JsonObject = {}): Promise<void> {
        try {
            await this.withRetry(async () => {
                await this.doRequest(Method.Post, spacePath("/spaces/$spaceId/leave", spaceId), undefined, body);
            }, "leaveSpace");
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
            prefix: ClientPrefix.V3,
        });
    }
}
