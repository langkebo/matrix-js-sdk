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
import { FakeTransport } from "../test-utils/FakeTransport";
import { InviteListManager, InviteListEvent } from "../../src/invite-list/index";
import { ValidationError } from "../../src/errors";
import { MatrixEvent } from "../../src/models/event";

describe("InviteListManager", () => {
    let transport: FakeTransport;
    let manager: InviteListManager;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;

    beforeEach(() => {
        transport = new FakeTransport();
        mockClient = {
            getRooms: vi.fn().mockReturnValue([]),
            joinRoom: vi.fn().mockResolvedValue({}),
            leave: vi.fn().mockResolvedValue({}),
            getUserId: vi.fn().mockReturnValue("@user:example.com"),
            getAccountData: vi.fn().mockReturnValue(null),
        };
        manager = new InviteListManager(mockClient, { transport });
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function createMockRoom(overrides: Partial<any> = {}): any {
        return {
            roomId: "!room:example.com",
            name: "Test Room",
            getMyMembership: vi.fn().mockReturnValue("invite"),
            getLiveTimeline: vi.fn().mockReturnValue(null),
            currentState: {
                getStateEvents: vi.fn().mockReturnValue([]),
                getMember: vi.fn().mockReturnValue(null),
            },
            ...overrides,
        };
    }

    describe("getInvites", () => {
        it("should return empty array when no rooms exist", async () => {
            mockClient.getRooms.mockReturnValue([]);

            const invites = await manager.getInvites();

            expect(invites).toEqual([]);
        });

        it("should return invite info for rooms with invite membership", async () => {
            const memberEvent = new MatrixEvent({
                type: "m.room.member",
                state_key: "@user:example.com",
                sender: "@alice:example.com",
                content: { membership: "invite" },
            });

            const room = createMockRoom({
                roomId: "!invited:example.com",
                name: "Cool Room",
                currentState: {
                    getStateEvents: vi.fn((eventType: string) => {
                        if (eventType === "m.room.member") return [memberEvent];
                        if (eventType === "m.room.name") return null;
                        return [];
                    }),
                    getMember: vi.fn().mockReturnValue({ name: "Alice" }),
                },
            });
            mockClient.getRooms.mockReturnValue([room]);

            const invites = await manager.getInvites();

            expect(invites).toHaveLength(1);
            expect(invites[0].roomId).toBe("!invited:example.com");
            expect(invites[0].roomName).toBe("Cool Room");
            expect(invites[0].inviterId).toBe("@alice:example.com");
            expect(invites[0].inviterName).toBe("Alice");
        });

        it("should return cached invites when client.getRooms fails", async () => {
            // First populate the cache
            mockClient.getRooms.mockReturnValue([]);
            await manager.getInvites();

            // Then make getRooms throw
            mockClient.getRooms.mockImplementation(() => {
                throw new Error("Client error");
            });

            const result = await manager.getInvites();

            expect(result).toEqual([]);
        });

        it("should emit InviteListUpdated when invites are retrieved", async () => {
            const emitSpy = vi.spyOn(manager, "emit");
            mockClient.getRooms.mockReturnValue([]);

            await manager.getInvites();

            expect(emitSpy).toHaveBeenCalledWith(InviteListEvent.InviteListUpdated, []);
        });
    });

    describe("acceptInvite", () => {
        it("should join the room and emit events", async () => {
            const emitSpy = vi.spyOn(manager, "emit");
            mockClient.joinRoom.mockResolvedValue({});

            // First add the invite to cache
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (manager as any).invites.set("!room:example.com", {
                roomId: "!room:example.com",
                inviterId: "@alice:example.com",
                timestamp: Date.now(),
            });

            await manager.acceptInvite("!room:example.com");

            expect(mockClient.joinRoom).toHaveBeenCalledWith("!room:example.com");
            expect(emitSpy).toHaveBeenCalledWith(InviteListEvent.InviteAccepted, "!room:example.com");
            expect(emitSpy).toHaveBeenCalledWith(InviteListEvent.InviteListUpdated, []);
        });

        it("should throw ValidationError for empty room ID", async () => {
            await expect(manager.acceptInvite("")).rejects.toThrow(ValidationError);
            await expect(manager.acceptInvite("")).rejects.toThrow("Room ID is required");
        });

        it("should propagate error from client.joinRoom", async () => {
            const apiError = new Error("Failed to join");
            mockClient.joinRoom.mockRejectedValue(apiError);

            await expect(manager.acceptInvite("!room:example.com")).rejects.toThrow("Failed to join");
        });

        it("should emit InviteError on failure", async () => {
            const emitSpy = vi.spyOn(manager, "emit");
            mockClient.joinRoom.mockRejectedValue(new Error("Join failed"));

            await expect(manager.acceptInvite("!room:example.com")).rejects.toThrow();
            expect(emitSpy).toHaveBeenCalledWith(InviteListEvent.InviteError, expect.any(Error));
        });
    });

    describe("rejectInvite", () => {
        it("should leave the room and emit events", async () => {
            const emitSpy = vi.spyOn(manager, "emit");
            mockClient.leave.mockResolvedValue({});

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (manager as any).invites.set("!room:example.com", {
                roomId: "!room:example.com",
                inviterId: "@alice:example.com",
                timestamp: Date.now(),
            });

            await manager.rejectInvite("!room:example.com");

            expect(mockClient.leave).toHaveBeenCalledWith("!room:example.com");
            expect(emitSpy).toHaveBeenCalledWith(InviteListEvent.InviteRejected, "!room:example.com");
            expect(emitSpy).toHaveBeenCalledWith(InviteListEvent.InviteListUpdated, []);
        });

        it("should throw ValidationError for empty room ID", async () => {
            await expect(manager.rejectInvite("")).rejects.toThrow(ValidationError);
        });
    });

    describe("batch operations", () => {
        it("acceptAllInvites should accept all cached invites", async () => {
            mockClient.joinRoom.mockResolvedValue({});
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (manager as any).invites.set("!room1:example.com", { roomId: "!room1:example.com" });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (manager as any).invites.set("!room2:example.com", { roomId: "!room2:example.com" });

            await manager.acceptAllInvites();

            expect(mockClient.joinRoom).toHaveBeenCalledTimes(2);
            expect(mockClient.joinRoom).toHaveBeenCalledWith("!room1:example.com");
            expect(mockClient.joinRoom).toHaveBeenCalledWith("!room2:example.com");
        });

        it("rejectAllInvites should reject all cached invites", async () => {
            mockClient.leave.mockResolvedValue({});
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (manager as any).invites.set("!room1:example.com", { roomId: "!room1:example.com" });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (manager as any).invites.set("!room2:example.com", { roomId: "!room2:example.com" });

            await manager.rejectAllInvites();

            expect(mockClient.leave).toHaveBeenCalledTimes(2);
            expect(mockClient.leave).toHaveBeenCalledWith("!room1:example.com");
            expect(mockClient.leave).toHaveBeenCalledWith("!room2:example.com");
        });

        it("acceptAllInvites should continue if one fails", async () => {
            mockClient.joinRoom.mockRejectedValueOnce(new Error("Room 1 failed")).mockResolvedValueOnce({});
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (manager as any).invites.set("!room1:example.com", { roomId: "!room1:example.com" });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (manager as any).invites.set("!room2:example.com", { roomId: "!room2:example.com" });

            await manager.acceptAllInvites();

            // Should have attempted both rooms even though first failed
            expect(mockClient.joinRoom).toHaveBeenCalledTimes(2);
        });
    });

    describe("cached invite accessors", () => {
        it("getInvite should return null for unknown room", () => {
            expect(manager.getInvite("!unknown:example.com")).toBeNull();
        });

        it("getInvite should return cached invite", () => {
            const invite = { roomId: "!room:example.com", inviterId: "@alice:example.com", timestamp: 1000 };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (manager as any).invites.set("!room:example.com", invite);

            expect(manager.getInvite("!room:example.com")).toEqual(invite);
        });

        it("hasInvite should return true for cached room", () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (manager as any).invites.set("!room:example.com", { roomId: "!room:example.com" });

            expect(manager.hasInvite("!room:example.com")).toBe(true);
        });

        it("hasInvite should return false for unknown room", () => {
            expect(manager.hasInvite("!unknown:example.com")).toBe(false);
        });

        it("getInviteCount should return the number of cached invites", () => {
            expect(manager.getInviteCount()).toBe(0);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (manager as any).invites.set("!room1:example.com", { roomId: "!room1:example.com" });
            expect(manager.getInviteCount()).toBe(1);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (manager as any).invites.set("!room2:example.com", { roomId: "!room2:example.com" });
            expect(manager.getInviteCount()).toBe(2);
        });

        it("getCachedInvites should return all cached invites", () => {
            const invite1 = { roomId: "!room1:example.com" };
            const invite2 = { roomId: "!room2:example.com" };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (manager as any).invites.set("!room1:example.com", invite1);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (manager as any).invites.set("!room2:example.com", invite2);

            const cached = manager.getCachedInvites();

            expect(cached).toHaveLength(2);
            expect(cached).toContainEqual(invite1);
            expect(cached).toContainEqual(invite2);
        });
    });

    describe("handleInvite", () => {
        it("should add invite to cache and emit events", () => {
            const emitSpy = vi.spyOn(manager, "emit");
            const invite = { roomId: "!room:example.com", inviterId: "@alice:example.com", timestamp: Date.now() };

            manager.handleInvite("!room:example.com", invite);

            expect(manager.hasInvite("!room:example.com")).toBe(true);
            expect(emitSpy).toHaveBeenCalledWith(InviteListEvent.InviteReceived, invite);
            expect(emitSpy).toHaveBeenCalledWith(InviteListEvent.InviteListUpdated, [invite]);
        });
    });

    describe("handleMembershipChange", () => {
        it("should remove invite when membership is not 'invite'", () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (manager as any).invites.set("!room:example.com", { roomId: "!room:example.com" });

            manager.handleMembershipChange("!room:example.com", "join");

            expect(manager.hasInvite("!room:example.com")).toBe(false);
        });

        it("should not modify cache when membership is still 'invite'", () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (manager as any).invites.set("!room:example.com", { roomId: "!room:example.com" });

            manager.handleMembershipChange("!room:example.com", "invite");

            expect(manager.hasInvite("!room:example.com")).toBe(true);
        });
    });

    describe("clear / lifecycle", () => {
        it("clear should empty the invite cache", () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (manager as any).invites.set("!room:example.com", { roomId: "!room:example.com" });
            expect(manager.getInviteCount()).toBe(1);

            manager.clear();

            expect(manager.getInviteCount()).toBe(0);
        });

        it("start should call getInvites", async () => {
            const getInvitesSpy = vi.spyOn(manager, "getInvites");
            mockClient.getRooms.mockReturnValue([]);

            await manager.start();

            expect(getInvitesSpy).toHaveBeenCalledOnce();
        });

        it("start should not re-initialize if already initialized", async () => {
            const getInvitesSpy = vi.spyOn(manager, "getInvites");
            mockClient.getRooms.mockReturnValue([]);

            await manager.start();
            await manager.start();

            expect(getInvitesSpy).toHaveBeenCalledTimes(1);
        });

        it("stop should clear cache and reset initialized flag", () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (manager as any).initialized = true;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (manager as any).invites.set("!room:example.com", { roomId: "!room:example.com" });

            manager.stop();

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((manager as any).initialized).toBe(false);
            expect(manager.getInviteCount()).toBe(0);
        });
    });
});
