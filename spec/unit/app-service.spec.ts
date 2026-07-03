import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeTransport } from "../test-utils/FakeTransport";
import { ApplicationServiceManager, AppServiceEvent } from "../../src/app-service/index";
import { Method } from "../../src/http-api/method";
import { AdminPrefix, ClientPrefix } from "../../src/http-api/prefix";
import { ValidationError } from "../../src/errors";

describe("ApplicationServiceManager", () => {
    let transport: FakeTransport;
    let manager: ApplicationServiceManager;
    const mockClient = {
        getDomain: () => "example.com",
    } as any;

    beforeEach(() => {
        transport = new FakeTransport();
        manager = new ApplicationServiceManager(mockClient, { transport });
    });

    describe("registerAppService", () => {
        it("should register a new application service", async () => {
            const response = {
                id: 1,
                as_id: "my-bridge",
                url: "https://bridge.example.com",
                sender: "bridge_bot",
                rate_limited: false,
                protocols: ["irc"],
                is_enabled: true,
                created_ts: 1000,
            };
            transport.respondWith(response);

            const result = await manager.registerAppService({
                id: "my-bridge",
                url: "https://bridge.example.com",
                as_token: "astoken123",
                hs_token: "hstoken456",
                sender_localpart: "bridge_bot",
            });

            expect(result.as_id).toBe("my-bridge");
            expect(result.sender).toBe("@bridge_bot:example.com");
            transport.expectCalledWith(Method.Post, "/application_services");
        });

        it("should reject registration with missing required fields", async () => {
            const req = { id: "", url: "", as_token: "", hs_token: "", sender_localpart: "" };
            await expect(manager.registerAppService(req as any)).rejects.toThrow(ValidationError);
        });

        it("should emit ServiceRegistered event on success", async () => {
            const response = {
                id: 1, as_id: "as1", url: "https://as.example.com",
                sender: "bot", rate_limited: false, protocols: [], is_enabled: true, created_ts: 1000,
            };
            transport.respondWith(response);
            const emitSpy = vi.spyOn(manager, "emit");

            await manager.registerAppService({
                id: "as1", url: "https://as.example.com",
                as_token: "t", hs_token: "t", sender_localpart: "bot",
            });

            expect(emitSpy).toHaveBeenCalledWith(AppServiceEvent.ServiceRegistered, "as1", expect.any(Object));
        });

        it("should cache the registered service for later lookups", async () => {
            const response = {
                id: 1, as_id: "cached-as", url: "https://cached.example.com",
                sender: "cbot", rate_limited: false, protocols: [], is_enabled: true, created_ts: 1000,
            };
            transport.respondWith(response);

            await manager.registerAppService({
                id: "cached-as", url: "https://cached.example.com",
                as_token: "t", hs_token: "t", sender_localpart: "cbot",
            });

            const cached = manager.getCachedService("cached-as");
            expect(cached).not.toBeNull();
            expect(cached!.as_id).toBe("cached-as");
        });
    });

    describe("getApplicationService", () => {
        it("should fetch a service from the API when not cached", async () => {
            const response = {
                id: 10, as_id: "remote-as", url: "https://remote.example.com",
                sender: "rbot", rate_limited: true, protocols: ["slack"], is_enabled: true, created_ts: 2000,
            };
            transport.respondWith(response);

            const result = await manager.getApplicationService("remote-as");

            expect(result).not.toBeNull();
            expect(result!.as_id).toBe("remote-as");
            transport.expectCalledWith(Method.Get, "/application_services/remote-as");
        });

        it("should return cached service without HTTP call", async () => {
            transport.respondWith([
                { id: 5, as_id: "preloaded", url: "https://pre.example.com", sender: "pbot", rate_limited: false, protocols: [], is_enabled: true, created_ts: 3000 },
            ]);
            await manager.listApplicationServices();
            transport.resetCalls();

            const result = await manager.getApplicationService("preloaded");

            expect(result).not.toBeNull();
            expect(transport.request).not.toHaveBeenCalled();
        });

        it("should return null on error", async () => {
            transport.rejectWith(new Error("Network error"));

            const result = await manager.getApplicationService("nonexistent");

            expect(result).toBeNull();
        });
    });

    describe("updateApplicationService", () => {
        it("should update an existing service", async () => {
            const response = {
                id: 1, as_id: "update-me", url: "https://updated.example.com",
                sender: "ubot", rate_limited: true, protocols: ["matrix"], is_enabled: true, created_ts: 4000,
            };
            transport.respondWith(response);

            const result = await manager.updateApplicationService("update-me", { url: "https://updated.example.com" });

            expect(result.url).toBe("https://updated.example.com");
            transport.expectCalledWith(Method.Put, "/application_services/update-me");
        });

        it("should emit ServiceUpdated event", async () => {
            const response = { id: 1, as_id: "evt-as", url: "https://evt.example.com", sender: "ebot", rate_limited: false, protocols: [], is_enabled: true, created_ts: 5000 };
            transport.respondWith(response);
            const emitSpy = vi.spyOn(manager, "emit");

            await manager.updateApplicationService("evt-as", { description: "updated desc" });

            expect(emitSpy).toHaveBeenCalledWith(AppServiceEvent.ServiceUpdated, "evt-as", expect.any(Object));
        });
    });

    describe("unregisterApplicationService", () => {
        it("should delete a service and emit event", async () => {
            transport.respondWith(undefined as any);
            const emitSpy = vi.spyOn(manager, "emit");

            await manager.unregisterApplicationService("to-delete");

            transport.expectCalledWith(Method.Delete, "/application_services/to-delete");
            expect(emitSpy).toHaveBeenCalledWith(AppServiceEvent.ServiceUnregistered, "to-delete");
        });
    });

    describe("listApplicationServices", () => {
        it("should list and cache all services", async () => {
            const response = [
                { id: 1, as_id: "as1", url: "https://a1.com", sender: "bot1", rate_limited: false, protocols: [], is_enabled: true, created_ts: 100 },
                { id: 2, as_id: "as2", url: "https://a2.com", sender: "bot2", rate_limited: true, protocols: ["irc"], is_enabled: false, created_ts: 200 },
            ];
            transport.respondWith(response);

            const services = await manager.listApplicationServices();

            expect(services).toHaveLength(2);
            expect(services[0].as_id).toBe("as1");
            expect(services[1].as_id).toBe("as2");
            transport.expectCalledWith(Method.Get, "/application_services");
        });
    });

    describe("checkUserId / checkAlias", () => {
        it("should check user id via exists field", async () => {
            transport.respondWith({ exists: true });

            const result = await manager.checkUserId("@bot:example.com");

            expect(result).toBe(true);
            transport.expectCalledWith(Method.Get, "/appservice/user");
        });

        it("should check alias and return true when application_service is set", async () => {
            transport.respondWith({ alias: "#irc:example.com", application_service: "irc-bridge", exists: true });

            const result = await manager.checkAlias("#irc:example.com");

            expect(result).toBe(true);
            transport.expectCalledWith(Method.Get, "/appservice/alias");
        });

        it("should return false on error for checkUserId", async () => {
            transport.rejectWith(new Error("Server error"));

            const result = await manager.checkUserId("@unknown:example.com");

            expect(result).toBe(false);
        });
    });

    describe("pingApplicationService", () => {
        it("should ping and return a duration", async () => {
            transport.respondWith(undefined as any);

            const result = await manager.pingApplicationService("my-bridge");

            expect(result.duration).toBeGreaterThanOrEqual(0);
            transport.expectCalledWith(Method.Post, "/application_services/my-bridge/ping");
        });

        it("should return duration -1 on error", async () => {
            transport.rejectWith(new Error("Timeout"));

            const result = await manager.pingApplicationService("offline-bridge");

            expect(result.duration).toBe(-1);
        });
    });

    describe("third-party protocols", () => {
        it("should get a protocol by name", async () => {
            const protocolResponse = { instances: [{ network_id: "testnet", desc: "Test Network" }] };
            transport.respondWith(protocolResponse);

            const result = await manager.getProtocol("irc");

            expect(result).toEqual(protocolResponse);
            transport.expectCalledWith(Method.Get, "/thirdparty/protocol/irc");
        });

        it("should list protocol names", async () => {
            transport.respondWith({ irc: {}, slack: {} });

            const protocols = await manager.getProtocols();

            expect(protocols).toEqual(["irc", "slack"]);
        });

        it("should query third-party users", async () => {
            const users = [{ user_id: "@alice:example.com" }];
            transport.respondWith(users);

            const result = await manager.queryUsers("irc", { nick: "alice" });

            expect(result).toEqual(users);
        });

        it("should query third-party locations", async () => {
            const locations = [{ alias: "#channel:example.com" }];
            transport.respondWith(locations);

            const result = await manager.queryLocations("irc", { alias: "#channel" });

            expect(result).toEqual(locations);
        });
    });

    describe("extended admin endpoints", () => {
        it("should get application service state", async () => {
            const state = [{ as_id: "as1", state_key: "key1", state_value: "val1", updated_ts: 1000 }];
            transport.respondWith(state);

            const result = await manager.getApplicationServiceState("as1");

            expect(result).toEqual(state);
            transport.expectCalledWith(Method.Get, "/application_services/as1/state");
        });

        it("should set application service state", async () => {
            transport.respondWith(undefined as any);

            await manager.setApplicationServiceState("as1", "mykey", "myvalue");

            transport.expectCalledWith(Method.Put, "/application_services/as1/state/mykey");
        });

        it("should list application service users", async () => {
            const result = { users: [{ user_id: "@asbot:example.com" }] };
            transport.respondWith(result);

            const users = await manager.listApplicationServiceUsers("as1");

            expect(users).toEqual(result);
        });

        it("should query application service user", async () => {
            const queryResult = { user_id: "@test:example.com", application_service: "as1", exists: true };
            transport.respondWith(queryResult);

            const result = await manager.queryApplicationServiceUser("as1", "@test:example.com");

            expect(result.exists).toBe(true);
            transport.expectCalledWith(Method.Get, "/application_services/as1/query/user/%40test%3Aexample.com");
        });
    });

    describe("cache and lifecycle", () => {
        it("should return all cached services via getCachedServices", async () => {
            const response = { id: 1, as_id: "c1", url: "https://c1.com", sender: "bot1", rate_limited: false, protocols: [], is_enabled: true, created_ts: 100 };
            transport.respondWith(response);
            await manager.registerAppService({
                id: "c1", url: "https://c1.com", as_token: "t", hs_token: "t", sender_localpart: "bot1",
            });

            const all = manager.getCachedServices();
            expect(all).toHaveLength(1);
            expect(all[0].as_id).toBe("c1");
        });

        it("should clear cache via clearCache", async () => {
            const response = { id: 1, as_id: "cc", url: "https://cc.com", sender: "bot", rate_limited: false, protocols: [], is_enabled: true, created_ts: 100 };
            transport.respondWith(response);
            await manager.registerAppService({
                id: "cc", url: "https://cc.com", as_token: "t", hs_token: "t", sender_localpart: "bot",
            });

            manager.clearCache();
            expect(manager.getCachedService("cc")).toBeNull();
        });

        it("should initialize on start", async () => {
            transport.respondWith([]);
            manager.clearCache();

            await manager.start();

            expect(transport.request).toHaveBeenCalled();
        });

        it("should clear cache on stop", async () => {
            const response = { id: 1, as_id: "st", url: "https://st.com", sender: "bot", rate_limited: false, protocols: [], is_enabled: true, created_ts: 100 };
            transport.respondWith(response);
            await manager.registerAppService({
                id: "st", url: "https://st.com", as_token: "t", hs_token: "t", sender_localpart: "bot",
            });

            manager.stop();
            expect(manager.getCachedService("st")).toBeNull();
        });
    });

    describe("error handling", () => {
        it("should emit ServiceError on registration failure", async () => {
            transport.rejectWith(new Error("Registration failed"));
            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.registerAppService({
                id: "fail", url: "https://fail.com",
                as_token: "t", hs_token: "t", sender_localpart: "bot",
            })).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(AppServiceEvent.ServiceError, expect.any(Error));
        });
    });
});
