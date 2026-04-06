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

import { describe, expect, it, vi, beforeEach } from "vitest";
import { SpaceManager } from "../../src/space/index";
import { ClientPrefix, MatrixError, Method } from "../../src/http-api";
import { NotFoundError } from "../../src/errors";

describe("SpaceManager - Extended Tests", () => {
    let mockClient: any;
    let spaceManager: SpaceManager;
    let mockAuthedRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockAuthedRequest = vi.fn();
        mockClient = {
            http: {
                authedRequest: mockAuthedRequest,
            },
            getRoom: vi.fn(),
            getUserId: vi.fn().mockReturnValue("@user:test"),
        };
        spaceManager = new SpaceManager(mockClient);
    });

    describe("Space CRUD Operations", () => {
        it("should update space successfully", async () => {
            mockAuthedRequest.mockResolvedValue({
                space_id: "!space:test",
                room_id: "!space:test",
                name: "Updated Space",
            });

            const result = await spaceManager.updateSpace("!space:test", {
                name: "Updated Space",
                topic: "New topic",
            });

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                `/spaces/${encodeURIComponent("!space:test")}`,
                undefined,
                { name: "Updated Space", topic: "New topic" },
                { prefix: ClientPrefix.V3 },
            );
            expect(result.name).toBe("Updated Space");
        });

        it("should delete space successfully", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await spaceManager.deleteSpace("!space:test");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Delete,
                `/spaces/${encodeURIComponent("!space:test")}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should get public spaces successfully", async () => {
            mockAuthedRequest.mockResolvedValue({
                chunk: [
                    { room_id: "!space1:test", name: "Public Space 1" },
                    { room_id: "!space2:test", name: "Public Space 2" },
                ],
                next_batch: "next_token",
                total_room_count_estimate: 2,
            });

            const result = await spaceManager.getPublicSpaces({ limit: 10 });

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/spaces/public",
                { limit: 10 },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result.chunk).toHaveLength(2);
            expect(result.next_batch).toBe("next_token");
        });

        it("should get space statistics successfully", async () => {
            mockAuthedRequest.mockResolvedValue({
                total_spaces: 50,
                total_members: 1000,
                total_rooms: 200,
            });

            const stats = await spaceManager.getSpaceStatistics();

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/spaces/statistics",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(stats.total_spaces).toBe(50);
        });
    });

    describe("Space Children Management", () => {
        it("should get space children successfully", async () => {
            mockAuthedRequest.mockResolvedValue({
                children: [
                    { room_id: "!child1:test", name: "Child 1" },
                    { room_id: "!child2:test", name: "Child 2" },
                ],
            });

            const children = await spaceManager.getSpaceChildren("!space:test", { limit: 20 });

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/spaces/${encodeURIComponent("!space:test")}/children`,
                { limit: 20 },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(children).toHaveLength(2);
        });

        it("should remove child successfully", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await spaceManager.removeChild("!space:test", "!child:test");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Delete,
                `/spaces/${encodeURIComponent("!space:test")}/children/${encodeURIComponent("!child:test")}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });
    });

    describe("Space Members Management", () => {
        it("should get space members successfully", async () => {
            mockAuthedRequest.mockResolvedValue({
                members: [
                    { user_id: "@user1:test", membership: "join" },
                    { user_id: "@user2:test", membership: "join" },
                ],
            });

            const members = await spaceManager.getSpaceMembers("!space:test");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/spaces/${encodeURIComponent("!space:test")}/members`,
                {},
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(members).toHaveLength(2);
        });

        it("should invite to space successfully", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await spaceManager.inviteToSpace("!space:test", "@user:test", { reason: "Welcome!" });

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                `/spaces/${encodeURIComponent("!space:test")}/invite`,
                undefined,
                { user_id: "@user:test", reason: "Welcome!" },
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should join space successfully", async () => {
            mockAuthedRequest.mockResolvedValue({ room_id: "!space:test" });

            const result = await spaceManager.joinSpace("!space:test", { via: ["test"] });

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                `/spaces/${encodeURIComponent("!space:test")}/join`,
                undefined,
                { via: ["test"] },
                { prefix: ClientPrefix.V3 },
            );
            expect(result.room_id).toBe("!space:test");
        });

        it("should leave space successfully", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await spaceManager.leaveSpace("!space:test");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                `/spaces/${encodeURIComponent("!space:test")}/leave`,
                undefined,
                {},
                { prefix: ClientPrefix.V3 },
            );
        });
    });

    describe("Space Hierarchy", () => {
        it("should get space hierarchy successfully", async () => {
            mockAuthedRequest
                .mockResolvedValueOnce({
                    room_id: "!space:test",
                    space_id: "!space:test",
                    name: "Root",
                })
                .mockResolvedValueOnce({
                    children: [{ room_id: "!child:test", name: "Child" }],
                })
                .mockResolvedValueOnce({
                    members: [{ user_id: "@user:test" }],
                });

            const hierarchy = await spaceManager.getSpaceHierarchy("!space:test");

            expect(hierarchy.space.space_id).toBe("!space:test");
            expect(hierarchy.children).toHaveLength(1);
            expect(hierarchy.members).toHaveLength(1);
        });

        it("should get space hierarchy page successfully", async () => {
            mockAuthedRequest.mockResolvedValue({
                rooms: [{ room_id: "!space:test" }],
                next_batch: "next",
            });

            const page = await spaceManager.getSpaceHierarchyPage("!space:test", { limit: 10 });

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/spaces/${encodeURIComponent("!space:test")}/hierarchy`,
                { limit: 10 },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(page.rooms).toHaveLength(1);
        });

        it("should get space hierarchy v1 successfully", async () => {
            mockAuthedRequest.mockResolvedValue({
                rooms: [{ room_id: "!space:test" }],
            });

            const page = await spaceManager.getSpaceHierarchyV1("!space:test", { max_depth: 2 });

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/spaces/${encodeURIComponent("!space:test")}/hierarchy/v1`,
                { max_depth: 2 },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should get space summary with children successfully", async () => {
            mockAuthedRequest.mockResolvedValue({
                room_id: "!space:test",
                children: [{ room_id: "!child:test" }],
            });

            const summary = await spaceManager.getSpaceSummaryWithChildren("!space:test");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/spaces/${encodeURIComponent("!space:test")}/summary/with_children`,
                {},
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(summary.children).toHaveLength(1);
        });
    });

    describe("Space State and Rooms", () => {
        it("should get space state successfully", async () => {
            mockAuthedRequest.mockResolvedValue([
                { type: "m.room.name", content: { name: "Space" } },
                { type: "m.room.topic", content: { topic: "Topic" } },
            ]);

            const state = await spaceManager.getSpaceState("!space:test");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/spaces/${encodeURIComponent("!space:test")}/state`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(state).toHaveLength(2);
        });

        it("should get room space successfully", async () => {
            mockAuthedRequest.mockResolvedValue({
                room_id: "!space:test",
                space_id: "!space:test",
                name: "Parent Space",
            });

            const space = await spaceManager.getRoomSpace("!room:test");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                `/spaces/room/${encodeURIComponent("!room:test")}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(space.space_id).toBe("!space:test");
        });

        it("should check if room is space successfully", async () => {
            mockAuthedRequest.mockResolvedValue({
                room_id: "!space:test",
                space_id: "!space:test",
            });

            const result = await spaceManager.isSpace("!space:test");

            expect(result).toBe(true);
        });

        it("should get space stats successfully", async () => {
            mockAuthedRequest
                .mockResolvedValueOnce({
                    members: Array(50).fill({ user_id: "@user:test" }),
                })
                .mockResolvedValueOnce({
                    children: Array(10).fill({ room_id: "!child:test" }),
                });

            const stats = await spaceManager.getSpaceStats("!space:test");

            expect(stats.memberCount).toBe(50);
            expect(stats.childCount).toBe(10);
        });
    });

    describe("Cache Management", () => {
        it("should cache user spaces", async () => {
            mockAuthedRequest.mockResolvedValue({
                spaces: [{ room_id: "!space:test", name: "Cached Space" }],
            });

            await spaceManager.getUserSpaces();
            const cached = await spaceManager.getUserSpaces();

            // Should only call API once due to caching
            expect(mockAuthedRequest).toHaveBeenCalledTimes(1);
            expect(cached).toHaveLength(1);
        });

        it("should force refresh user spaces", async () => {
            mockAuthedRequest.mockResolvedValue({
                spaces: [{ room_id: "!space:test", name: "Space" }],
            });

            await spaceManager.getUserSpaces();
            await spaceManager.getUserSpaces(true);

            // Should call API twice due to force refresh
            expect(mockAuthedRequest).toHaveBeenCalledTimes(2);
        });
    });

    describe("Error Handling", () => {
        it("should handle 404 for non-existent space", async () => {
            const notFoundError = new MatrixError({ errcode: "M_NOT_FOUND" }, 404, undefined);
            mockAuthedRequest.mockRejectedValue(notFoundError);

            await expect(spaceManager.getSpace("!missing:test")).rejects.toBeInstanceOf(NotFoundError);
        });

        it("should handle 404 for getRoomSpace", async () => {
            const notFoundError = new MatrixError({ errcode: "M_NOT_FOUND" }, 404, undefined);
            mockAuthedRequest.mockRejectedValue(notFoundError);

            await expect(spaceManager.getRoomSpace("!room:test")).rejects.toBeInstanceOf(NotFoundError);
        });

        it("should handle network errors", async () => {
            mockAuthedRequest.mockRejectedValue(new Error("Network error"));

            await expect(spaceManager.getSpace("!space:test")).rejects.toThrow("Network error");
        });
    });
});
