import { describe, it, expect, beforeEach, vi } from "vitest";

import { AdminManager, AdminEvent } from "../../src/admin/index";

describe("AdminManager", () => {
    let mockClient: any;
    let adminManager: AdminManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };
        adminManager = new AdminManager(mockClient);
    });

    // ===== 用户管理 =====

    describe("getUsers", () => {
        it("should get users successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                users: [
                    { user_id: "@user1:example.com", displayname: "User 1" },
                    { user_id: "@user2:example.com", displayname: "User 2" },
                ],
                next_token: "next",
            });

            const result = await adminManager.getUsers();

            expect(result.users).toHaveLength(2);
            expect(result.next_token).toBe("next");
        });

        it("should handle pagination parameters", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({ users: [] });

            await adminManager.getUsers("from123", 50);

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
            // Verify the URL contains the params
            const call = mockClient.http.authedRequest.mock.calls[0];
            expect(call[1]).toContain("from=from123");
            expect(call[1]).toContain("limit=50");
        });

        it("should return empty array on error", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            const result = await adminManager.getUsers();

            expect(result.users).toHaveLength(0);
        });
    });

    describe("getUser", () => {
        it("should get user successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                user_id: "@user1:example.com",
                displayname: "User 1",
            });

            const user = await adminManager.getUser("@user1:example.com");

            expect(user?.user_id).toBe("@user1:example.com");
        });

        it("should return null on error", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            const user = await adminManager.getUser("@user1:example.com");

            expect(user).toBeNull();
        });
    });

    describe("createUser", () => {
        it("should create user successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                user_id: "@newuser:example.com",
                displayname: "New User",
            });

            const user = await adminManager.createUser("@newuser:example.com", {
                password: "password",
                admin: false,
            });

            expect(user?.user_id).toBe("@newuser:example.com");
        });

        it("should emit UserCreated event", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                user_id: "@newuser:example.com",
            });

            const emitSpy = vi.spyOn(adminManager, "emit");
            await adminManager.createUser("@newuser:example.com");

            expect(emitSpy).toHaveBeenCalledWith(
                AdminEvent.UserCreated,
                "@newuser:example.com",
                expect.any(Object)
            );
        });
    });

    describe("deactivateUser", () => {
        it("should deactivate user successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.deactivateUser("@user1:example.com");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });

        it("should emit UserDeactivated event", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            const emitSpy = vi.spyOn(adminManager, "emit");
            await adminManager.deactivateUser("@user1:example.com");

            expect(emitSpy).toHaveBeenCalledWith(
                AdminEvent.UserDeactivated,
                "@user1:example.com"
            );
        });
    });

    describe("resetPassword", () => {
        it("should reset password successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.resetPassword("@user1:example.com", "newpassword");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
            const call = mockClient.http.authedRequest.mock.calls[0];
            expect(call[3]).toHaveProperty("new_password", "newpassword");
        });

        it("should accept logout parameter", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.resetPassword("@user1:example.com", "newpassword", false);

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
            const call = mockClient.http.authedRequest.mock.calls[0];
            expect(call[3]).toHaveProperty("logout_devices", false);
        });
    });

    describe("setAdmin", () => {
        it("should set admin successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.setAdmin("@user1:example.com", true);

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
            const call = mockClient.http.authedRequest.mock.calls[0];
            expect(call[3]).toHaveProperty("admin", true);
        });
    });

    describe("getUserDevices", () => {
        it("should get user devices", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                devices: [{ device_id: "device1" }, { device_id: "device2" }],
            });

            const devices = await adminManager.getUserDevices("@user1:example.com");

            expect(devices).toHaveLength(2);
        });

        it("should return empty array on error", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            const devices = await adminManager.getUserDevices("@user1:example.com");

            expect(devices).toHaveLength(0);
        });
    });

    describe("deleteUserDevices", () => {
        it("should delete user devices", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.deleteUserDevices("@user1:example.com", ["device1", "device2"]);

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    // ===== Shadow Ban =====

    describe("shadowBanUser", () => {
        it("should shadow ban user", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            const emitSpy = vi.spyOn(adminManager, "emit");
            await adminManager.shadowBanUser("@user1:example.com");

            expect(emitSpy).toHaveBeenCalledWith(
                AdminEvent.UserShadowBanned,
                "@user1:example.com"
            );
        });
    });

    describe("unshadowBanUser", () => {
        it("should unshadow ban user", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            const emitSpy = vi.spyOn(adminManager, "emit");
            await adminManager.unshadowBanUser("@user1:example.com");

            expect(emitSpy).toHaveBeenCalledWith(
                AdminEvent.UserUnshadowBanned,
                "@user1:example.com"
            );
        });
    });

    describe("getShadowBanStatus", () => {
        it("should get shadow ban status", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                user_id: "@user1:example.com",
                banned: true,
            });

            const status = await adminManager.getShadowBanStatus("@user1:example.com");

            expect(status?.banned).toBe(true);
        });

        it("should return null on error", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            const status = await adminManager.getShadowBanStatus("@user1:example.com");

            expect(status).toBeNull();
        });
    });

    // ===== Rate Limit =====

    describe("getRateLimit", () => {
        it("should get rate limit", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                messages_per_second: 10,
                burst_count: 100,
            });

            const config = await adminManager.getRateLimit("@user1:example.com");

            expect(config?.messages_per_second).toBe(10);
        });
    });

    describe("setRateLimit", () => {
        it("should set rate limit", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.setRateLimit("@user1:example.com", {
                messages_per_second: 20,
                burst_count: 200,
            });

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    describe("deleteRateLimit", () => {
        it("should delete rate limit", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.deleteRateLimit("@user1:example.com");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    // ===== 房间管理 =====

    describe("getRooms", () => {
        it("should get rooms successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                rooms: [
                    { room_id: "!room1:example.com", name: "Room 1" },
                    { room_id: "!room2:example.com", name: "Room 2" },
                ],
            });

            const result = await adminManager.getRooms();

            expect(result.rooms).toHaveLength(2);
        });

        it("should handle search term", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({ rooms: [] });

            await adminManager.getRooms(undefined, 10, "test");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
            const call = mockClient.http.authedRequest.mock.calls[0];
            expect(call[1]).toContain("search_term=test");
        });
    });

    describe("getRoom", () => {
        it("should get room successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                room_id: "!room1:example.com",
                name: "Test Room",
            });

            const room = await adminManager.getRoom("!room1:example.com");

            expect(room?.room_id).toBe("!room1:example.com");
        });
    });

    describe("deleteRoom", () => {
        it("should delete room", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            const emitSpy = vi.spyOn(adminManager, "emit");
            await adminManager.deleteRoom("!room1:example.com");

            expect(emitSpy).toHaveBeenCalledWith(
                AdminEvent.RoomDeleted,
                "!room1:example.com"
            );
        });

        it("should accept options", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.deleteRoom("!room1:example.com", {
                purge: true,
                force_purge: true,
            });

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
            const call = mockClient.http.authedRequest.mock.calls[0];
            expect(call[3]).toHaveProperty("purge", true);
            expect(call[3]).toHaveProperty("force_purge", true);
        });
    });

    describe("blockRoom", () => {
        it("should block room", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            const emitSpy = vi.spyOn(adminManager, "emit");
            await adminManager.blockRoom("!room1:example.com", true);

            expect(emitSpy).toHaveBeenCalledWith(
                AdminEvent.RoomBlocked,
                "!room1:example.com",
                true
            );
        });
    });

    describe("getRoomMembers", () => {
        it("should get room members", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                members: ["@user1:example.com", "@user2:example.com"],
            });

            const members = await adminManager.getRoomMembers("!room1:example.com");

            expect(members).toHaveLength(2);
        });
    });

    describe("joinRoom", () => {
        it("should join room", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.joinRoom("!room1:example.com", "@user1:example.com");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    // ===== 服务器管理 =====

    describe("getServerVersion", () => {
        it("should get server version", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                server_version: "1.0.0",
                python_version: "3.9",
            });

            const version = await adminManager.getServerVersion();

            expect(version.server_version).toBe("1.0.0");
        });

        it("should return defaults on error", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            const version = await adminManager.getServerVersion();

            expect(version.server_version).toBe("unknown");
        });
    });

    describe("getServerStats", () => {
        it("should get server stats", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                total_users: 100,
                total_rooms: 50,
            });

            const stats = await adminManager.getServerStats();

            expect(stats.total_users).toBe(100);
        });

        it("should emit ServerStatsUpdated event", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            const emitSpy = vi.spyOn(adminManager, "emit");
            await adminManager.getServerStats();

            expect(emitSpy).toHaveBeenCalledWith(
                AdminEvent.ServerStatsUpdated,
                expect.any(Object)
            );
        });
    });

    describe("getServerConfig", () => {
        it("should get server config", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                max_upload_size: 50000000,
            });

            const config = await adminManager.getServerConfig();

            expect(config.max_upload_size).toBe(50000000);
        });
    });

    // ===== 注册令牌 =====

    describe("getRegistrationTokens", () => {
        it("should get registration tokens", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                registration_tokens: [{ token: "token1" }],
            });

            const tokens = await adminManager.getRegistrationTokens();

            expect(tokens).toHaveLength(1);
        });
    });

    describe("createRegistrationToken", () => {
        it("should create registration token", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                token: "newtoken",
            });

            const token = await adminManager.createRegistrationToken({
                uses_allowed: 10,
            });

            expect(token?.token).toBe("newtoken");
        });
    });

    describe("updateRegistrationToken", () => {
        it("should update registration token", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.updateRegistrationToken("token1", {
                uses_allowed: 20,
            });

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    describe("deleteRegistrationToken", () => {
        it("should delete registration token", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.deleteRegistrationToken("token1");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    // ===== 联邦管理 =====

    describe("getFederationDestinations", () => {
        it("should get federation destinations", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                destinations: [{ destination: "example.org" }],
            });

            const destinations = await adminManager.getFederationDestinations();

            expect(destinations).toHaveLength(1);
        });

        it("should return empty array on error", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            const destinations = await adminManager.getFederationDestinations();

            expect(destinations).toHaveLength(0);
        });
    });

    describe("getFederationDestination", () => {
        it("should get federation destination", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                destination: "example.org",
                retry_last_ts: 1234567890,
            });

            const destination = await adminManager.getFederationDestination("example.org");

            expect(destination?.destination).toBe("example.org");
        });

        it("should return null on error", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            const destination = await adminManager.getFederationDestination("example.org");

            expect(destination).toBeNull();
        });
    });

    describe("resetFederationConnection", () => {
        it("should reset federation connection", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.resetFederationConnection("example.org");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });

        it("should emit AdminError on error", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            const emitSpy = vi.spyOn(adminManager, "emit");
            await expect(adminManager.resetFederationConnection("example.org")).rejects.toThrow();
        });
    });

    // ===== 媒体管理 =====

    describe("getMedia", () => {
        it("should get media", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                media: [{ media_id: "media1" }],
            });

            const result = await adminManager.getMedia();

            expect(result.media).toHaveLength(1);
        });

        it("should handle pagination", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({ media: [] });

            await adminManager.getMedia(50, "from123");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
            const call = mockClient.http.authedRequest.mock.calls[0];
            expect(call[1]).toContain("limit=50");
            expect(call[1]).toContain("from=from123");
        });

        it("should return empty on error", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            const result = await adminManager.getMedia();

            expect(result.media).toHaveLength(0);
        });
    });

    describe("deleteMedia", () => {
        it("should delete media", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.deleteMedia("media1");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });

        it("should emit AdminError on error", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            const emitSpy = vi.spyOn(adminManager, "emit");
            await expect(adminManager.deleteMedia("media1")).rejects.toThrow();
        });
    });

    describe("quarantineMedia", () => {
        it("should quarantine media", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.quarantineMedia("media1");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    describe("purgeMediaCache", () => {
        it("should purge media cache", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({ deleted: 10 });

            const result = await adminManager.purgeMediaCache();

            expect(result.deleted).toBe(10);
        });

        it("should accept timestamp", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({ deleted: 5 });

            await adminManager.purgeMediaCache(1234567890000);

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });

        it("should return 0 on error", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            const result = await adminManager.purgeMediaCache();

            expect(result.deleted).toBe(0);
        });
    });

    // ===== 便捷方法 =====

    describe("getCachedServerStats", () => {
        it("should return null initially", () => {
            const stats = adminManager.getCachedServerStats();
            expect(stats).toBeNull();
        });

        it("should return cached stats after fetch", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                total_users: 100,
                total_rooms: 50,
            });

            await adminManager.getServerStats();
            const stats = adminManager.getCachedServerStats();

            expect(stats?.total_users).toBe(100);
        });
    });

    describe("whois", () => {
        it("should get user whois info", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                user_id: "@user1:example.com",
                devices: ["device1"],
            });

            const whois = await adminManager.whois("@user1:example.com");

            expect(whois.user_id).toBe("@user1:example.com");
        });

        it("should return null on error", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            const whois = await adminManager.whois("@user1:example.com");

            expect(whois).toBeNull();
        });
    });

    describe("makeRoomAdmin", () => {
        it("should make user room admin", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.makeRoomAdmin("!room:example.com", "@user1:example.com");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
            const call = mockClient.http.authedRequest.mock.calls[0];
            expect(call[3]).toHaveProperty("user_id", "@user1:example.com");
        });

        it("should work without userId", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.makeRoomAdmin("!room:example.com");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });

        it("should emit AdminError on error", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            const emitSpy = vi.spyOn(adminManager, "emit");
            await expect(adminManager.makeRoomAdmin("!room:example.com")).rejects.toThrow();
        });
    });

    describe("start", () => {
        it("should start the admin manager", () => {
            adminManager.start();
            expect(adminManager).toBeDefined();
        });
    });

    describe("stop", () => {
        it("should stop the admin manager", () => {
            adminManager.stop();
            const stats = adminManager.getCachedServerStats();
            expect(stats).toBeNull();
        });
    });
});
