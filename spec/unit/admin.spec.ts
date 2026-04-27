import { describe, it, expect, beforeEach, vi } from "vitest";

import { AdminManager, AdminEvent } from "../../src/admin/index";
import { MatrixError } from "../../src/http-api/errors";
import { AuthError, NotFoundError, ApiError, RetryableError, ValidationError } from "../../src/errors";
import { FetchHttpApi } from "../../src/http-api/fetch";
import { TypedEventEmitter } from "../../src/models/typed-event-emitter";

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

    // ============ URL 组装测试 ============

    describe("URL 组装规则", () => {
        it("应该使用相对路径，不包含前缀", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                users: [],
            });

            await adminManager.getUsers();

            // 验证 authedRequest 被调用
            expect(mockClient.http.authedRequest).toHaveBeenCalled();
            const call = mockClient.http.authedRequest.mock.calls[0];

            // 验证调用参数：path 应该是相对路径，不包含 /_synapse/admin
            const path = call[1];
            expect(path).toBe("/v2/users");
            expect(path).not.toContain("/_synapse/admin");

            // 验证 prefix 是单独传递的
            const opts = call[4];
            expect(opts.prefix).toBe("/_synapse/admin");
        });

        it("应该正确组装 getUser URL", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                user_id: "@user:example.com",
            });

            await adminManager.getUser("@user:example.com");

            const call = mockClient.http.authedRequest.mock.calls[0];
            // 路径应该是相对路径
            expect(call[1]).toBe("/v2/users/%40user%3Aexample.com");
            expect(call[1]).not.toContain("/_synapse/admin");
        });

        it("应该正确组装 getRooms URL", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                rooms: [],
            });

            await adminManager.getRooms(undefined, 10, "test");

            const call = mockClient.http.authedRequest.mock.calls[0];
            expect(call[1]).toBe("/v1/rooms");
            // queryParams should be passed (even if some values are undefined)
            expect(call[2]).toBeDefined();
            expect(call[1]).not.toContain("/_synapse/admin");
        });
    });

    // ============ 新增功能测试 ============

    describe("服务器状态监控", () => {
        it("应该获取服务器状态", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                status: "online",
                uptime: 12345,
            });

            const status = await adminManager.getServerStatus();
            expect(status).toEqual({ status: "online", uptime: 12345 });
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/v1/status",
                {},
                undefined,
                { prefix: "/_synapse/admin" },
            );
        });

        it("应该获取服务器健康状态", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                healthy: true,
                checks: { database: { status: "ok" } },
            });

            const health = await adminManager.getServerHealth();
            expect(health?.healthy).toBe(true);
        });

        it("应该获取服务器信息", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                server_name: "example.com",
                version: "1.0.0",
            });

            const info = await adminManager.getServerInfo();
            expect(info?.server_name).toBe("example.com");
        });
    });

    describe("通知管理", () => {
        it("应该发送服务器通知", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                event_id: "$event123",
            });

            const result = await adminManager.sendServerNotice("@user:example.com", {
                msgtype: "m.text",
                body: "Test notice",
            });

            expect(result.event_id).toBe("$event123");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/v1/send_server_notice",
                {},
                {
                    user_id: "@user:example.com",
                    content: { msgtype: "m.text", body: "Test notice" },
                },
                { prefix: "/_synapse/admin" },
            );
        });

        it("应该获取服务器通知列表", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                notices: [{ event_id: "$event1", user_id: "@user:example.com", content: {}, sent_ts: 123456 }],
                next_token: "token123",
            });

            const result = await adminManager.getServerNotices(10);
            expect(result?.notices).toHaveLength(1);
            expect(result?.next_token).toBe("token123");
        });
    });

    describe("联邦黑名单管理", () => {
        it("应该获取联邦黑名单", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                blacklist: [{ server_name: "evil.com", reason: "spam" }],
            });

            const blacklist = await adminManager.getFederationBlacklist();
            expect(blacklist).toHaveLength(1);
            expect(blacklist[0].server_name).toBe("evil.com");
        });

        it("应该添加服务器到黑名单", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.addToFederationBlacklist("evil.com", "spam");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/v1/federation/blacklist/evil.com",
                {},
                { reason: "spam" },
                { prefix: "/_synapse/admin" },
            );
        });

        it("应该从黑名单移除服务器", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.removeFromFederationBlacklist("evil.com");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "DELETE",
                "/v1/federation/blacklist/evil.com",
                {},
                undefined,
                { prefix: "/_synapse/admin" },
            );
        });

        it("应该断开联邦连接", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.disconnectFederation("server.com");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/v1/federation/destinations/server.com/reset_connection",
                {},
                undefined,
                { prefix: "/_synapse/admin" },
            );
        });
    });

    describe("用户管理扩展", () => {
        it("应该删除单个设备", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.deleteUserDevice("@user:example.com", "DEVICE123");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "DELETE",
                "/v1/users/%40user%3Aexample.com/devices/DEVICE123",
                {},
                undefined,
                { prefix: "/_synapse/admin" },
            );
        });

        it("应该获取账户状态", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                user_id: "@user:example.com",
                exists: true,
                deactivated: false,
            });

            const status = await adminManager.getAccountStatus("@user:example.com");
            expect(status?.exists).toBe(true);
            expect(status?.deactivated).toBe(false);
        });

        it("应该检查管理员状态", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({ admin: true });

            const isAdmin = await adminManager.isAdmin("@admin:example.com");
            expect(isAdmin).toBe(true);
        });

        it("应该覆盖速率限制", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.overrideRateLimit("@user:example.com");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/v1/users/%40user%3Aexample.com/override_ratelimit",
                {},
                undefined,
                { prefix: "/_synapse/admin" },
            );
        });

        it("应该获取速率限制覆盖状态", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({ overridden: true });

            const result = await adminManager.getRateLimitOverride("@user:example.com");
            expect(result?.overridden).toBe(true);
        });

        it("应该删除速率限制覆盖", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.deleteRateLimitOverride("@user:example.com");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "DELETE",
                "/v1/users/%40user%3Aexample.com/override_ratelimit",
                {},
                undefined,
                { prefix: "/_synapse/admin" },
            );
        });
    });

    // ============ 输入验证测试 ============

    describe("输入验证", () => {
        it("应该拒绝空用户 ID", async () => {
            await expect(adminManager.getUser("")).rejects.toThrow(ValidationError);
        });

        it("应该拒绝无效的用户 ID 格式", async () => {
            await expect(adminManager.getUser("invalid-user-id")).rejects.toThrow(ValidationError);
            await expect(adminManager.getUser("@user")).rejects.toThrow(ValidationError);
            await expect(adminManager.getUser("user:example.com")).rejects.toThrow(ValidationError);
        });

        it("应该接受有效的用户 ID", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                user_id: "@alice:example.com",
            });

            await adminManager.getUser("@alice:example.com");
            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });

        it("应该拒绝空房间 ID", async () => {
            await expect(adminManager.getRoom("")).rejects.toThrow(ValidationError);
        });

        it("应该拒绝无效的房间 ID 格式", async () => {
            await expect(adminManager.getRoom("invalid-room-id")).rejects.toThrow(ValidationError);
            await expect(adminManager.getRoom("!room")).rejects.toThrow(ValidationError);
            await expect(adminManager.getRoom("room:example.com")).rejects.toThrow(ValidationError);
        });

        it("应该接受有效的房间 ID", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                room_id: "!abc123:example.com",
            });

            await adminManager.getRoom("!abc123:example.com");
            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });

        it("应该拒绝无效的 limit 值", async () => {
            await expect(adminManager.getUsers(undefined, 0)).rejects.toThrow(ValidationError);
            await expect(adminManager.getUsers(undefined, -1)).rejects.toThrow(ValidationError);
            await expect(adminManager.getUsers(undefined, 10001)).rejects.toThrow(ValidationError);
            await expect(adminManager.getUsers(undefined, 1.5 as any)).rejects.toThrow(ValidationError);
        });

        it("应该接受有效的 limit 值", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({ users: [] });

            await adminManager.getUsers(undefined, 100);
            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });

        it("应该处理特殊字符的用户 ID", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                user_id: "@user_test-123:example.com",
            });

            await adminManager.getUser("@user_test-123:example.com");
            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    // ============ 错误分类测试 ============

    describe("错误分类测试", () => {
        it("应该对 401 响应抛出 AuthError", async () => {
            const matrixError = new MatrixError({ errcode: "M_UNKNOWN_TOKEN", error: "Invalid token" }, 401, undefined);
            mockClient.http.authedRequest.mockRejectedValue(matrixError);

            await expect(adminManager.getUser("@test:localhost")).rejects.toThrow(AuthError);
        });

        it("应该对 401 状态码抛出 AuthError", async () => {
            const matrixError = new MatrixError({ errcode: "M_UNKNOWN", error: "Unauthorized" }, 401, undefined);
            mockClient.http.authedRequest.mockRejectedValue(matrixError);

            await expect(adminManager.getUser("@test:localhost")).rejects.toThrow(AuthError);
        });

        it("应该对 404 响应抛出 NotFoundError", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "User not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValue(matrixError);

            await expect(adminManager.createUser("@test:localhost")).rejects.toThrow(NotFoundError);
        });

        it("应该对其他错误码抛出 ApiError", async () => {
            const matrixError = new MatrixError({ errcode: "M_FORBIDDEN", error: "Forbidden" }, 403, undefined);
            mockClient.http.authedRequest.mockRejectedValue(matrixError);

            await expect(adminManager.getUser("@test:localhost")).rejects.toThrow(ApiError);
        });

        it("应该对 500 错误抛出 RetryableError", async () => {
            const matrixError = new MatrixError(
                { errcode: "M_UNKNOWN", error: "Internal server error" },
                500,
                undefined,
            );
            mockClient.http.authedRequest.mockRejectedValue(matrixError);

            await expect(adminManager.getUser("@test:localhost")).rejects.toThrow(RetryableError);
        });

        it("错误消息应该包含类名", async () => {
            const matrixError = new MatrixError(
                { errcode: "M_UNKNOWN", error: "Something went wrong" },
                500,
                undefined,
            );
            mockClient.http.authedRequest.mockRejectedValue(matrixError);

            await expect(adminManager.getUser("@test:localhost")).rejects.toThrow(/AdminManager/);
        });

        it("错误消息应该包含原始错误信息", async () => {
            const matrixError = new MatrixError({ errcode: "M_FORBIDDEN", error: "Access denied" }, 403, undefined);
            mockClient.http.authedRequest.mockRejectedValue(matrixError);

            await expect(adminManager.getUser("@test:localhost")).rejects.toThrow(/Access denied/);
        });

        it("getUser 在显式兼容模式下遇到 404 应该返回 null", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "User not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValue(matrixError);

            const result = await adminManager.getUser("@nonexistent:example.com", false);
            expect(result).toBeNull();
        });
    });

    // ============ 错误处理测试 ============

    describe("错误处理", () => {
        it("should convert MatrixError to ApiError for non-401/404", async () => {
            const matrixError = new MatrixError({ errcode: "M_FORBIDDEN", error: "Forbidden" }, 403, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(adminManager.getUser("@user:example.com")).rejects.toThrow(ApiError);
        });

        it("getUser should throw for 404 by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "User not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(adminManager.getUser("@nonexistent:example.com")).rejects.toThrow(NotFoundError);
        });

        it("getUser should return null for 404 when throwOnError is false", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "User not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            const result = await adminManager.getUser("@nonexistent:example.com", false);
            expect(result).toBeNull();
        });

        it("getShadowBanStatus should throw by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(adminManager.getShadowBanStatus("@user:example.com")).rejects.toThrow(NotFoundError);
        });

        it("getRateLimit should throw by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(adminManager.getRateLimit("@user:example.com")).rejects.toThrow(NotFoundError);
        });

        it("getRoom should throw by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(adminManager.getRoom("!room:example.com")).rejects.toThrow(NotFoundError);
        });

        it("getServerVersion should throw by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_FORBIDDEN", error: "Forbidden" }, 403, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(adminManager.getServerVersion()).rejects.toThrow(ApiError);
        });

        it("getServerVersion should return fallback when throwOnError is false", async () => {
            const matrixError = new MatrixError({ errcode: "M_FORBIDDEN", error: "Forbidden" }, 403, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(adminManager.getServerVersion(false)).resolves.toEqual({
                server_version: "unknown",
                python_version: "unknown",
            });
        });

        it("getFederationDestination should throw by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(adminManager.getFederationDestination("example.com")).rejects.toThrow(NotFoundError);
        });

        it("getRoomVersion should throw by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(adminManager.getRoomVersion("!room:example.com")).rejects.toThrow(NotFoundError);
        });

        it("getAccountDetails should throw by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(adminManager.getAccountDetails("@user:example.com")).rejects.toThrow(NotFoundError);
        });

        it("getSpace should throw by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(adminManager.getSpace("!space:example.com")).rejects.toThrow(NotFoundError);
        });

        it("whois should throw by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(adminManager.whois("@user:example.com")).rejects.toThrow(NotFoundError);
        });

        it("getRoomStats should throw by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(adminManager.getRoomStats("!room:example.com")).rejects.toThrow(NotFoundError);
        });

        it("getServerConfig should return fallback when throwOnError is false", async () => {
            const matrixError = new MatrixError({ errcode: "M_FORBIDDEN", error: "Forbidden" }, 403, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(adminManager.getServerConfig(false)).resolves.toEqual({});
        });
    });

    // ============ 用户管理测试 ============

    describe("用户管理", () => {
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
            const call = mockClient.http.authedRequest.mock.calls[0];
            expect(call[2]).toHaveProperty("from", "from123");
            expect(call[2]).toHaveProperty("limit", "50");
        });

        it("should get user successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                user_id: "@user1:example.com",
                displayname: "User 1",
            });

            const user = await adminManager.getUser("@user1:example.com");

            expect(user?.user_id).toBe("@user1:example.com");
        });

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

            expect(emitSpy).toHaveBeenCalledWith(AdminEvent.UserCreated, "@newuser:example.com", expect.any(Object));
        });
    });

    // ============ 房间管理测试 ============

    describe("房间管理", () => {
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

            const call = mockClient.http.authedRequest.mock.calls[0];
            expect(call[2]).toHaveProperty("search_term", "test");
        });

        it("should delete room and emit event", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            const emitSpy = vi.spyOn(adminManager, "emit");
            await adminManager.deleteRoom("!room1:example.com");

            expect(emitSpy).toHaveBeenCalledWith(AdminEvent.RoomDeleted, "!room1:example.com");
        });
    });

    // ============ 服务器管理测试 ============

    describe("服务器管理", () => {
        it("should get server stats and cache", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                total_users: 100,
                total_rooms: 50,
            });

            const stats = await adminManager.getServerStats();

            expect(stats.total_users).toBe(100);
            expect(adminManager.getCachedServerStats()?.total_users).toBe(100);
        });

        it("should get server version", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                server_version: "1.0.0",
                python_version: "3.9",
            });

            const version = await adminManager.getServerVersion();

            expect(version.server_version).toBe("1.0.0");
        });
    });

    // ============ extendMatrixClient 测试 ============

    describe("extendMatrixClient", () => {
        it("should export AdminManager class", () => {
            expect(typeof AdminManager).toBe("function");
        });

        it("should have correct prototype methods", () => {
            const manager = new AdminManager({ http: { authedRequest: async () => ({}) } } as any);
            expect(typeof manager.getUsers).toBe("function");
            expect(typeof manager.getUser).toBe("function");
            expect(typeof manager.getRooms).toBe("function");
        });
    });

    // ============ URL 重复前缀检测测试 ============

    describe("URL 重复前缀检测", () => {
        it("getUser 不应该产生重复前缀的 URL", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                user_id: "@user:example.com",
            });

            await adminManager.getUser("@user:example.com");

            // 验证 path 是相对路径，不包含完整 prefix
            const call = mockClient.http.authedRequest.mock.calls[0];
            const path = call[1];
            const opts = call[4];

            // path 不应该包含 _synapse/admin
            expect(path).not.toContain("_synapse/admin");
            // prefix 应该是独立的
            expect(opts.prefix).toBe("/_synapse/admin");

            const httpApi = new FetchHttpApi(new TypedEventEmitter<any, any>(), {
                baseUrl: "http://localhost:28008",
                prefix: "/_matrix/client/v3",
                onlyData: true,
                allowInsecureHttp: true,
            });
            const url = httpApi.getUrl(path, undefined, opts.prefix, "http://localhost:28008");
            expect(url.pathname).toBe("/_synapse/admin/v2/users/%40user%3Aexample.com");
            expect(url.pathname).not.toContain("/_synapse/admin/v1/v2");
        });

        it("getUsers 不应该产生重复前缀的 URL", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                users: [],
            });

            await adminManager.getUsers();

            const call = mockClient.http.authedRequest.mock.calls[0];
            const path = call[1];
            const opts = call[4];

            expect(path).not.toContain("_synapse/admin");
            expect(opts.prefix).toBe("/_synapse/admin");
        });

        it("createUser 不应该产生重复前缀的 URL", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                user_id: "@newuser:example.com",
            });

            await adminManager.createUser("@newuser:example.com", { password: "test" });

            const call = mockClient.http.authedRequest.mock.calls[0];
            const path = call[1];
            const opts = call[4];

            expect(path).not.toContain("_synapse/admin");
            expect(opts.prefix).toBe("/_synapse/admin");
        });

        it("deactivateUser 不应该产生重复前缀的 URL", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.deactivateUser("@user:example.com");

            const call = mockClient.http.authedRequest.mock.calls[0];
            const path = call[1];
            const opts = call[4];

            expect(path).not.toContain("_synapse/admin");
            expect(opts.prefix).toBe("/_synapse/admin");

            const httpApi = new FetchHttpApi(new TypedEventEmitter<any, any>(), {
                baseUrl: "http://localhost:28008",
                prefix: "/_matrix/client/v3",
                onlyData: true,
                allowInsecureHttp: true,
            });
            const url = httpApi.getUrl(path, undefined, opts.prefix, "http://localhost:28008");
            expect(url.pathname).toBe("/_synapse/admin/v1/users/%40user%3Aexample.com/deactivate");
            expect(url.pathname).not.toContain("/_synapse/admin/v1/v1");
        });

        it("deleteRoom 不应该产生重复前缀的 URL", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await adminManager.deleteRoom("!room:example.com");

            const call = mockClient.http.authedRequest.mock.calls[0];
            const path = call[1];
            const opts = call[4];

            expect(path).not.toContain("_synapse/admin");
            expect(opts.prefix).toBe("/_synapse/admin");
        });

        it("getServerStats 不应该产生重复前缀的 URL", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                total_users: 100,
                total_rooms: 50,
            });

            await adminManager.getServerStats();

            const call = mockClient.http.authedRequest.mock.calls[0];
            const path = call[1];
            const opts = call[4];

            expect(path).not.toContain("_synapse/admin");
            expect(opts.prefix).toBe("/_synapse/admin");
        });

        it("getRoomStats 不应该产生重复前缀的 URL", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                room_id: "!room:example.com",
            });

            await adminManager.getRoomStats("!room:example.com");

            const call = mockClient.http.authedRequest.mock.calls[0];
            const path = call[1];
            const opts = call[4];

            expect(path).not.toContain("_synapse/admin");
            expect(opts.prefix).toBe("/_synapse/admin");
        });
    });

    // ============ URL 拼接完整性测试 ============

    describe("URL 拼接完整性", () => {
        it("所有 API 方法都应该传递正确的 prefix", async () => {
            const methodsToTest = [
                { name: "getUsers", call: () => adminManager.getUsers() },
                { name: "getRooms", call: () => adminManager.getRooms() },
                { name: "getServerVersion", call: () => adminManager.getServerVersion() },
                { name: "getServerStats", call: () => adminManager.getServerStats() },
            ];

            for (const { call } of methodsToTest) {
                mockClient.http.authedRequest.mockResolvedValueOnce({});

                await call();

                const callArgs = mockClient.http.authedRequest.mock.calls[0];
                const opts = callArgs[4];

                expect(opts).toBeDefined();
                expect(opts.prefix).toBe("/_synapse/admin");
            }
        });

        it("authedRequest 应该接收正确数量的参数", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({ users: [] });

            await adminManager.getUsers();

            const callArgs = mockClient.http.authedRequest.mock.calls[0];
            // method, path, queryParams, body, opts = 5 个参数
            expect(callArgs.length).toBe(5);
        });
    });
});
