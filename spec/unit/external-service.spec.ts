import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminPrefix, Method } from "../../src/http-api/index.ts";
import { ExternalServiceEvent, ExternalServiceManager } from "../../src/external-service/index.ts";

describe("ExternalServiceManager", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let manager: ExternalServiceManager;

    beforeEach(() => {
        authedRequest = vi.fn();
        manager = new ExternalServiceManager({ http: { authedRequest } } as any);
    });

    it("updates external services with the backend request shape", async () => {
        authedRequest.mockResolvedValueOnce({
            as_id: "trendradar_news-bot",
            service_type: "trendradar",
            service_id: "news-bot",
            display_name: "News Bot",
            is_enabled: false,
            is_healthy: true,
            created_ts: 123,
        });

        await expect(
            manager.updateService("trendradar_news-bot", {
                webhookUrl: "https://example.com/webhook",
                apiKey: "secret",
                config: { topic: "tech" },
                isEnabled: false,
            }),
        ).resolves.toEqual({
            asId: "trendradar_news-bot",
            serviceType: "trendradar",
            serviceId: "news-bot",
            displayName: "News Bot",
            isEnabled: false,
            isHealthy: true,
            createdTs: 123,
        });

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Put,
            "/external_services/trendradar_news-bot",
            undefined,
            {
                webhook_url: "https://example.com/webhook",
                api_key: "secret",
                config: { topic: "tech" },
                is_enabled: false,
            },
            { prefix: AdminPrefix.V1 },
        );
    });

    it("rejects empty service ids on update", async () => {
        await expect(manager.updateService("", {})).rejects.toThrow("Service ID is required");
        expect(authedRequest).not.toHaveBeenCalled();
    });

    it("propagates 4xx errors from the backend on update", async () => {
        const httpError = Object.assign(new Error("Not Found"), {
            httpStatus: 404,
            errcode: "M_NOT_FOUND",
            data: { errcode: "M_NOT_FOUND", error: "Unknown application service" },
        });
        authedRequest.mockRejectedValueOnce(httpError);

        await expect(manager.updateService("trendradar_missing", { isEnabled: false })).rejects.toMatchObject({
            httpStatus: 404,
            errcode: "M_NOT_FOUND",
        });

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Put,
            "/external_services/trendradar_missing",
            undefined,
            { is_enabled: false },
            { prefix: AdminPrefix.V1 },
        );
    });

    it("only serialises defined fields and skips undefined ones on update", async () => {
        authedRequest.mockResolvedValueOnce({
            as_id: "trendradar_news-bot",
            service_type: "trendradar",
            service_id: "news-bot",
            display_name: "Renamed Bot",
            is_enabled: true,
            is_healthy: true,
            created_ts: 123,
        });

        await manager.updateService("trendradar_news-bot", {
            displayName: "Renamed Bot",
            // webhookUrl/apiKey/config/isEnabled intentionally omitted
        });

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Put,
            "/external_services/trendradar_news-bot",
            undefined,
            { display_name: "Renamed Bot" },
            { prefix: AdminPrefix.V1 },
        );
    });

    describe("registerService", () => {
        it("posts the request, caches the response, and emits ServiceRegistered", async () => {
            authedRequest.mockResolvedValueOnce({
                as_id: "trendradar_news-bot",
                service_type: "trendradar",
                service_id: "news-bot",
                display_name: "News Bot",
                is_enabled: true,
                is_healthy: true,
                created_ts: 123,
            });
            const seen: unknown[] = [];
            manager.on(ExternalServiceEvent.ServiceRegistered, (s) => seen.push(s));

            const service = await manager.registerService({
                serviceType: "trendradar",
                serviceId: "news-bot",
                displayName: "News Bot",
                webhookUrl: "https://example.com/webhook",
                apiKey: "secret",
                config: { topic: "tech" },
            });

            expect(service.asId).toBe("trendradar_news-bot");
            expect(manager.getCachedService("trendradar_news-bot")).toEqual(service);
            expect(seen).toEqual([service]);
            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/external_services",
                undefined,
                {
                    service_type: "trendradar",
                    service_id: "news-bot",
                    display_name: "News Bot",
                    webhook_url: "https://example.com/webhook",
                    api_key: "secret",
                    config: { topic: "tech" },
                },
                { prefix: AdminPrefix.V1 },
            );
        });

        it("propagates errors and emits an Error event without caching", async () => {
            const httpError = Object.assign(new Error("Forbidden"), {
                httpStatus: 403,
                errcode: "M_FORBIDDEN",
            });
            authedRequest.mockRejectedValueOnce(httpError);
            const errors: unknown[] = [];
            manager.on(ExternalServiceEvent.Error, (e) => errors.push(e));

            await expect(
                manager.registerService({
                    serviceType: "trendradar",
                    serviceId: "news-bot",
                    displayName: "News Bot",
                }),
            ).rejects.toMatchObject({ httpStatus: 403, errcode: "M_FORBIDDEN" });

            expect(errors).toHaveLength(1);
            expect(errors[0]).toMatchObject({ httpStatus: 403, errcode: "M_FORBIDDEN" });
            expect(manager.getCachedServices()).toEqual([]);
        });
    });

    describe("typed helper registration APIs", () => {
        it("registerTrendRadarService delegates with the trendradar service type", async () => {
            const registerServiceSpy = vi.spyOn(manager, "registerService").mockResolvedValue({} as any);

            await manager.registerTrendRadarService("news-bot", "News Bot", "https://example.com/trend", "secret");

            expect(registerServiceSpy).toHaveBeenCalledWith({
                serviceType: "trendradar",
                serviceId: "news-bot",
                displayName: "News Bot",
                webhookUrl: "https://example.com/trend",
                apiKey: "secret",
            });
        });

        it("registerOpenClawService delegates with the openclaw service type", async () => {
            const registerServiceSpy = vi.spyOn(manager, "registerService").mockResolvedValue({} as any);

            await manager.registerOpenClawService("ops-bot", "Ops Bot", "https://example.com/openclaw", "token");

            expect(registerServiceSpy).toHaveBeenCalledWith({
                serviceType: "openclaw",
                serviceId: "ops-bot",
                displayName: "Ops Bot",
                webhookUrl: "https://example.com/openclaw",
                apiKey: "token",
            });
        });

        it("registerWebhookService delegates with the generic webhook service type", async () => {
            const registerServiceSpy = vi.spyOn(manager, "registerService").mockResolvedValue({} as any);

            await manager.registerWebhookService("alerts", "Alerts", "https://example.com/webhook", "hook-key");

            expect(registerServiceSpy).toHaveBeenCalledWith({
                serviceType: "generic_webhook",
                serviceId: "alerts",
                displayName: "Alerts",
                webhookUrl: "https://example.com/webhook",
                apiKey: "hook-key",
            });
        });
    });

    describe("listServices", () => {
        it("forwards service_type as a query parameter and caches results", async () => {
            authedRequest.mockResolvedValueOnce([
                {
                    as_id: "trendradar_a",
                    service_type: "trendradar",
                    service_id: "a",
                    display_name: "A",
                    is_enabled: true,
                    is_healthy: true,
                    created_ts: 1,
                },
            ]);

            const list = await manager.listServices("trendradar");

            expect(list).toHaveLength(1);
            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/external_services",
                { service_type: "trendradar" },
                undefined,
                { prefix: AdminPrefix.V1 },
            );
            expect(manager.getCachedService("trendradar_a")?.serviceId).toBe("a");
        });

        it("falls back to the cache when the backend errors", async () => {
            authedRequest.mockResolvedValueOnce([
                {
                    as_id: "trendradar_a",
                    service_type: "trendradar",
                    service_id: "a",
                    display_name: "A",
                    is_enabled: true,
                    is_healthy: true,
                    created_ts: 1,
                },
            ]);
            await manager.listServices();

            authedRequest.mockRejectedValueOnce(new Error("network down"));
            const fallback = await manager.listServices();

            expect(fallback).toHaveLength(1);
            expect(fallback[0].asId).toBe("trendradar_a");
        });
    });

    describe("getServiceHealth", () => {
        it("rejects empty service ids", async () => {
            await expect(manager.getServiceHealth("")).rejects.toThrow("Service ID is required");
            expect(authedRequest).not.toHaveBeenCalled();
        });

        it("normalises the wire payload to camelCase", async () => {
            authedRequest.mockResolvedValueOnce({
                service_id: "news-bot",
                service_type: "trendradar",
                is_healthy: true,
                last_check_ts: 100,
                last_success_ts: 99,
                consecutive_failures: 0,
            });

            const health = await manager.getServiceHealth("trendradar_news-bot");

            expect(health).toEqual({
                serviceId: "news-bot",
                serviceType: "trendradar",
                isHealthy: true,
                lastCheckTs: 100,
                lastSuccessTs: 99,
                lastError: undefined,
                consecutiveFailures: 0,
            });
        });

        it("returns null when the backend errors (swallow-fallback)", async () => {
            authedRequest.mockRejectedValueOnce(new Error("network"));
            await expect(manager.getServiceHealth("trendradar_news-bot")).resolves.toBeNull();
        });
    });

    describe("checkServiceHealth", () => {
        it("propagates errors instead of swallowing them", async () => {
            const httpError = Object.assign(new Error("Bad Gateway"), { httpStatus: 502 });
            authedRequest.mockRejectedValue(httpError);

            await expect(manager.checkServiceHealth("trendradar_news-bot")).rejects.toMatchObject({
                httpStatus: 502,
            });
            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/external_services/trendradar_news-bot/health/check",
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        });

        it("maps the response to camelCase on success", async () => {
            authedRequest.mockResolvedValueOnce({ as_id: "trendradar_news-bot", is_healthy: false });

            await expect(manager.checkServiceHealth("trendradar_news-bot")).resolves.toEqual({
                asId: "trendradar_news-bot",
                isHealthy: false,
            });
        });
    });

    describe("unregisterService", () => {
        it("deletes, evicts the cache entry, and emits ServiceUnregistered", async () => {
            authedRequest.mockResolvedValueOnce({
                as_id: "trendradar_news-bot",
                service_type: "trendradar",
                service_id: "news-bot",
                display_name: "News Bot",
                is_enabled: true,
                is_healthy: true,
                created_ts: 123,
            });
            await manager.registerService({
                serviceType: "trendradar",
                serviceId: "news-bot",
                displayName: "News Bot",
            });

            authedRequest.mockResolvedValueOnce(undefined);
            const seen: string[] = [];
            manager.on(ExternalServiceEvent.ServiceUnregistered, (id) => seen.push(id));

            await manager.unregisterService("trendradar_news-bot");

            expect(seen).toEqual(["trendradar_news-bot"]);
            expect(manager.getCachedService("trendradar_news-bot")).toBeUndefined();
            expect(authedRequest).toHaveBeenLastCalledWith(
                Method.Delete,
                "/external_services/trendradar_news-bot",
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        });

        it("rejects empty service ids", async () => {
            await expect(manager.unregisterService("")).rejects.toThrow("Service ID is required");
            expect(authedRequest).not.toHaveBeenCalled();
        });
    });

    describe("getAllHealthStatus", () => {
        it("normalises every entry on success", async () => {
            authedRequest.mockResolvedValueOnce([
                {
                    service_id: "a",
                    service_type: "trendradar",
                    is_healthy: true,
                    last_check_ts: 1,
                },
                {
                    service_id: "b",
                    service_type: "openclaw",
                    is_healthy: false,
                    last_check_ts: 2,
                    last_error: "timeout",
                    consecutive_failures: 3,
                },
            ]);

            const all = await manager.getAllHealthStatus();
            expect(all).toEqual([
                {
                    serviceId: "a",
                    serviceType: "trendradar",
                    isHealthy: true,
                    lastCheckTs: 1,
                    lastSuccessTs: undefined,
                    lastError: undefined,
                    consecutiveFailures: 0,
                },
                {
                    serviceId: "b",
                    serviceType: "openclaw",
                    isHealthy: false,
                    lastCheckTs: 2,
                    lastSuccessTs: undefined,
                    lastError: "timeout",
                    consecutiveFailures: 3,
                },
            ]);
        });

        it("returns an empty array when the backend errors (swallow-fallback)", async () => {
            authedRequest.mockRejectedValueOnce(new Error("network"));
            await expect(manager.getAllHealthStatus()).resolves.toEqual([]);
        });
    });

    describe("isServiceRegistered", () => {
        it("short-circuits via the cache without hitting the backend", async () => {
            authedRequest.mockResolvedValueOnce({
                as_id: "trendradar_news-bot",
                service_type: "trendradar",
                service_id: "news-bot",
                display_name: "News Bot",
                is_enabled: true,
                is_healthy: true,
                created_ts: 123,
            });
            await manager.registerService({
                serviceType: "trendradar",
                serviceId: "news-bot",
                displayName: "News Bot",
            });
            authedRequest.mockClear();

            await expect(manager.isServiceRegistered("trendradar_news-bot")).resolves.toBe(true);
            expect(authedRequest).not.toHaveBeenCalled();
        });

        it("falls through to listServices when the cache misses", async () => {
            authedRequest.mockResolvedValueOnce([
                {
                    as_id: "trendradar_a",
                    service_type: "trendradar",
                    service_id: "a",
                    display_name: "A",
                    is_enabled: true,
                    is_healthy: true,
                    created_ts: 1,
                },
            ]);
            await expect(manager.isServiceRegistered("trendradar_a")).resolves.toBe(true);

            authedRequest.mockResolvedValueOnce([]);
            manager.clearCache();
            await expect(manager.isServiceRegistered("trendradar_missing")).resolves.toBe(false);
        });
    });

    describe("clearCache", () => {
        it("empties the cache without touching the backend", async () => {
            authedRequest.mockResolvedValueOnce({
                as_id: "trendradar_news-bot",
                service_type: "trendradar",
                service_id: "news-bot",
                display_name: "News Bot",
                is_enabled: true,
                is_healthy: true,
                created_ts: 123,
            });
            await manager.registerService({
                serviceType: "trendradar",
                serviceId: "news-bot",
                displayName: "News Bot",
            });
            authedRequest.mockClear();

            manager.clearCache();
            expect(manager.getCachedServices()).toEqual([]);
            expect(authedRequest).not.toHaveBeenCalled();
        });
    });
});
