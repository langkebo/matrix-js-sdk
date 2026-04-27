import { describe, it, expect, beforeEach, vi } from "vitest";

import { AdminManager } from "../../src/admin/index";
import { ValidationError } from "../../src/errors";

describe("AdminManager extended endpoints (retention/audit/feature-flags/federation)", () => {
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
            expect(req.mock.calls[0][1]).toBe("/v1/retention/policy");
            expect(req.mock.calls[0][4]).toMatchObject({ prefix: "/_synapse/admin" });
        });

        it("setRetentionPolicy POSTs body unchanged", async () => {
            await manager.setRetentionPolicy({ max_lifetime: 3600 });
            expect(req.mock.calls[0][3]).toEqual({ max_lifetime: 3600 });
        });

        it("getRoomRetentionPolicy validates room ID", async () => {
            await expect(manager.getRoomRetentionPolicy("bad")).rejects.toThrow(ValidationError);
        });

        it("runRetention POSTs {room_id}", async () => {
            await manager.runRetention("!r:x");
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/v1/retention/run");
            expect(req.mock.calls[0][3]).toEqual({ room_id: "!r:x" });
        });
    });

    // --------- audit ---------
    describe("audit events", () => {
        it("listAuditEvents encodes params as query strings", async () => {
            req.mockResolvedValue({ events: [], total: 0, next_token: null });
            await manager.listAuditEvents({ actor_id: "@a:x", limit: 50 });
            expect(req.mock.calls[0][0]).toBe("GET");
            expect(req.mock.calls[0][1]).toBe("/v1/audit/events");
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
            expect(req.mock.calls[0][1]).toBe("/v1/feature-flags/flag1");
            expect(req.mock.calls[0][3]).toEqual({ rollout_percent: 50 });
        });
    });

    // --------- federation resolve/rewrite ---------
    describe("federation resolve/rewrite", () => {
        it("resolveFederation POSTs {server_name}", async () => {
            await manager.resolveFederation("example.org");
            expect(req.mock.calls[0][1]).toBe("/v1/federation/resolve");
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
    });

    // --------- federation destinations detail ---------
    describe("federation destinations detail", () => {
        it("deleteFederationDestination uses DELETE", async () => {
            await manager.deleteFederationDestination("example.org");
            expect(req.mock.calls[0][0]).toBe("DELETE");
            expect(req.mock.calls[0][1]).toBe("/v1/federation/destinations/example.org");
        });

        it("getFederationDestinationRooms passes from+limit", async () => {
            req.mockResolvedValue({ rooms: [] });
            await manager.getFederationDestinationRooms("example.org", { from: 10, limit: 5 });
            expect(req.mock.calls[0][1]).toBe("/v1/federation/destinations/example.org/rooms");
            expect(req.mock.calls[0][2]).toEqual({ from: "10", limit: "5" });
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
            expect(req.mock.calls[0][1]).toBe(
                "/v1/event_reports/rate_limit/%40a%3Ax/unblock",
            );
        });
    });

    // --------- telemetry alerts ---------
    describe("telemetry alerts", () => {
        it("acknowledgeTelemetryAlert POSTs to /ack", async () => {
            await manager.acknowledgeTelemetryAlert("alert-1");
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/v1/telemetry/alerts/alert-1/ack");
        });
    });

    // --------- modules ---------
    describe("modules admin", () => {
        it("setModuleEnabled posts {enabled}", async () => {
            await manager.setModuleEnabled("mod1", true);
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/v1/modules/mod1/enable");
            expect(req.mock.calls[0][3]).toEqual({ enabled: true });
        });

        it("getModuleLogs applies limit+from query", async () => {
            await manager.getModuleLogs("mod1", { limit: 20, from: 3 });
            expect(req.mock.calls[0][2]).toEqual({ limit: "20", from: "3" });
        });
    });

    // --------- setAdmin route correctness ---------
    describe("setAdmin", () => {
        it("uses PUT /v1/users/{id}/admin with {admin} body", async () => {
            await manager.setAdmin("@u:x", true);
            expect(req.mock.calls[0][0]).toBe("PUT");
            expect(req.mock.calls[0][1]).toBe("/v1/users/%40u%3Ax/admin");
            expect(req.mock.calls[0][3]).toEqual({ admin: true });
        });
    });

    // --------- getAccountStatus reroute ---------
    describe("getAccountStatus", () => {
        it("hits /v1/account/{user_id}", async () => {
            req.mockResolvedValue({ user_id: "@u:x", exists: true });
            await manager.getAccountStatus("@u:x");
            expect(req.mock.calls[0][1]).toBe("/v1/account/%40u%3Ax");
        });
    });

    // --------- purgeMediaCache (backend now implements) ---------
    describe("purgeMediaCache", () => {
        it("POSTs /v1/purge_media_cache with empty body when no arg", async () => {
            req.mockResolvedValue({ deleted: 0 });
            const result = await manager.purgeMediaCache();
            expect(req.mock.calls[0][0]).toBe("POST");
            expect(req.mock.calls[0][1]).toBe("/v1/purge_media_cache");
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
            expect(req.mock.calls[0][1]).toBe("/v1/backups");
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
            expect(req.mock.calls[0][1]).toBe("/v1/experimental_features");
            expect(result).toHaveProperty("enabled");
            expect(result).toHaveProperty("disabled");
        });
    });
});
