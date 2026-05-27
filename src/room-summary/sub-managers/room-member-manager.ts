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

import { MatrixClient } from "../../client";
import { Method } from "../../http-api/method";
import { Body } from "../../http-api/interface";
import type { QueryDict } from "../../utils";
import { InvalidParamError } from "../../common/errors";
import { LRUCache } from "../../utils/lru-cache";
import { RoomSummaryBaseManager, type RoomSummaryErrorCallback } from "../room-summary-base-manager";
import type { RoomSummaryMember, RoomMembersRecentResult } from "../types";
import type { RoomSummaryPathPattern } from "../__generated__/route-table";

type StripClientV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;
function rsv<P extends StripClientV3<RoomSummaryPathPattern>>(path: P): P {
    return path;
}

export enum RoomSummaryMemberEvent {
    MembersUpdated = "MembersUpdated",
}

export interface RoomSummaryMemberEventMap {
    [RoomSummaryMemberEvent.MembersUpdated]: (roomId: string, members: RoomSummaryMember[]) => void;
}

export class RoomSummaryMemberManager extends RoomSummaryBaseManager<RoomSummaryMemberEvent, RoomSummaryMemberEventMap> {
    private readonly memberCache: LRUCache<RoomSummaryMember[]>;

    constructor(client: MatrixClient, memberCache: LRUCache<RoomSummaryMember[]>, onError?: RoomSummaryErrorCallback) {
        super(client, onError);
        this.memberCache = memberCache;
    }

    // ─── Path helpers ──────────────────────────────────────────────────────

    private summaryMembersPath(roomId: string): StripClientV3<RoomSummaryPathPattern> {
        return rsv(`/rooms/${encodeURIComponent(roomId)}/summary/members`);
    }

    private summaryMemberPath(roomId: string, userId: string): StripClientV3<RoomSummaryPathPattern> {
        return rsv(`/rooms/${encodeURIComponent(roomId)}/summary/members/${encodeURIComponent(userId)}`);
    }

    // ─── Public API ────────────────────────────────────────────────────────

    /**
     * 获取房间成员列表摘要
     *
     * @param roomId - 房间 ID
     * @param forceRefresh - 是否强制刷新缓存
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 成员列表
     */
    public async getRoomSummaryMembers(
        roomId: string,
        forceRefresh = false,
        throwOnError = true,
    ): Promise<RoomSummaryMember[]> {
        this.validateRoomId(roomId);

        if (!forceRefresh) {
            const cached = this.memberCache.get(roomId);
            if (cached) {
                return cached;
            }
        }

        return this.withRetry(async () => {
            return await this.requestV3<RoomSummaryMember[]>(
                Method.Get,
                this.summaryMembersPath(roomId),
            );
        }, "getRoomSummaryMembers").then(
            (members) => {
                this.memberCache.set(roomId, members);
                this.emit(RoomSummaryMemberEvent.MembersUpdated, roomId, members);
                return members;
            },
            (e) => {
                if (throwOnError) {
                    throw this.normalizeError(e, "getRoomSummaryMembers");
                }
                this.handleError("getRoomSummaryMembers", e);
                return [];
            },
        );
    }

    /**
     * 写入房间成员列表
     *
     * @param roomId - 房间 ID
     * @param members - 成员列表
     * @returns 写入后的成员列表
     */
    public async writeSummaryMembers(roomId: string, members: RoomSummaryMember[]): Promise<RoomSummaryMember[]> {
        this.validateRoomId(roomId);
        if (!Array.isArray(members)) {
            throw new InvalidParamError("Members must be an array");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.requestV3<{ members?: RoomSummaryMember[] } | RoomSummaryMember[]>(
                    Method.Post,
                    this.summaryMembersPath(roomId),
                    undefined,
                    { members },
                );
            }, "writeSummaryMembers");

            const normalizedMembers = Array.isArray(response) ? response : (response.members ?? members);
            this.memberCache.set(roomId, normalizedMembers);
            this.emit(RoomSummaryMemberEvent.MembersUpdated, roomId, normalizedMembers);
            return normalizedMembers;
        } catch (e) {
            throw this.normalizeError(e, "writeSummaryMembers");
        }
    }

    /**
     * 更新单个成员信息
     *
     * @param roomId - 房间 ID
     * @param userId - 用户 ID
     * @param member - 成员数据
     * @returns 更新后的成员数据
     */
    public async updateSummaryMember(
        roomId: string,
        userId: string,
        member: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        this.validateRoomId(roomId);
        this.validateUserId(userId);

        return this.withRetry(async () => {
            const updatedMember = await this.requestV3<Record<string, unknown>>(
                Method.Put,
                this.summaryMemberPath(roomId, userId),
                undefined,
                member,
            );
            this.memberCache.delete(roomId);
            return updatedMember;
        }, "updateSummaryMember");
    }

    /**
     * 删除单个成员
     *
     * @param roomId - 房间 ID
     * @param userId - 用户 ID
     */
    public async deleteSummaryMember(roomId: string, userId: string): Promise<void> {
        this.validateRoomId(roomId);
        this.validateUserId(userId);

        return this.withRetry(async () => {
            await this.requestV3(
                Method.Delete,
                this.summaryMemberPath(roomId, userId),
            );
            this.memberCache.delete(roomId);
        }, "deleteSummaryMember");
    }

    /**
     * 获取最近成员变更
     *
     * @param roomId - 房间 ID
     * @param options - 查询选项
     * @returns 最近成员变更结果
     */
    public async getRoomMembersRecent(
        roomId: string,
        options?: { from?: string; limit?: number },
    ): Promise<RoomMembersRecentResult> {
        this.validateRoomId(roomId);

        return this.withRetry(async () => {
            const query: QueryDict = {};
            if (options?.from) query.from = options.from;
            if (options?.limit !== undefined) query.limit = String(options.limit);
            return await this.requestV3<RoomMembersRecentResult>(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/members/recent", roomId),
                query,
            );
        }, "getRoomMembersRecent");
    }

    /**
     * 获取缓存的成员列表
     *
     * @param roomId - 房间 ID
     * @returns 缓存的成员列表，如无缓存则返回空数组
     */
    public getCachedMembers(roomId: string): RoomSummaryMember[] {
        return this.memberCache.get(roomId) || [];
    }

    // ─── Internal helpers ──────────────────────────────────────────────────

    /**
     * 处理错误
     */
    private handleError(method: string, error: unknown): void {
        const sdkError = this.normalizeError(error, method);
        if (this.onError) {
            this.onError(sdkError);
        }
    }
}
