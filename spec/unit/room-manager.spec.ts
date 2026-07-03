import { describe, it, expect, beforeEach, vi } from "vitest";

import { RoomManager, RoomEvent } from "../../src/room/RoomManager";
import { KnownMembership } from "../../src/types";
import { EventType } from "../../src/@types/event";
import { Visibility } from "../../src/@types/partials";

describe("RoomManager", () => {
    let mockClient: any;
    let roomManager: RoomManager;

    beforeEach(() => {
        const mockRoom = {
            roomId: "!room:example.com",
            getMyMembership: vi.fn().mockReturnValue(KnownMembership.Join),
            getMember: vi.fn().mockReturnValue({
                membership: KnownMembership.Join,
                events: { member: { getSender: vi.fn().mockReturnValue("@inviter:example.com") } },
            }),
            hasMembershipState: vi.fn().mockReturnValue(true),
        };

        const mockEventManager = {
            getState: vi.fn().mockResolvedValue([]),
            getStateEvent: vi.fn().mockResolvedValue({}),
            sendStateEvent: vi.fn().mockResolvedValue({ event_id: "$event:example.com" }),
        };

        mockClient = {
            store: {
                getRoom: vi.fn().mockReturnValue(mockRoom),
                getRooms: vi.fn().mockReturnValue([mockRoom]),
                removeRoom: vi.fn(),
            },
            http: {
                authedRequest: vi.fn().mockResolvedValue({ room_id: "!newroom:example.com" }),
                requestOtherUrl: vi.fn().mockResolvedValue({}),
            },
            getSafeUserId: vi.fn().mockReturnValue("@test:example.com"),
            getUserId: vi.fn().mockReturnValue("@test:example.com"),
            identityServer: {
                getAccessToken: vi.fn().mockResolvedValue("identity-token"),
            },
            credentials: { userId: "@test:example.com" },
            getEventManager: vi.fn().mockReturnValue(mockEventManager),
            getCrypto: vi.fn().mockReturnValue(undefined),
            getCryptoBackend: vi.fn().mockReturnValue(undefined),
            sendStateEvent: vi.fn().mockResolvedValue({ event_id: "$event:example.com" }),
            getIdentityServerUrl: vi.fn().mockReturnValue("https://identity.example.com"),
            emit: vi.fn(),
            getClientOpts: vi.fn().mockReturnValue({}),
            getSyncApiOptions: vi.fn().mockReturnValue({}),
            getIdentityServerManager: vi.fn().mockReturnValue({
                getIdentityServerUrl: vi.fn().mockReturnValue("https://identity.example.com"),
            }),
            baseUrl: "https://matrix.test",
            getClientWellKnown: vi.fn().mockReturnValue(null),
        };
        roomManager = new RoomManager(mockClient);
    });

    describe("constructor", () => {
        it("should initialize correctly", () => {
            expect(roomManager).toBeDefined();
        });
    });

    describe("isSlidingSyncSupported", () => {
        it("defaults to supported for clients without centralized discovery", async () => {
            await expect(roomManager.isSlidingSyncSupported()).resolves.toBe(true);
        });

        it("uses centralized synapse-rust sliding-sync discovery when available", async () => {
            mockClient.doesServerAdvertiseSynapseRustFeature = vi.fn().mockResolvedValue(false);

            await expect(roomManager.isSlidingSyncSupported()).resolves.toBe(false);
            expect(mockClient.doesServerAdvertiseSynapseRustFeature).toHaveBeenCalledWith(
                "org.matrix.msc3886.sliding_sync",
            );
        });
    });

    describe("getRoom", () => {
        it("should return room from store", () => {
            const room = roomManager.getRoom("!room:example.com");
            expect(room).toBeDefined();
            expect(mockClient.store.getRoom).toHaveBeenCalledWith("!room:example.com");
        });

        it("should return null for undefined roomId", () => {
            mockClient.store.getRoom.mockReturnValue(null);
            const room = roomManager.getRoom(undefined);
            expect(room).toBeNull();
        });
    });

    describe("getRooms", () => {
        it("should return all rooms from store", () => {
            const rooms = roomManager.getRooms();
            expect(rooms).toHaveLength(1);
            expect(mockClient.store.getRooms).toHaveBeenCalled();
        });

        it("should return empty array when no rooms", () => {
            mockClient.store.getRooms.mockReturnValue([]);
            const rooms = roomManager.getRooms();
            expect(rooms).toHaveLength(0);
        });
    });

    describe("getVisibleRooms", () => {
        it("should return only visible rooms", () => {
            const rooms = roomManager.getVisibleRooms();
            expect(rooms).toHaveLength(1);
        });

        it("should filter out rooms with leave membership", () => {
            const mockLeaveRoom = {
                getMyMembership: vi.fn().mockReturnValue(KnownMembership.Leave),
            };
            mockClient.store.getRooms.mockReturnValue([
                { getMyMembership: vi.fn().mockReturnValue(KnownMembership.Join) },
                mockLeaveRoom,
            ]);
            const rooms = roomManager.getVisibleRooms();
            expect(rooms).toHaveLength(1);
        });
    });

    describe("getRoomVersion", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.getRoomVersion("")).rejects.toThrow();
        });

        it("should fetch room version from server", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ room_version: "9" });
            const version = await roomManager.getRoomVersion("!room:example.com");
            expect(version).toBe("9");
        });

        it("should use cached version when available", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ room_version: "9" });
            await roomManager.getRoomVersion("!room:example.com");
            await roomManager.getRoomVersion("!room:example.com");
            expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(1);
        });

        it("should force refresh when requested", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ room_version: "9" });
            await roomManager.getRoomVersion("!room:example.com");
            await roomManager.getRoomVersion("!room:example.com", true);
            expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(2);
        });
    });

    describe("getRoomCapabilities", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.getRoomCapabilities("")).rejects.toThrow();
        });

        it("should fetch room capabilities from server", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ capabilities: {} });
            const caps = await roomManager.getRoomCapabilities("!room:example.com");
            expect(caps).toBeDefined();
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                `/rooms/${encodeURIComponent("!room:example.com")}/capabilities`,
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    describe("getRoomMetadata", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.getRoomMetadata("")).rejects.toThrow();
        });

        it("should fetch room metadata from server", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ metadata: {} });
            const meta = await roomManager.getRoomMetadata("!room:example.com");
            expect(meta).toBeDefined();
        });
    });

    describe("createRoom", () => {
        it("should create room with basic options", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ room_id: "!newroom:example.com" });
            const result = await roomManager.createRoom({ name: "Test Room" });
            expect(result.room_id).toBe("!newroom:example.com");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/createRoom",
                undefined,
                { name: "Test Room" },
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("should add identity access token for 3pid invites", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ room_id: "!newroom:example.com" });
            await roomManager.createRoom({
                invite_3pid: [{ id_server: "example.com", medium: "email", address: "test@example.com" }],
            });
            expect(mockClient.identityServer.getAccessToken).toHaveBeenCalled();
        });
    });

    describe("joinRoom", () => {
        it("should join room by ID", async () => {
            mockClient.store.getRoom
                .mockReturnValueOnce({
                    roomId: "!room:example.com",
                    getMember: vi.fn().mockReturnValue({
                        membership: KnownMembership.Invite,
                        events: { member: { getSender: vi.fn().mockReturnValue("@inviter:example.com") } },
                    }),
                    hasMembershipState: vi.fn().mockReturnValue(false),
                })
                .mockReturnValueOnce({
                    roomId: "!room:example.com",
                    getMember: vi.fn().mockReturnValue({
                        membership: KnownMembership.Invite,
                        events: { member: { getSender: vi.fn().mockReturnValue("@inviter:example.com") } },
                    }),
                    hasMembershipState: vi.fn().mockReturnValue(true),
                });
            mockClient.http.authedRequest.mockResolvedValue({ room_id: "!room:example.com" });
            const result = await roomManager.joinRoom("!room:example.com");
            expect(result).toBeDefined();
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                `/join/${encodeURIComponent("!room:example.com")}`,
                {},
                {},
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    describe("knockRoom", () => {
        it("should knock room by ID", async () => {
            mockClient.store.getRoom.mockReturnValue(null);
            mockClient.http.authedRequest.mockResolvedValue({ room_id: "!room:example.com" });

            const result = await roomManager.knockRoom("!room:example.com", {
                reason: "let me in",
                viaServers: ["example.com", "backup.example.com"],
            });

            expect(result).toEqual({ room_id: "!room:example.com" });
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                `/knock/${encodeURIComponent("!room:example.com")}`,
                { server_name: ["example.com", "backup.example.com"], via: ["example.com", "backup.example.com"] },
                { reason: "let me in" },
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    describe("leave", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.leave("")).rejects.toThrow();
        });

        it("should leave room successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});
            const result = await roomManager.leave("!room:example.com");
            expect(result).toEqual({});
        });

        it("should emit RoomLeft event", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});
            const emitSpy = vi.spyOn(roomManager, "emit");
            await roomManager.leave("!room:example.com");
            expect(emitSpy).toHaveBeenCalledWith(RoomEvent.RoomLeft, "!room:example.com");
        });
    });

    describe("forget", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.forget("")).rejects.toThrow();
        });

        it("should forget room successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});
            const result = await roomManager.forget("!room:example.com");
            expect(result).toEqual({});
        });

        it("should remove room from store when deleteRoom is true", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});
            await roomManager.forget("!room:example.com", true);
            expect(mockClient.store.removeRoom).toHaveBeenCalledWith("!room:example.com");
        });
    });

    describe("getMembers", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.getMembers("")).rejects.toThrow();
        });

        it("should fetch members from server", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ chunk: [{ event_id: "$event1" }] });
            const members = await roomManager.getMembers("!room:example.com");
            expect(members).toHaveLength(1);
        });

        it("should use cached members when available", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ chunk: [{ event_id: "$event1" }] });
            await roomManager.getMembers("!room:example.com");
            await roomManager.getMembers("!room:example.com");
            expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(1);
        });

        it("should force refresh when requested", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ chunk: [{ event_id: "$event1" }] });
            await roomManager.getMembers("!room:example.com");
            await roomManager.getMembers("!room:example.com", undefined, true);
            expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(2);
        });
    });

    describe("getJoinedMembers", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.getJoinedMembers("")).rejects.toThrow();
        });

        it("should fetch joined members from server", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ joined: {} });
            const result = await roomManager.getJoinedMembers("!room:example.com");
            expect(result).toBeDefined();
        });
    });

    describe("getMembership", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.getMembership("", "@user:example.com")).rejects.toThrow();
        });

        it("should throw error for invalid userId", async () => {
            await expect(roomManager.getMembership("!room:example.com", "")).rejects.toThrow();
        });

        it("should fetch membership from server", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ event_id: "$event1", state_key: "@user:example.com" });
            const result = await roomManager.getMembership("!room:example.com", "@user:example.com");
            expect(result).toBeDefined();
        });

        it("should return null on 404 when throwOnError is false", async () => {
            const error = new Error("Not found") as any;
            error.httpStatus = 404;
            mockClient.http.authedRequest.mockRejectedValue(error);
            const result = await roomManager.getMembership("!room:example.com", "@user:example.com", false);
            expect(result).toBeNull();
        });

        it("should throw on 404 by default", async () => {
            const error = new Error("Not found") as any;
            error.httpStatus = 404;
            mockClient.http.authedRequest.mockRejectedValue(error);
            await expect(roomManager.getMembership("!room:example.com", "@user:example.com")).rejects.toThrow();
        });
    });

    describe("invite", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.invite("", "@user:example.com")).rejects.toThrow();
        });

        it("should throw error for invalid userId", async () => {
            await expect(roomManager.invite("!room:example.com", "")).rejects.toThrow();
        });

        it("should invite user successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});
            const result = await roomManager.invite("!room:example.com", "@user:example.com");
            expect(result).toEqual({});
        });

        it("should invite user with reason string", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});
            await roomManager.invite("!room:example.com", "@user:example.com", "test reason");
            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });

        it("should emit MemberJoined event", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});
            const emitSpy = vi.spyOn(roomManager, "emit");
            await roomManager.invite("!room:example.com", "@user:example.com");
            expect(emitSpy).toHaveBeenCalledWith(RoomEvent.MemberJoined, "!room:example.com", "@user:example.com");
        });
    });

    describe("inviteByEmail", () => {
        it("should call inviteByThreePid with email medium", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});
            await roomManager.inviteByEmail("!room:example.com", "test@example.com");
            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    describe("inviteByThreePid", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.inviteByThreePid("", "email", "test@example.com")).rejects.toThrow();
        });

        it("should invite by three pid successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});
            const result = await roomManager.inviteByThreePid("!room:example.com", "email", "test@example.com");
            expect(result).toEqual({});
        });
    });

    describe("kick", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.kick("", "@user:example.com")).rejects.toThrow();
        });

        it("should throw error for invalid userId", async () => {
            await expect(roomManager.kick("!room:example.com", "")).rejects.toThrow();
        });

        it("should kick user successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});
            const result = await roomManager.kick("!room:example.com", "@user:example.com", "test reason");
            expect(result).toEqual({});
        });

        it("should emit MemberLeft event", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});
            const emitSpy = vi.spyOn(roomManager, "emit");
            await roomManager.kick("!room:example.com", "@user:example.com");
            expect(emitSpy).toHaveBeenCalledWith(RoomEvent.MemberLeft, "!room:example.com", "@user:example.com");
        });
    });

    describe("ban", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.ban("", "@user:example.com")).rejects.toThrow();
        });

        it("should throw error for invalid userId", async () => {
            await expect(roomManager.ban("!room:example.com", "")).rejects.toThrow();
        });

        it("should ban user successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});
            const result = await roomManager.ban("!room:example.com", "@user:example.com", "test reason");
            expect(result).toEqual({});
        });
    });

    describe("unban", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.unban("", "@user:example.com")).rejects.toThrow();
        });

        it("should throw error for invalid userId", async () => {
            await expect(roomManager.unban("!room:example.com", "")).rejects.toThrow();
        });

        it("should unban user successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});
            const result = await roomManager.unban("!room:example.com", "@user:example.com");
            expect(result).toEqual({});
        });
    });

    describe("getState", () => {
        it("should delegate to event manager", async () => {
            await roomManager.getState("!room:example.com");
            expect(mockClient.getEventManager().getState).toHaveBeenCalledWith("!room:example.com", false);
        });
    });

    describe("getStateEvent", () => {
        it("should delegate to event manager", async () => {
            await roomManager.getStateEvent("!room:example.com", "m.room.name", "");
            expect(mockClient.getEventManager().getStateEvent).toHaveBeenCalledWith(
                "!room:example.com",
                "m.room.name",
                "",
            );
        });
    });

    describe("sendStateEvent", () => {
        it("should delegate to event manager", async () => {
            await roomManager.sendStateEvent("!room:example.com", "m.room.name", { name: "Test" }, "");
            expect(mockClient.getEventManager().sendStateEvent).toHaveBeenCalled();
        });
    });

    describe("setRoomName", () => {
        it("should send state event with room name", async () => {
            await roomManager.setRoomName("!room:example.com", "New Name");
            expect(mockClient.sendStateEvent).toHaveBeenCalledWith(
                "!room:example.com",
                "m.room.name",
                { name: "New Name" },
                "",
            );
        });
    });

    describe("setRoomTopic", () => {
        it("should send state event with room topic", async () => {
            await roomManager.setRoomTopic("!room:example.com", "New Topic");
            expect(mockClient.sendStateEvent).toHaveBeenCalled();
        });
    });

    describe("getEvent", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.getEvent("", "$event:example.com")).rejects.toThrow();
        });

        it("should throw error for missing eventId", async () => {
            await expect(roomManager.getEvent("!room:example.com", "")).rejects.toThrow();
        });

        it("should fetch event from server", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ event_id: "$event:example.com" });
            const result = await roomManager.getEvent("!room:example.com", "$event:example.com");
            expect(result).toBeDefined();
        });
    });

    describe("getEventContext", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.getEventContext("", "$event:example.com")).rejects.toThrow();
        });

        it("should throw error for missing eventId", async () => {
            await expect(roomManager.getEventContext("!room:example.com", "")).rejects.toThrow();
        });

        it("should fetch event context from server", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                event: { event_id: "$event:example.com" },
                events_before: [],
                events_after: [],
                start: "start",
                end: "end",
                state: [],
            });
            const result = await roomManager.getEventContext("!room:example.com", "$event:example.com");
            expect(result).toBeDefined();
        });

        it("should pass limit parameter", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                event: { event_id: "$event:example.com" },
                events_before: [],
                events_after: [],
                start: "start",
                end: "end",
                state: [],
            });
            await roomManager.getEventContext("!room:example.com", "$event:example.com", { limit: 10 });
            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });

        it("should preserve zero-valued limit parameter", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                event: { event_id: "$event:example.com" },
                events_before: [],
                events_after: [],
                start: "start",
                end: "end",
                state: [],
            });

            await roomManager.getEventContext("!room:example.com", "$event:example.com", { limit: 0 });

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/rooms/!room%3Aexample.com/context/%24event%3Aexample.com",
                { limit: "0" },
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    describe("redactEvent", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.redactEvent("", "$event:example.com")).rejects.toThrow();
        });

        it("should throw error for missing eventId", async () => {
            await expect(roomManager.redactEvent("!room:example.com", "")).rejects.toThrow();
        });

        it("should redact event successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ event_id: "$redact:example.com" });
            const result = await roomManager.redactEvent("!room:example.com", "$event:example.com", "test reason");
            expect(result).toBeDefined();
        });
    });

    describe("getRoomTags", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.getRoomTags("")).rejects.toThrow();
        });

        it("should fetch room tags from server", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ tags: {} });
            const result = await roomManager.getRoomTags("!room:example.com");
            expect(result).toBeDefined();
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                `/user/${encodeURIComponent("@test:example.com")}/rooms/${encodeURIComponent("!room:example.com")}/tags`,
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    describe("setRoomTag", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.setRoomTag("", "m.favourite")).rejects.toThrow();
        });

        it("should throw error for missing tagName", async () => {
            await expect(roomManager.setRoomTag("!room:example.com", "")).rejects.toThrow();
        });

        it("should set room tag successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});
            const result = await roomManager.setRoomTag("!room:example.com", "m.favourite", { order: 0.5 });
            expect(result).toEqual({});
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "PUT",
                `/user/${encodeURIComponent("@test:example.com")}/rooms/${encodeURIComponent("!room:example.com")}/tags/${encodeURIComponent("m.favourite")}`,
                undefined,
                { order: 0.5 },
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    describe("deleteRoomTag", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.deleteRoomTag("", "m.favourite")).rejects.toThrow();
        });

        it("should throw error for missing tagName", async () => {
            await expect(roomManager.deleteRoomTag("!room:example.com", "")).rejects.toThrow();
        });

        it("should delete room tag successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});
            const result = await roomManager.deleteRoomTag("!room:example.com", "m.favourite");
            expect(result).toEqual({});
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "DELETE",
                `/user/${encodeURIComponent("@test:example.com")}/rooms/${encodeURIComponent("!room:example.com")}/tags/${encodeURIComponent("m.favourite")}`,
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    describe("setRoomAccountData", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(
                roomManager.setRoomAccountData("", EventType.FullyRead, { event_id: "$event:example.com" }),
            ).rejects.toThrow();
        });

        it("should throw error for missing eventType", async () => {
            await expect(roomManager.setRoomAccountData("!room:example.com", "" as any, {})).rejects.toThrow();
        });

        it("should set room account data successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});
            const result = await roomManager.setRoomAccountData("!room:example.com", EventType.FullyRead, {
                event_id: "$event:example.com",
            });
            expect(result).toEqual({});
        });
    });

    describe("getRoomDirectoryVisibility", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.getRoomDirectoryVisibility("")).rejects.toThrow();
        });

        it("should fetch room directory visibility", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ visibility: "public" });
            const result = await roomManager.getRoomDirectoryVisibility("!room:example.com");
            expect(result).toBeDefined();
        });
    });

    describe("setRoomDirectoryVisibility", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.setRoomDirectoryVisibility("", Visibility.Public)).rejects.toThrow();
        });

        it("should set room directory visibility", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});
            const result = await roomManager.setRoomDirectoryVisibility("!room:example.com", Visibility.Public);
            expect(result).toEqual({});
        });
    });

    describe("getRoomHierarchy", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.getRoomHierarchy("")).rejects.toThrow();
        });

        it("should fetch room hierarchy", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ rooms: [] });
            const result = await roomManager.getRoomHierarchy("!room:example.com");
            expect(result).toBeDefined();
        });

        it("should pass query parameters", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ rooms: [] });
            await roomManager.getRoomHierarchy("!room:example.com", 10, 5, true, "token");
            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    describe("getRoomIdForAlias", () => {
        it("should throw error for missing roomAlias", async () => {
            await expect(roomManager.getRoomIdForAlias("")).rejects.toThrow();
        });

        it("should fetch room ID for alias", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ room_id: "!room:example.com", servers: [] });
            const result = await roomManager.getRoomIdForAlias("#room:example.com");
            expect(result).toBeDefined();
        });
    });

    describe("createAlias", () => {
        it("should throw error for missing roomAlias", async () => {
            await expect(roomManager.createAlias("", "!room:example.com")).rejects.toThrow();
        });

        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.createAlias("#room:example.com", "")).rejects.toThrow();
        });

        it("should create alias successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});
            const result = await roomManager.createAlias("#room:example.com", "!room:example.com");
            expect(result).toEqual({});
        });
    });

    describe("deleteAlias", () => {
        it("should throw error for missing roomAlias", async () => {
            await expect(roomManager.deleteAlias("")).rejects.toThrow();
        });

        it("should delete alias successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});
            const result = await roomManager.deleteAlias("#room:example.com");
            expect(result).toEqual({});
        });
    });

    describe("getLocalAliases", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.getLocalAliases("")).rejects.toThrow();
        });

        it("should fetch local aliases", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ aliases: [] });
            const result = await roomManager.getLocalAliases("!room:example.com");
            expect(result).toBeDefined();
        });
    });

    describe("upgradeRoom", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.upgradeRoom("", "9")).rejects.toThrow();
        });

        it("should upgrade room successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ replacement_room: "!newroom:example.com" });
            const result = await roomManager.upgradeRoom("!room:example.com", "9");
            expect(result).toBeDefined();
        });

        it("should include additional creators", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ replacement_room: "!newroom:example.com" });
            await roomManager.upgradeRoom("!room:example.com", "9", ["@creator:example.com"]);
            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    describe("reportRoom", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.reportRoom("", "spam")).rejects.toThrow();
        });

        it("should report room successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});
            const result = await roomManager.reportRoom("!room:example.com", "spam");
            expect(result).toEqual({});
        });
    });

    describe("roomInitialSync", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.roomInitialSync("")).rejects.toThrow();
        });

        it("should perform initial sync", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ room_id: "!room:example.com" });
            const result = await roomManager.roomInitialSync("!room:example.com");
            expect(result).toBeDefined();
        });
    });

    describe("setGuestAccess", () => {
        it("should throw error for invalid roomId", async () => {
            await expect(roomManager.setGuestAccess("", { allowJoin: true, allowRead: true })).rejects.toThrow();
        });

        it("should set guest access successfully", async () => {
            mockClient.sendStateEvent.mockResolvedValue({ event_id: "$event" });
            await roomManager.setGuestAccess("!room:example.com", { allowJoin: true, allowRead: true });
            expect(mockClient.sendStateEvent).toHaveBeenNthCalledWith(
                1,
                "!room:example.com",
                "m.room.guest_access",
                { guest_access: "can_join" },
                "",
            );
            expect(mockClient.sendStateEvent).toHaveBeenNthCalledWith(
                2,
                "!room:example.com",
                "m.room.history_visibility",
                { history_visibility: "world_readable" },
                "",
            );
        });
    });

    describe("clearRoomCache", () => {
        it("should clear room cache", () => {
            roomManager.clearRoomCache("!room:example.com");
            expect(true).toBe(true);
        });
    });

    describe("clearAllCaches", () => {
        it("should clear all caches", () => {
            roomManager.clearAllCaches();
            expect(true).toBe(true);
        });
    });
});
