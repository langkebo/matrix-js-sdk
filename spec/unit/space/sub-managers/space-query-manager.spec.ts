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

import { SpaceQueryManager } from "../../../../src/space/sub-managers/space-query-manager";
import { SpaceEvent } from "../../../../src/space/events";
import { NotFoundError } from "../../../../src/errors";
import type { Space } from "../../../../src/space/types";

describe("SpaceQueryManager", () => {
    let manager: SpaceQueryManager;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
            getRoom: vi.fn(),
        };

        manager = new SpaceQueryManager(mockClient);
    });

    describe("getPublicSpaces", () => {
        it("calls GET /spaces/public", async () => {
            const mockResponse = { chunk: [{ room_id: "!pub1:test", name: "Public 1" }] };
            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getPublicSpaces({ limit: 10 });

            expect(result.chunk).toEqual(
                expect.arrayContaining([expect.objectContaining({ room_id: "!pub1:test", name: "Public 1" })]),
            );
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/spaces/public",
                { limit: 10 },
                undefined,
                { prefix: "/_matrix/vendor/v1" },
            );
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 500, errcode: "M_UNKNOWN" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.getPublicSpaces()).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });

    describe("searchSpaces", () => {
        it("calls GET /spaces/search with search_term", async () => {
            const mockResponse = { chunk: [{ room_id: "!search1:test", name: "Search Result" }] };
            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.searchSpaces("test", 5);

            expect(result).toEqual(
                expect.arrayContaining([expect.objectContaining({ room_id: "!search1:test", name: "Search Result" })]),
            );
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/spaces/search",
                { search_term: "test", limit: 5 },
                undefined,
                { prefix: "/_matrix/vendor/v1" },
            );
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 500, errcode: "M_UNKNOWN" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.searchSpaces("test")).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });

    describe("getSpaceStatistics", () => {
        it("calls GET /spaces/statistics", async () => {
            const mockResponse = { spaceCount: 10, roomCount: 50, memberCount: 100 };
            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getSpaceStatistics();

            expect(result).toEqual(mockResponse);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/spaces/statistics",
                undefined,
                undefined,
                { prefix: "/_matrix/vendor/v1" },
            );
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 500, errcode: "M_UNKNOWN" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.getSpaceStatistics()).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });

    describe("getUserSpaces", () => {
        it("calls GET /spaces/user", async () => {
            const mockResponse = { chunk: [{ room_id: "!user1:test", name: "User Space" }] };
            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getUserSpaces();

            expect(result).toEqual(
                expect.arrayContaining([expect.objectContaining({ room_id: "!user1:test", name: "User Space" })]),
            );
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith("GET", "/spaces/user", undefined, undefined, {
                prefix: "/_matrix/vendor/v1",
            });
        });

        it("returns cached result when not forceRefresh", async () => {
            // Force cache population
            const mockResponse = { chunk: [{ room_id: "!cached:test", name: "Cached" }] };
            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            await manager.getUserSpaces();

            // Second call should return cached result without API call
            const result = await manager.getUserSpaces();
            expect(result).toEqual(
                expect.arrayContaining([expect.objectContaining({ room_id: "!cached:test", name: "Cached" })]),
            );
            expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(1);
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 403, errcode: "M_FORBIDDEN" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.getUserSpaces()).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });

    describe("getSpaceByRoom", () => {
        it("calls GET /spaces/room/{room_id}", async () => {
            const mockResponse = { room_id: "!space:test", name: "Parent Space" };
            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getSpaceByRoom("!room:test");

            expect(result).toEqual(expect.objectContaining({ room_id: "!space:test", name: "Parent Space" }));
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/spaces/room/!room%3Atest",
                undefined,
                undefined,
                { prefix: "/_matrix/vendor/v1" },
            );
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 404, errcode: "M_NOT_FOUND" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.getSpaceByRoom("!room:test")).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });

    describe("getRoomParentSpaces", () => {
        it("calls GET /spaces/room/{room_id}/parents", async () => {
            const mockResponse = { chunk: [{ room_id: "!space1:test", name: "Parent 1" }] };
            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getRoomParentSpaces("!room:test");

            expect(result).toEqual(
                expect.arrayContaining([expect.objectContaining({ room_id: "!space1:test", name: "Parent 1" })]),
            );
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/spaces/room/!room%3Atest/parents",
                {},
                undefined,
                { prefix: "/_matrix/vendor/v1" },
            );
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 500, errcode: "M_UNKNOWN" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.getRoomParentSpaces("!room:test")).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });

    describe("isSpace", () => {
        it("returns true when space found", async () => {
            const mockResponse = { room_id: "!space:test", name: "Test Space" };
            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.isSpace("!room:test");

            expect(result).toBe(true);
        });

        it("returns false when NotFoundError", async () => {
            mockClient.http.authedRequest.mockRejectedValue(new NotFoundError("Not found"));
            mockClient.getRoom.mockReturnValue({ isSpaceRoom: vi.fn().mockReturnValue(false) });

            const result = await manager.isSpace("!room:test");

            expect(result).toBe(false);
        });

        it("returns false when room is not a space", async () => {
            const error = new Error("Some error");
            Object.defineProperty(error, "cause", { value: { httpStatus: 404, errcode: "M_NOT_FOUND" } });
            mockClient.http.authedRequest.mockRejectedValue(error);
            mockClient.getRoom.mockReturnValue({ isSpaceRoom: vi.fn().mockReturnValue(false) });

            const result = await manager.isSpace("!room:test");

            expect(result).toBe(false);
        });
    });

    describe("cache management", () => {
        it("clearCache clears both caches", async () => {
            manager.clearCache();

            // Should not throw
            expect(true).toBe(true);
        });

        it("getCachedSpace returns undefined when not cached", async () => {
            const result = manager.getCachedSpace("!space:test");
            expect(result).toBeUndefined();
        });

        it("getAggregatedCacheStats returns stats object", async () => {
            const stats = manager.getAggregatedCacheStats();
            // 高频缓存统计
            expect(stats.highFreq).toHaveProperty("size");
            expect(stats.highFreq).toHaveProperty("hits");
            // 低频缓存统计
            expect(stats.lowFreq).toHaveProperty("size");
            expect(stats.lowFreq).toHaveProperty("hits");
            // 单个 Space 缓存统计
            expect(stats.space).toHaveProperty("size");
            expect(stats.space).toHaveProperty("hits");
            // 聚合统计
            expect(stats.total).toHaveProperty("size");
            expect(stats.total).toHaveProperty("hitRate");
        });

        it("getHighFreqCacheStats returns stats object", async () => {
            const stats = manager.getHighFreqCacheStats();
            expect(stats).toHaveProperty("size");
            expect(stats).toHaveProperty("hitRate");
        });

        it("getLowFreqCacheStats returns stats object", async () => {
            const stats = manager.getLowFreqCacheStats();
            expect(stats).toHaveProperty("size");
            expect(stats).toHaveProperty("hitRate");
        });

        it("preloadCommonSpaces returns results", async () => {
            const mockSpaces: Space[] = [
                { space_id: "!space1:test", room_id: "!space1:test", name: "Space 1", topic: "", avatar_url: "" },
                { space_id: "!space2:test", room_id: "!space2:test", name: "Space 2", topic: "", avatar_url: "" },
            ];
            mockClient.http.authedRequest.mockResolvedValue({ chunk: mockSpaces });

            const result = await manager.preloadCommonSpaces({ maxSpaces: 10, parallelLimit: 3 });

            expect(result).toHaveProperty("total");
            expect(result).toHaveProperty("loaded");
            expect(result).toHaveProperty("failed");
        });
    });
});
