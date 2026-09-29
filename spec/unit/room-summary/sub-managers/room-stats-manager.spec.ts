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

import { describe, it, expect, beforeEach, vi } from "vitest";

import { RoomSummaryStatsManager, RoomSummaryStatsEvent } from "../../../../src/room-summary/sub-managers/room-stats-manager";
import { LRUCache } from "../../../../src/utils/lru-cache";
import type { RoomSummaryErrorCallback } from "../../../../src/room-summary/room-summary-base-manager";
import type { RoomStats } from "../../../../src/room-summary/types";

describe("RoomSummaryStatsManager", () => {
    let manager: RoomSummaryStatsManager;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let statsCache: LRUCache<any>;
    let onError: RoomSummaryErrorCallback | undefined;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };
        
        statsCache = new LRUCache(100, 3 * 60 * 1000); // maxSize=100, TTL=3min
        onError = vi.fn();

        manager = new RoomSummaryStatsManager(mockClient, statsCache, undefined, onError);
    });

    describe("getRoomSummaryStats", () => {
        it("returns cached stats when forceRefresh is false", async () => {
            const cachedStats = {
                room_id: "!room:test",
                num_messages: 100,
                num_members: 50,
            };
            statsCache.set("!room:test", cachedStats);

            const result = await manager.getRoomSummaryStats("!room:test");

            expect(result).toEqual(cachedStats);
            expect(mockClient.http.authedRequest).not.toHaveBeenCalled();
        });

        it("fetches stats from API when cache miss", async () => {
            const mockStats = {
                room_id: "!room:test",
                num_messages: 100,
                num_members: 50,
            };

            mockClient.http.authedRequest.mockResolvedValue(mockStats);

            const result = await manager.getRoomSummaryStats("!room:test");

            expect(result).toEqual(mockStats);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/rooms/!room%3Atest/summary/stats",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("emits StatsUpdated event when stats are fetched", async () => {
            const mockStats = {
                room_id: "!room:test",
                num_messages: 100,
                num_members: 50,
            };

            mockClient.http.authedRequest.mockResolvedValue(mockStats);
            const emitSpy = vi.spyOn(manager, "emit");

            await manager.getRoomSummaryStats("!room:test");

            expect(emitSpy).toHaveBeenCalledWith(
                RoomSummaryStatsEvent.StatsUpdated,
                "!room:test",
                mockStats,
            );
        });

        it("forces refresh when forceRefresh is true", async () => {
            const cachedStats = {
                room_id: "!room:test",
                num_messages: 50,
                num_members: 25,
            };
            statsCache.set("!room:test", cachedStats);

            const freshStats = {
                room_id: "!room:test",
                num_messages: 100,
                num_members: 50,
            };

            mockClient.http.authedRequest.mockResolvedValue(freshStats);

            const result = await manager.getRoomSummaryStats("!room:test", true);

            expect(result).toEqual(freshStats);
            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });

        it("returns null on error when throwOnError is false", async () => {
            const error = { httpStatus: 500, errcode: "M_UNKNOWN" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            const result = await manager.getRoomSummaryStats("!room:test", false, false);

            expect(result).toBeNull();
            expect(onError).toHaveBeenCalled();
        });

        it("throws on error when throwOnError is true", async () => {
            const error = { httpStatus: 500, errcode: "M_UNKNOWN" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            await expect(manager.getRoomSummaryStats("!room:test", false, true)).rejects.toThrow();
        });
    });

    describe("recalculateSummaryStats", () => {
        it("recalculates stats and updates cache", async () => {
            const mockStats = {
                room_id: "!room:test",
                num_messages: 150,
                num_members: 60,
            };

            mockClient.http.authedRequest.mockResolvedValue(mockStats);
            const emitSpy = vi.spyOn(manager, "emit");

            const result = await manager.recalculateSummaryStats("!room:test", { force: true });

            expect(result).toEqual(mockStats);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/rooms/!room%3Atest/summary/stats/recalculate",
                undefined,
                { force: true },
                { prefix: "/_matrix/client/v3" },
            );
            expect(emitSpy).toHaveBeenCalledWith(
                RoomSummaryStatsEvent.StatsUpdated,
                "!room:test",
                mockStats,
            );
        });

        it("throws on error", async () => {
            const error = { httpStatus: 404, errcode: "M_NOT_FOUND" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            await expect(manager.recalculateSummaryStats("!room:test")).rejects.toThrow();
        });
    });

    describe("recalculateSummaryHeroes", () => {
        it("recalculates heroes and invalidates cache", async () => {
            const mockResult = {
                success: true,
                heroes_count: 5,
            };

            mockClient.http.authedRequest.mockResolvedValue(mockResult);
            const onCacheInvalidation = vi.fn();
            
            // Recreate manager with callback
            manager = new RoomSummaryStatsManager(
                mockClient,
                statsCache,
                onCacheInvalidation,
                onError,
            );

            const result = await manager.recalculateSummaryHeroes("!room:test", { force: true });

            expect(result).toEqual(mockResult);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/rooms/!room%3Atest/summary/heroes/recalculate",
                undefined,
                { force: true },
                { prefix: "/_matrix/client/v3" },
            );
            expect(onCacheInvalidation).toHaveBeenCalledWith("!room:test");
        });

        it("throws on error", async () => {
            const error = { httpStatus: 400, errcode: "M_BAD_PARAM" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            await expect(manager.recalculateSummaryHeroes("!room:test")).rejects.toThrow();
        });
    });

    describe("clearSummaryUnread", () => {
        it("clears unread markers and invalidates cache", async () => {
            const mockResult = {
                success: true,
                cleared_count: 10,
            };

            mockClient.http.authedRequest.mockResolvedValue(mockResult);
            const onCacheInvalidation = vi.fn();
            
            // Recreate manager with callback
            manager = new RoomSummaryStatsManager(
                mockClient,
                statsCache,
                onCacheInvalidation,
                onError,
            );

            const result = await manager.clearSummaryUnread("!room:test", { reason: "read" });

            expect(result).toEqual(mockResult);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/rooms/!room%3Atest/summary/unread/clear",
                undefined,
                { reason: "read" },
                { prefix: "/_matrix/client/v3" },
            );
            expect(onCacheInvalidation).toHaveBeenCalledWith("!room:test");
        });

        it("throws on error", async () => {
            const error = { httpStatus: 403, errcode: "M_FORBIDDEN" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            await expect(manager.clearSummaryUnread("!room:test")).rejects.toThrow();
        });
    });

    describe("getCachedStats", () => {
        it("returns cached stats", () => {
            const cachedStats = {
                room_id: "!room:test",
                num_messages: 100,
                num_members: 50,
            };
            statsCache.set("!room:test", cachedStats);

            const result = manager.getCachedStats("!room:test");

            expect(result).toEqual(cachedStats);
        });

        it("returns null for uncached room", () => {
            const result = manager.getCachedStats("!unknown:test");

            expect(result).toBeNull();
        });
    });
});
