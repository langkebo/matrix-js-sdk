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
import { EventType } from "../../@types/event";
import { RoomSummaryBaseManager, type RoomSummaryErrorCallback } from "../room-summary-base-manager";
import type { RoomSummaryOptions, RoomSummary, RoomSearchResult } from "../types";
import type { IPublicRoomsResponse, IPublicRoomsChunkRoom } from "../../client-api-types";
import type { RoomSummaryPathPattern } from "../__generated__/route-table";

/** 房间搜索请求体 */
export interface RoomSearchBody {
    search_term?: string;
    keys?: string[];
    limit?: number;
    order_by?: string;
    direction?: "f" | "b";
    filter?: Record<string, unknown>;
    [key: string]: unknown;
}

type StripClientV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;
function _rsv<P extends StripClientV3<RoomSummaryPathPattern>>(path: P): P {
    return path;
}

/**
 * Room Search Manager - 房间搜索/发现操作
 *
 * 处理房间层级结构、公共房间搜索、推荐房间、收藏房间、最近房间等操作。
 * 无缓存、无事件。
 */
export class RoomSummarySearchManager extends RoomSummaryBaseManager {
    constructor(client: MatrixClient, onError?: RoomSummaryErrorCallback) {
        super(client, onError);
    }

    /**
     * 获取房间层级结构（Space 层级）
     *
     * @param roomId - 房间 ID
     * @param options - 选项
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 层级结构
     */
    public async getRoomHierarchy(
        roomId: string,
        options?: RoomSummaryOptions,
        throwOnError = true,
    ): Promise<unknown | null> {
        try {
            return await this.withRetry(async () => {
                return await this.client.getRoomHierarchy(
                    roomId,
                    options?.limit,
                    undefined,
                    options?.suggested ?? false,
                );
            }, "getRoomHierarchy");
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, "getRoomHierarchy");
            }
            this.handleError("getRoomHierarchy", e);
            return null;
        }
    }

    /**
     * 获取公共房间列表
     *
     * @param server - 服务器名（可选）
     * @param options - 选项
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 公共房间列表
     */
    public async getPublicRooms(
        server = "",
        options?: { limit?: number; since?: string; query?: string },
        throwOnError = true,
    ): Promise<IPublicRoomsResponse | null> {
        try {
            return await this.withRetry(async () => {
                return await this.client.publicRooms({
                    server,
                    limit: options?.limit,
                    since: options?.since,
                    filter: options?.query ? { generic_search_term: options.query } : undefined,
                });
            }, "getPublicRooms");
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, "getPublicRooms");
            }
            this.handleError("getPublicRooms", e);
            return null;
        }
    }

    /**
     * 搜索公共房间
     *
     * @param query - 搜索关键词
     * @param server - 服务器名
     * @param limit - 限制数量
     * @returns 公共房间列表
     */
    public async searchPublicRooms(query: string, server = "", limit = 20): Promise<IPublicRoomsChunkRoom[]> {
        try {
            const result = await this.getPublicRooms(server, { query, limit });
            return result?.chunk ?? [];
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
        } catch (e) {
            this.handleError("searchPublicRooms", e);
            return [];
        }
    }

    /**
     * 获取推荐房间
     *
     * @param server - 服务器名
     * @param limit - 限制数量
     * @returns 推荐公共房间列表
     */
    public async getRecommendedRooms(server = "", limit = 20): Promise<IPublicRoomsChunkRoom[]> {
        try {
            const result = await this.getPublicRooms(server, { limit });
            return result?.chunk ?? [];
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
        } catch (e) {
            this.handleError("getRecommendedRooms", e);
            return [];
        }
    }

    /**
     * 获取收藏的房间
     *
     * @returns 收藏的房间摘要列表
     */
    public async getFavoriteRooms(): Promise<RoomSummary[]> {
        try {
            const rooms = this.client.getRooms();

            return rooms
                .filter((room) => room.tags && room.tags["m.favorite"])
                .map((room) => ({
                    room_id: room.roomId,
                    name: room.name,
                    topic: room.currentState.getStateEvents(EventType.RoomTopic, "")?.getContent<{ topic?: string }>().topic,
                    avatar_url: room.getMxcAvatarUrl() ?? undefined,
                    join_rule: "invite" as const,
                    history_visibility: "shared" as const,
                    guest_access: "forbidden" as const,
                    is_direct: false,
                    is_space: false,
                    is_encrypted: false,
                    member_count: room.getJoinedMemberCount() || 0,
                    joined_member_count: room.getJoinedMemberCount() || 0,
                    invited_member_count: 0,
                    heroes: [],
                }));
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
        } catch (e) {
            this.handleError("getFavoriteRooms", e);
            return [];
        }
    }

    /**
     * 获取最近活跃的房间
     *
     * @param limit - 限制数量
     * @returns 最近活跃的房间摘要列表
     */
    public async getRecentRooms(limit = 10): Promise<RoomSummary[]> {
        try {
            const rooms = this.client.getRooms();

            return rooms
                .filter((room) => room.getLastActiveTimestamp())
                .sort((a, b) => (b.getLastActiveTimestamp() || 0) - (a.getLastActiveTimestamp() || 0))
                .slice(0, limit)
                .map((room) => ({
                    room_id: room.roomId,
                    name: room.name,
                    topic: room.currentState.getStateEvents(EventType.RoomTopic, "")?.getContent<{ topic?: string }>().topic,
                    avatar_url: room.getMxcAvatarUrl() ?? undefined,
                    join_rule: "invite" as const,
                    history_visibility: "shared" as const,
                    guest_access: "forbidden" as const,
                    is_direct: false,
                    is_space: false,
                    is_encrypted: false,
                    member_count: room.getJoinedMemberCount() || 0,
                    joined_member_count: room.getJoinedMemberCount() || 0,
                    invited_member_count: 0,
                    heroes: [],
                }));
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
        } catch (e) {
            this.handleError("getRecentRooms", e);
            return [];
        }
    }

    /**
     * 搜索房间内容
     *
     * @param roomId - 房间 ID
     * @param body - 搜索请求体
     * @returns 搜索结果
     */
    public async searchRoom(roomId: string, body: RoomSearchBody): Promise<RoomSearchResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3<RoomSearchResult>(
                Method.Post,
                this.roomSummaryPath("/rooms/$roomId/search", roomId),
                undefined,
                body as Body,
            );
        }, "searchRoom");
    }

    // ─── Internal helpers ──────────────────────────────────────────────────

    private handleError(method: string, error: unknown): void {
        const sdkError = this.normalizeError(error, method);
        if (this.onError) {
            this.onError(sdkError);
        }
    }
}
