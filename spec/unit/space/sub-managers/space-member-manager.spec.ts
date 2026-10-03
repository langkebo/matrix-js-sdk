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

import { SpaceMemberManager } from "../../../../src/space/sub-managers/space-member-manager";
import { SpaceEvent } from "../../../../src/space/events";

describe("SpaceMemberManager", () => {
    let manager: SpaceMemberManager;
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
            },
        };

        manager = new SpaceMemberManager(mockClient);
        manager._setParent(mockParent);
    });

    describe("getSpaceMembers", () => {
        it("calls GET /spaces/{space_id}/members", async () => {
            const mockResponse = {
                chunk: [
                    { user_id: "@user1:test", membership: "join" },
                    { user_id: "@user2:test", membership: "invite" },
                ],
            };

            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getSpaceMembers("!space:test", { limit: 20 });

            expect(result).toEqual([
                expect.objectContaining({ user_id: "@user1:test", space_id: "!space:test", membership: "join" }),
                expect.objectContaining({ user_id: "@user2:test", space_id: "!space:test", membership: "invite" }),
            ]);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/spaces/!space%3Atest/members",
                { limit: 20 },
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("handles direct array response", async () => {
            const mockResponse = [{ user_id: "@user:test", membership: "join" }];

            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getSpaceMembers("!space:test");

            expect(result).toEqual(
                expect.arrayContaining([expect.objectContaining({ user_id: "@user:test", space_id: "!space:test" })]),
            );
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 403, errcode: "M_FORBIDDEN" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.getSpaceMembers("!space:test")).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });

    describe("inviteToSpace", () => {
        it("POSTs to /spaces/{space_id}/invite", async () => {
            mockClient.http.authedRequest.mockResolvedValue(undefined);

            await manager.inviteToSpace("!space:test", "@user:test", { reason: "Welcome" });

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/spaces/!space%3Atest/invite",
                undefined,
                { user_id: "@user:test", reason: "Welcome" },
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 400, errcode: "M_BAD_PARAM" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.inviteToSpace("!space:test", "@user:test")).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });

    describe("joinSpace", () => {
        it("POSTs to /spaces/{space_id}/join", async () => {
            const mockResponse = { room_id: "!space:test", name: "Test Space" };
            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.joinSpace("!space:test");

            expect(result).toEqual(mockResponse);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/spaces/!space%3Atest/join",
                undefined,
                {},
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("emits MemberJoined on success", async () => {
            const mockResponse = { room_id: "!space:test" };
            mockClient.http.authedRequest.mockResolvedValue(mockResponse);

            const emitSpy = vi.spyOn(manager, "emit");

            await manager.joinSpace("!space:test");

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.MemberJoined, "!space:test", "@user:test");
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 403, errcode: "M_FORBIDDEN" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.joinSpace("!space:test")).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });

    describe("leaveSpace", () => {
        it("POSTs to /spaces/{space_id}/leave", async () => {
            mockClient.http.authedRequest.mockResolvedValue(undefined);

            await manager.leaveSpace("!space:test");

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/spaces/!space%3Atest/leave",
                undefined,
                {},
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("emits MemberLeft on success", async () => {
            mockClient.http.authedRequest.mockResolvedValue(undefined);

            const emitSpy = vi.spyOn(manager, "emit");

            await manager.leaveSpace("!space:test");

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.MemberLeft, "!space:test", "@user:test");
        });

        it("emits SpaceError on failure", async () => {
            const error = { httpStatus: 404, errcode: "M_NOT_FOUND" };
            mockClient.http.authedRequest.mockRejectedValue(error);

            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.leaveSpace("!space:test")).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(SpaceEvent.SpaceError, expect.any(Error));
        });
    });
});
