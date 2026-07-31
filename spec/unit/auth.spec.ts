/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { describe, expect, it, vi, beforeEach } from "vitest";

import { AuthManager, AuthEvent } from "../../src/auth/index";
import { Method, ClientPrefix } from "../../src/http-api";

describe("AuthManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let authManager: AuthManager;
    let mockAuthedRequest: ReturnType<typeof vi.fn>;
    let mockRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockAuthedRequest = vi.fn();
        mockRequest = vi.fn();
        mockClient = {
            http: {
                authedRequest: mockAuthedRequest,
                request: mockRequest,
            },
            isAuthenticated: vi.fn().mockReturnValue(false),
        };
        authManager = new AuthManager(mockClient);
    });

    describe("Data Validation", () => {
        it("should reject username longer than 255 characters", async () => {
            const longUsername = "a".repeat(256);
            const auth = { type: "m.login.dummy" };

            await expect(authManager.register(longUsername, "password123", null, auth)).rejects.toThrow(
                "Username too long (max 255 characters)",
            );
        });

        it("should accept username with exactly 255 characters", async () => {
            const maxUsername = "a".repeat(255);
            const auth = { type: "m.login.dummy" };
            mockRequest.mockResolvedValue({
                access_token: "token",
                user_id: "@user:example.com",
                device_id: "ABCDEFGHIJKLMNOP",
            });

            await authManager.register(maxUsername, "password123", null, auth);

            expect(mockRequest).toHaveBeenCalled();
        });

        it("should reject password longer than 128 characters", async () => {
            const longPassword = "a".repeat(129);
            const auth = { type: "m.login.dummy" };

            await expect(authManager.register("alice", longPassword, null, auth)).rejects.toThrow(
                "Password too long (max 128 characters)",
            );
        });

        it("should accept password with exactly 128 characters", async () => {
            const maxPassword = "a".repeat(128);
            const auth = { type: "m.login.dummy" };
            mockRequest.mockResolvedValue({
                access_token: "token",
                user_id: "@alice:example.com",
                device_id: "ABCDEFGHIJKLMNOP",
            });

            await authManager.register("alice", maxPassword, null, auth);

            expect(mockRequest).toHaveBeenCalled();
        });
    });

    describe("Static Validation Methods", () => {
        it("should validate username format - valid", () => {
            const result = AuthManager.validateUsernameFormat("alice");
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it("should validate username format - empty", () => {
            const result = AuthManager.validateUsernameFormat("");
            expect(result.valid).toBe(false);
            expect(result.error).toBe("Username is required");
        });

        it("should validate username format - too long", () => {
            const result = AuthManager.validateUsernameFormat("a".repeat(256));
            expect(result.valid).toBe(false);
            expect(result.error).toBe("Username too long (max 255 characters)");
        });

        it("should validate username format - invalid characters", () => {
            const result = AuthManager.validateUsernameFormat("alice@domain");
            expect(result.valid).toBe(false);
            expect(result.error).toBe("Username contains invalid characters");
        });

        it("should validate password format - valid", () => {
            const result = AuthManager.validatePasswordFormat("password123");
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it("should validate password format - empty", () => {
            const result = AuthManager.validatePasswordFormat("");
            expect(result.valid).toBe(false);
            expect(result.error).toBe("Password is required");
        });

        it("should validate password format - too short", () => {
            const result = AuthManager.validatePasswordFormat("pass");
            expect(result.valid).toBe(false);
            expect(result.error).toBe("Password too short (min 8 characters)");
        });

        it("should validate password format - too long", () => {
            const result = AuthManager.validatePasswordFormat("a".repeat(129));
            expect(result.valid).toBe(false);
            expect(result.error).toBe("Password too long (max 128 characters)");
        });
    });

    describe("Constraints", () => {
        it("should return data constraints", () => {
            const constraints = AuthManager.getConstraints();
            expect(constraints.USERNAME_MAX_LENGTH).toBe(255);
            expect(constraints.PASSWORD_MAX_LENGTH).toBe(128);
            expect(constraints.DEVICE_ID_LENGTH).toBe(16);
        });
    });

    describe("Authentication State", () => {
        it("should check if authenticated", () => {
            mockClient.isAuthenticated.mockReturnValue(true);
            expect(authManager.isAuthenticated()).toBe(true);

            mockClient.isAuthenticated.mockReturnValue(false);
            expect(authManager.isAuthenticated()).toBe(false);
        });

        it("should return false when isAuthenticated is not defined", () => {
            delete mockClient.isAuthenticated;
            expect(authManager.isAuthenticated()).toBe(false);
        });

        it("should get auth login type", () => {
            mockClient.authLoginType = "m.login.password";
            expect(authManager.getAuthLoginType()).toBe("m.login.password");
        });

        it("should return undefined when auth login type is not set", () => {
            expect(authManager.getAuthLoginType()).toBeUndefined();
        });

        it("should set auth payload", () => {
            const payload = { username: "test", password: "pass" };
            authManager.setAuthPayload(payload);
            expect(mockClient.authPayload).toEqual(payload);
        });

        it("should get fallback retry text", () => {
            mockClient.fallbackGetLoginRetryText = "Please try again";
            expect(authManager.getFallbackRetryText()).toBe("Please try again");
        });

        it("should return empty string when fallback text is not set", () => {
            expect(authManager.getFallbackRetryText()).toBe("");
        });

        it("should set fallback retry text", () => {
            authManager.setFallbackRetryText("Custom retry text");
            expect(mockClient.fallbackGetLoginRetryText).toBe("Custom retry text");
        });
    });

    describe("Login Flows", () => {
        it("should get supported login flows", async () => {
            const flows = {
                flows: [{ type: "m.login.password" }, { type: "m.login.sso" }],
            };
            mockRequest.mockResolvedValue(flows);

            const result = await authManager.getSupportedLoginFlows();

            expect(mockRequest).toHaveBeenCalledWith(Method.Get, "/login", undefined, undefined, {
                prefix: ClientPrefix.V3,
            });
            expect(result).toEqual(flows);
        });

        it("should cache login flows", async () => {
            const flows = {
                flows: [{ type: "m.login.password" }],
            };
            mockRequest.mockResolvedValue(flows);

            await authManager.getSupportedLoginFlows();
            const cachedResult = await authManager.getSupportedLoginFlows();

            expect(mockRequest).toHaveBeenCalledTimes(1);
            expect(cachedResult).toEqual(flows);
        });

        it("should force refresh login flows", async () => {
            const flows1 = { flows: [{ type: "m.login.password" }] };
            const flows2 = { flows: [{ type: "m.login.sso" }] };

            mockRequest.mockResolvedValueOnce(flows1);
            mockRequest.mockResolvedValueOnce(flows2);

            await authManager.getSupportedLoginFlows();
            const result = await authManager.getSupportedLoginFlows(true);

            expect(mockRequest).toHaveBeenCalledTimes(2);
            expect(result).toEqual(flows2);
        });

        it("should emit LoginFlowUpdated event", async () => {
            const flows = { flows: [{ type: "m.login.password" }] };
            mockRequest.mockResolvedValue(flows);

            const emitSpy = vi.spyOn(authManager, "emit");
            await authManager.getSupportedLoginFlows();

            expect(emitSpy).toHaveBeenCalledWith(AuthEvent.LoginFlowUpdated, flows);
        });

        it("should check if login flow exists", async () => {
            const flows = {
                flows: [{ type: "m.login.password" }, { type: "m.login.sso" }],
            };
            mockRequest.mockResolvedValue(flows);

            expect(await authManager.hasLoginFlow("m.login.password")).toBe(true);
            expect(await authManager.hasLoginFlow("m.login.token")).toBe(false);
        });

        it("should check if password login is supported", async () => {
            const flows = {
                flows: [{ type: "m.login.password" }],
            };
            mockRequest.mockResolvedValue(flows);

            expect(await authManager.hasPasswordLogin()).toBe(true);
        });

        it("should check if SSO login is supported", async () => {
            const flows = {
                flows: [{ type: "m.login.sso" }],
            };
            mockRequest.mockResolvedValue(flows);

            expect(await authManager.hasSSOLogin()).toBe(true);
        });
    });

    describe("Register Flows", () => {
        it("should get register flows", async () => {
            const flows = {
                flows: [{ stages: ["m.login.email.identity", "m.login.msisdn"] }, { stages: ["m.login.dummy"] }],
                params: {},
            };
            mockRequest.mockResolvedValue(flows);

            const result = await authManager.getRegisterFlows();

            expect(mockRequest).toHaveBeenCalledWith(Method.Get, "/register", undefined, undefined, {
                prefix: ClientPrefix.V3,
            });
            expect(result).toEqual(flows);
        });

        it("should cache register flows", async () => {
            const flows = {
                flows: [{ stages: ["m.login.dummy"] }],
                params: {},
            };
            mockRequest.mockResolvedValue(flows);

            await authManager.getRegisterFlows();
            const cachedResult = await authManager.getRegisterFlows();

            expect(mockRequest).toHaveBeenCalledTimes(1);
            expect(cachedResult).toEqual(flows);
        });

        it("should force refresh register flows", async () => {
            const flows1 = { flows: [{ stages: ["m.login.dummy"] }], params: {} };
            const flows2 = { flows: [{ stages: ["m.login.email.identity"] }], params: {} };

            mockRequest.mockResolvedValueOnce(flows1);
            mockRequest.mockResolvedValueOnce(flows2);

            await authManager.getRegisterFlows();
            const result = await authManager.getRegisterFlows(true);

            expect(mockRequest).toHaveBeenCalledTimes(2);
            expect(result).toEqual(flows2);
        });

        it("should emit RegisterFlowUpdated event", async () => {
            const flows = { flows: [{ stages: ["m.login.dummy"] }], params: {} };
            mockRequest.mockResolvedValue(flows);

            const emitSpy = vi.spyOn(authManager, "emit");
            await authManager.getRegisterFlows();

            expect(emitSpy).toHaveBeenCalledWith(AuthEvent.RegisterFlowUpdated, flows);
        });
    });

    describe("Cache Management", () => {
        it("should clear all caches", async () => {
            const loginFlows = { flows: [{ type: "m.login.password" }] };
            const registerFlows = { flows: [{ stages: ["m.login.dummy"] }], params: {} };

            mockRequest.mockResolvedValueOnce(loginFlows);
            mockRequest.mockResolvedValueOnce(registerFlows);

            await authManager.getSupportedLoginFlows();
            await authManager.getRegisterFlows();

            authManager.clearCache();

            // After clearing, should make new requests
            await authManager.getSupportedLoginFlows();
            await authManager.getRegisterFlows();

            expect(mockRequest).toHaveBeenCalledTimes(4);
        });

        it("should get cache statistics", async () => {
            const loginFlows = { flows: [{ type: "m.login.password" }] };
            mockRequest.mockResolvedValue(loginFlows);

            await authManager.getSupportedLoginFlows();
            await authManager.getSupportedLoginFlows(); // Cache hit

            const stats = authManager.getCacheStats();

            expect(stats.loginFlows.size).toBe(1);
            expect(stats.loginFlows.hits).toBe(1);
            expect(stats.loginFlows.misses).toBe(1);
            expect(stats.registerFlows.size).toBe(0);
        });
    });

    describe("Extended Auth Methods", () => {
        it("should get captcha challenge", async () => {
            mockRequest.mockResolvedValue({
                public_key: "captcha-key-123",
                challenge: "challenge-abc",
            });

            const result = await authManager.getCaptcha();

            expect(result.public_key).toBe("captcha-key-123");
            expect(result.challenge).toBe("challenge-abc");
            expect(mockRequest).toHaveBeenCalledWith(Method.Get, "/register/captcha", undefined, undefined, {
                prefix: ClientPrefix.V3,
            });
        });

        it("should get current user info (whoami)", async () => {
            mockAuthedRequest.mockResolvedValue({
                user_id: "@alice:example.com",
                device_id: "DEVICE123",
                is_guest: false,
            });

            const result = await authManager.whoami();

            expect(result.user_id).toBe("@alice:example.com");
            expect(result.device_id).toBe("DEVICE123");
            expect(result.is_guest).toBe(false);
            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/account/whoami", undefined, undefined, {
                prefix: ClientPrefix.V3,
            });
        });

        it("should logout", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await authManager.logout();

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Post, "/logout", undefined, undefined, {
                prefix: ClientPrefix.V3,
            });
        });

        it("should get SAML redirect URL", async () => {
            mockAuthedRequest.mockResolvedValue({
                location: "https://idp.example.com/saml?SAMLRequest=abc",
            });

            const result = await authManager.getSamlRedirect("saml-idp");

            expect(result.location).toContain("https://idp.example.com/saml");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/login/sso/redirect/saml",
                { idp_id: "saml-idp" },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should get server versions", async () => {
            mockRequest.mockResolvedValue({
                versions: ["r0.6.1", "v1.1", "v1.2"],
                unstable_features: { "org.matrix.msc1234": true },
            });

            const result = await authManager.getVersions();

            expect(result.versions).toEqual(["r0.6.1", "v1.1", "v1.2"]);
            expect(result.unstable_features).toEqual({ "org.matrix.msc1234": true });
            expect(mockRequest).toHaveBeenCalledWith(Method.Get, "/versions", undefined, undefined, {
                prefix: "",
            });
        });
    });
});
