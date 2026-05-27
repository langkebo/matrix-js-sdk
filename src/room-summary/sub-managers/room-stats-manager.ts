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
import { RoomSummaryBaseManager, type RoomSummaryErrorCallback } from "../room-summary-base-manager";
import { LRUCache } from "../../utils/lru-cache";
import { logger } from "../../logger";
import type { RoomSummaryPathPattern } from "../__generated__/route-table";

type StripClientV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function rsv<P extends StripClientV3<RoomSummaryPathPattern>>(path: P): P {
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

    private summaryStatsPath(roomId: string): StripClientV3<RoomSummaryPathPattern> {
        return rsv(`/rooms/${encodeURIComponent(roomId)}/summary/stats`);
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
                return await this.requestV3<RoomStats>(
                    Method.Get,
                    this.summaryStatsPath(roomId),
                );
            }, "getRoomSummaryStats");

            if (stats) {
                this.statsCache.set(roomId, stats);
                this.emit(RoomSummaryStatsEvent.StatsUpdated, roomId, stats);
            }
            return stats;
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, "getRoomSummaryStats");
            }
            this.handleError("getRoomSummaryStats", e);
            return null;
        }
    }

    public async recalculateSummaryStats(
        roomId: string,
        body: Record<string, unknown> = {},
    ): Promise<RoomStats | null> {
        this.validateRoomId(roomId);

        try {
            const stats = await this.withRetry(async () => {
                return await this.requestV3<RoomStats>(
                    Method.Post,
                    rsv(`/rooms/${encodeURIComponent(roomId)}/summary/stats/recalculate`),
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

    public async recalculateSummaryHeroes(
        roomId: string,
        body: Record<string, unknown> = {},
    ): Promise<HeroesRecalcResult> {
        this.validateRoomId(roomId);

        return this.withRetry(async () => {
            const result = await this.requestV3<HeroesRecalcResult>(
                Method.Post,
                rsv(`/rooms/${encodeURIComponent(roomId)}/summary/heroes/recalculate`),
                undefined,
                body,
            );
            this.onCacheInvalidation?.(roomId);
            return result;
        }, "recalculateSummaryHeroes");
    }

    public async clearSummaryUnread(
        roomId: string,
        body: Record<string, unknown> = {},
    ): Promise<UnreadClearResult> {
        this.validateRoomId(roomId);

        return this.withRetry(async () => {
            const result = await this.requestV3<UnreadClearResult>(
                Method.Post,
                rsv(`/rooms/${encodeURIComponent(roomId)}/summary/unread/clear`),
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
