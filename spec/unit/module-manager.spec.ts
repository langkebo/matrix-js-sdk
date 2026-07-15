import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeTransport } from "../test-utils/FakeTransport";
import { ModuleManager, ModuleEvent } from "../../src/module/index";
import { Method } from "../../src/http-api/method";
import { MatrixError } from "../../src/http-api/errors";
import { NotFoundError } from "../../src/errors";

describe("ModuleManager", () => {
    let transport: FakeTransport;
    let manager: ModuleManager;

    beforeEach(() => {
        transport = new FakeTransport();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        manager = new ModuleManager({} as any, { transport });
    });

    // ==================== 模块管理 ====================

    describe("module management", () => {
        it("should list modules", async () => {
            const response = {
                modules: [
                    { name: "spam-checker", type: "spam_checker", enabled: true },
                    { name: "auth-module", type: "password_auth_provider", enabled: false },
                ],
                total: 2,
            };
            transport.respondWith(response);

            const result = await manager.listModules({ limit: 10, from: "0" });

            expect(result.modules).toHaveLength(2);
            expect(result.total).toBe(2);
            transport.expectCalledWith(Method.Get, "/modules");
        });

        it("should list modules by type", async () => {
            const response = { modules: [{ name: "spam-module", type: "spam_checker", enabled: true }] };
            transport.respondWith(response);

            const result = await manager.listModulesByType("spam_checker");

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("spam-module");
            transport.expectCalledWith(Method.Get, "/modules/type/spam_checker");
        });

        it("should get a single module", async () => {
            const response = { name: "my-module", type: "spam_checker", enabled: true, version: "1.0" };
            transport.respondWith(response);

            const result = await manager.getModule("my-module");

            expect(result.name).toBe("my-module");
            expect(result.version).toBe("1.0");
            transport.expectCalledWith(Method.Get, "/modules/my-module");
        });

        it("should throw NotFoundError when module is not found", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Module not found" }, 404, undefined);
            transport.rejectWith(matrixError);

            await expect(manager.getModule("nonexistent")).rejects.toThrow(NotFoundError);
        });

        it("should create a module and emit event", async () => {
            const response = { name: "new-module", type: "spam_checker", enabled: true };
            transport.respondWith(response);
            const emitSpy = vi.spyOn(manager, "emit");

            const result = await manager.createModule({ name: "new-module", type: "spam_checker" });

            expect(result.name).toBe("new-module");
            transport.expectCalledWith(Method.Post, "/modules");
            expect(emitSpy).toHaveBeenCalledWith(ModuleEvent.ModuleCreated, response);
        });

        it("should delete a module and emit event", async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            transport.respondWith(undefined as any);
            const emitSpy = vi.spyOn(manager, "emit");

            await manager.deleteModule("old-module");

            transport.expectCalledWith(Method.Delete, "/modules/old-module");
            expect(emitSpy).toHaveBeenCalledWith(ModuleEvent.ModuleDeleted, "old-module");
        });

        it("should update module config and emit event", async () => {
            const response = { name: "my-module", type: "spam_checker", enabled: true, config: { key: "val" } };
            transport.respondWith(response);
            const emitSpy = vi.spyOn(manager, "emit");

            const result = await manager.updateModuleConfig("my-module", { key: "val" });

            expect(result.name).toBe("my-module");
            transport.expectCalledWith(Method.Put, "/modules/my-module/config");
            expect(emitSpy).toHaveBeenCalledWith(ModuleEvent.ModuleConfigUpdated, "my-module", { key: "val" });
        });

        it("should enable a module and emit event", async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            transport.respondWith(undefined as any);
            const emitSpy = vi.spyOn(manager, "emit");

            await manager.setModuleEnabled("my-module", true);

            transport.expectCalledWith(Method.Post, "/modules/my-module/enable");
            expect(emitSpy).toHaveBeenCalledWith(ModuleEvent.ModuleEnabled, "my-module");
        });

        it("should disable a module and emit event", async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            transport.respondWith(undefined as any);
            const emitSpy = vi.spyOn(manager, "emit");

            await manager.setModuleEnabled("my-module", false);

            expect(emitSpy).toHaveBeenCalledWith(ModuleEvent.ModuleDisabled, "my-module");
        });

        it("should get module logs", async () => {
            const response = {
                logs: [{ timestamp: 1000, level: "INFO", message: "Started", module_name: "my-module" }],
                total: 1,
            };
            transport.respondWith(response);

            const result = await manager.getModuleLogs("my-module", { limit: 10 });

            expect(result.logs).toHaveLength(1);
            transport.expectCalledWith(Method.Get, "/modules/my-module/logs");
        });
    });

    // ==================== Spam 检查 ====================

    describe("spam checking", () => {
        it("should check spam and emit event", async () => {
            const response = { is_spam: true, reason: "Blocked by policy", score: 0.95 };
            transport.respondWith(response);
            const emitSpy = vi.spyOn(manager, "emit");

            const result = await manager.checkSpam({
                event_id: "$evt1",
                user_id: "@spammer:example.com",
                content: { body: "spam" },
            });

            expect(result.is_spam).toBe(true);
            expect(result.reason).toBe("Blocked by policy");
            transport.expectCalledWith(Method.Post, "/modules/check_spam");
            expect(emitSpy).toHaveBeenCalledWith(ModuleEvent.SpamCheckCompleted, response);
        });

        it("should get spam check result by event id", async () => {
            transport.respondWith({ is_spam: false, score: 0 });

            const result = await manager.getSpamCheckResult("$evt1");

            expect(result.is_spam).toBe(false);
            transport.expectCalledWith(Method.Get, "/modules/spam_check/%24evt1");
        });

        it("should get spam checks by sender", async () => {
            const response = { checks: [{ is_spam: true, reason: "spam" }] };
            transport.respondWith(response);

            const result = await manager.getSpamCheckBySender("@spammer:example.com");

            expect(result).toHaveLength(1);
            transport.expectCalledWith(Method.Get, "/modules/spam_check/sender/%40spammer%3Aexample.com");
        });
    });

    // ==================== 第三方规则 ====================

    describe("third-party rules", () => {
        it("should check third-party rule and emit event", async () => {
            const response = { allowed: false, reason: "Rule violation" };
            transport.respondWith(response);
            const emitSpy = vi.spyOn(manager, "emit");

            const result = await manager.checkThirdPartyRule({
                rule_type: "m.room.message",
                event_id: "$evt2",
                user_id: "@user:example.com",
            });

            expect(result.allowed).toBe(false);
            transport.expectCalledWith(Method.Post, "/modules/check_third_party_rule");
            expect(emitSpy).toHaveBeenCalledWith(ModuleEvent.ThirdPartyRuleChecked, response);
        });

        it("should get third-party rule result by event id", async () => {
            transport.respondWith({ allowed: true });

            const result = await manager.getThirdPartyRuleResult("$evt2");

            expect(result.allowed).toBe(true);
            transport.expectCalledWith(Method.Get, "/modules/third_party_rule/%24evt2");
        });
    });

    // ==================== 回调管理 ====================

    describe("callbacks", () => {
        it("should get account data callbacks", async () => {
            const response = {
                callbacks: [{ id: "cb1", module_name: "mod1", callback_type: "on_change", enabled: true }],
            };
            transport.respondWith(response);

            const result = await manager.getAccountDataCallbacks();

            expect(result).toHaveLength(1);
            transport.expectCalledWith(Method.Get, "/account_data_callbacks");
        });

        it("should register account data callback and emit event", async () => {
            const response = { id: "cb1", module_name: "mod1", callback_type: "on_change", enabled: true };
            transport.respondWith(response);
            const emitSpy = vi.spyOn(manager, "emit");

            const result = await manager.registerAccountDataCallback({
                module_name: "mod1",
                callback_type: "on_change",
            });

            expect(result.id).toBe("cb1");
            transport.expectCalledWith(Method.Post, "/account_data_callbacks");
            expect(emitSpy).toHaveBeenCalledWith(ModuleEvent.AccountDataCallbackRegistered, response);
        });

        it("should get media callbacks", async () => {
            const response = {
                callbacks: [{ id: "mcb1", module_name: "mod1", callback_type: "on_upload", enabled: true }],
            };
            transport.respondWith(response);

            const result = await manager.getMediaCallbacks();

            expect(result).toHaveLength(1);
            transport.expectCalledWith(Method.Get, "/media_callbacks");
        });

        it("should register media callback and emit event", async () => {
            const response = { id: "mcb1", module_name: "mod1", callback_type: "on_upload", enabled: true };
            transport.respondWith(response);
            const emitSpy = vi.spyOn(manager, "emit");

            const result = await manager.registerMediaCallback({ module_name: "mod1", callback_type: "on_upload" });

            expect(result.id).toBe("mcb1");
            transport.expectCalledWith(Method.Post, "/media_callbacks");
            expect(emitSpy).toHaveBeenCalledWith(ModuleEvent.MediaCallbackRegistered, response);
        });

        it("should get media callbacks by type", async () => {
            const response = {
                callbacks: [{ id: "mcb1", module_name: "mod1", callback_type: "on_upload", enabled: true }],
            };
            transport.respondWith(response);

            const result = await manager.getMediaCallbacksByType("on_upload");

            expect(result).toHaveLength(1);
            transport.expectCalledWith(Method.Get, "/media_callbacks/on_upload");
        });
    });

    // ==================== 密码认证提供商 ====================

    describe("password auth providers", () => {
        it("should list password auth providers", async () => {
            const response = { providers: [{ id: "p1", name: "LDAP", type: "ldap_auth", enabled: true }] };
            transport.respondWith(response);

            const result = await manager.getPasswordAuthProviders();

            expect(result).toHaveLength(1);
            transport.expectCalledWith(Method.Get, "/password_auth_providers");
        });

        it("should register password auth provider and emit event", async () => {
            const response = { id: "p1", name: "LDAP", type: "ldap_auth", enabled: true };
            transport.respondWith(response);
            const emitSpy = vi.spyOn(manager, "emit");

            const result = await manager.registerPasswordAuthProvider({ name: "LDAP", type: "ldap_auth" });

            expect(result.name).toBe("LDAP");
            transport.expectCalledWith(Method.Post, "/password_auth_providers");
            expect(emitSpy).toHaveBeenCalledWith(ModuleEvent.PasswordAuthProviderRegistered, response);
        });
    });

    // ==================== 账户有效性 ====================

    describe("account validity", () => {
        it("should check account validity", async () => {
            expect.assertions(0);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            transport.respondWith(undefined as any);

            await manager.checkAccountValidity();

            transport.expectCalledWith(Method.Post, "/account_validity");
        });

        it("should get account validity for a user and emit event", async () => {
            const response = { user_id: "@user:example.com", valid: true, expires_at: 9999999999 };
            transport.respondWith(response);
            const emitSpy = vi.spyOn(manager, "emit");

            const result = await manager.getAccountValidity("@user:example.com");

            expect(result.valid).toBe(true);
            transport.expectCalledWith(Method.Get, "/account_validity/%40user%3Aexample.com");
            expect(emitSpy).toHaveBeenCalledWith(ModuleEvent.AccountValidityChecked, response);
        });

        it("should renew account validity and emit event", async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            transport.respondWith(undefined as any);
            const emitSpy = vi.spyOn(manager, "emit");

            await manager.renewAccountValidity("@user:example.com");

            transport.expectCalledWith(Method.Post, "/account_validity/%40user%3Aexample.com/renew");
            expect(emitSpy).toHaveBeenCalledWith(ModuleEvent.AccountValidityRenewed, "@user:example.com");
        });
    });

    // ==================== 事件发射 ====================

    describe("event emission", () => {
        it("should emit ModuleError on request failure", async () => {
            transport.rejectWith(new Error("Server error"));
            const emitSpy = vi.spyOn(manager, "emit");

            await expect(manager.listModules()).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(ModuleEvent.ModuleError, expect.any(Error));
        });
    });
});
