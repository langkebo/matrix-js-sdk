import { describe, it, expect, beforeEach, vi } from "vitest";

import { AdminManager } from "../../src/admin/index";
import { NotFoundError, ValidationError } from "../../src/errors";
import { MatrixError } from "../../src/http-api/errors";

describe("AdminManager extended endpoints (retention/audit/feature-flags/federation)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: AdminManager;
    let req: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        req = vi.fn().mockResolvedValue({});
        mockClient = { http: { authedRequest: req } };
        manager = new AdminManager(mockClient);
    });

    // --------- retention ---------
    describe("retention", () => {
        it("getRetentionPolicy GETs /v1/retention/policy", async () => {
            await manager.getRetentionPolicy();
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/retention/policy");
            expect(req.mock.calls[0][4]).toMatchObject({ prefix: "/_synapse/admin/v1" });
        });

        it("setRetentionPolicy POSTs body unchanged", async () => {
            await manager.setRetentionPolicy({ max_lifetime: 3600 });
            expect(req.mock.calls[0][3]).toEqual({ max_lifetime: 3600 });
        });

        it("getRoomRetentionPolicy validates room ID", async () => {
            await expect(manager.getRoomRetentionPolicy("bad")).rejects.toThrow(ValidationError);
        });

        it("setRoomRetentionPolicy POSTs room-scoped policy to the typed route", async () => {
            await manager.setRoomRetentionPolicy("!room:x", { min_lifetime: 60_000, max_lifetime: 86_400_000 });
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe(`/retention/policy/${encodeURIComponent("!room:x")}`);
            expect(req.mock.calls[0][3]).toEqual({ min_lifetime: 60_000, max_lifetime: 86_400_000 });
        });

        it("runRetention POSTs {room_id}", async () => {
            await manager.runRetention({ room_id: "!r:x" });
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/retention/run");
            expect(req.mock.calls[0][3]).toEqual({ room_id: "!r:x" });
        });

        it("getRetentionStatus GETs /v1/retention/status", async () => {
            await manager.getRetentionStatus();
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/retention/status");
            expect(req.mock.calls[0][4]).toMatchObject({ prefix: "/_synapse/admin/v1" });
        });
    });

    // --------- audit ---------
    describe("audit events", () => {
        it("listAuditEvents encodes params as query strings", async () => {
            req.mockResolvedValue({ events: [], total: 0, next_token: null });
            await manager.listAuditEvents({ actor_id: "@a:x", limit: 50 });
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/audit/events");
            expect(req.mock.calls[0][2]).toEqual({ actor_id: "@a:x", limit: "50" });
        });

        it("getAuditEvent requires eventId", async () => {
            await expect(manager.getAuditEvent("")).rejects.toThrow(ValidationError);
        });

        it("createAuditEvent POSTs full body", async () => {
            await manager.createAuditEvent({
                actor_id: "@a:x",
                action: "login",
                resource_type: "user",
                resource_id: "@a:x",
                result: "success",
                request_id: "r1",
            });
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][3]).toMatchObject({ action: "login" });
        });
    });

    // --------- feature flags ---------
    describe("feature flags", () => {
        it("listFeatureFlags filters undefined values out of query", async () => {
            req.mockResolvedValue({ flags: [], total: 0 });
            await manager.listFeatureFlags({ status: "enabled", limit: 10 });
            expect(req.mock.calls[0][2]).toEqual({ status: "enabled", limit: "10" });
        });

        it("updateFeatureFlag uses PATCH", async () => {
            await manager.updateFeatureFlag("flag1", { rollout_percent: 50 });
            expect(req.mock.calls[0][0]).toBe("PATCH");
            expect(req.mock.calls[0][1]).toBe("/feature-flags/flag1");
            expect(req.mock.calls[0][3]).toEqual({ rollout_percent: 50 });
        });
    });

    // --------- federation resolve/rewrite ---------
    describe("federation resolve/rewrite", () => {
        it("resolveFederation POSTs {server_name}", async () => {
            await manager.resolveFederation("example.org");
            expect(req.mock.calls[0][1]).toBe("/federation/resolve");
            expect(req.mock.calls[0][3]).toEqual({ server_name: "example.org" });
        });

        it("rewriteFederation POSTs {from,to}", async () => {
            await manager.rewriteFederation("a.tld", "b.tld");
            expect(req.mock.calls[0][3]).toEqual({ from: "a.tld", to: "b.tld" });
        });

        it("rewriteFederation validates both args", async () => {
            await expect(manager.rewriteFederation("", "b")).rejects.toThrow(ValidationError);
            await expect(manager.rewriteFederation("a", "")).rejects.toThrow(ValidationError);
        });

        it("confirmFederation POSTs {server_name, accept} to /v1/federation/confirm", async () => {
            // 回归守卫：后端 ConfirmRequest 带 deny_unknown_fields，字段是 {server_name, accept}；
            // 旧签名发 {server_name, action, reason} ⇒ accept 缺失 + 两个未知字段 ⇒ 必然 400。
            await manager.confirmFederation("example.org", true);
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/federation/confirm");
            expect(req.mock.calls[0][3]).toEqual({ server_name: "example.org", accept: true });
            expect(req.mock.calls[0][3]).not.toHaveProperty("action");
        });

        it("confirmFederation rejects an empty server name", async () => {
            await expect(manager.confirmFederation("", true)).rejects.toThrow(ValidationError);
        });
    });

    // --------- federation destinations detail ---------
    describe("federation destinations detail", () => {
        it("deleteFederationDestination uses DELETE", async () => {
            await manager.deleteFederationDestination("example.org");
            expect(req.mock.calls[0][0]).toBe("DELETE");
            expect(req.mock.calls[0][1]).toBe("/federation/destinations/example.org");
        });

        it("getFederationDestinationRooms passes from+limit", async () => {
            req.mockResolvedValue({ rooms: [] });
            await manager.getFederationDestinationRooms("example.org", { from: 10, limit: 5 });
            expect(req.mock.calls[0][1]).toBe("/federation/destinations/example.org/rooms");
            expect(req.mock.calls[0][2]).toEqual({ from: "10", limit: "5" });
        });

        it("resetFederationDestination prefers /reset path", async () => {
            await manager.resetFederationDestination("example.org");
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/federation/destinations/example.org/reset");
        });

        it("resetFederationDestination falls back to /reset_connection on 404", async () => {
            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            req.mockResolvedValueOnce({});
            await manager.resetFederationDestination("example.org");
            expect(req.mock.calls[0][1]).toBe("/federation/destinations/example.org/reset");
            expect(req.mock.calls[1][1]).toBe("/federation/destinations/example.org/reset_connection");
        });
    });

    // --------- federation cache ---------
    describe("federation cache", () => {
        it("getFederationCache GETs /v1/federation/cache", async () => {
            await manager.getFederationCache();
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/federation/cache");
            expect(req.mock.calls[0][4]).toMatchObject({ prefix: "/_synapse/admin/v1" });
        });

        it("clearFederationCache POSTs to /v1/federation/cache/clear", async () => {
            await manager.clearFederationCache();
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/federation/cache/clear");
            expect(req.mock.calls[0][4]).toMatchObject({ prefix: "/_synapse/admin/v1" });
        });

        it("deleteFederationCacheEntry DELETEs /v1/federation/cache/{key}", async () => {
            await manager.deleteFederationCacheEntry("example.com");
            expect(req.mock.calls[0][0]).toBe("DELETE");
            expect(req.mock.calls[0][1]).toBe("/federation/cache/example.com");
            expect(req.mock.calls[0][4]).toMatchObject({ prefix: "/_synapse/admin/v1" });
        });

        it("deleteFederationCacheEntry validates key", async () => {
            await expect(manager.deleteFederationCacheEntry("")).rejects.toThrow(ValidationError);
        });
    });

    describe("federation pending/admission compatibility", () => {
        it("getFederationAdmissionList reads the real `servers` key from /v1/federation/pending", async () => {
            // 回归守卫：后端返回 {servers, total, limit, next_batch}；旧实现读
            // `admissions` / `pending` 两个从不存在的键 ⇒ 恒返回 []。
            req.mockResolvedValueOnce({
                servers: [{ server_name: "example.org", failure_count: 0, status: "pending" }],
                total: 1,
                limit: 100,
                next_batch: null,
            });
            const result = await manager.getFederationAdmissionList();
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/federation/pending");
            expect(result).toEqual([{ server_name: "example.org", failure_count: 0, status: "pending" }]);
        });

        it("getFederationAdmissionList does NOT fall back on 404", async () => {
            // `/federation/admissions` 回退已删除：后端从未注册该路径，留着只会把
            // 一个 404 变成另一个 404（由 quality:path-contract 门禁发现）。
            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            await expect(manager.getFederationAdmissionList()).rejects.toThrow(NotFoundError);
            expect(req.mock.calls).toHaveLength(1);
            expect(req.mock.calls[0][1]).toBe("/federation/pending");
        });

        it("getPendingFederationServers uses /v1/federation/pending with pagination", async () => {
            req.mockResolvedValueOnce({ pending_servers: [], total: 0 });
            await manager.getPendingFederationServers("10", 20);
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/federation/pending");
            expect(req.mock.calls[0][2]).toEqual({ from: "10", limit: "20" });
        });

        it("getPendingFederationServers does NOT fall back on 404", async () => {
            // `/federation/pending_servers` 回退已删除：后端只注册 `/federation/pending`。
            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            await expect(manager.getPendingFederationServers("1", 5)).rejects.toThrow(NotFoundError);
            expect(req.mock.calls).toHaveLength(1);
            expect(req.mock.calls[0][1]).toBe("/federation/pending");
            expect(req.mock.calls[0][2]).toEqual({ from: "1", limit: "5" });
        });
    });

    // --------- event-report rate-limit ---------
    describe("event report rate limit", () => {
        it("block sends {blocked_until, reason}", async () => {
            await manager.blockEventReportUser("@a:x", { blocked_until: 123, reason: "spam" });
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][3]).toEqual({ blocked_until: 123, reason: "spam" });
        });

        it("unblock uses POST without body", async () => {
            await manager.unblockEventReportUser("@a:x");
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/event_reports/rate_limit/%40a%3Ax/unblock");
        });
    });

    // --------- telemetry alerts ---------
    describe("telemetry alerts", () => {
        it("acknowledgeTelemetryAlert POSTs to /ack", async () => {
            await manager.acknowledgeTelemetryAlert("alert-1");
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/telemetry/alerts/alert-1/ack");
        });
    });

    // --------- modules ---------
    describe("modules admin", () => {
        it("listModules passes pagination query", async () => {
            await manager.listModules({ limit: 10, from: "cursor-1" });
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/modules");
            expect(req.mock.calls[0][2]).toEqual({ limit: "10", from: "cursor-1" });
        });

        it("listModulesByType uses the typed route path", async () => {
            await manager.listModulesByType("spam_check");
            expect(req.mock.calls[0][1]).toBe("/modules/type/spam_check");
        });

        it("updateModuleConfig uses PUT with {config}", async () => {
            await manager.updateModuleConfig("mod1", { level: "strict" });
            expect(req.mock.calls[0][0]).toBe("PUT");
            expect(req.mock.calls[0][1]).toBe("/modules/mod1/config");
            expect(req.mock.calls[0][3]).toEqual({ config: { level: "strict" } });
        });

        it("setModuleEnabled posts {enabled}", async () => {
            await manager.setModuleEnabled("mod1", true);
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/modules/mod1/enable");
            expect(req.mock.calls[0][3]).toEqual({ is_enabled: true });
        });

        it("getModuleLogs uses /modules/logs/{module_name} and applies limit+from query", async () => {
            await manager.getModuleLogs("mod1", { limit: 20, from: 3 });
            // 后端只注册 `GET /_synapse/admin/v1/modules/logs/{module_name}`，
            // 旧的 `/modules/{module_name}/logs` 段序错误，已修正。
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/modules/logs/mod1");
            expect(req.mock.calls[0][2]).toEqual({ limit: "20", from: "3" });
        });

        it("covers module checks and module-adjacent callback routes", async () => {
            await manager.checkModuleThirdPartyRule({
                event_id: "$e1",
                room_id: "!r:x",
                sender: "@a:x",
                event_type: "m.room.message",
                content: {},
                state_events: [],
            });
            await manager.getModuleSpamCheckResult("$e2");
            await manager.listModuleSpamChecksBySender("@alice:x", { limit: 5 });
            await manager.getModuleThirdPartyRuleResults("$e3");
            await manager.createAccountValidity({ user_id: "@u:x", expiration_ts: 1 });
            await manager.getAccountValidity("@u:x");
            await manager.renewAccountValidity("@u:x", { renewal_token: "t", new_expiration_ts: 2 });
            await manager.listPasswordAuthProviders();
            await manager.createPasswordAuthProvider({ provider_name: "p1", provider_type: "ldap", config: {} });
            await manager.listPresenceRoutes();
            await manager.createPresenceRoute({ route_name: "r1", route_type: "remote", config: {} });
            await manager.listMediaCallbacks();
            await manager.listMediaCallbacksByType("upload");
            await manager.createMediaCallback({ callback_name: "c1", callback_type: "upload", url: "https://x" });
            await manager.listRateLimitCallbacks();
            await manager.createRateLimitCallback({ callback_name: "rl1", callback_type: "login", config: {} });
            await manager.listAccountDataCallbacks();
            await manager.createAccountDataCallback({ callback_name: "ad1", callback_type: "m.tag", config: {} });

            expect(req.mock.calls[0][1]).toBe("/modules/check_third_party_rule");
            expect(req.mock.calls[1][1]).toBe("/modules/spam_check/%24e2");
            expect(req.mock.calls[2][1]).toBe("/modules/spam_check/sender/%40alice%3Ax");
            expect(req.mock.calls[2][2]).toEqual({ limit: "5" });
            expect(req.mock.calls[3][1]).toBe("/modules/third_party_rule/%24e3");
            expect(req.mock.calls[4][1]).toBe("/account_validity");
            expect(req.mock.calls[5][1]).toBe("/account_validity/%40u%3Ax");
            expect(req.mock.calls[6][1]).toBe("/account_validity/%40u%3Ax/renew");
            expect(req.mock.calls[7][1]).toBe("/password_auth_providers");
            expect(req.mock.calls[8][1]).toBe("/password_auth_providers");
            expect(req.mock.calls[9][1]).toBe("/presence_routes");
            expect(req.mock.calls[10][1]).toBe("/presence_routes");
            expect(req.mock.calls[11][1]).toBe("/media_callbacks");
            expect(req.mock.calls[12][1]).toBe("/media_callbacks/upload");
            expect(req.mock.calls[13][1]).toBe("/media_callbacks");
            expect(req.mock.calls[14][1]).toBe("/rate_limit_callbacks");
            expect(req.mock.calls[15][1]).toBe("/rate_limit_callbacks");
            expect(req.mock.calls[16][1]).toBe("/account_data_callbacks");
            expect(req.mock.calls[17][1]).toBe("/account_data_callbacks");
        });
    });

    // --------- server config adjacents / cleanup ---------
    describe("server side helper routes", () => {
        it("reads invite allowlist, blocklist and jitsi config from v1 server routes", async () => {
            await manager.getInviteAllowlist();
            await manager.getInviteBlocklist();
            await manager.getJitsiConfig();

            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/invite/allowlist");
            expect(req.mock.calls[1][1]).toBe("/invite/blocklist");
            expect(req.mock.calls[2][1]).toBe("/jitsi/config");
        });

        it("posts cleanupAll and cleanupTokens to v1 cleanup routes", async () => {
            await manager.cleanupAll();
            await manager.cleanupTokens();

            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/cleanup/all");
            expect(req.mock.calls[1][1]).toBe("/cleanup/tokens");
        });

        it("cleanupRooms prefers /v1/rooms/cleanup and falls back to /v1/cleanup/rooms on 404", async () => {
            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            req.mockResolvedValueOnce({});
            // 后端 `cleanup_rooms` 只读 `min_age_ms`（`limit` 会被静默忽略），
            // 夹具原先写的 `{limit: 100}` 是在断言一个后端不存在的参数。
            await manager.cleanupRooms({ min_age_ms: 86_400_000 });
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/rooms/cleanup");
            expect(req.mock.calls[0][3]).toEqual({ min_age_ms: 86_400_000 });
            expect(req.mock.calls[1][1]).toBe("/cleanup/rooms");
            expect(req.mock.calls[1][3]).toEqual({ min_age_ms: 86_400_000 });
        });

        it("purgeRoom/shutdownRoom post to room maintenance routes", async () => {
            await manager.purgeRoom({ room_id: "!room:example.com" });
            // 后端 shutdown_room 只读 `room_id`（`new_room_user_id` 等一律忽略）。
            await manager.shutdownRoom({ room_id: "!room:example.com" });
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/purge_room");
            expect(req.mock.calls[0][3]).toEqual({ room_id: "!room:example.com" });
            expect(req.mock.calls[1][0]).toBe("POST");
            expect(req.mock.calls[1][1]).toBe("/shutdown_room");
        });

        it("purgeHistory/restartServer post to server maintenance routes", async () => {
            await manager.purgeHistory({ room_id: "!room:example.com", purge_up_to_ts: 123 });
            await manager.restartServer({ timeout_ms: 500 });
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/purge_history");
            expect(req.mock.calls[0][3]).toEqual({ room_id: "!room:example.com", purge_up_to_ts: 123 });
            expect(req.mock.calls[1][0]).toBe("POST");
            expect(req.mock.calls[1][1]).toBe("/restart");
            expect(req.mock.calls[1][3]).toEqual({ timeout_ms: 500 });
        });

        it("getServerHealth uses /v1/health and does NOT fall back on 404", async () => {
            // `/server_health` 回退已删除：后端只注册 `GET /_synapse/admin/v1/health`。
            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            await expect(manager.getServerHealth()).rejects.toThrow(NotFoundError);
            expect(req.mock.calls).toHaveLength(1);
            expect(req.mock.calls[0][1]).toBe("/health");
        });

        it("getServerInfo uses the UNVERSIONED prefix (/_synapse/admin + /info)", async () => {
            // 后端注册的是**无 v1 段**的 `GET /_synapse/admin/info`。
            // 若走 adminRequest（前缀恒为 /_synapse/admin/v1），会拼成
            // `/_synapse/admin/v1/info` → 必 404。故必须走 v2Request。
            // `/server_info` 回退也已删除（后端从未注册）。
            req.mockResolvedValueOnce({ server_name: "example.org" });
            const result = await manager.getServerInfo();
            expect(req.mock.calls).toHaveLength(1);
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/info");
            expect(req.mock.calls[0][4]).toMatchObject({ prefix: "/_synapse/admin" });
            expect(result).toEqual({ server_name: "example.org" });
        });

        it("getAdminInfo uses the UNVERSIONED prefix (/_synapse/admin + /info)", async () => {
            await manager.getAdminInfo();
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/info");
            expect(req.mock.calls[0][4]).toMatchObject({ prefix: "/_synapse/admin" });
        });
    });

    describe("notifications and pushers", () => {
        it("listNotifications uses GET /v1/notifications with pagination", async () => {
            // 回归守卫：游标键是 next_batch（后端 list_notifications），不是 next_token
            req.mockResolvedValueOnce({ notifications: [], next_batch: "n1" });
            const result = await manager.listNotifications("10", 20);
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/notifications");
            expect(req.mock.calls[0][2]).toEqual({ from: "10", limit: "20" });
            expect(result).toEqual({ notifications: [], next_batch: "n1" });
            expect(result).not.toHaveProperty("next_token");
        });

        it("create/get/update/deactivate/delete notification routes are correct", async () => {
            await manager.createNotification({ type: "maintenance" });
            await manager.getNotification("notice1");
            await manager.updateNotification("notice1", { content: "updated" });
            await manager.deactivateNotification("notice1");
            await manager.deleteNotification("notice1");

            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/notifications");
            expect(req.mock.calls[1][1]).toBe("/notifications/notice1");
            expect(req.mock.calls[2][0]).toBe("PUT");
            expect(req.mock.calls[2][1]).toBe("/notifications/notice1");
            expect(req.mock.calls[3][1]).toBe("/notifications/notice1/deactivate");
            expect(req.mock.calls[4][0]).toBe("DELETE");
            expect(req.mock.calls[4][1]).toBe("/notifications/notice1");
        });

        it("listActiveNotifications uses GET /v1/notifications/active", async () => {
            // ⚠️ 后端 `notification.rs::list_active_notifications` 是 `Ok(Json(json!(notifications)))`
            // —— 顶层就是**数组**（元素是 `ServerNotification`）。旧 mock 造了
            // `{notifications: [...]}` 并断言解包结果 —— 第 9 次「mock 自造形状 + 断言该形状」：
            // 真实响应下 `response.notifications` 恒为 `undefined`，该方法**永远返回空数组**。
            req.mockResolvedValueOnce([{ id: 1, title: "n1" }]);
            const result = await manager.listActiveNotifications();
            expect(req.mock.calls[0][1]).toBe("/notifications/active");
            expect(result).toEqual([{ id: 1, title: "n1" }]);
        });

        it("getUserNotification/setUserNotification use user route", async () => {
            await manager.getUserNotification("@u:x");
            await manager.setUserNotification("@u:x", { enabled: false });
            expect(req.mock.calls[0][1]).toBe("/users/%40u%3Ax/notification");
            expect(req.mock.calls[1][0]).toBe("PUT");
            expect(req.mock.calls[1][1]).toBe("/users/%40u%3Ax/notification");
            // 线上字段是 is_enabled（后端 UserNotificationRequest 带 deny_unknown_fields）；
            // 方法签名保留 {enabled} 并在此映射。
            expect(req.mock.calls[1][3]).toEqual({ is_enabled: false });
        });

        it("getUserPushers/deleteUserPusher use pusher routes", async () => {
            req.mockResolvedValueOnce({ pushers: [{ pushkey: "p1", app_id: "a1" }] });
            const result = await manager.getUserPushers("@u:x");
            await manager.deleteUserPusher("@u:x", "p1");
            expect(req.mock.calls[0][1]).toBe("/users/%40u%3Ax/pushers");
            expect(req.mock.calls[1][0]).toBe("DELETE");
            expect(req.mock.calls[1][1]).toBe("/users/%40u%3Ax/pushers/p1");
            expect(result.pushers).toHaveLength(1);
        });

        it("validates notification id and pushkey", async () => {
            await expect(manager.getNotification("")).rejects.toThrow(ValidationError);
            await expect(manager.updateNotification("", {})).rejects.toThrow(ValidationError);
            await expect(manager.deactivateNotification("")).rejects.toThrow(ValidationError);
            await expect(manager.deleteNotification("")).rejects.toThrow(ValidationError);
            await expect(manager.deleteUserPusher("@u:x", "")).rejects.toThrow(ValidationError);
        });
    });

    describe("server notices detail", () => {
        it("getServerNotice uses GET /v1/server_notices/{notice_id}", async () => {
            await manager.getServerNotice("notice-1");
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/server_notices/notice-1");
        });

        it("getServerNotice validates notice id", async () => {
            await expect(manager.getServerNotice("")).rejects.toThrow(ValidationError);
        });
    });

    describe("spaces", () => {
        it("list/get/delete space routes are correct", async () => {
            await manager.listSpaces("5", 10);
            await manager.getSpace("!space:example.com");
            await manager.deleteSpace("!space:example.com");
            expect(req.mock.calls[0][1]).toBe("/spaces");
            expect(req.mock.calls[0][2]).toEqual({ from: "5", limit: "10" });
            expect(req.mock.calls[1][1]).toBe(`/spaces/${encodeURIComponent("!space:example.com")}`);
            expect(req.mock.calls[2][0]).toBe("DELETE");
            expect(req.mock.calls[2][1]).toBe(`/spaces/${encodeURIComponent("!space:example.com")}`);
        });

        it("space rooms/stats/users routes are correct", async () => {
            await manager.getSpaceRooms("!space:example.com", "1", 20);
            await manager.getSpaceStats("!space:example.com");
            await manager.getSpaceUsers("!space:example.com", "2", 30);
            expect(req.mock.calls[0][1]).toBe(`/spaces/${encodeURIComponent("!space:example.com")}/rooms`);
            expect(req.mock.calls[0][2]).toEqual({ from: "1", limit: "20" });
            expect(req.mock.calls[1][1]).toBe(`/spaces/${encodeURIComponent("!space:example.com")}/stats`);
            expect(req.mock.calls[2][1]).toBe(`/spaces/${encodeURIComponent("!space:example.com")}/users`);
            expect(req.mock.calls[2][2]).toEqual({ from: "2", limit: "30" });
        });

        it("spaces methods validate space id", async () => {
            await expect(manager.getSpace("bad-space")).rejects.toThrow(ValidationError);
            await expect(manager.deleteSpace("bad-space")).rejects.toThrow(ValidationError);
            await expect(manager.getSpaceRooms("bad-space")).rejects.toThrow(ValidationError);
            await expect(manager.getSpaceStats("bad-space")).rejects.toThrow(ValidationError);
            await expect(manager.getSpaceUsers("bad-space")).rejects.toThrow(ValidationError);
        });
    });

    describe("user media routes", () => {
        it("getUserMedia uses GET /v1/users/{user_id}/media", async () => {
            req.mockResolvedValueOnce({ media: [{ media_id: "m1" }], total: 1 });
            const result = await manager.getUserMedia("@u:x", "3", 9);
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/users/%40u%3Ax/media");
            expect(req.mock.calls[0][2]).toEqual({ from: "3", limit: "9" });
            // 后端 admin/media.rs::get_user_media 只返回 {media, total}：既不读 limit/from，
            // 也不返回游标（原声明的 next_token 恒为 undefined）。
            expect(result).toEqual({ media: [{ media_id: "m1" }], total: 1 });
            expect(result).not.toHaveProperty("next_token");
        });

        it("deleteUserMedia uses DELETE /v1/users/{user_id}/media", async () => {
            await manager.deleteUserMedia("@u:x");
            expect(req.mock.calls[0][0]).toBe("DELETE");
            expect(req.mock.calls[0][1]).toBe("/users/%40u%3Ax/media");
        });

        it("validates user id for user-media methods", async () => {
            await expect(manager.getUserMedia("bad-user")).rejects.toThrow(ValidationError);
            await expect(manager.deleteUserMedia("bad-user")).rejects.toThrow(ValidationError);
        });
    });

    describe("user tokens and refresh tokens", () => {
        it("getUserTokens and deleteUserToken use /v1/users/{user_id}/tokens routes", async () => {
            req.mockResolvedValueOnce({ tokens: [{ token_id: "t1" }] });
            const result = await manager.getUserTokens("@u:x");
            await manager.deleteUserToken("@u:x", "t1");
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/users/%40u%3Ax/tokens");
            expect(req.mock.calls[1][0]).toBe("DELETE");
            expect(req.mock.calls[1][1]).toBe("/users/%40u%3Ax/tokens/t1");
            expect(result.tokens).toHaveLength(1);
        });

        it("getUserRefreshTokens and deleteUserRefreshToken use refresh token routes", async () => {
            req.mockResolvedValueOnce({ refresh_tokens: [{ token_id: "r1" }] });
            const result = await manager.getUserRefreshTokens("@u:x");
            await manager.deleteUserRefreshToken("@u:x", "r1");
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/users/%40u%3Ax/refresh_tokens");
            expect(req.mock.calls[1][0]).toBe("DELETE");
            expect(req.mock.calls[1][1]).toBe("/users/%40u%3Ax/refresh_tokens/r1");
            expect(result.refresh_tokens).toHaveLength(1);
        });

        it("validates user id and token id for token routes", async () => {
            await expect(manager.getUserTokens("bad-user")).rejects.toThrow(ValidationError);
            await expect(manager.deleteUserToken("@u:x", "")).rejects.toThrow(ValidationError);
            await expect(manager.getUserRefreshTokens("bad-user")).rejects.toThrow(ValidationError);
            await expect(manager.deleteUserRefreshToken("@u:x", "")).rejects.toThrow(ValidationError);
        });
    });

    describe("user sessions and auth actions", () => {
        it("get/invalidate user session use /v1/user_sessions routes", async () => {
            await manager.getUserSession("@u:x");
            await manager.invalidateUserSession("@u:x");
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/user_sessions/%40u%3Ax");
            expect(req.mock.calls[1][0]).toBe("POST");
            expect(req.mock.calls[1][1]).toBe("/user_sessions/%40u%3Ax/invalidate");
        });

        it("login/logout/evict use /v1/users/{user_id} action routes", async () => {
            await manager.loginAsUser("@u:x", { device_id: "D1" });
            await manager.logoutUser("@u:x", { revoke_all: true });
            await manager.evictUser("@u:x", { reason: "security" });
            expect(req.mock.calls[0][1]).toBe("/users/%40u%3Ax/login");
            expect(req.mock.calls[0][3]).toEqual({ device_id: "D1" });
            expect(req.mock.calls[1][1]).toBe("/users/%40u%3Ax/logout");
            expect(req.mock.calls[1][3]).toEqual({ revoke_all: true });
            expect(req.mock.calls[2][1]).toBe("/users/%40u%3Ax/evict");
            expect(req.mock.calls[2][3]).toEqual({ reason: "security" });
        });

        it("user rooms/stats routes are correct", async () => {
            await manager.getUserRooms("@u:x", "3", 7);
            await manager.getUserStats("@u:x");
            await manager.listUserStats();
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/users/%40u%3Ax/rooms");
            expect(req.mock.calls[0][2]).toEqual({ from: "3", limit: "7" });
            expect(req.mock.calls[1][1]).toBe("/users/%40u%3Ax/stats");
            expect(req.mock.calls[2][1]).toBe("/user_stats");
            // 后端 get_user_stats 不接收任何 query 参数（旧实现硬塞 from/limit 会被静默忽略）
            expect(req.mock.calls[2][2]).toBeUndefined();
        });

        it("validates user id for session/auth action methods", async () => {
            await expect(manager.getUserSession("bad-user")).rejects.toThrow(ValidationError);
            await expect(manager.invalidateUserSession("bad-user")).rejects.toThrow(ValidationError);
            await expect(manager.loginAsUser("bad-user")).rejects.toThrow(ValidationError);
            await expect(manager.logoutUser("bad-user")).rejects.toThrow(ValidationError);
            await expect(manager.evictUser("bad-user")).rejects.toThrow(ValidationError);
            await expect(manager.getUserRooms("bad-user")).rejects.toThrow(ValidationError);
            await expect(manager.getUserStats("bad-user")).rejects.toThrow(ValidationError);
        });
    });

    describe("device and rate-limit compatibility", () => {
        it("getUserDevices uses /v1/users/{user_id}/devices and does NOT fall back on 404", async () => {
            // `/v2/users/{id}/devices` 回退已删除：后端设备端点只注册在 v1 命名空间下。
            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            await expect(manager.getUserDevices("@u:x")).rejects.toThrow(NotFoundError);
            expect(req.mock.calls).toHaveLength(1);
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/users/%40u%3Ax/devices");
        });

        it("deleteUserDevice falls back to POST /devices/{device_id}/delete on 404", async () => {
            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            req.mockResolvedValueOnce({});
            await manager.deleteUserDevice("@u:x", "DEV1");
            expect(req.mock.calls[0][0]).toBe("DELETE");
            expect(req.mock.calls[0][1]).toBe("/users/%40u%3Ax/devices/DEV1");
            expect(req.mock.calls[1][0]).toBe("POST");
            expect(req.mock.calls[1][1]).toBe("/users/%40u%3Ax/devices/DEV1/delete");
        });

        it("getRateLimit prefers /rate_limit and falls back to /override_ratelimit", async () => {
            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            req.mockResolvedValueOnce({ overridden: true });
            const result = await manager.getRateLimit("@u:x", false);
            expect(req.mock.calls[0][1]).toBe("/users/%40u%3Ax/rate_limit");
            expect(req.mock.calls[1][1]).toBe("/users/%40u%3Ax/override_ratelimit");
            expect(result).toEqual({ overridden: true });
        });

        it("setRateLimit/deleteRateLimit prefer /rate_limit and fall back on 404", async () => {
            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            req.mockResolvedValueOnce({});
            await manager.setRateLimit("@u:x", { messages_per_second: 3 });
            expect(req.mock.calls[0][0]).toBe("PUT");
            expect(req.mock.calls[0][1]).toBe("/users/%40u%3Ax/rate_limit");
            expect(req.mock.calls[1][0]).toBe("POST");
            expect(req.mock.calls[1][1]).toBe("/users/%40u%3Ax/override_ratelimit");

            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            req.mockResolvedValueOnce({});
            await manager.deleteRateLimit("@u:x");
            expect(req.mock.calls[2][0]).toBe("DELETE");
            expect(req.mock.calls[2][1]).toBe("/users/%40u%3Ax/rate_limit");
            expect(req.mock.calls[3][0]).toBe("DELETE");
            expect(req.mock.calls[3][1]).toBe("/users/%40u%3Ax/override_ratelimit");
        });
    });

    describe("media quota and statistics compatibility", () => {
        it("getMediaQuota uses GET /v1/media/quota", async () => {
            await manager.getMediaQuota();
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/media/quota");
        });

        it("getServerStats uses /v1/statistics and does NOT fall back on 404", async () => {
            // `/server_stats` 回退已删除：后端只注册 `GET /_synapse/admin/v1/statistics`。
            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            await expect(manager.getServerStats()).rejects.toThrow(NotFoundError);
            expect(req.mock.calls).toHaveLength(1);
            expect(req.mock.calls[0][1]).toBe("/statistics");
        });

        it("getRoomStatsByRoom uses GET /v1/room_stats/{room_id}", async () => {
            await manager.getRoomStatsByRoom("!room:example.com");
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/room_stats/!room%3Aexample.com");
        });

        it("getRoomStatsByRoom validates room id", async () => {
            await expect(manager.getRoomStatsByRoom("bad-room")).rejects.toThrow(ValidationError);
        });
    });

    describe("register and reports", () => {
        it("getRegisterNonce/registerAdmin hit register routes", async () => {
            await manager.getRegisterNonce();
            // 后端 `RegisterRequest` 里 nonce / mac / admin 都是**必填**（见 AdminRegisterRequest 的 JSDoc）
            await manager.registerAdmin({
                nonce: "n0nce",
                username: "admin",
                password: "pw",
                admin: true,
                mac: "00112233445566778899aabbccddeeff",
            });
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/register/nonce");
            expect(req.mock.calls[1][0]).toBe("POST");
            expect(req.mock.calls[1][1]).toBe("/register");
        });

        it("list/get/delete report routes are correct", async () => {
            await manager.listReports({ from: "5", limit: 10 });
            await manager.getReport("r1");
            await manager.deleteReport("r1");
            expect(req.mock.calls[0][1]).toBe("/reports");
            expect(req.mock.calls[0][2]).toEqual({ from: "5", limit: "10" });
            expect(req.mock.calls[1][1]).toBe("/reports/r1");
            expect(req.mock.calls[2][0]).toBe("DELETE");
            expect(req.mock.calls[2][1]).toBe("/reports/r1");
        });

        it("list/get room reports routes are correct", async () => {
            await manager.listRoomReports("!room:example.com", { from: "3", limit: 7 });
            await manager.getRoomReport("!room:example.com", "rep-1");
            expect(req.mock.calls[0][1]).toBe(`/rooms/${encodeURIComponent("!room:example.com")}/reports`);
            expect(req.mock.calls[0][2]).toEqual({ from: "3", limit: "7" });
            expect(req.mock.calls[1][1]).toBe(
                `/rooms/${encodeURIComponent("!room:example.com")}/reports/${encodeURIComponent("rep-1")}`,
            );
        });

        it("validates report id", async () => {
            await expect(manager.getReport("")).rejects.toThrow(ValidationError);
            await expect(manager.deleteReport("")).rejects.toThrow(ValidationError);
            await expect(manager.getRoomReport("!room:example.com", "")).rejects.toThrow(ValidationError);
        });
    });

    describe("global room search routes", () => {
        it("searchRooms uses GET /v1/rooms/search with query params", async () => {
            await manager.searchRooms({ term: "matrix", from: 5, limit: 20 });
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/rooms/search");
            expect(req.mock.calls[0][2]).toEqual({ term: "matrix", from: "5", limit: "20" });
        });

        it("searchRoomsPost uses POST /v1/rooms/search", async () => {
            await manager.searchRoomsPost({ search_term: "matrix" });
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/rooms/search");
            expect(req.mock.calls[0][3]).toEqual({ search_term: "matrix" });
        });
    });

    describe("room admin extra routes", () => {
        it("event context / forward extremities / token sync routes are correct", async () => {
            await manager.getRoomEventContext("!room:example.com", "$event:example.com");
            await manager.getRoomForwardExtremities("!room:example.com");
            await manager.getRoomTokenSync("!room:example.com");
            expect(req.mock.calls[0][1]).toBe(
                `/rooms/${encodeURIComponent("!room:example.com")}/event_context/${encodeURIComponent("$event:example.com")}`,
            );
            expect(req.mock.calls[1][1]).toBe(`/rooms/${encodeURIComponent("!room:example.com")}/forward_extremities`);
            expect(req.mock.calls[2][1]).toBe(`/rooms/${encodeURIComponent("!room:example.com")}/token_sync`);
        });

        it("room search and listing routes are correct", async () => {
            // ⚠️ 后端字段名是 `search_term`（必填），不是 `term` —— 旧夹具写的 `term`
            // 会被 `deny_unknown_fields` 直接 400。
            const payload = { search_term: "hello" };
            await manager.searchRoomEvents("!room:example.com", payload);
            await manager.getRoomListings("!room:example.com");
            await manager.setRoomPublicListing("!room:example.com");
            await manager.deleteRoomPublicListing("!room:example.com");
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe(`/rooms/${encodeURIComponent("!room:example.com")}/search`);
            expect(req.mock.calls[0][3]).toEqual(payload);
            expect(req.mock.calls[1][0]).toBe("GET");
            expect(req.mock.calls[1][1]).toBe(`/rooms/${encodeURIComponent("!room:example.com")}/listings`);
            expect(req.mock.calls[2][0]).toBe("PUT");
            expect(req.mock.calls[2][1]).toBe(`/rooms/${encodeURIComponent("!room:example.com")}/listings/public`);
            expect(req.mock.calls[3][0]).toBe("DELETE");
            expect(req.mock.calls[3][1]).toBe(`/rooms/${encodeURIComponent("!room:example.com")}/listings/public`);
        });

        it("member and moderation user routes are correct", async () => {
            await manager.addRoomMember("!room:example.com", "@u:x", { reason: "join-back" });
            await manager.removeRoomMember("!room:example.com", "@u:x");
            await manager.banRoomMember("!room:example.com", "@u:x", { reason: "spam" });
            await manager.kickRoomMember("!room:example.com", "@u:x", { reason: "rule" });
            await manager.unbanRoomMember("!room:example.com", "@u:x", { reason: "appeal-ok" });
            expect(req.mock.calls[0][0]).toBe("PUT");
            expect(req.mock.calls[0][1]).toBe(
                `/rooms/${encodeURIComponent("!room:example.com")}/members/${encodeURIComponent("@u:x")}`,
            );
            expect(req.mock.calls[1][0]).toBe("DELETE");
            expect(req.mock.calls[1][1]).toBe(
                `/rooms/${encodeURIComponent("!room:example.com")}/members/${encodeURIComponent("@u:x")}`,
            );
            expect(req.mock.calls[2][0]).toBe("POST");
            expect(req.mock.calls[2][1]).toBe(
                `/rooms/${encodeURIComponent("!room:example.com")}/ban/${encodeURIComponent("@u:x")}`,
            );
            expect(req.mock.calls[3][0]).toBe("POST");
            expect(req.mock.calls[3][1]).toBe(
                `/rooms/${encodeURIComponent("!room:example.com")}/kick/${encodeURIComponent("@u:x")}`,
            );
            expect(req.mock.calls[4][0]).toBe("POST");
            expect(req.mock.calls[4][1]).toBe(
                `/rooms/${encodeURIComponent("!room:example.com")}/unban/${encodeURIComponent("@u:x")}`,
            );
        });

        it("ban/kick body routes and make_admin compatibility are correct", async () => {
            await manager.banRoom("!room:example.com", { user_id: "@u:x", reason: "spam" });
            await manager.kickRoom("!room:example.com", { user_id: "@u:x", reason: "rule" });
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe(`/rooms/${encodeURIComponent("!room:example.com")}/ban`);
            expect(req.mock.calls[1][0]).toBe("POST");
            expect(req.mock.calls[1][1]).toBe(`/rooms/${encodeURIComponent("!room:example.com")}/kick`);

            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            req.mockResolvedValueOnce({});
            await manager.makeRoomAdmin("!room:example.com", { user_id: "@u:x" });
            expect(req.mock.calls[2][0]).toBe("PUT");
            expect(req.mock.calls[2][1]).toBe(`/rooms/${encodeURIComponent("!room:example.com")}/make_admin`);
            expect(req.mock.calls[3][0]).toBe("POST");
            expect(req.mock.calls[3][1]).toBe(`/rooms/${encodeURIComponent("!room:example.com")}/make_admin`);
        });

        it("room delete/purge_history admin routes are correct", async () => {
            await manager.deleteRoomAdmin("!room:example.com", { purge: true, reason: "cleanup" });
            // 后端 `purge_history` 只读 `purge_up_to_ts` / `dry_run`；
            // `delete_local_events` 会被静默忽略（旧夹具在断言一个无效参数）。
            await manager.purgeRoomHistory("!room:example.com", { dry_run: true });
            await manager.unblockRoom("!room:example.com", { reason: "manual-review" });
            expect(req.mock.calls[0][0]).toBe("DELETE");
            expect(req.mock.calls[0][1]).toBe(`/rooms/${encodeURIComponent("!room:example.com")}`);
            expect(req.mock.calls[0][3]).toEqual({ purge: true, reason: "cleanup" });
            expect(req.mock.calls[1][0]).toBe("POST");
            expect(req.mock.calls[1][1]).toBe(`/rooms/${encodeURIComponent("!room:example.com")}/purge_history`);
            expect(req.mock.calls[1][3]).toEqual({ dry_run: true });
            expect(req.mock.calls[2][0]).toBe("POST");
            expect(req.mock.calls[2][1]).toBe(`/rooms/${encodeURIComponent("!room:example.com")}/unblock`);
            expect(req.mock.calls[2][3]).toEqual({ reason: "manual-review" });
        });

        it("validates room/event ids for extra room routes", async () => {
            await expect(manager.getRoomEventContext("!room:example.com", "")).rejects.toThrow(ValidationError);
            await expect(manager.getRoomForwardExtremities("bad-room")).rejects.toThrow(ValidationError);
            await expect(manager.getRoomTokenSync("bad-room")).rejects.toThrow(ValidationError);
            await expect(manager.searchRoomEvents("bad-room", { search_term: "x" })).rejects.toThrow(ValidationError);
            await expect(manager.getRoomListings("bad-room")).rejects.toThrow(ValidationError);
            await expect(manager.setRoomPublicListing("bad-room")).rejects.toThrow(ValidationError);
            await expect(manager.deleteRoomPublicListing("bad-room")).rejects.toThrow(ValidationError);
            await expect(manager.addRoomMember("bad-room", "@u:x")).rejects.toThrow(ValidationError);
            await expect(manager.addRoomMember("!room:example.com", "bad-user")).rejects.toThrow(ValidationError);
            await expect(manager.removeRoomMember("bad-room", "@u:x")).rejects.toThrow(ValidationError);
            await expect(manager.removeRoomMember("!room:example.com", "bad-user")).rejects.toThrow(ValidationError);
            await expect(manager.banRoomMember("bad-room", "@u:x")).rejects.toThrow(ValidationError);
            await expect(manager.banRoomMember("!room:example.com", "bad-user")).rejects.toThrow(ValidationError);
            await expect(manager.kickRoomMember("bad-room", "@u:x")).rejects.toThrow(ValidationError);
            await expect(manager.kickRoomMember("!room:example.com", "bad-user")).rejects.toThrow(ValidationError);
            await expect(manager.unbanRoomMember("bad-room", "@u:x")).rejects.toThrow(ValidationError);
            await expect(manager.unbanRoomMember("!room:example.com", "bad-user")).rejects.toThrow(ValidationError);
            await expect(manager.banRoom("bad-room", { user_id: "@u:x" })).rejects.toThrow(ValidationError);
            await expect(manager.kickRoom("bad-room", { user_id: "@u:x" })).rejects.toThrow(ValidationError);
            await expect(manager.makeRoomAdmin("bad-room", { user_id: "@u:x" })).rejects.toThrow(ValidationError);
            await expect(manager.deleteRoomAdmin("bad-room")).rejects.toThrow(ValidationError);
            await expect(manager.purgeRoomHistory("bad-room")).rejects.toThrow(ValidationError);
            await expect(manager.unblockRoom("bad-room")).rejects.toThrow(ValidationError);
        });
    });

    describe("registration token detail compatibility", () => {
        it("getRegistrationToken uses GET /v1/registration_tokens/{token}", async () => {
            await manager.getRegistrationToken("token-1");
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/registration_tokens/token-1");
        });

        it("updateRegistrationToken uses POST and does NOT fall back to PUT on 404", async () => {
            // 后端只注册 `POST /_synapse/admin/v1/registration_tokens/{token}`，
            // 旧实现的 `PUT` 回退是死分支，已删除 —— 404 必须直接抛出。
            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            await expect(manager.updateRegistrationToken("token-1", { uses_allowed: 5 })).rejects.toThrow(
                NotFoundError,
            );
            expect(req.mock.calls).toHaveLength(1);
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/registration_tokens/token-1");
        });
    });

    // --------- setAdmin route correctness ---------
    describe("setAdmin", () => {
        it("uses PUT /v1/users/{id}/admin with {admin} body", async () => {
            await manager.setAdmin("@u:x", true);
            expect(req.mock.calls[0][0]).toBe("PUT");
            expect(req.mock.calls[0][1]).toBe("/users/%40u%3Ax/admin");
            expect(req.mock.calls[0][3]).toEqual({ admin: true });
        });

        it("deleteUser prefers v1 and falls back to v2 on 404", async () => {
            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            req.mockResolvedValueOnce({});
            await manager.deleteUser("@u:x");
            expect(req.mock.calls[0][0]).toBe("DELETE");
            expect(req.mock.calls[0][1]).toBe("/users/%40u%3Ax");
            expect(req.mock.calls[1][0]).toBe("DELETE");
            expect(req.mock.calls[1][1]).toBe("/v2/users/%40u%3Ax");
        });

        it("batchCreateUsers and batchDeactivateUsers use v1 batch routes with the real field names", async () => {
            // 回归守卫：两个请求体都由后端 deny_unknown_fields 的结构体解析 ——
            // 批量创建条目字段是 username（不是 user_id）、批量停用是 users（不是 user_ids）。
            await manager.batchCreateUsers({ users: [{ username: "a", password: "pw" }] });
            await manager.batchDeactivateUsers({ users: ["@a:x"] });
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/users/batch");
            expect(req.mock.calls[0][3]).toEqual({ users: [{ username: "a", password: "pw" }] });
            expect(req.mock.calls[1][0]).toBe("POST");
            expect(req.mock.calls[1][1]).toBe("/users/batch_deactivate");
            expect(req.mock.calls[1][3]).toEqual({ users: ["@a:x"] });
        });

        it("batch responses use created/failed/total and deactivated/failed/total", async () => {
            req.mockResolvedValueOnce({ created: ["a", "b"], failed: ["c"], total: 3 });
            const created = await manager.batchCreateUsers({ users: [{ username: "a" }] });
            expect(created.created).toEqual(["a", "b"]);
            expect(created.failed).toEqual(["c"]);
            expect(created.total).toBe(3);
            // 旧声明里的 errors 后端从不返回
            expect(created).not.toHaveProperty("errors");

            req.mockResolvedValueOnce({ deactivated: ["@a:x"], failed: [], total: 1 });
            const deactivated = await manager.batchDeactivateUsers({ users: ["@a:x"] });
            expect(deactivated.deactivated).toEqual(["@a:x"]);
            expect(deactivated.failed).toEqual([]);
            expect(deactivated.total).toBe(1);
            expect(deactivated).not.toHaveProperty("errors");
        });

        it("validates user id for deleteUser", async () => {
            await expect(manager.deleteUser("bad-user")).rejects.toThrow(ValidationError);
        });

        it("getUsersPaginated falls back to /v1/users when /v2/users returns 404", async () => {
            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            req.mockResolvedValueOnce({ users: [{ user_id: "@u:x" }], total: 1 });
            const result = await manager.getUsersPaginated({ from: "2", limit: 3 });
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/v2/users");
            expect(req.mock.calls[0][2]).toEqual({ from: "2", limit: "3" });
            expect(req.mock.calls[1][1]).toBe("/users");
            expect(req.mock.calls[1][2]).toEqual({ from: "2", limit: "3" });
            expect(result.items).toEqual([{ user_id: "@u:x" }]);
            expect(result.total).toBe(1);
        });

        it("getUser falls back to /v1/users/{id} when /v2 returns 404", async () => {
            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            req.mockResolvedValueOnce({ user_id: "@u:x", admin: false });
            const user = await manager.getUser("@u:x");
            expect(req.mock.calls[0][1]).toBe("/v2/users/%40u%3Ax");
            expect(req.mock.calls[1][1]).toBe("/users/%40u%3Ax");
            expect(user).toEqual({ user_id: "@u:x", admin: false });
        });
    });

    // --------- getAccountStatus reroute ---------
    describe("getAccountStatus", () => {
        it("hits /v1/account/{user_id}", async () => {
            req.mockResolvedValue({ user_id: "@u:x", exists: true });
            await manager.getAccountStatus("@u:x");
            expect(req.mock.calls[0][1]).toBe("/account/%40u%3Ax");
        });

        it("updateAccountDetails POSTs /v1/account/{user_id}", async () => {
            // ⚠️ 这里原来断言的是 `{ suspended: true }` —— 后端 `UpdateAccountRequest`
            // 只接受 `{displayname, avatar_url, admin}` 且 `deny_unknown_fields`，
            // 带上 `suspended` 必然 400。测试把"后端会拒绝的请求体"当成正确行为钉住了。
            await manager.updateAccountDetails("@u:x", { displayname: "New Name" });
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/account/%40u%3Ax");
            expect(req.mock.calls[0][3]).toEqual({ displayname: "New Name" });
        });

        it("validates user id for account detail routes", async () => {
            await expect(manager.getAccountStatus("bad-user")).rejects.toThrow(ValidationError);
            await expect(manager.updateAccountDetails("bad-user", {})).rejects.toThrow(ValidationError);
        });
    });

    describe("whoisByDevice", () => {
        it("hits /v1/whois/{user_id}/{device_id}", async () => {
            req.mockResolvedValue({ user_id: "@u:x", devices: {} });
            await manager.whoisByDevice("@u:x", "DEV1");
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/whois/%40u%3Ax/DEV1");
        });

        it("validates deviceId", async () => {
            await expect(manager.whoisByDevice("@u:x", "")).rejects.toThrow(ValidationError);
        });
    });

    // --------- purgeMediaCache (backend now implements) ---------
    describe("purgeMediaCache", () => {
        it("POSTs /v1/purge_media_cache without query params when no arg", async () => {
            req.mockResolvedValue({ deleted: 0 });
            const result = await manager.purgeMediaCache();
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/purge_media_cache");
            expect(req.mock.calls[0][2]).toBeUndefined();
            expect(result).toEqual({ deleted: 0 });
        });

        it("passes before_ts as a **query** param (backend reads it with axum Query, not from the body)", async () => {
            req.mockResolvedValue({ deleted: 42 });
            const ts = 1_700_000_000_000;
            const result = await manager.purgeMediaCache(ts);
            // 原实现把这个值放进 JSON body ⇒ 后端读不到 ⇒ 退化成 before_ts = 0（静默不生效）。
            expect(req.mock.calls[0][2]).toEqual({ before_ts: String(ts) });
            expect(result.deleted).toBe(42);
        });

        it("defaults deleted to 0 when backend omits field", async () => {
            req.mockResolvedValue({});
            const result = await manager.purgeMediaCache();
            expect(result).toEqual({ deleted: 0 });
        });

        it("rejects non-positive beforeTs", async () => {
            await expect(manager.purgeMediaCache(0)).rejects.toThrow(ValidationError);
            await expect(manager.purgeMediaCache(-1)).rejects.toThrow(ValidationError);
        });

        it("rejects non-integer beforeTs", async () => {
            await expect(manager.purgeMediaCache(1.5)).rejects.toThrow(ValidationError);
            await expect(manager.purgeMediaCache(Number.NaN)).rejects.toThrow(ValidationError);
        });
    });

    // --------- listBackups (backend newly implemented) ---------
    describe("listBackups", () => {
        it("GETs /v1/backups with default params", async () => {
            req.mockResolvedValue({
                backups: [],
                total: 0,
                total_keys: 0,
                limit: 50,
                offset: 0,
            });
            const result = await manager.listBackups();
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/backups");
            expect(req.mock.calls[0][2]).toEqual({});
            expect(result.total).toBe(0);
        });

        it("passes limit/offset as query params", async () => {
            req.mockResolvedValue({ backups: [], total: 0, total_keys: 0, limit: 10, offset: 5 });
            await manager.listBackups({ limit: 10, offset: 5 });
            expect(req.mock.calls[0][2]).toEqual({ limit: "10", offset: "5" });
        });

        it("rejects out-of-range limit", async () => {
            await expect(manager.listBackups({ limit: 0 })).rejects.toThrow(ValidationError);
            await expect(manager.listBackups({ limit: 501 })).rejects.toThrow(ValidationError);
            await expect(manager.listBackups({ limit: 1.5 })).rejects.toThrow(ValidationError);
        });

        it("rejects negative offset", async () => {
            await expect(manager.listBackups({ offset: -1 })).rejects.toThrow(ValidationError);
        });
    });

    // --------- getExperimentalFeatures (backend newly implemented) ---------
    describe("getExperimentalFeatures", () => {
        it("GETs /v1/experimental_features", async () => {
            // 后端 `…::get_experimental_features` 返回的是 flagKey → 生效与否 的映射，不是两个数组。
            req.mockResolvedValue({ features: { "experimental.foo": true, "msc1234.bar": false }, total: 2 });
            const result = await manager.getExperimentalFeatures();
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/experimental_features");
            expect(result.features).toEqual({ "experimental.foo": true, "msc1234.bar": false });
            expect(result.total).toBe(2);
        });
    });

    // --------- getUserMedia / deleteUserMedia ---------
    describe("getUserMedia", () => {
        it("GETs /v1/users/{user_id}/media", async () => {
            req.mockResolvedValue({ media: [], total: 0 });
            const result = await manager.media.getUserMedia("@alice:example.org");
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/users/%40alice%3Aexample.org/media");
            expect(req.mock.calls[0][4]).toMatchObject({ prefix: "/_synapse/admin/v1" });
            expect(result.media).toEqual([]);
            expect(result.total).toBe(0);
            expect(result).not.toHaveProperty("next_token");
        });

        it("still forwards limit/from as query params (backend currently ignores them)", async () => {
            req.mockResolvedValue({ media: [], total: 0 });
            await manager.media.getUserMedia("@alice:example.org", { limit: 50, from: "token123" });
            expect(req.mock.calls[0][2]).toEqual({ limit: "50", from: "token123" });
        });

        it("rejects empty userId", async () => {
            await expect(manager.media.getUserMedia("")).rejects.toThrow(ValidationError);
        });
    });

    describe("getMediaQuarantineChanges", () => {
        it("maps the real backend shape {stream_id, media_id, server_name, change_type, changed_by, created_ts}", async () => {
            // 形状取自后端 admin/media.rs::get_media_quarantine_changes：
            // Ok(Json(json!({ "changes": changes_json, "total": changes_json.len() })))
            req.mockResolvedValue({
                changes: [
                    {
                        stream_id: 7,
                        media_id: "abc123",
                        server_name: "example.org",
                        change_type: "quarantine",
                        changed_by: "@admin:example.org",
                        created_ts: 1_700_000_000_000,
                    },
                ],
                total: 1,
            });
            const result = await manager.media.getMediaQuarantineChanges("abc123", { limit: 50 });
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/quarantine_media/abc123/changes");
            expect(result.total).toBe(1);
            expect(result.changes[0]).toEqual({
                stream_id: 7,
                media_id: "abc123",
                server_name: "example.org",
                change_type: "quarantine",
                changed_by: "@admin:example.org",
                created_ts: 1_700_000_000_000,
            });
            // 顶层没有 media_id（由路径决定）、也没有分页游标
            expect(result).not.toHaveProperty("media_id");
            expect(result).not.toHaveProperty("next_token");
        });

        it("defaults total to changes.length when the backend omits it", async () => {
            req.mockResolvedValue({
                changes: [
                    {
                        stream_id: 1,
                        media_id: "m",
                        server_name: "s",
                        change_type: "unquarantine",
                        changed_by: "u",
                        created_ts: 1,
                    },
                ],
            });
            const result = await manager.media.getMediaQuarantineChanges("m");
            expect(result.total).toBe(1);
        });

        it("rejects empty mediaId", async () => {
            await expect(manager.media.getMediaQuarantineChanges("")).rejects.toThrow(ValidationError);
        });
    });

    describe("deleteUserMedia", () => {
        it("DELETes /v1/users/{user_id}/media and returns deleted count", async () => {
            req.mockResolvedValue({ deleted: 42 });
            const result = await manager.media.deleteUserMedia("@bob:example.org");
            expect(req.mock.calls[0][0]).toBe("DELETE");
            expect(req.mock.calls[0][1]).toBe("/users/%40bob%3Aexample.org/media");
            expect(req.mock.calls[0][4]).toMatchObject({ prefix: "/_synapse/admin/v1" });
            expect(result.deleted).toBe(42);
        });

        it("defaults deleted to 0 when missing", async () => {
            req.mockResolvedValue({});
            const result = await manager.media.deleteUserMedia("@charlie:example.org");
            expect(result.deleted).toBe(0);
        });

        it("rejects empty userId", async () => {
            await expect(manager.media.deleteUserMedia("")).rejects.toThrow(ValidationError);
        });
    });

    // --------- Federation 响应/请求形状（对照后端 federation.rs 与 notification.rs 逐个核对）---------
    describe("federation & notification payload shapes (backend-verified)", () => {
        it("getFederationDestinations: item has last_successful_ts/failure_count, NOT last_successful_stream_ordering", async () => {
            req.mockResolvedValue({
                destinations: [
                    {
                        destination: "a.tld",
                        retry_last_ts: null,
                        retry_interval: null,
                        failure_ts: null,
                        last_successful_ts: 1700000000000,
                        failure_count: 2,
                        status: "active",
                        updated_ts: 1700000000000,
                    },
                ],
                total: 1,
                total_count: 1,
                next_batch: null,
            });
            const list = await manager.getFederationDestinations();
            expect(list[0]!.last_successful_ts).toBe(1700000000000);
            expect(list[0]!.failure_count).toBe(2);
            expect(list[0]).not.toHaveProperty("last_successful_stream_ordering");
        });

        it("getFederationDestinationRooms: rooms is a string id array (not objects) and there is no cursor", async () => {
            req.mockResolvedValue({ rooms: ["!a:x", "!b:x"], total: 2 });
            const page = await manager.getFederationDestinationRooms("a.tld");
            expect(page.rooms).toEqual(["!a:x", "!b:x"]);
            expect(typeof page.rooms[0]).toBe("string");
            expect(page).not.toHaveProperty("next_token");
        });

        it("getFederationCache: list key is cache, entries carry expiry_ts (not size/last_access_ts)", async () => {
            req.mockResolvedValue({ cache: [{ key: "k", value: { v: 1 }, expiry_ts: 1700000000000 }], total: 1 });
            const cache = await manager.getFederationCache();
            expect(cache.cache[0]!.key).toBe("k");
            expect(cache.cache[0]!.expiry_ts).toBe(1700000000000);
            expect(cache).not.toHaveProperty("entries");
            expect(cache.cache[0]).not.toHaveProperty("size");
            expect(cache.cache[0]).not.toHaveProperty("last_access_ts");
        });

        it("getPendingFederationServers: cursor is next_batch (backend never returns offset)", async () => {
            req.mockResolvedValue({ servers: [], total: 0, limit: 100, next_batch: "1700000000000|a.tld" });
            const page = await manager.getPendingFederationServers();
            expect(page.next_batch).toBe("1700000000000|a.tld");
            expect(page).not.toHaveProperty("offset");
        });

        it("sendServerNotice: object form posts {user_id, content} and returns {event_id, room_id, notice_id}", async () => {
            req.mockResolvedValue({ event_id: "$e:x", room_id: "!r:x", notice_id: 3 });
            const result = await manager.sendServerNotice("@a:x", { msgtype: "m.text", body: "hi" });
            expect(req.mock.calls[0][1]).toBe("/send_server_notice");
            expect(req.mock.calls[0][3]).toEqual({ user_id: "@a:x", content: { msgtype: "m.text", body: "hi" } });
            expect(result.notice_id).toBe(3);
            expect(result.room_id).toBe("!r:x");
        });

        it("sendServerNotice: the string form throws instead of sending a body the backend always rejects", async () => {
            // 后端 ServerNoticeRequest 带 deny_unknown_fields，且 content 必须是 {msgtype, body}；
            // 旧实现在该分支发 {content: "<字符串>", type, target_users} ⇒ 必然 400。
            await expect(manager.sendServerNotice("some text", "m.text")).rejects.toThrow(ValidationError);
            expect(req).not.toHaveBeenCalled();
        });

        it("setUserNotification posts {is_enabled} and returns {is_enabled} (GET returns {enabled})", async () => {
            req.mockResolvedValue({ is_enabled: false });
            const result = await manager.setUserNotification("@a:x", { enabled: false });
            expect(req.mock.calls[0][0]).toBe("PUT");
            expect(req.mock.calls[0][1]).toBe("/users/%40a%3Ax/notification");
            // 请求体走 is_enabled（后端 UserNotificationRequest 带 deny_unknown_fields）
            expect(req.mock.calls[0][3]).toEqual({ is_enabled: false });
            expect(result.is_enabled).toBe(false);
        });

        it("getUserNotification reads {enabled} (GET and PUT use different keys on the backend)", async () => {
            req.mockResolvedValue({ enabled: true });
            const result = await manager.getUserNotification("@a:x");
            expect(result.enabled).toBe(true);
        });

        it("getUserPushers returns {pushers, total}", async () => {
            req.mockResolvedValue({ pushers: [{ pushkey: "k", app_id: "a" }], total: 1 });
            const result = await manager.getUserPushers("@a:x");
            expect(result.pushers).toHaveLength(1);
            expect(result.total).toBe(1);
        });
    });

    // --------- Token / Retention / Security / Session 形状（对照后端 token.rs / retention.rs / security.rs / user.rs）---------
    describe("token / retention / security / session shapes (backend-verified)", () => {
        it("getRetentionPolicy uses is_expire_on_clients (backend never returns expire_on_clients)", async () => {
            req.mockResolvedValue({ max_lifetime: 100, min_lifetime: null, is_expire_on_clients: true });
            const policy = await manager.getRetentionPolicy();
            expect(policy.is_expire_on_clients).toBe(true);
            expect(policy).not.toHaveProperty("expire_on_clients");
        });

        it("setRetentionPolicy sends is_expire_on_clients (deny_unknown_fields ⇒ expire_on_clients would 400)", async () => {
            await manager.setRetentionPolicy({ max_lifetime: 3600, is_expire_on_clients: true });
            expect(req.mock.calls[0][3]).toEqual({ max_lifetime: 3600, is_expire_on_clients: true });
            expect(req.mock.calls[0][3]).not.toHaveProperty("expire_on_clients");
        });

        it("runRetention only ever sends room_id (the backend rejects a scope field)", async () => {
            await manager.runRetention();
            expect(req.mock.calls[0][3]).toEqual({});
            await manager.runRetention({ room_id: "!r:x" });
            expect(req.mock.calls[1][3]).toEqual({ room_id: "!r:x" });
            expect(req.mock.calls[1][3]).not.toHaveProperty("scope");
        });

        it("getRetentionStatus last_run has failed_tasks and none of the phantom cleanup_queue_* fields", async () => {
            req.mockResolvedValue({
                server_policy_enabled: true,
                rooms_with_custom_policy: 2,
                lifecycle_cleanup_enabled: false,
                audit_retention_days: 90,
                last_run: {
                    started_ts: 1,
                    completed_ts: 2,
                    duration_ms: 1,
                    expired_events_deleted: 3,
                    expired_beacons_deleted: 0,
                    expired_uploads_deleted: 0,
                    expired_audit_events_deleted: 0,
                    failed_tasks: 0,
                },
            });
            const status = await manager.getRetentionStatus();
            expect(status.last_run!.failed_tasks).toBe(0);
            expect(status).not.toHaveProperty("cleanup_batch_size");
            expect(status).not.toHaveProperty("queue_retention_days");
            expect(status.last_run).not.toHaveProperty("cleanup_queue_items_processed");
            expect(status.last_run).not.toHaveProperty("cleanup_queue_rows_pruned");
        });

        it("getUserTokens returns tokens + total, with the real per-token keys", async () => {
            req.mockResolvedValue({
                tokens: [{ id: 7, device_id: "D", created_ts: 1, expires_at: null, is_revoked: false }],
                total: 1,
            });
            const result = await manager.getUserTokens("@a:x");
            expect(result.total).toBe(1);
            expect(result.tokens[0]).toEqual({
                id: 7,
                device_id: "D",
                created_ts: 1,
                expires_at: null,
                is_revoked: false,
            });
            expect(result.tokens[0]).not.toHaveProperty("user_id");
            expect(result.tokens[0]).not.toHaveProperty("name");
        });

        it("getUserRefreshTokens returns refresh_tokens (its own list key) + total", async () => {
            req.mockResolvedValue({
                refresh_tokens: [{ id: 8, device_id: "D", created_ts: 1, expires_at: 2, is_revoked: true }],
                total: 1,
            });
            const result = await manager.getUserRefreshTokens("@a:x");
            expect(result.refresh_tokens[0]!.is_revoked).toBe(true);
            expect(result.total).toBe(1);
            expect(result.refresh_tokens[0]).not.toHaveProperty("token");
        });

        it("getUserSession returns the wrapper {user_id, sessions, total}, not a bare session", async () => {
            req.mockResolvedValue({
                user_id: "@a:x",
                sessions: [
                    { session_id: "D", device_id: "D", display_name: null, last_seen_ts: null, last_seen_ip: null },
                ],
                total: 1,
            });
            const page = await manager.getUserSession("@a:x");
            expect(page.total).toBe(1);
            expect(page.sessions[0]!.session_id).toBe("D");
            expect(page.sessions[0]).not.toHaveProperty("user_agent");
            expect(page).not.toHaveProperty("session_id");
        });

        it("invalidateUserSession returns {invalidated, sessions_removed}", async () => {
            req.mockResolvedValue({ invalidated: true, sessions_removed: 3 });
            const result = await manager.invalidateUserSession("@a:x");
            expect(result.invalidated).toBe(true);
            expect(result.sessions_removed).toBe(3);
        });

        it("getUserRooms reads joined_rooms (not rooms) and keeps total/next_batch", async () => {
            req.mockResolvedValue({ joined_rooms: ["!a:x"], total: 1, next_batch: null });
            const page = await manager.getUserRooms("@a:x");
            expect(page.joined_rooms).toEqual(["!a:x"]);
            expect(page.total).toBe(1);
            expect(page).not.toHaveProperty("rooms");
        });

        it("logoutUser returns devices_deleted (backend never returns device_id)", async () => {
            req.mockResolvedValue({ devices_deleted: 2 });
            const result = await manager.logoutUser("@a:x", { devices: ["D1"] });
            expect(result.devices_deleted).toBe(2);
            expect(result).not.toHaveProperty("device_id");
        });

        it("evictUser returns {user_id, rooms_evicted, rooms, failures} (not evicted)", async () => {
            req.mockResolvedValue({
                user_id: "@a:x",
                rooms_evicted: 2,
                rooms: ["!a:x", "!b:x"],
                failures: [{ room_id: "!c:x", error: "boom" }],
            });
            const result = await manager.evictUser("@a:x");
            expect(result.rooms_evicted).toBe(2);
            expect(result.failures[0]!.error).toBe("boom");
            expect(result).not.toHaveProperty("evicted");
        });

        it("overrideRateLimit POSTs a JSON body (a bodyless POST is rejected with 415)", async () => {
            req.mockResolvedValue({ messages_per_second: 2, burst_count: 5 });
            const result = await manager.overrideRateLimit("@a:x", { messages_per_second: 2, burst_count: 5 });
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/users/%40a%3Ax/override_ratelimit");
            expect(req.mock.calls[0][3]).toEqual({ messages_per_second: 2, burst_count: 5 });
            expect(result.burst_count).toBe(5);
        });

        it("overrideRateLimit with no config still sends an object body", async () => {
            req.mockResolvedValue({ messages_per_second: 5, burst_count: 10 });
            await manager.overrideRateLimit("@a:x");
            expect(req.mock.calls[0][3]).toEqual({});
        });

        it("getRateLimit reads {messages_per_second, burst_count}", async () => {
            req.mockResolvedValue({ messages_per_second: 1.5, burst_count: 3 });
            const limit = await manager.getRateLimit("@a:x");
            expect(limit!.messages_per_second).toBe(1.5);
            expect(limit!.burst_count).toBe(3);
        });
    });

    // --------- Room / Space 响应体形状（对照后端 room/*.rs 与 report.rs 逐个核对）---------
    describe("room & space response shapes (backend-verified)", () => {
        it("getRoom returns the detail shape (is_public / room_version / join_rule, NOT public / version / join_rules)", async () => {
            req.mockResolvedValue({
                room_id: "!r:x",
                name: "R",
                topic: "T",
                creator: "@a:x",
                member_count: 3,
                room_version: "10",
                encryption: null,
                is_public: false,
                join_rule: "invite",
                tombstoned: false,
                replacement_room: null,
            });
            const room = await manager.getRoom("!r:x");
            expect(room).not.toBeNull();
            expect(room!.is_public).toBe(false);
            expect(room!.room_version).toBe("10");
            expect(room!.join_rule).toBe("invite");
            // 旧声明里的键后端都不返回
            expect(room).not.toHaveProperty("public");
            expect(room).not.toHaveProperty("version");
            expect(room).not.toHaveProperty("join_rules");
            expect(room!.encryption).toBeNull();
        });

        it("getRoomMembers returns object items plus total/next_batch (not AdminAccountDetails[])", async () => {
            req.mockResolvedValue({
                members: [{ user_id: "@a:x", displayname: "A", avatar_url: null, membership: "join" }],
                total: 1,
                next_batch: null,
            });
            const page = await manager.getRoomMembers("!r:x");
            expect(page.members[0]).toEqual({
                user_id: "@a:x",
                displayname: "A",
                avatar_url: null,
                membership: "join",
            });
            expect(page.total).toBe(1);
            expect(page.next_batch).toBeNull();
            expect(req.mock.calls[0][2]).toEqual({});
        });

        it("getRoomMessages keeps next_batch (backend returns chunk/start/end/next_batch)", async () => {
            req.mockResolvedValue({ chunk: [], start: "0", end: "17", next_batch: "17" });
            const page = await manager.getRoomMessages("!r:x");
            expect(page.next_batch).toBe("17");
            expect(page.start).toBe("0");
            expect(page.end).toBe("17");
        });

        it("getRoomStats returns the global overview object (backend does NOT wrap in {rooms})", async () => {
            req.mockResolvedValue({
                total_rooms: 5,
                encrypted_rooms: 1,
                public_rooms: 2,
                total_messages: 90,
                total_members: 12,
                active_rooms: 3,
                average_messages_per_room: 18,
            });
            const overview = await manager.getRoomStats();
            expect(overview.total_rooms).toBe(5);
            expect(overview.average_messages_per_room).toBe(18);
            expect(overview).not.toHaveProperty("rooms");
        });

        it("getRoomStatsByRoom accepts null last_message_ts (empty room)", async () => {
            req.mockResolvedValue({
                room_id: "!r:x",
                member_count: 0,
                message_count: 0,
                last_message_ts: null,
                is_encrypted: false,
                admin_count: 0,
            });
            const stats = await manager.getRoomStatsByRoom("!r:x");
            expect(stats.last_message_ts).toBeNull();
            expect(stats).not.toHaveProperty("name");
            expect(stats).not.toHaveProperty("avatar_url");
        });

        it("getRoomBlockStatus reflects {block:false} with no blocked_at", async () => {
            req.mockResolvedValue({ block: false });
            const status = await manager.getRoomBlockStatus("!r:x");
            expect(status.block).toBe(false);
            expect(status.blocked_at).toBeUndefined();
            expect(status).not.toHaveProperty("room_id");
            expect(status).not.toHaveProperty("user_id");
        });

        it("getRoomForwardExtremities is a count, not an array of objects", async () => {
            req.mockResolvedValue({ room_id: "!r:x", forward_extremities: 4 });
            const result = await manager.getRoomForwardExtremities("!r:x");
            expect(result.forward_extremities).toBe(4);
            expect(Array.isArray(result)).toBe(false);
            expect(result).not.toHaveProperty("event_id");
        });

        it("getRoomTokenSync returns results/total/next_batch/summary (no stream_ordering)", async () => {
            req.mockResolvedValue({
                room_id: "!r:x",
                results: [
                    {
                        user_id: "@a:x",
                        device_id: "D",
                        conn_id: null,
                        list_key: null,
                        pos: null,
                        token_created_ts: null,
                        token_expires_at: null,
                        room_timestamp: 0,
                        room_updated_ts: 1,
                        bump_stamp: 0,
                        highlight_count: 0,
                        notification_count: 2,
                        is_dm: false,
                        is_encrypted: true,
                        is_tombstoned: false,
                        invited: false,
                        name: "R",
                        avatar: null,
                        is_expired: false,
                    },
                ],
                total: 1,
                next_batch: null,
                summary: {
                    active_token_count: 0,
                    expired_token_count: 0,
                    distinct_users: 1,
                    distinct_devices: 1,
                },
            });
            const sync = await manager.getRoomTokenSync("!r:x");
            expect(sync.summary.distinct_devices).toBe(1);
            expect(sync.results[0]!.notification_count).toBe(2);
            expect(sync.results[0]!.invited).toBe(false);
            expect(sync).not.toHaveProperty("stream_ordering");
        });

        it("getRoomEventContext returns {event, events_before, events_after, state} (no events/start/end)", async () => {
            req.mockResolvedValue({
                event: {
                    event_id: "$e",
                    type: "m.room.message",
                    sender: "@a:x",
                    content: {},
                    room_id: "!r:x",
                    origin_server_ts: 1,
                },
                events_before: [],
                events_after: [],
                state: [],
            });
            const ctx = await manager.getRoomEventContext("!r:x", "$e");
            expect(ctx.event.event_id).toBe("$e");
            expect(ctx.events_before).toEqual([]);
            expect(ctx.events_after).toEqual([]);
            expect(ctx.state).toEqual([]);
            expect(ctx).not.toHaveProperty("events");
        });

        it("getRoomListings returns a single room's listing status (not a room list)", async () => {
            req.mockResolvedValue({ room_id: "!r:x", public: true, in_directory: false });
            const listings = await manager.getRoomListings("!r:x");
            expect(listings.public).toBe(true);
            expect(listings.in_directory).toBe(false);
            expect(listings).not.toHaveProperty("rooms");
            expect(listings).not.toHaveProperty("next_batch");
        });

        it("purgeRoomHistory returns success/deleted_events/dry_run (purge_id belongs to /purge_room)", async () => {
            req.mockResolvedValue({ success: true, deleted_events: 7, dry_run: false });
            const result = await manager.purgeRoomHistory("!r:x", { purge_up_to_ts: 1 });
            expect(result.deleted_events).toBe(7);
            expect(result.success).toBe(true);
            expect(result.dry_run).toBe(false);
            expect(result).not.toHaveProperty("purge_id");
        });

        it("listSpaces returns {spaces, total} with no cursor", async () => {
            req.mockResolvedValue({
                spaces: [{ space_id: "!s:x", room_id: "!s:x", name: "S", topic: null, creator: "@a:x", created_ts: 1 }],
                total: 1,
            });
            const page = await manager.listSpaces();
            expect(page.spaces[0]!.space_id).toBe("!s:x");
            expect(page.spaces[0]!.topic).toBeNull();
            expect(page.total).toBe(1);
            expect(page).not.toHaveProperty("next_batch");
            expect(page.spaces[0]).not.toHaveProperty("child_rooms");
            expect(page.spaces[0]).not.toHaveProperty("member_count");
        });

        it("getSpaceStats exposes member_count/child_room_count (not joined_members/rooms_count)", async () => {
            req.mockResolvedValue({ space_id: "!s:x", member_count: 3, child_room_count: 2 });
            const stats = await manager.getSpaceStats("!s:x");
            expect(stats.member_count).toBe(3);
            expect(stats.child_room_count).toBe(2);
            expect(stats).not.toHaveProperty("joined_members");
            expect(stats).not.toHaveProperty("rooms_count");
        });

        it("getSpaceUsers / getSpaceRooms return string id arrays, not object arrays", async () => {
            req.mockResolvedValue({ users: ["@a:x", "@b:x"], total: 2 });
            const users = await manager.getSpaceUsers("!s:x");
            expect(users.users).toEqual(["@a:x", "@b:x"]);
            expect(typeof users.users[0]).toBe("string");
            expect(users).not.toHaveProperty("next_batch");

            req.mockResolvedValue({ rooms: ["!a:x", "!b:x"], total: 2 });
            const rooms = await manager.getSpaceRooms("!s:x");
            expect(rooms.rooms).toEqual(["!a:x", "!b:x"]);
            expect(typeof rooms.rooms[0]).toBe("string");
            expect(rooms).not.toHaveProperty("next_batch");
        });

        it("listReports returns {reports, total} with no next_token (cursor is request-side since_ts/since_id)", async () => {
            req.mockResolvedValue({
                reports: [
                    {
                        id: 1,
                        room_id: "!r:x",
                        event_id: "$e",
                        user_id: "@a:x",
                        reported_user_id: null,
                        reason: null,
                        content: null,
                        status: "open",
                        score: 0,
                        received_ts: 1,
                    },
                ],
                total: 1,
            });
            const page = await manager.listReports();
            expect(page.total).toBe(1);
            expect(page.reports[0]!.id).toBe(1);
            expect(page).not.toHaveProperty("next_token");
            expect(page.reports[0]).not.toHaveProperty("name");
            expect(page.reports[0]).not.toHaveProperty("sender");
        });
    });
});
