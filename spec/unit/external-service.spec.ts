import { describe, it, expect, beforeEach } from "vitest";
import { FakeTransport } from "../test-utils/FakeTransport";
import { ExternalServiceManager } from "../../src/external-service/index";
import { Method } from "../../src/http-api/method";
import { AdminPrefix } from "../../src/http-api/prefix";

describe("ExternalServiceManager", () => {
    let transport: FakeTransport;
    let manager: ExternalServiceManager;

    beforeEach(() => {
        transport = new FakeTransport();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        manager = new ExternalServiceManager({} as any, { transport });
    });

    // ─── listServices ────────────────────────────────────────────────

    it("listServices should GET /external_services with synapse_admin prefix by default", async () => {
        transport.respondWith({
            services: [{ id: "svc1", type: "webhook", url: "https://example.com/hook", enabled: true }],
        });
        const result = await manager.listServices();
        expect(result.services).toHaveLength(1);
        expect(result.services[0].id).toBe("svc1");
        transport.expectCalledWithArgs(Method.Get, "/external_services", undefined, undefined, {
            prefix: AdminPrefix.V1,
        });
    });

    it("listServices should work with matrix_admin prefix", async () => {
        expect.assertions(0);
        transport.respondWith({ services: [] });
        await manager.listServices("matrix_admin");
        transport.expectCalledWithArgs(Method.Get, "/external_services", undefined, undefined, {
            prefix: "/_matrix/admin/v1",
        });
    });

    it("listServices should throw when using client prefix", async () => {
        await expect(manager.listServices("client")).rejects.toThrow("Client prefix does not support listing services");
    });

    // ─── createService ───────────────────────────────────────────────

    it("createService should POST /external_services", async () => {
        const data = { type: "webhook", url: "https://example.com/hook", enabled: true };
        transport.respondWith({ id: "svc_new" });
        const result = await manager.createService(data);
        expect(result.id).toBe("svc_new");
        transport.expectCalledWithArgs(Method.Post, "/external_services", undefined, data, {
            prefix: AdminPrefix.V1,
        });
    });

    it("createService should work with matrix_admin prefix", async () => {
        expect.assertions(0);
        transport.respondWith({ id: "svc2" });
        await manager.createService({ type: "webhook", url: "https://hook.example.com" }, "matrix_admin");
        transport.expectCalledWithArgs(
            Method.Post,
            "/external_services",
            undefined,
            { type: "webhook", url: "https://hook.example.com" },
            {
                prefix: "/_matrix/admin/v1",
            },
        );
    });

    // ─── getService ─────────────────────────────────────────────────

    // SDK-BL-007: backend /external_services/{as_id} only registers PUT/DELETE
    // (no GET handler), so getService() would always 405. The method was removed;
    // callers should use listServices() and filter locally by id.
    it("should not expose getService (backend has no GET /external_services/{id})", () => {
        expect((manager as unknown as Record<string, unknown>).getService).toBeUndefined();
    });

    // ─── updateService ─────────────────────────────────────────────

    it("updateService should PUT /external_services/{id}", async () => {
        const update = { enabled: false };
        transport.respondWith({ id: "svc1" });
        const result = await manager.updateService("svc1", update);
        expect(result.id).toBe("svc1");
        transport.expectCalledWithArgs(Method.Put, "/external_services/svc1", undefined, update, {
            prefix: AdminPrefix.V1,
        });
    });

    it("updateService should work with client prefix", async () => {
        expect.assertions(0);
        transport.respondWith({ id: "svc1" });
        await manager.updateService("svc1", { enabled: true }, "client");
        transport.expectCalledWithArgs(
            Method.Put,
            "/external_services/svc1",
            undefined,
            { enabled: true },
            {
                prefix: "/_matrix/client/v1",
            },
        );
    });

    it("updateService should throw ValidationError for empty service ID", async () => {
        await expect(manager.updateService("", { enabled: true })).rejects.toThrow("serviceId is required");
    });

    // ─── deleteService ──────────────────────────────────────────────

    it("deleteService should DELETE /external_services/{id}", async () => {
        transport.respondWith({ id: "svc1" });
        const result = await manager.deleteService("svc1");
        expect(result.id).toBe("svc1");
        transport.expectCalledWithArgs(Method.Delete, "/external_services/svc1", undefined, undefined, {
            prefix: AdminPrefix.V1,
        });
    });

    it("deleteService should throw ValidationError for empty service ID", async () => {
        await expect(manager.deleteService("")).rejects.toThrow("serviceId is required");
    });

    // ─── getHealth ──────────────────────────────────────────────────

    it("getHealth should GET /external_services/health with synapse_admin prefix", async () => {
        transport.respondWith({ status: "healthy", services: [{ id: "svc1", type: "webhook", status: "ok" }] });
        const result = await manager.getHealth();
        expect(result.status).toBe("healthy");
        expect(result.services).toHaveLength(1);
        transport.expectCalledWithArgs(Method.Get, "/external_services/health", undefined, undefined, {
            prefix: AdminPrefix.V1,
        });
    });

    it("getHealth should work with matrix_admin prefix", async () => {
        expect.assertions(0);
        transport.respondWith({ status: "healthy" });
        await manager.getHealth("matrix_admin");
        transport.expectCalledWithArgs(Method.Get, "/external_services/health", undefined, undefined, {
            prefix: "/_matrix/admin/v1",
        });
    });

    // ─── getServiceHealth ──────────────────────────────────────────

    it("getServiceHealth should GET /external_services/{id}/health", async () => {
        const resp = { id: "svc1", type: "webhook", status: "healthy", last_check: 1234567890 };
        transport.respondWith(resp);
        const result = await manager.getServiceHealth("svc1");
        expect(result.status).toBe("healthy");
        transport.expectCalledWithArgs(Method.Get, "/external_services/svc1/health", undefined, undefined, {
            prefix: AdminPrefix.V1,
        });
    });

    it("getServiceHealth should throw ValidationError for empty service ID", async () => {
        await expect(manager.getServiceHealth("")).rejects.toThrow("serviceId is required");
    });

    // ─── checkServiceHealth ─────────────────────────────────────────

    it("checkServiceHealth should POST /external_services/{id}/health/check", async () => {
        const resp = { id: "svc1", status: "healthy", checked_at: 1234567890, healthy: true };
        transport.respondWith(resp);
        const result = await manager.checkServiceHealth("svc1");
        expect(result.healthy).toBe(true);
        transport.expectCalledWithArgs(Method.Post, "/external_services/svc1/health/check", undefined, undefined, {
            prefix: AdminPrefix.V1,
        });
    });

    it("checkServiceHealth should throw ValidationError for empty service ID", async () => {
        await expect(manager.checkServiceHealth("")).rejects.toThrow("serviceId is required");
    });

    // ─── triggerWebhook ─────────────────────────────────────────────

    it("triggerWebhook should POST /webhook/{id} with WEBHOOK_PREFIX", async () => {
        const payload = { event: "test", data: { key: "value" } };
        transport.respondWith({ success: true, message: "Webhook triggered" });
        const result = await manager.triggerWebhook("svc1", payload);
        expect(result.success).toBe(true);
        transport.expectCalledWithArgs(Method.Post, "/webhook/svc1", undefined, payload, {
            prefix: "/_synapse/external",
        });
    });

    it("triggerWebhook should work without payload", async () => {
        transport.respondWith({ success: true });
        const result = await manager.triggerWebhook("svc1");
        expect(result.success).toBe(true);
    });

    it("triggerWebhook should throw ValidationError for empty service ID", async () => {
        await expect(manager.triggerWebhook("")).rejects.toThrow("serviceId is required");
    });

    // ─── triggerOpenclawWebhook ────────────────────────────────────

    it("triggerOpenclawWebhook should POST /openclaw/{id}/webhook", async () => {
        transport.respondWith({ success: true });
        const result = await manager.triggerOpenclawWebhook("svc1", { query: "hello" });
        expect(result.success).toBe(true);
        transport.expectCalledWithArgs(
            Method.Post,
            "/openclaw/svc1/webhook",
            undefined,
            { query: "hello" },
            {
                prefix: "/_synapse/external",
            },
        );
    });

    it("triggerOpenclawWebhook should throw ValidationError for empty service ID", async () => {
        await expect(manager.triggerOpenclawWebhook("")).rejects.toThrow("serviceId is required");
    });

    // ─── triggerTrendradarWebhook ──────────────────────────────────

    it("triggerTrendradarWebhook should POST /trendradar/{id}/webhook", async () => {
        transport.respondWith({ success: true });
        const result = await manager.triggerTrendradarWebhook("svc1", { topic: "AI" });
        expect(result.success).toBe(true);
        transport.expectCalledWithArgs(
            Method.Post,
            "/trendradar/svc1/webhook",
            undefined,
            { topic: "AI" },
            {
                prefix: "/_synapse/external",
            },
        );
    });

    it("triggerTrendradarWebhook should throw ValidationError for empty service ID", async () => {
        await expect(manager.triggerTrendradarWebhook("")).rejects.toThrow("serviceId is required");
    });

    // ─── extendMatrixClient export ─────────────────────────────────

    it("should export ExternalServiceManager class", () => {
        expect(typeof ExternalServiceManager).toBe("function");
    });

    it("should have expected prototype methods", () => {
        expect(typeof manager.listServices).toBe("function");
        expect(typeof manager.createService).toBe("function");
        expect(typeof manager.updateService).toBe("function");
        expect(typeof manager.deleteService).toBe("function");
        expect(typeof manager.getHealth).toBe("function");
        expect(typeof manager.triggerWebhook).toBe("function");
    });
});
