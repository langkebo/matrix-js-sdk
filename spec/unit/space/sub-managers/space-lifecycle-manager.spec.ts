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

import { SpaceLifecycleManager } from "../../../../src/space/sub-managers/space-lifecycle-manager";
import { SpaceEvent } from "../../../../src/space/events";
import { ValidationError } from "../../../../src/errors";
import type { UnifiedCacheManager } from "../../../../src/managers/cache-manager";

describe("SpaceLifecycleManager", () => {
    let manager: SpaceLifecycleManager;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockParent: any;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
            getUserId: vi.fn().mockReturnValue("@user:test"),
        };

        mockParent = {
            query: {
                clearCache: vi.fn(),
                getCachedSpace: vi.fn(),
                setCachedSpace: vi.fn(),
            },
        };

        manager = new SpaceLifecycleManager(mockClient);
        manager._setParent(mockParent);

        // Mock lifecycleCache.getOrFetch 方法
        // 先用 UnifiedCacheManager["getOrFetch"] 固定签名，再 spy 方法本身，
        // 避免 (manager as any) 让 vi.spyOn 把回调参数推断成 unknown
        const lifecycleCache = (manager as any).lifecycleCache as {
            getOrFetch: UnifiedCacheManager["getOrFetch"];
        };
        vi.spyOn(lifecycleCache, "getOrFetch").mockImplementation(async (_key, fetchFn) => fetchFn() as never);
    });

    describe("createSpace", () => {
        it("POSTs to /spaces with options", async () => {
            const mockResponse = { room_id: "!newspace:test", name: "New Space" };
            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.createSpace({
                room_id: "!newspace:test",
                name: "New Space",
                topic: "A test space",
                visibility: "public",
            });

            expect(result.space_id).toBe("!newspace:test");
            expect(result.name).toBe("New Space");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/spaces",
                undefined,
                expect.objectContaining({
                    room_id: "!newspace:test",
                    name: "New Space",
                }),
                { prefix: "/_matrix/client/v3" },
            );
            expect(mockParent.query.clearCache).toHaveBeenCalled();
        });

        it("emits SpaceCreated on success", async () => {
            const mockResponse = { room_id: "!newspace:test", name: "New Space" };
            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const emitSpy = vi.spyOn(manager, "emit");

            await manager.createSpace({ room_id: "!newspace:test", name: "New Space" });

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceCreated, expect.any(Object));
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 500, errcode: "M_UNKNOWN" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            const emitSpy = vi.spyOn(manager, "emit");

            await expect(
                manager.createSpace({ room_id: "!newspace:test", name: "New Space" }),
            ).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });

        it("throws ValidationError when room_id is missing", async () => {
            await expect(manager.createSpace({ name: "No Room" } as any)).rejects.toThrow(ValidationError);
        });

        it("throws ValidationError when name is too long", async () => {
            await expect(
                manager.createSpace({
                    room_id: "!test:test",
                    name: "a".repeat(256),
                }),
            ).rejects.toThrow(ValidationError);
        });
    });

    describe("getSpace", () => {
        it("calls GET /spaces/{space_id}", async () => {
            const mockResponse = { room_id: "!space:test", name: "Test Space" };
            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getSpace("!space:test");

            expect(result.space_id).toBe("!space:test");
            expect(result.name).toBe("Test Space");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/spaces/!space%3Atest",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
            expect(mockParent.query.setCachedSpace).toHaveBeenCalledWith("!space:test", expect.any(Object));
        });

        it("returns cached space if available", async () => {
            const mockSpace = { space_id: "!cached:test", room_id: "!cached:test", name: "Cached" };
            // 模拟 lifecycleCache.getOrFetch 返回缓存的值
            (manager as any).lifecycleCache.getOrFetch.mockResolvedValue(mockSpace);

            const result = await manager.getSpace("!cached:test");

            expect(result).toEqual(expect.objectContaining({ space_id: "!cached:test", name: "Cached" }));
            expect((manager as any).lifecycleCache.getOrFetch).toHaveBeenCalled();
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 404, errcode: "M_NOT_FOUND" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.getSpace("!space:test")).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });

    describe("updateSpace", () => {
        it("PUTs to /spaces/{space_id}", async () => {
            const mockResponse = { room_id: "!space:test", name: "Updated" };
            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.updateSpace("!space:test", { name: "Updated" });

            expect(result.name).toBe("Updated");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "PUT",
                "/spaces/!space%3Atest",
                undefined,
                { name: "Updated" },
                { prefix: "/_matrix/client/v3" },
            );
            expect(mockParent.query.clearCache).toHaveBeenCalled();
        });

        it("emits SpaceUpdated on success", async () => {
            const mockResponse = { room_id: "!space:test", name: "Updated" };
            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const emitSpy = vi.spyOn(manager, "emit");

            await manager.updateSpace("!space:test", { name: "Updated" });

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceUpdated, expect.any(Object));
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 403, errcode: "M_FORBIDDEN" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.updateSpace("!space:test", { name: "Updated" })).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });

    describe("deleteSpace", () => {
        it("DELETEs /spaces/{space_id}", async () => {
            mockClient.http.authedRequest.mockResolvedValue(undefined);

            await manager.deleteSpace("!space:test");

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "DELETE",
                "/spaces/!space%3Atest",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
            expect(mockParent.query.clearCache).toHaveBeenCalled();
        });

        it("emits SpaceDeleted on success", async () => {
            mockClient.http.authedRequest.mockResolvedValue(undefined);

            const emitSpy = vi.spyOn(manager, "emit");

            await manager.deleteSpace("!space:test");

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceDeleted, "!space:test");
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 404, errcode: "M_NOT_FOUND" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.deleteSpace("!space:test")).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });
});
