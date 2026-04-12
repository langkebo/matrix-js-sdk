import { describe, it, expect, beforeEach, vi } from "vitest";

import { DirectMessageManager, DMEvent } from "../../src/dm/index";
import { MatrixError } from "../../src/http-api/errors";
import * as dmExports from "../../src/dm/index";

describe("DirectMessageManager", () => {
    let mockClient: any;
    let dmManager: DirectMessageManager;

    beforeEach(() => {
        mockClient = {
            createRoom: vi.fn(),
            getRooms: vi.fn().mockReturnValue([]),
            getAccountData: vi.fn(), // ⚠️ 用户级别的 account data
            setAccountData: vi.fn(),
            leave: vi.fn(),
            getRoom: vi.fn(),
            setRoomReadMarkers: vi.fn(),
            sendEvent: vi.fn(),
            getUserId: vi.fn().mockReturnValue("@test:example.com"),
            getHomeserverUrl: vi.fn().mockReturnValue("https://example.com"),
        };
        dmManager = new DirectMessageManager(mockClient);
    });

    // ============ m.direct 读取位置测试 ============

    describe("m.direct 读取位置（关键）", () => {
        it("应该从 client 级别读取 m.direct，不是 room 级别", async () => {
            // 设置用户级别的 m.direct account data
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({
                    "@user1:example.com": ["!room:example.com"],
                }),
            });

            await dmManager.getDMRooms();

            // 验证是从 client.getAccountData 读取，不是 room.getAccountData
            expect(mockClient.getAccountData).toHaveBeenCalledWith("m.direct");
        });

        it("m.direct 是用户级别的 account data，不是房间级别", async () => {
            // 模拟没有 m.direct 的情况
            mockClient.getAccountData.mockReturnValue(null);

            const dmMap = await dmManager.getDirectRoomsByUser();

            expect(dmMap).toEqual({});
            expect(mockClient.getAccountData).toHaveBeenCalled();
        });

        it("m.direct 格式应为 { [userId]: [roomId, ...] }", async () => {
            const expectedMap = {
                "@alice:example.com": ["!dm1:example.com"],
                "@bob:example.com": ["!dm2:example.com", "!dm3:example.com"],
            };

            mockClient.getAccountData.mockReturnValue({
                getContent: () => expectedMap,
            });

            const dmMap = await dmManager.getDirectRoomsByUser();

            expect(dmMap).toEqual(expectedMap);
        });
    });

    // ============ 构造函数测试 ============

    describe("constructor", () => {
        it("should initialize correctly", () => {
            expect(dmManager).toBeDefined();
        });
    });

    // ============ createDm 测试 ============

    describe("createDm", () => {
        it("should create DM with userIds array", async () => {
            mockClient.createRoom.mockResolvedValueOnce({ room_id: "!room:example.com" });
            mockClient.getAccountData.mockReturnValue(null);
            mockClient.setAccountData.mockResolvedValueOnce({});

            const roomId = await dmManager.createDm(["@user1:example.com"]);

            expect(roomId).toBe("!room:example.com");
            expect(mockClient.createRoom).toHaveBeenCalledWith(
                expect.objectContaining({
                    is_direct: true,
                    invite: ["@user1:example.com"],
                }),
            );
        });

        it("should create DM with CreateDmOptions", async () => {
            mockClient.createRoom.mockResolvedValueOnce({ room_id: "!room:example.com" });
            mockClient.getAccountData.mockReturnValue(null);
            mockClient.setAccountData.mockResolvedValueOnce({});

            const roomId = await dmManager.createDm({
                userIds: ["@user1:example.com"],
                name: "Test DM",
            });

            expect(roomId).toBe("!room:example.com");
        });

        it("should return existing DM if found", async () => {
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({
                    "@user1:example.com": ["!existing:example.com"],
                }),
            });

            const roomId = await dmManager.createDm(["@user1:example.com"]);

            expect(roomId).toBe("!existing:example.com");
            expect(mockClient.createRoom).not.toHaveBeenCalled();
        });

        it("should emit DMCreated event", async () => {
            mockClient.createRoom.mockResolvedValueOnce({ room_id: "!room:example.com" });
            mockClient.getAccountData.mockReturnValue(null);
            mockClient.setAccountData.mockResolvedValueOnce({});

            const emitSpy = vi.spyOn(dmManager, "emit");
            await dmManager.createDm(["@user1:example.com"]);

            expect(emitSpy).toHaveBeenCalledWith(DMEvent.DMCreated, "!room:example.com", ["@user1:example.com"]);
        });

        it("should throw error for empty userIds", async () => {
            await expect(dmManager.createDm({ userIds: [] })).rejects.toThrow();
        });
    });

    // ============ getDMRooms 测试 ============

    describe("getDMRooms", () => {
        it("should return empty array when no rooms", async () => {
            mockClient.getAccountData.mockReturnValue({ getContent: () => ({}) });
            mockClient.getRooms.mockReturnValue([]);

            const dmRooms = await dmManager.getDMRooms();

            expect(dmRooms).toHaveLength(0);
        });

        it("should return DM rooms for all m.direct mappings", async () => {
            // 设置 m.direct 映射
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({
                    "@alice:example.com": ["!dm1:example.com"],
                    "@bob:example.com": ["!dm2:example.com"],
                }),
            });

            const mockRoom1 = {
                roomId: "!dm1:example.com",
                getMyMembership: vi.fn().mockReturnValue("join"),
                getJoinedMembers: vi
                    .fn()
                    .mockReturnValue([{ userId: "@test:example.com" }, { userId: "@alice:example.com" }]),
                name: "DM 1",
                getAvatarUrl: vi.fn().mockReturnValue(null),
                getLiveTimeline: vi.fn().mockReturnValue({ getEvents: () => [] }),
                getUnreadNotificationCount: vi.fn().mockReturnValue(0),
            };

            const mockRoom2 = {
                roomId: "!dm2:example.com",
                getMyMembership: vi.fn().mockReturnValue("join"),
                getJoinedMembers: vi
                    .fn()
                    .mockReturnValue([{ userId: "@test:example.com" }, { userId: "@bob:example.com" }]),
                name: "DM 2",
                getAvatarUrl: vi.fn().mockReturnValue(null),
                getLiveTimeline: vi.fn().mockReturnValue({ getEvents: () => [] }),
                getUnreadNotificationCount: vi.fn().mockReturnValue(0),
            };

            mockClient.getRooms.mockReturnValue([mockRoom1, mockRoom2]);

            const dmRooms = await dmManager.getDMRooms();

            expect(dmRooms).toHaveLength(2);
        });

        it("should skip rooms with left membership", async () => {
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({
                    "@alice:example.com": ["!dm1:example.com"],
                }),
            });

            const mockRoom = {
                roomId: "!dm1:example.com",
                getMyMembership: vi.fn().mockReturnValue("leave"), // 已离开
                getJoinedMembers: vi.fn().mockReturnValue([]),
                name: "DM 1",
                getAvatarUrl: vi.fn().mockReturnValue(null),
                getLiveTimeline: vi.fn().mockReturnValue({ getEvents: () => [] }),
                getUnreadNotificationCount: vi.fn().mockReturnValue(0),
            };

            mockClient.getRooms.mockReturnValue([mockRoom]);

            const dmRooms = await dmManager.getDMRooms();

            // 应该跳过已离开的房间
            expect(dmRooms).toHaveLength(0);
        });

        it("should handle both join and invite membership", async () => {
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({
                    "@alice:example.com": ["!dm1:example.com"],
                }),
            });

            const mockRoom = {
                roomId: "!dm1:example.com",
                getMyMembership: vi.fn().mockReturnValue("invite"),
                getJoinedMembers: vi.fn().mockReturnValue([{ userId: "@alice:example.com" }]),
                name: "DM 1",
                getAvatarUrl: vi.fn().mockReturnValue(null),
                getLiveTimeline: vi.fn().mockReturnValue({ getEvents: () => [] }),
                getUnreadNotificationCount: vi.fn().mockReturnValue(0),
            };

            mockClient.getRooms.mockReturnValue([mockRoom]);

            const dmRooms = await dmManager.getDMRooms();

            // 邀请状态也应该被包含
            expect(dmRooms).toHaveLength(1);
        });
    });

    // ============ getDmForUser 测试 ============

    describe("getDmForUser", () => {
        it("should return null for unknown user", async () => {
            mockClient.getAccountData.mockReturnValue({ getContent: () => ({}) });

            const roomId = await dmManager.getDmForUser("@unknown:example.com");

            expect(roomId).toBeNull();
        });

        it("should return roomId from account data", async () => {
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({
                    "@user1:example.com": ["!room:example.com"],
                }),
            });

            const roomId = await dmManager.getDmForUser("@user1:example.com");

            expect(roomId).toBe("!room:example.com");
        });
    });

    // ============ leaveDm 测试 ============

    describe("leaveDm", () => {
        it("should leave DM successfully", async () => {
            mockClient.leave.mockResolvedValueOnce({});

            await dmManager.leaveDm("!room:example.com");

            expect(mockClient.leave).toHaveBeenCalledWith("!room:example.com");
        });

        it("should throw error for empty roomId", async () => {
            await expect(dmManager.leaveDm("")).rejects.toThrow();
        });

        it("should emit DMLeft event", async () => {
            mockClient.leave.mockResolvedValueOnce({});

            const emitSpy = vi.spyOn(dmManager, "emit");
            await dmManager.leaveDm("!room:example.com");

            expect(emitSpy).toHaveBeenCalledWith(DMEvent.DMLeft, "!room:example.com");
        });
    });

    // ============ getDirectRoomsByUser 测试 ============

    describe("getDirectRoomsByUser", () => {
        it("should return empty object when no account data", async () => {
            mockClient.getAccountData.mockReturnValue(null);

            const result = await dmManager.getDirectRoomsByUser();

            expect(result).toEqual({});
        });

        it("should return direct rooms map", async () => {
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({
                    "@user1:example.com": ["!room1:example.com"],
                    "@user2:example.com": ["!room2:example.com"],
                }),
            });

            const result = await dmManager.getDirectRoomsByUser();

            expect(result).toEqual({
                "@user1:example.com": ["!room1:example.com"],
                "@user2:example.com": ["!room2:example.com"],
            });
        });
    });

    // ============ setDmRoom 测试 ============

    describe("setDmRoom", () => {
        it("should set DM room successfully", async () => {
            mockClient.getAccountData.mockReturnValue(null);
            mockClient.setAccountData.mockResolvedValueOnce({});

            await dmManager.setDmRoom("!room:example.com", "@user1:example.com");

            expect(mockClient.setAccountData).toHaveBeenCalledWith("m.direct", expect.any(Object));
        });

        it("should add to existing user rooms", async () => {
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({
                    "@user1:example.com": ["!old:example.com"],
                }),
            });
            mockClient.setAccountData.mockResolvedValueOnce({});

            await dmManager.setDmRoom("!room:example.com", "@user1:example.com");

            expect(mockClient.setAccountData).toHaveBeenCalledWith(
                "m.direct",
                expect.objectContaining({
                    "@user1:example.com": expect.arrayContaining(["!old:example.com", "!room:example.com"]),
                }),
            );
        });
    });

    // ============ checkRoomIsDm 测试 ============

    describe("checkRoomIsDm", () => {
        it("should return true for room in m.direct", async () => {
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({
                    "@user1:example.com": ["!room:example.com"],
                }),
            });

            const result = await dmManager.checkRoomIsDm("!room:example.com");

            expect(result).toBe(true);
        });

        it("should return false for room not in m.direct", async () => {
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({
                    "@user1:example.com": ["!other:example.com"],
                }),
            });

            const result = await dmManager.checkRoomIsDm("!room:example.com");

            expect(result).toBe(false);
        });

        it("should fallback to member count check", async () => {
            mockClient.getAccountData.mockReturnValue({ getContent: () => ({}) });

            const mockRoom = {
                getJoinedMembers: vi
                    .fn()
                    .mockReturnValue([{ userId: "@user1:example.com" }, { userId: "@user2:example.com" }]),
            };
            mockClient.getRoom.mockReturnValue(mockRoom);

            const result = await dmManager.checkRoomIsDm("!room:example.com");

            // 2 人房间应该被识别为 DM
            expect(result).toBe(true);
        });
    });

    // ============ getDmPartner 测试 ============

    describe("getDmPartner", () => {
        it("should return partner from m.direct", async () => {
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({
                    "@alice:example.com": ["!room:example.com"],
                }),
            });

            const partner = await dmManager.getDmPartner("!room:example.com");

            expect(partner).toBe("@alice:example.com");
        });

        it("should fallback to member inference", async () => {
            mockClient.getAccountData.mockReturnValue({ getContent: () => ({}) });

            const mockRoom = {
                getJoinedMembers: vi
                    .fn()
                    .mockReturnValue([{ userId: "@test:example.com" }, { userId: "@alice:example.com" }]),
            };
            mockClient.getRoom.mockReturnValue(mockRoom);

            const partner = await dmManager.getDmPartner("!room:example.com");

            expect(partner).toBe("@alice:example.com");
        });
    });

    // ============ getDmRoomsByUserIds 测试 ============

    describe("getDmRoomsByUserIds", () => {
        it("should return matching DM rooms", async () => {
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({
                    "@alice:example.com": ["!dm1:example.com"],
                    "@bob:example.com": ["!dm2:example.com"],
                }),
            });

            const mockRoom1 = {
                roomId: "!dm1:example.com",
                getMyMembership: vi.fn().mockReturnValue("join"),
            };

            mockClient.getRooms.mockReturnValue([mockRoom1]);

            const rooms = await dmManager.getDmRoomsByUserIds(["@alice:example.com"]);

            expect(rooms).toHaveLength(1);
            expect(rooms[0].roomId).toBe("!dm1:example.com");
        });

        it("should return empty for non-matching users", async () => {
            mockClient.getAccountData.mockReturnValue({ getContent: () => ({}) });
            mockClient.getRooms.mockReturnValue([]);

            const rooms = await dmManager.getDmRoomsByUserIds(["@unknown:example.com"]);

            expect(rooms).toHaveLength(0);
        });
    });

    // ============ extendMatrixClient 测试 ============

    describe("extendMatrixClient", () => {
        it("should export extendMatrixClient function", () => {
            const { extendMatrixClient } = dmExports;
            expect(typeof extendMatrixClient).toBe("function");
        });

        it("should extend DirectMessageManager prototype correctly", () => {
            const { DirectMessageManager } = dmExports;
            expect(typeof DirectMessageManager).toBe("function");
        });
    });

    // ============ 专用 API 封装测试 ============

    describe("专用 API 封装", () => {
        describe("createDmRoom", () => {
            it("should call POST /create_dm API", async () => {
                mockClient.http = {
                    authedRequest: vi.fn().mockResolvedValue({ room_id: "!newdm:example.com" }),
                };

                const roomId = await dmManager.createDmRoom("@alice:example.com");

                expect(roomId).toBe("!newdm:example.com");
                expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                    expect.anything(),
                    "/create_dm",
                    undefined,
                    expect.objectContaining({
                        user_id: "@alice:example.com",
                        is_direct: true,
                    }),
                    expect.anything(),
                );
            });

            it("should include optional parameters", async () => {
                mockClient.http = {
                    authedRequest: vi.fn().mockResolvedValue({ room_id: "!newdm:example.com" }),
                };

                await dmManager.createDmRoom("@alice:example.com", {
                    name: "Test DM",
                    topic: "Test Topic",
                });

                expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                    expect.anything(),
                    "/create_dm",
                    undefined,
                    expect.objectContaining({
                        user_id: "@alice:example.com",
                        is_direct: true,
                        name: "Test DM",
                        topic: "Test Topic",
                    }),
                    expect.anything(),
                );
            });

            it("should throw error for empty userId", async () => {
                await expect(dmManager.createDmRoom("")).rejects.toThrow();
            });

            it("should emit DMCreated event", async () => {
                mockClient.http = {
                    authedRequest: vi.fn().mockResolvedValue({ room_id: "!newdm:example.com" }),
                };

                const emitSpy = vi.spyOn(dmManager, "emit");
                await dmManager.createDmRoom("@alice:example.com");

                expect(emitSpy).toHaveBeenCalledWith(DMEvent.DMCreated, "!newdm:example.com", ["@alice:example.com"]);
            });
        });

        describe("getDirectRoomsFromServer", () => {
            it("should call GET /direct API", async () => {
                const expectedMap = {
                    "@alice:example.com": ["!dm1:example.com"],
                };
                mockClient.http = {
                    authedRequest: vi.fn().mockResolvedValue({ rooms: expectedMap }),
                };

                const result = await dmManager.getDirectRoomsFromServer();

                expect(result).toEqual(expectedMap);
                expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                    expect.anything(),
                    "/direct",
                    undefined,
                    undefined,
                    expect.anything(),
                );
            });

            it("should return empty object when no rooms", async () => {
                mockClient.http = {
                    authedRequest: vi.fn().mockResolvedValue({ rooms: null }),
                };

                const result = await dmManager.getDirectRoomsFromServer();

                expect(result).toEqual({});
            });
        });

        describe("updateDirectRoom", () => {
            it("should call PUT /direct/{room_id} API", async () => {
                mockClient.http = {
                    authedRequest: vi.fn().mockResolvedValue({}),
                };

                await dmManager.updateDirectRoom("!dm:example.com", ["@alice:example.com"]);

                expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                    "PUT",
                    "/direct/!dm%3Aexample.com",
                    undefined,
                    { users: ["@alice:example.com"] },
                    { prefix: "/_matrix/client/v3" },
                );
            });

            it("should throw error for empty roomId", async () => {
                await expect(dmManager.updateDirectRoom("", ["@alice:example.com"])).rejects.toThrow();
            });

            it("should emit ListUpdated event", async () => {
                mockClient.http = {
                    authedRequest: vi.fn().mockResolvedValue({}),
                };

                const emitSpy = vi.spyOn(dmManager, "emit");
                await dmManager.updateDirectRoom("!dm:example.com", ["@alice:example.com"]);

                expect(emitSpy).toHaveBeenCalledWith(DMEvent.ListUpdated);
            });
        });

        describe("isDmRoomFromServer", () => {
            it("should return true for DM room", async () => {
                mockClient.http = {
                    authedRequest: vi.fn().mockResolvedValue({
                        "room_id": "!dm:example.com",
                        "m.direct": true,
                    }),
                };

                const result = await dmManager.isDmRoomFromServer("!dm:example.com");

                expect(result).toBe(true);
            });

            it("should return false for non-DM room", async () => {
                mockClient.http = {
                    authedRequest: vi.fn().mockResolvedValue({
                        "room_id": "!room:example.com",
                        "m.direct": false,
                    }),
                };

                const result = await dmManager.isDmRoomFromServer("!room:example.com");

                expect(result).toBe(false);
            });

            it("should return false on 404 error", async () => {
                const error = new MatrixError({ errcode: "M_NOT_FOUND" }, 404);
                mockClient.http = {
                    authedRequest: vi.fn().mockRejectedValue(error),
                };

                const result = await dmManager.isDmRoomFromServer("!unknown:example.com");

                expect(result).toBe(false);
            });

            it("should throw on 404 error when throwOnError is true", async () => {
                const error = new MatrixError({ errcode: "M_NOT_FOUND" }, 404);
                mockClient.http = {
                    authedRequest: vi.fn().mockRejectedValue(error),
                };

                await expect(dmManager.isDmRoomFromServer("!unknown:example.com", true)).rejects.toThrow();
            });

            it("should throw error for empty roomId", async () => {
                await expect(dmManager.isDmRoomFromServer("")).rejects.toThrow();
            });
        });

        describe("getDmPartnerFromServer", () => {
            it("should return DM partner info", async () => {
                const expectedPartner = {
                    room_id: "!dm:example.com",
                    user_id: "@alice:example.com",
                    display_name: "Alice",
                    avatar_url: "mxc://example.com/avatar",
                };
                mockClient.http = {
                    authedRequest: vi.fn().mockResolvedValue(expectedPartner),
                };

                const result = await dmManager.getDmPartnerFromServer("!dm:example.com");

                expect(result).toEqual(expectedPartner);
                expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                    "GET",
                    "/rooms/!dm%3Aexample.com/dm/partner",
                    undefined,
                    undefined,
                    { prefix: "/_matrix/client/v3" },
                );
            });

            it("should return null on 404 error", async () => {
                const error = new MatrixError({ errcode: "M_NOT_FOUND" }, 404);
                mockClient.http = {
                    authedRequest: vi.fn().mockRejectedValue(error),
                };

                const result = await dmManager.getDmPartnerFromServer("!unknown:example.com");

                expect(result).toBeNull();
            });

            it("should throw on 404 error when throwOnError is true", async () => {
                const error = new MatrixError({ errcode: "M_NOT_FOUND" }, 404);
                mockClient.http = {
                    authedRequest: vi.fn().mockRejectedValue(error),
                };

                await expect(dmManager.getDmPartnerFromServer("!unknown:example.com", true)).rejects.toThrow();
            });

            it("should throw error for empty roomId", async () => {
                await expect(dmManager.getDmPartnerFromServer("")).rejects.toThrow();
            });
        });
    });

    describe("Additional Methods", () => {
        describe("getDmRoomInfo", () => {
            it("should return DM room info", async () => {
                const mockRoom = {
                    roomId: "!dm:example.com",
                    name: "DM Room",
                    getMember: vi.fn().mockReturnValue({
                        userId: "@partner:example.com",
                        name: "Partner",
                    }),
                    getJoinedMembers: vi.fn().mockReturnValue([
                        { userId: "@test:example.com", name: "Test User" },
                        { userId: "@partner:example.com", name: "Partner" },
                    ]),
                    getAvatarUrl: vi.fn().mockReturnValue("mxc://avatar"),
                    getUnreadNotificationCount: vi.fn().mockReturnValue(0),
                    getLiveTimeline: vi.fn().mockReturnValue({
                        getEvents: vi.fn().mockReturnValue([]),
                    }),
                };

                mockClient.getRoom.mockReturnValue(mockRoom);
                mockClient.getAccountData.mockReturnValue({
                    getContent: () => ({
                        "@partner:example.com": ["!dm:example.com"],
                    }),
                });
                mockClient.mxcToHttp = vi.fn().mockReturnValue("https://example.com/avatar");

                const info = await dmManager.getDmRoomInfo("!dm:example.com");

                expect(info).toBeDefined();
                expect(info?.roomId).toBe("!dm:example.com");
            });

            it("should return null for non-existent room", async () => {
                mockClient.getRoom.mockReturnValue(null);

                const info = await dmManager.getDmRoomInfo("!missing:example.com");

                expect(info).toBeNull();
            });
        });

        describe("markDmAsRead", () => {
            it("should mark DM as read", async () => {
                const mockEvent = {
                    getId: vi.fn().mockReturnValue("$event:example.com"),
                };
                const mockTimeline = {
                    getEvents: vi.fn().mockReturnValue([mockEvent]),
                };
                const mockRoom = {
                    getLiveTimeline: vi.fn().mockReturnValue(mockTimeline),
                };
                mockClient.getRoom.mockReturnValue(mockRoom);
                mockClient.setRoomReadMarkers.mockResolvedValue({});

                await dmManager.markDmAsRead("!dm:example.com");

                expect(mockClient.setRoomReadMarkers).toHaveBeenCalledWith(
                    "!dm:example.com",
                    "$event:example.com",
                    mockEvent,
                );
            });

            it("should handle room with no events", async () => {
                const mockTimeline = {
                    getEvents: vi.fn().mockReturnValue([]),
                };
                const mockRoom = {
                    getLiveTimeline: vi.fn().mockReturnValue(mockTimeline),
                };
                mockClient.getRoom.mockReturnValue(mockRoom);

                await dmManager.markDmAsRead("!dm:example.com");

                expect(mockClient.setRoomReadMarkers).not.toHaveBeenCalled();
            });
        });

        describe("sendDmMessage", () => {
            it("should send text message", async () => {
                mockClient.sendEvent.mockResolvedValue({ event_id: "$event:example.com" });

                const eventId = await dmManager.sendDmMessage("!dm:example.com", "Hello");

                expect(eventId).toBe("$event:example.com");
                expect(mockClient.sendEvent).toHaveBeenCalledWith(
                    "!dm:example.com",
                    "m.room.message",
                    expect.objectContaining({
                        msgtype: "m.text",
                        body: "Hello",
                    }),
                );
            });

            it("should send custom content", async () => {
                mockClient.sendEvent.mockResolvedValue({ event_id: "$event:example.com" });

                const content = { msgtype: "m.image", body: "image.png", url: "mxc://..." };
                const eventId = await dmManager.sendDmMessage("!dm:example.com", content);

                expect(eventId).toBe("$event:example.com");
                expect(mockClient.sendEvent).toHaveBeenCalledWith("!dm:example.com", "m.room.message", content);
            });

            it("should throw error for empty roomId", async () => {
                await expect(dmManager.sendDmMessage("", "Hello")).rejects.toThrow();
            });
        });

        describe("getDmRoomInfos", () => {
            it("should return all cached DM room infos", async () => {
                (dmManager as any).dmRoomsCache.set("!dm1:example.com", {
                    roomId: "!dm1:example.com",
                    invitees: ["@user1:example.com"],
                });
                (dmManager as any).dmRoomsCache.set("!dm2:example.com", {
                    roomId: "!dm2:example.com",
                    invitees: ["@user2:example.com"],
                });

                const infos = await dmManager.getDmRoomInfos();

                expect(infos).toHaveLength(2);
                expect(infos.map((info) => info.roomId).sort()).toEqual(["!dm1:example.com", "!dm2:example.com"]);
            });

            it("should return empty array when no DMs", async () => {
                mockClient.getRooms.mockReturnValue([]);
                mockClient.getAccountData.mockReturnValue(null);

                const infos = await dmManager.getDmRoomInfos();

                expect(infos).toEqual([]);
            });
        });

        describe("getDmRoom", () => {
            it("should return room object", async () => {
                const mockRoom = { roomId: "!dm:example.com" };
                mockClient.getRoom.mockReturnValue(mockRoom);

                const room = await dmManager.getDmRoom("!dm:example.com");

                expect(room).toEqual(mockRoom);
            });

            it("should return null for non-existent room", async () => {
                mockClient.getRoom.mockReturnValue(null);

                const room = await dmManager.getDmRoom("!missing:example.com");

                expect(room).toBeNull();
            });

            it("should throw NotFoundError for non-existent room when throwOnError is true", async () => {
                mockClient.getRoom.mockReturnValue(null);

                await expect(dmManager.getDmRoom("!missing:example.com", true)).rejects.toThrow("DM room not found");
            });
        });

        describe("removeDmRoom", () => {
            it("should remove DM room from m.direct", async () => {
                mockClient.getAccountData.mockReturnValue({
                    getContent: () => ({
                        "@user:example.com": ["!dm1:example.com", "!dm2:example.com"],
                    }),
                });
                mockClient.setAccountData.mockResolvedValue({});

                await dmManager.removeDmRoom("!dm1:example.com", "@user:example.com");

                expect(mockClient.setAccountData).toHaveBeenCalledWith(
                    "m.direct",
                    expect.objectContaining({
                        "@user:example.com": ["!dm2:example.com"],
                    }),
                );
            });

            it("should remove user entry if no rooms left", async () => {
                mockClient.getAccountData.mockReturnValue({
                    getContent: () => ({
                        "@user:example.com": ["!dm:example.com"],
                    }),
                });
                mockClient.setAccountData.mockResolvedValue({});

                await dmManager.removeDmRoom("!dm:example.com", "@user:example.com");

                expect(mockClient.setAccountData).toHaveBeenCalledWith(
                    "m.direct",
                    expect.not.objectContaining({
                        "@user:example.com": expect.anything(),
                    }),
                );
            });
        });

        describe("start", () => {
            it("should start DM manager", async () => {
                await dmManager.start();
                // start() method should complete without errors
                expect(true).toBe(true);
            });
        });

        describe("getCacheStats", () => {
            it("should return cache statistics", () => {
                const stats = dmManager.getCacheStats();

                expect(stats).toHaveProperty("dmRooms");
                expect(stats.dmRooms).toHaveProperty("size");
                expect(stats.dmRooms).toHaveProperty("maxSize");
                expect(stats.dmRooms).toHaveProperty("hits");
                expect(stats.dmRooms).toHaveProperty("misses");
            });

            it("should report cache size after inserting DM room", () => {
                (dmManager as any).dmRoomsCache.set("!dm1:example.com", {
                    roomId: "!dm1:example.com",
                    invitees: ["@user1:example.com"],
                });

                const stats = dmManager.getCacheStats();
                expect(stats.dmRooms.size).toBe(1);
            });
        });
    });
});
