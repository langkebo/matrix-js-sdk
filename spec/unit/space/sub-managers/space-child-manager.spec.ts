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

import { SpaceChildManager } from "../../../../src/space/sub-managers/space-child-manager";
import { SpaceEvent } from "../../../../src/space/events";

describe("SpaceChildManager", () => {
    let manager: SpaceChildManager;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockParent: any;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };

        mockParent = {
            query: {
                clearCache: vi.fn(),
            },
        };

        manager = new SpaceChildManager(mockClient);
        manager._setParent(mockParent);

        // Clear cache between tests to ensure isolation
        (manager as any).childrenCache.invalidate(["*"]);
    });

    describe("getSpaceChildren", () => {
        it("calls GET /spaces/{space_id}/children with query params", async () => {
            const mockResponse = {
                chunk: [
                    { room_id: "!child1:test", via: ["server1"] },
                    { room_id: "!child2:test", via: ["server2"] },
                ],
            };

            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getSpaceChildren("!space:test", { limit: 10 });

            // normalizeChild adds space_id, sender, is_suggested, added_ts, order, via_servers
            expect(result).toEqual([
                expect.objectContaining({
                    room_id: "!child1:test",
                    space_id: "!space:test",
                    via_servers: ["server1"],
                }),
                expect.objectContaining({
                    room_id: "!child2:test",
                    space_id: "!space:test",
                    via_servers: ["server2"],
                }),
            ]);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/spaces/!space%3Atest/children",
                { limit: 10 },
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("handles direct array response", async () => {
            const mockResponse = [{ room_id: "!child1:test" }];

            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getSpaceChildren("!space:test");

            expect(result).toEqual(
                expect.arrayContaining([expect.objectContaining({ room_id: "!child1:test", space_id: "!space:test" })]),
            );
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 500, errcode: "M_UNKNOWN" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.getSpaceChildren("!space:test")).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });

    describe("addChild", () => {
        it("POSTs child to /spaces/{space_id}/children", async () => {
            mockClient.http.authedRequest.mockResolvedValue(undefined);

            await manager.addChild("!space:test", {
                room_id: "!room:test",
                via_servers: ["server1"],
            });

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/spaces/!space%3Atest/children",
                undefined,
                {
                    room_id: "!room:test",
                    via_servers: ["server1"],
                    suggested: undefined,
                },
                { prefix: "/_matrix/client/v3" },
            );
            // 验证缓存已失效，使用统一缓存策略
            expect((manager as any).childrenCache.has("children:!space:test")).toBe(false);
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 403, errcode: "M_FORBIDDEN" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.addChild("!space:test", { room_id: "!room:test" })).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });

    describe("removeChild", () => {
        it("DELETEs child from /spaces/{space_id}/children/{room_id}", async () => {
            mockClient.http.authedRequest.mockResolvedValue(undefined);

            await manager.removeChild("!space:test", "!room:test");

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "DELETE",
                "/spaces/!space%3Atest/children/!room%3Atest",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
            // 验证缓存已失效，使用统一缓存策略
            expect((manager as any).childrenCache.has("children:!space:test")).toBe(false);
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 404, errcode: "M_NOT_FOUND" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.removeChild("!space:test", "!room:test")).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });

    describe("getSpaceRooms", () => {
        it("calls GET /spaces/{space_id}/rooms with query params", async () => {
            const mockResponse = {
                chunk: [
                    { room_id: "!room1:test", name: "Room 1" },
                    { room_id: "!room2:test", name: "Room 2" },
                ],
            };

            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getSpaceRooms("!space:test", { limit: 5 });

            // extractSpaces returns full Space objects with many fields
            expect(result).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ room_id: "!room1:test", name: "Room 1" }),
                    expect.objectContaining({ room_id: "!room2:test", name: "Room 2" }),
                ]),
            );
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/spaces/!space%3Atest/rooms",
                { limit: 5 },
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 400, errcode: "M_BAD_PARAM" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.getSpaceRooms("!space:test")).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });

    describe("getSpaceState", () => {
        it("calls GET /spaces/{space_id}/state", async () => {
            const mockResponse = [{ type: "m.space.child", state_key: "!child:test", content: { via: ["server1"] } }];

            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getSpaceState("!space:test");

            expect(result).toEqual([
                { type: "m.space.child", state_key: "!child:test", content: { via: ["server1"] } },
            ]);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/spaces/!space%3Atest/state",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 404, errcode: "M_NOT_FOUND" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.getSpaceState("!space:test")).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });
});
