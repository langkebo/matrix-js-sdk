import { describe, it, expect, beforeEach, vi } from "vitest";

import { AdminManager } from "../../src/admin/index";
import { ValidationError } from "../../src/errors";
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

        it("confirmFederation POSTs payload to /v1/federation/confirm", async () => {
            await manager.confirmFederation({ server_name: "example.org", action: "approve", reason: "verified" });
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/federation/confirm");
            expect(req.mock.calls[0][3]).toEqual({
                server_name: "example.org",
                action: "approve",
                reason: "verified",
            });
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
        it("getFederationAdmissionList prefers /v1/federation/pending", async () => {
            req.mockResolvedValueOnce({ pending: [{ server_name: "example.org" }] });
            const result = await manager.getFederationAdmissionList();
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/federation/pending");
            expect(result).toEqual([{ server_name: "example.org" }]);
        });

        it("getFederationAdmissionList falls back to /v1/federation/admissions on 404", async () => {
            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            req.mockResolvedValueOnce({ admissions: [{ server_name: "legacy.example" }] });
            const result = await manager.getFederationAdmissionList();
            expect(req.mock.calls[0][1]).toBe("/federation/pending");
            expect(req.mock.calls[1][1]).toBe("/federation/admissions");
            expect(result).toEqual([{ server_name: "legacy.example" }]);
        });

        it("getPendingFederationServers uses /v1/federation/pending with pagination", async () => {
            req.mockResolvedValueOnce({ pending_servers: [], total: 0 });
            await manager.getPendingFederationServers("10", 20);
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/federation/pending");
            expect(req.mock.calls[0][2]).toEqual({ from: "10", limit: "20" });
        });

        it("getPendingFederationServers falls back to /v1/federation/pending_servers on 404", async () => {
            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            req.mockResolvedValueOnce({ pending_servers: [], total: 0 });
            await manager.getPendingFederationServers("1", 5);
            expect(req.mock.calls[0][1]).toBe("/federation/pending");
            expect(req.mock.calls[1][1]).toBe("/federation/pending_servers");
            expect(req.mock.calls[1][2]).toEqual({ from: "1", limit: "5" });
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

        it("getModuleLogs applies limit+from query", async () => {
            await manager.getModuleLogs("mod1", { limit: 20, from: 3 });
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
            await manager.cleanupRooms({ limit: 100 });
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/rooms/cleanup");
            expect(req.mock.calls[0][3]).toEqual({ limit: 100 });
            expect(req.mock.calls[1][1]).toBe("/cleanup/rooms");
            expect(req.mock.calls[1][3]).toEqual({ limit: 100 });
        });

        it("purgeRoom/shutdownRoom post to room maintenance routes", async () => {
            await manager.purgeRoom({ room_id: "!room:example.com" });
            await manager.shutdownRoom({ room_id: "!room:example.com", new_room_user_id: "@admin:example.com" });
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/purge_room");
            expect(req.mock.calls[0][3]).toEqual({ room_id: "!room:example.com" });
            expect(req.mock.calls[1][0]).toBe("POST");
            expect(req.mock.calls[1][1]).toBe("/shutdown_room");
        });

        it("purgeHistory/restartServer post to server maintenance routes", async () => {
            await manager.purgeHistory({ purge_up_to_ts: 123 });
            await manager.restartServer({ reason: "maintenance-window" });
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/purge_history");
            expect(req.mock.calls[0][3]).toEqual({ purge_up_to_ts: 123 });
            expect(req.mock.calls[1][0]).toBe("POST");
            expect(req.mock.calls[1][1]).toBe("/restart");
            expect(req.mock.calls[1][3]).toEqual({ reason: "maintenance-window" });
        });

        it("getServerHealth prefers /v1/health and falls back on 404", async () => {
            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            req.mockResolvedValueOnce({ healthy: true });
            const result = await manager.getServerHealth();
            expect(req.mock.calls[0][1]).toBe("/health");
            expect(req.mock.calls[1][1]).toBe("/server_health");
            expect(result).toEqual({ healthy: true });
        });

        it("getServerInfo prefers /v1/info and falls back on 404", async () => {
            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            req.mockResolvedValueOnce({ server_name: "example.org" });
            const result = await manager.getServerInfo();
            expect(req.mock.calls[0][1]).toBe("/info");
            expect(req.mock.calls[1][1]).toBe("/server_info");
            expect(result).toEqual({ server_name: "example.org" });
        });

        it("getAdminInfo uses GET /info", async () => {
            await manager.getAdminInfo();
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/info");
        });
    });

    describe("notifications and pushers", () => {
        it("listNotifications uses GET /v1/notifications with pagination", async () => {
            req.mockResolvedValueOnce({ notifications: [], next_token: "n1" });
            const result = await manager.listNotifications("10", 20);
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/notifications");
            expect(req.mock.calls[0][2]).toEqual({ from: "10", limit: "20" });
            expect(result).toEqual({ notifications: [], next_token: "n1" });
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
            req.mockResolvedValueOnce({ notifications: [{ notification_id: "n1" }] });
            const result = await manager.listActiveNotifications();
            expect(req.mock.calls[0][1]).toBe("/notifications/active");
            expect(result).toEqual([{ notification_id: "n1" }]);
        });

        it("getUserNotification/setUserNotification use user route", async () => {
            await manager.getUserNotification("@u:x");
            await manager.setUserNotification("@u:x", { enabled: false });
            expect(req.mock.calls[0][1]).toBe("/users/%40u%3Ax/notification");
            expect(req.mock.calls[1][0]).toBe("PUT");
            expect(req.mock.calls[1][1]).toBe("/users/%40u%3Ax/notification");
            expect(req.mock.calls[1][3]).toEqual({ enabled: false });
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
        it("getUserMedia uses GET /v1/users/{user_id}/media with pagination", async () => {
            req.mockResolvedValueOnce({ media: [{ media_id: "m1" }], next_token: "n1" });
            const result = await manager.getUserMedia("@u:x", "3", 9);
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/users/%40u%3Ax/media");
            expect(req.mock.calls[0][2]).toEqual({ from: "3", limit: "9" });
            expect(result).toEqual({ media: [{ media_id: "m1" }], next_token: "n1" });
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
            await manager.listUserStats("1", 9);
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/users/%40u%3Ax/rooms");
            expect(req.mock.calls[0][2]).toEqual({ from: "3", limit: "7" });
            expect(req.mock.calls[1][1]).toBe("/users/%40u%3Ax/stats");
            expect(req.mock.calls[2][1]).toBe("/user_stats");
            expect(req.mock.calls[2][2]).toEqual({ from: "1", limit: "9" });
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
        it("getUserDevices prefers /v1/users/{user_id}/devices and falls back to /v2 on 404", async () => {
            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            req.mockResolvedValueOnce({ devices: [{ device_id: "DEV1" }] });
            const devices = await manager.getUserDevices("@u:x");
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/users/%40u%3Ax/devices");
            expect(req.mock.calls[1][0]).toBe("GET");
            expect(req.mock.calls[1][1]).toBe("/v2/users/%40u%3Ax/devices");
            expect(devices).toEqual([{ device_id: "DEV1" }]);
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

        it("getServerStats prefers /v1/statistics and falls back to /v1/server_stats on 404", async () => {
            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            req.mockResolvedValueOnce({ total_users: 1, total_rooms: 2 });
            const stats = await manager.getServerStats();
            expect(req.mock.calls[0][1]).toBe("/statistics");
            expect(req.mock.calls[1][1]).toBe("/server_stats");
            expect(stats.total_users).toBe(1);
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
            await manager.registerAdmin({ username: "admin", password: "pw", admin: true });
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
            const payload = { term: "hello" };
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
            await manager.purgeRoomHistory("!room:example.com", { delete_local_events: true });
            await manager.unblockRoom("!room:example.com", { reason: "manual-review" });
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe(`/rooms/${encodeURIComponent("!room:example.com")}/delete`);
            expect(req.mock.calls[0][3]).toEqual({ purge: true, reason: "cleanup" });
            expect(req.mock.calls[1][0]).toBe("POST");
            expect(req.mock.calls[1][1]).toBe(`/rooms/${encodeURIComponent("!room:example.com")}/purge_history`);
            expect(req.mock.calls[1][3]).toEqual({ delete_local_events: true });
            expect(req.mock.calls[2][0]).toBe("POST");
            expect(req.mock.calls[2][1]).toBe(`/rooms/${encodeURIComponent("!room:example.com")}/unblock`);
            expect(req.mock.calls[2][3]).toEqual({ reason: "manual-review" });
        });

        it("validates room/event ids for extra room routes", async () => {
            await expect(manager.getRoomEventContext("!room:example.com", "")).rejects.toThrow(ValidationError);
            await expect(manager.getRoomForwardExtremities("bad-room")).rejects.toThrow(ValidationError);
            await expect(manager.getRoomTokenSync("bad-room")).rejects.toThrow(ValidationError);
            await expect(manager.searchRoomEvents("bad-room", {})).rejects.toThrow(ValidationError);
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
            await expect(manager.banRoom("bad-room", {})).rejects.toThrow(ValidationError);
            await expect(manager.kickRoom("bad-room", {})).rejects.toThrow(ValidationError);
            await expect(manager.makeRoomAdmin("bad-room", {})).rejects.toThrow(ValidationError);
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

        it("updateRegistrationToken prefers POST and falls back to PUT on 404", async () => {
            req.mockRejectedValueOnce(
                new MatrixError({
                    errcode: "M_NOT_FOUND",
                    httpStatus: 404,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any),
            );
            req.mockResolvedValueOnce({});
            await manager.updateRegistrationToken("token-1", { uses_allowed: 5 });
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/registration_tokens/token-1");
            expect(req.mock.calls[1][0]).toBe("PUT");
            expect(req.mock.calls[1][1]).toBe("/registration_tokens/token-1");
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

        it("batchCreateUsers and batchDeactivateUsers use v1 batch routes", async () => {
            await manager.batchCreateUsers({ users: [{ user_id: "@a:x" }] });
            await manager.batchDeactivateUsers({ user_ids: ["@a:x"] });
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/users/batch");
            expect(req.mock.calls[0][3]).toEqual({ users: [{ user_id: "@a:x" }] });
            expect(req.mock.calls[1][0]).toBe("POST");
            expect(req.mock.calls[1][1]).toBe("/users/batch_deactivate");
            expect(req.mock.calls[1][3]).toEqual({ user_ids: ["@a:x"] });
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
            await manager.updateAccountDetails("@u:x", { suspended: true });
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/account/%40u%3Ax");
            expect(req.mock.calls[0][3]).toEqual({ suspended: true });
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
        it("POSTs /v1/purge_media_cache with empty body when no arg", async () => {
            req.mockResolvedValue({ deleted: 0 });
            const result = await manager.purgeMediaCache();
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/purge_media_cache");
            expect(req.mock.calls[0][3]).toEqual({});
            expect(result).toEqual({ deleted: 0 });
        });

        it("passes before_ts body when provided", async () => {
            req.mockResolvedValue({ deleted: 42 });
            const ts = 1_700_000_000_000;
            const result = await manager.purgeMediaCache(ts);
            expect(req.mock.calls[0][3]).toEqual({ before_ts: ts });
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
            req.mockResolvedValue({ enabled: [], disabled: [], total: 0, total_flags: 3 });
            const result = await manager.getExperimentalFeatures();
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/experimental_features");
            expect(result).toHaveProperty("enabled");
            expect(result).toHaveProperty("disabled");
        });
    });
});
