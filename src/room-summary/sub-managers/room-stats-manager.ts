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
import type { RoomStats, HeroesRecalcResult, UnreadClearResult } from "../types";
import type { IContent } from "../../models/event";
import { RoomSummaryBaseManager, type RoomSummaryErrorCallback } from "../room-summary-base-manager";
import { LRUCache } from "../../utils/lru-cache";
import { logger } from "../../logger";
import type { RoomSummaryPath, RoomSummaryPathPattern } from "../__generated__/route-table";
import type { PathAssert, StripVendor } from "../../http-api/strip-prefix";

/**
 * vendor（`/_matrix/vendor/v1`）前缀空间下的路径断言。
 *
 * 本文件所有端点（`summary/stats` 读 + `stats|heroes/recalculate` + `unread/clear`）都已归位
 * vendor（后端 Batch 1–3），因此这里只保留 vendor 断言。
 *
 * 为什么不写成 v3 断言（`StripV3<RoomSummaryPath>`）：`RoomSummaryPath` 是**只增不减**的并集
 * （codegen 的"既有条目 ∪ ledger"），同时含 v3 与 vendor 两份条目 —— 用 v3 断言写 vendor
 * 端点会被那些旧 v3 条目**静默通过**，于是"路径对"是假绿（类型绿 ≠ 真实路径对）。
 */
function rsvVendor<const P extends string>(path: P & PathAssert<P, StripVendor<RoomSummaryPath>>): P {
    return path;
}

export enum RoomSummaryStatsEvent {
    StatsUpdated = "StatsUpdated",
}

export interface RoomSummaryStatsEventMap {
    [RoomSummaryStatsEvent.StatsUpdated]: (roomId: string, stats: RoomStats) => void;
}

export class RoomSummaryStatsManager extends RoomSummaryBaseManager<RoomSummaryStatsEvent, RoomSummaryStatsEventMap> {
    private readonly statsCache: LRUCache<RoomStats>;
    private readonly onCacheInvalidation?: (roomId: string) => void;

    constructor(
        client: MatrixClient,
        statsCache: LRUCache<RoomStats>,
        onCacheInvalidation?: (roomId: string) => void,
        onError?: RoomSummaryErrorCallback,
    ) {
        super(client, onError);
        this.statsCache = statsCache;
        this.onCacheInvalidation = onCacheInvalidation;
    }

    private summaryStatsPath(roomId: string): StripVendor<RoomSummaryPathPattern> {
        return rsvVendor(`/rooms/${encodeURIComponent(roomId)}/summary/stats`);
    }

    public async getRoomSummaryStats(
        roomId: string,
        forceRefresh = false,
        throwOnError = true,
    ): Promise<RoomStats | null> {
        if (!forceRefresh) {
            const cached = this.statsCache.get(roomId);
            if (cached) {
                return cached;
            }
        }

        try {
            const stats = await this.withRetry(async () => {
                return await this.requestVendor<RoomStats>(Method.Get, this.summaryStatsPath(roomId));
            }, "getRoomSummaryStats");

            if (stats) {
                this.statsCache.set(roomId, stats);
                this.emit(RoomSummaryStatsEvent.StatsUpdated, roomId, stats);
            }
            return stats;
            // @swallow-error { owner: "room-summary", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, "getRoomSummaryStats");
            }
            this.handleError("getRoomSummaryStats", e);
            return null;
        }
    }

    public async recalculateSummaryStats(roomId: string, body: IContent = {}): Promise<RoomStats | null> {
        this.validateRoomId(roomId);

        try {
            const stats = await this.withRetry(async () => {
                return await this.requestVendor<RoomStats>(
                    Method.Post,
                    rsvVendor(`/rooms/${encodeURIComponent(roomId)}/summary/stats/recalculate`),
                    undefined,
                    body,
                );
            }, "recalculateSummaryStats");

            if (stats) {
                this.statsCache.set(roomId, stats);
                this.emit(RoomSummaryStatsEvent.StatsUpdated, roomId, stats);
            }
            return stats;
        } catch (e) {
            throw this.normalizeError(e, "recalculateSummaryStats");
        }
    }

    public async recalculateSummaryHeroes(roomId: string, body: IContent = {}): Promise<HeroesRecalcResult> {
        this.validateRoomId(roomId);

        return this.withRetry(async () => {
            const result = await this.requestVendor<HeroesRecalcResult>(
                Method.Post,
                rsvVendor(`/rooms/${encodeURIComponent(roomId)}/summary/heroes/recalculate`),
                undefined,
                body,
            );
            this.onCacheInvalidation?.(roomId);
            return result;
        }, "recalculateSummaryHeroes");
    }

    public async clearSummaryUnread(roomId: string, body: IContent = {}): Promise<UnreadClearResult> {
        this.validateRoomId(roomId);

        return this.withRetry(async () => {
            const result = await this.requestVendor<UnreadClearResult>(
                Method.Post,
                rsvVendor(`/rooms/${encodeURIComponent(roomId)}/summary/unread/clear`),
                undefined,
                body,
            );
            this.onCacheInvalidation?.(roomId);
            return result;
        }, "clearSummaryUnread");
    }

    public getCachedStats(roomId: string): RoomStats | null {
        return this.statsCache.get(roomId) ?? null;
    }

    private handleError(method: string, error: unknown): void {
        const sdkError = this.normalizeError(error, method);
        logger.warn(sdkError.message);
        this.onError?.(sdkError);
    }
}
