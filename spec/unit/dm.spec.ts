import { describe, it, expect, beforeEach, vi } from "vitest";

import { DirectMessageManager, DMEvent } from "../../src/dm/index";

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
                    "@user1:example.com": ["!room:example.com"]
                })
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
                "@bob:example.com": ["!dm2:example.com", "!dm3:example.com"]
            };
            
            mockClient.getAccountData.mockReturnValue({
                getContent: () => expectedMap
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
                })
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
                    "@user1:example.com": ["!existing:example.com"]
                })
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

            expect(emitSpy).toHaveBeenCalledWith(
                DMEvent.DMCreated,
                "!room:example.com",
                ["@user1:example.com"]
            );
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
                    "@bob:example.com": ["!dm2:example.com"]
                })
            });

            const mockRoom1 = {
                roomId: "!dm1:example.com",
                getMyMembership: vi.fn().mockReturnValue("join"),
                getJoinedMembers: vi.fn().mockReturnValue([
                    { userId: "@test:example.com" },
                    { userId: "@alice:example.com" }
                ]),
                name: "DM 1",
                getAvatarUrl: vi.fn().mockReturnValue(null),
                getLiveTimeline: vi.fn().mockReturnValue({ getEvents: () => [] }),
                getUnreadNotificationCount: vi.fn().mockReturnValue(0)
            };

            const mockRoom2 = {
                roomId: "!dm2:example.com",
                getMyMembership: vi.fn().mockReturnValue("join"),
                getJoinedMembers: vi.fn().mockReturnValue([
                    { userId: "@test:example.com" },
                    { userId: "@bob:example.com" }
                ]),
                name: "DM 2",
                getAvatarUrl: vi.fn().mockReturnValue(null),
                getLiveTimeline: vi.fn().mockReturnValue({ getEvents: () => [] }),
                getUnreadNotificationCount: vi.fn().mockReturnValue(0)
            };

            mockClient.getRooms.mockReturnValue([mockRoom1, mockRoom2]);

            const dmRooms = await dmManager.getDMRooms();

            expect(dmRooms).toHaveLength(2);
        });

        it("should skip rooms with left membership", async () => {
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({
                    "@alice:example.com": ["!dm1:example.com"]
                })
            });

            const mockRoom = {
                roomId: "!dm1:example.com",
                getMyMembership: vi.fn().mockReturnValue("leave"), // 已离开
                getJoinedMembers: vi.fn().mockReturnValue([]),
                name: "DM 1",
                getAvatarUrl: vi.fn().mockReturnValue(null),
                getLiveTimeline: vi.fn().mockReturnValue({ getEvents: () => [] }),
                getUnreadNotificationCount: vi.fn().mockReturnValue(0)
            };

            mockClient.getRooms.mockReturnValue([mockRoom]);

            const dmRooms = await dmManager.getDMRooms();

            // 应该跳过已离开的房间
            expect(dmRooms).toHaveLength(0);
        });

        it("should handle both join and invite membership", async () => {
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({
                    "@alice:example.com": ["!dm1:example.com"]
                })
            });

            const mockRoom = {
                roomId: "!dm1:example.com",
                getMyMembership: vi.fn().mockReturnValue("invite"),
                getJoinedMembers: vi.fn().mockReturnValue([
                    { userId: "@alice:example.com" }
                ]),
                name: "DM 1",
                getAvatarUrl: vi.fn().mockReturnValue(null),
                getLiveTimeline: vi.fn().mockReturnValue({ getEvents: () => [] }),
                getUnreadNotificationCount: vi.fn().mockReturnValue(0)
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
                })
            );
        });
    });

    // ============ checkRoomIsDm 测试 ============

    describe("checkRoomIsDm", () => {
        it("should return true for room in m.direct", async () => {
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({
                    "@user1:example.com": ["!room:example.com"]
                })
            });

            const result = await dmManager.checkRoomIsDm("!room:example.com");

            expect(result).toBe(true);
        });

        it("should return false for room not in m.direct", async () => {
            mockClient.getAccountData.mockReturnValue({
                getContent: () => ({
                    "@user1:example.com": ["!other:example.com"]
                })
            });

            const result = await dmManager.checkRoomIsDm("!room:example.com");

            expect(result).toBe(false);
        });

        it("should fallback to member count check", async () => {
            mockClient.getAccountData.mockReturnValue({ getContent: () => ({}) });

            const mockRoom = {
                getJoinedMembers: vi.fn().mockReturnValue([
                    { userId: "@user1:example.com" },
                    { userId: "@user2:example.com" }
                ])
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
                    "@alice:example.com": ["!room:example.com"]
                })
            });

            const partner = await dmManager.getDmPartner("!room:example.com");

            expect(partner).toBe("@alice:example.com");
        });

        it("should fallback to member inference", async () => {
            mockClient.getAccountData.mockReturnValue({ getContent: () => ({}) });

            const mockRoom = {
                getJoinedMembers: vi.fn().mockReturnValue([
                    { userId: "@test:example.com" },
                    { userId: "@alice:example.com" }
                ])
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
                    "@bob:example.com": ["!dm2:example.com"]
                })
            });

            const mockRoom1 = {
                roomId: "!dm1:example.com",
                getMyMembership: vi.fn().mockReturnValue("join")
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
            const { extendMatrixClient } = require("../../lib/dm/index");
            expect(typeof extendMatrixClient).toBe("function");
        });

        it("should extend DirectMessageManager prototype correctly", () => {
            const { DirectMessageManager } = require("../../lib/dm/index");
            expect(typeof DirectMessageManager).toBe("function");
        });
    });
});