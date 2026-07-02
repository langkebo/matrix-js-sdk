import { describe, it, expect, beforeEach, vi } from "vitest";

import { ModuleManager, ModuleEvent } from "../../src/module/index";

describe("ModuleManager", () => {
    let mockClient: any;
    let moduleManager: ModuleManager;

    const createMockClient = () => ({
        http: {
            authedRequest: vi.fn().mockResolvedValue({}),
        },
        getHomeserverUrl: () => "https://matrix.example.com",
        getUserId: () => "@admin:example.com",
    });

    beforeEach(() => {
        mockClient = createMockClient();
        moduleManager = new ModuleManager(mockClient as any);
        vi.clearAllMocks();
    });

    describe("module listing and management", () => {
        it("should list modules", async () => {
            const mockModules = {
                modules: [
                    { name: "test-module", type: "spam_checker", enabled: true },
                    { name: "auth-module", type: "password_auth_provider", enabled: false },
                ],
                total: 2,
            };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockModules);

            const result = await moduleManager.listModules({ from: "0", limit: 10 });
            expect(result.modules).toHaveLength(2);
            expect(result.total).toBe(2);
        });

        it("should list modules by type", async () => {
            const mockModules = {
                modules: [{ name: "spam-module", type: "spam_checker", enabled: true }],
            };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockModules);

            const result = await moduleManager.listModulesByType("spam_checker");
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("spam-module");
        });

        it("should get a single module", async () => {
            const mockModule = { name: "test-module", type: "spam_checker", enabled: true };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockModule);

            const result = await moduleManager.getModule("test-module");
            expect(result.name).toBe("test-module");
            expect(result.enabled).toBe(true);
        });

        it("should create a module", async () => {
            const mockModule = { name: "new-module", type: "custom", enabled: false };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockModule);

            const emittedEvents: any[] = [];
            moduleManager.on(ModuleEvent.ModuleCreated, (module: any) => emittedEvents.push(module));

            const result = await moduleManager.createModule({ name: "new-module", type: "custom" });
            expect(result.name).toBe("new-module");
            expect(emittedEvents).toHaveLength(1);
        });

        it("should delete a module", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            const emittedEvents: any[] = [];
            moduleManager.on(ModuleEvent.ModuleDeleted, (name: any) => emittedEvents.push(name));

            await moduleManager.deleteModule("old-module");
            expect(emittedEvents).toEqual(["old-module"]);
        });

        it("should update module config", async () => {
            const mockModule = {
                name: "test-module",
                type: "spam_checker",
                enabled: true,
                config: { threshold: 0.5 },
            };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockModule);

            const result = await moduleManager.updateModuleConfig("test-module", { threshold: 0.5 });
            expect(result.name).toBe("test-module");
            expect(result.config).toEqual({ threshold: 0.5 });
        });

        it("should enable a module", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            const emittedEvents: any[] = [];
            moduleManager.on(ModuleEvent.ModuleEnabled, (name: any) => emittedEvents.push(name));

            await moduleManager.setModuleEnabled("test-module", true);
            expect(emittedEvents).toEqual(["test-module"]);
        });

        it("should disable a module", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            const emittedEvents: any[] = [];
            moduleManager.on(ModuleEvent.ModuleDisabled, (name: any) => emittedEvents.push(name));

            await moduleManager.setModuleEnabled("test-module", false);
            expect(emittedEvents).toEqual(["test-module"]);
        });

        it("should get module logs", async () => {
            const mockLogs = {
                logs: [{ timestamp: 123456, level: "info", message: "test", module_name: "test" }],
                total: 1,
            };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockLogs);

            const result = await moduleManager.getModuleLogs("test-module", { from: "0", limit: 10 });
            expect(result.logs).toHaveLength(1);
            expect(result.total).toBe(1);
        });
    });

    describe("spam checking", () => {
        it("should check spam", async () => {
            const mockResult = { is_spam: true, reason: "spam detected", score: 0.9 };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockResult);

            const result = await moduleManager.checkSpam({
                event_id: "ev1",
                user_id: "@user:server",
                content: { body: "test" },
            });
            expect(result.is_spam).toBe(true);
            expect(result.score).toBe(0.9);
        });

        it("should get spam check result by event id", async () => {
            const mockResult = { is_spam: false };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockResult);

            const result = await moduleManager.getSpamCheckResult("ev1");
            expect(result.is_spam).toBe(false);
        });

        it("should get spam check results by sender", async () => {
            const mockResults = { checks: [{ is_spam: true, reason: "spam" }] };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockResults);

            const result = await moduleManager.getSpamCheckBySender("@user:server", {
                from: "0",
                limit: 10,
            });
            expect(result).toHaveLength(1);
        });
    });

    describe("third party rules", () => {
        it("should check third party rules", async () => {
            const mockResult = { allowed: true };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockResult);

            const result = await moduleManager.checkThirdPartyRule({
                rule_type: "m.room.member",
                event_id: "ev1",
                user_id: "@user:server",
            });
            expect(result.allowed).toBe(true);
        });

        it("should get third party rule result by event id", async () => {
            const mockResult = { allowed: false, reason: "blocked" };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockResult);

            const result = await moduleManager.getThirdPartyRuleResult("ev1");
            expect(result.allowed).toBe(false);
            expect(result.reason).toBe("blocked");
        });
    });

    describe("callbacks management", () => {
        it("should get account data callbacks", async () => {
            const mockCallbacks = {
                callbacks: [
                    { id: "1", module_name: "test", callback_type: "account_data", enabled: true },
                ],
            };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockCallbacks);

            const result = await moduleManager.getAccountDataCallbacks();
            expect(result).toHaveLength(1);
        });

        it("should register account data callback", async () => {
            const mockCallback = {
                id: "1",
                module_name: "test",
                callback_type: "account_data",
                enabled: true,
            };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockCallback);

            const result = await moduleManager.registerAccountDataCallback({
                module_name: "test",
                callback_type: "account_data",
            });
            expect(result.module_name).toBe("test");
        });

        it("should get media callbacks", async () => {
            const mockCallbacks = {
                callbacks: [
                    { id: "1", module_name: "test", callback_type: "media", enabled: true },
                ],
            };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockCallbacks);

            const result = await moduleManager.getMediaCallbacks();
            expect(result).toHaveLength(1);
        });

        it("should register media callback", async () => {
            const mockCallback = {
                id: "1",
                module_name: "test",
                callback_type: "media",
                enabled: true,
            };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockCallback);

            const result = await moduleManager.registerMediaCallback({
                module_name: "test",
                callback_type: "media",
            });
            expect(result.module_name).toBe("test");
        });

        it("should get media callbacks by type", async () => {
            const mockCallbacks = {
                callbacks: [
                    {
                        id: "1",
                        module_name: "test",
                        callback_type: "media/upload",
                        enabled: true,
                    },
                ],
            };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockCallbacks);

            const result = await moduleManager.getMediaCallbacksByType("media/upload");
            expect(result).toHaveLength(1);
        });

    });

    describe("password auth providers", () => {
        it("should get password auth providers", async () => {
            const mockProviders = {
                providers: [{ id: "1", name: "ldap", type: "ldap", enabled: true }],
            };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockProviders);

            const result = await moduleManager.getPasswordAuthProviders();
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("ldap");
        });

        it("should register password auth provider", async () => {
            const mockProvider = { id: "1", name: "ldap", type: "ldap", enabled: true };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockProvider);

            const result = await moduleManager.registerPasswordAuthProvider({
                name: "ldap",
                type: "ldap",
            });
            expect(result.name).toBe("ldap");
        });
    });

    describe("account validity", () => {
        it("should check account validity", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});
            await expect(moduleManager.checkAccountValidity()).resolves.toBeUndefined();
        });

        it("should get account validity for user", async () => {
            const mockValidity = { user_id: "@user:server", valid: true };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockValidity);

            const result = await moduleManager.getAccountValidity("@user:server");
            expect(result.user_id).toBe("@user:server");
            expect(result.valid).toBe(true);
        });

        it("should renew account validity", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            const emittedEvents: any[] = [];
            moduleManager.on(ModuleEvent.AccountValidityRenewed, (userId: any) =>
                emittedEvents.push(userId),
            );

            await moduleManager.renewAccountValidity("@user:server");
            expect(emittedEvents).toEqual(["@user:server"]);
        });
    });

    describe("error handling", () => {
        it("should emit ModuleError on request failure", async () => {
            const emittedErrors: any[] = [];
            moduleManager.on(ModuleEvent.ModuleError, (error: any) => emittedErrors.push(error));

            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Server error"));

            await expect(moduleManager.listModules()).rejects.toThrow("Server error");
            expect(emittedErrors).toHaveLength(1);
        });
    });
});