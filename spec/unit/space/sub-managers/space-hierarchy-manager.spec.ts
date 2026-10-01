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

import { SpaceHierarchyManager } from "../../../../src/space/sub-managers/space-hierarchy-manager";
import { SpaceEvent } from "../../../../src/space/events";

describe("SpaceHierarchyManager", () => {
    let manager: SpaceHierarchyManager;
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
            lifecycle: {
                getSpace: vi.fn(),
            },
            child: {
                getSpaceChildren: vi.fn(),
            },
            member: {
                getSpaceMembers: vi.fn(),
            },
        };

        manager = new SpaceHierarchyManager(mockClient);
        manager._setParent(mockParent);
    });

    describe("getSpaceHierarchy", () => {
        it("returns combined space, children, and members", async () => {
            const mockSpace = { space_id: "!space:test", name: "Test Space" };
            const mockChildren = [{ room_id: "!child1:test" }, { room_id: "!child2:test" }];
            const mockMembers = [{ user_id: "@user1:test" }, { user_id: "@user2:test" }];

            mockParent.lifecycle.getSpace.mockResolvedValue(mockSpace);
            mockParent.child.getSpaceChildren.mockResolvedValue(mockChildren);
            mockParent.member.getSpaceMembers.mockResolvedValue(mockMembers);

            const result = await manager.getSpaceHierarchy("!space:test");

            expect(result).toEqual({
                space: mockSpace,
                children: mockChildren,
                members: mockMembers,
            });

            expect(mockParent.lifecycle.getSpace).toHaveBeenCalledWith("!space:test");
            expect(mockParent.child.getSpaceChildren).toHaveBeenCalledWith("!space:test");
            expect(mockParent.member.getSpaceMembers).toHaveBeenCalledWith("!space:test");
        });
    });

    describe("getSpaceHierarchyPage", () => {
        it("calls GET /spaces/{space_id}/hierarchy with query params", async () => {
            const mockResponse = {
                chunk: [{ room_id: "!room:test" }],
                num_rooms_joined: 1,
            };

            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getSpaceHierarchyPage("!space:test", { limit: 10 });

            expect(result).toEqual(mockResponse);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/spaces/!space%3Atest/hierarchy",
                { limit: 10 },
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 500, errcode: "M_UNKNOWN" };
            mockClient.http.authedRequest.mockRejectedValue(error);
            
            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.getSpaceHierarchyPage("!space:test")).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });

    describe("getSpaceHierarchyV1", () => {
        it("calls GET /spaces/{space_id}/hierarchy/v1", async () => {
            const mockResponse = {
                chunk: [{ room_id: "!room:test" }],
                num_rooms_joined: 1,
            };

            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getSpaceHierarchyV1("!space:test", { limit: 20 });

            expect(result).toEqual(mockResponse);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/spaces/!space%3Atest/hierarchy/v1",
                { limit: 20 },
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 404, errcode: "M_NOT_FOUND" };
            mockClient.http.authedRequest.mockRejectedValue(error);
            
            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.getSpaceHierarchyV1("!space:test")).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });

    describe("getSpaceSummary", () => {
        it("calls GET /spaces/{space_id}/summary", async () => {
            const mockResponse = {
                room_id: "!space:test",
                name: "Test Space",
                avatar_url: "mxc://test.com/abc",
            };

            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getSpaceSummary("!space:test");

            expect(result).toEqual(mockResponse);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/spaces/!space%3Atest/summary",
                {},
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 403, errcode: "M_FORBIDDEN" };
            mockClient.http.authedRequest.mockRejectedValue(error);
            
            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.getSpaceSummary("!space:test")).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });

    describe("getSpaceSummaryWithChildren", () => {
        it("calls GET /spaces/{space_id}/summary/with_children", async () => {
            const mockResponse = {
                room_id: "!space:test",
                name: "Test Space",
                children: [{ room_id: "!child:test" }],
            };

            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getSpaceSummaryWithChildren("!space:test");

            expect(result).toEqual(mockResponse);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/spaces/!space%3Atest/summary/with_children",
                {},
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 400, errcode: "M_BAD_PARAM" };
            mockClient.http.authedRequest.mockRejectedValue(error);
            
            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.getSpaceSummaryWithChildren("!space:test")).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });

    describe("getSpaceTreePath", () => {
        it("calls GET /spaces/{space_id}/tree_path", async () => {
            const mockResponse = {
                path: ["!root:test", "!parent:test", "!space:test"],
            };

            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getSpaceTreePath("!space:test");

            expect(result).toEqual(mockResponse);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/spaces/!space%3Atest/tree_path",
                {},
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 404, errcode: "M_NOT_FOUND" };
            mockClient.http.authedRequest.mockRejectedValue(error);
            
            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.getSpaceTreePath("!space:test")).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });
});
