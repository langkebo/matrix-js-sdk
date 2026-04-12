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
import { Method } from "../../src/http-api";

describe("AuthManager", () => {
    let mockClient: any;
    let authManager: AuthManager;
    let mockAuthedRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockAuthedRequest = vi.fn();
        mockClient = {
            http: {
                authedRequest: mockAuthedRequest,
            },
            isAuthenticated: vi.fn().mockReturnValue(false),
        };
        authManager = new AuthManager(mockClient);
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
            mockAuthedRequest.mockResolvedValue(flows);

            const result = await authManager.getSupportedLoginFlows();

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/login", undefined, undefined, {
                prefix: undefined,
            });
            expect(result).toEqual(flows);
        });

        it("should cache login flows", async () => {
            const flows = {
                flows: [{ type: "m.login.password" }],
            };
            mockAuthedRequest.mockResolvedValue(flows);

            await authManager.getSupportedLoginFlows();
            const cachedResult = await authManager.getSupportedLoginFlows();

            expect(mockAuthedRequest).toHaveBeenCalledTimes(1);
            expect(cachedResult).toEqual(flows);
        });

        it("should force refresh login flows", async () => {
            const flows1 = { flows: [{ type: "m.login.password" }] };
            const flows2 = { flows: [{ type: "m.login.sso" }] };

            mockAuthedRequest.mockResolvedValueOnce(flows1);
            mockAuthedRequest.mockResolvedValueOnce(flows2);

            await authManager.getSupportedLoginFlows();
            const result = await authManager.getSupportedLoginFlows(true);

            expect(mockAuthedRequest).toHaveBeenCalledTimes(2);
            expect(result).toEqual(flows2);
        });

        it("should emit LoginFlowUpdated event", async () => {
            const flows = { flows: [{ type: "m.login.password" }] };
            mockAuthedRequest.mockResolvedValue(flows);

            const emitSpy = vi.spyOn(authManager, "emit");
            await authManager.getSupportedLoginFlows();

            expect(emitSpy).toHaveBeenCalledWith(AuthEvent.LoginFlowUpdated, flows);
        });

        it("should check if login flow exists", async () => {
            const flows = {
                flows: [{ type: "m.login.password" }, { type: "m.login.sso" }],
            };
            mockAuthedRequest.mockResolvedValue(flows);

            expect(await authManager.hasLoginFlow("m.login.password")).toBe(true);
            expect(await authManager.hasLoginFlow("m.login.token")).toBe(false);
        });

        it("should check if password login is supported", async () => {
            const flows = {
                flows: [{ type: "m.login.password" }],
            };
            mockAuthedRequest.mockResolvedValue(flows);

            expect(await authManager.hasPasswordLogin()).toBe(true);
        });

        it("should check if SSO login is supported", async () => {
            const flows = {
                flows: [{ type: "m.login.sso" }],
            };
            mockAuthedRequest.mockResolvedValue(flows);

            expect(await authManager.hasSSOLogin()).toBe(true);
        });
    });

    describe("Register Flows", () => {
        it("should get register flows", async () => {
            const flows = {
                flows: [{ stages: ["m.login.email.identity", "m.login.msisdn"] }, { stages: ["m.login.dummy"] }],
                params: {},
            };
            mockAuthedRequest.mockResolvedValue(flows);

            const result = await authManager.getRegisterFlows();

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/register", undefined, undefined, {
                prefix: undefined,
            });
            expect(result).toEqual(flows);
        });

        it("should cache register flows", async () => {
            const flows = {
                flows: [{ stages: ["m.login.dummy"] }],
                params: {},
            };
            mockAuthedRequest.mockResolvedValue(flows);

            await authManager.getRegisterFlows();
            const cachedResult = await authManager.getRegisterFlows();

            expect(mockAuthedRequest).toHaveBeenCalledTimes(1);
            expect(cachedResult).toEqual(flows);
        });

        it("should force refresh register flows", async () => {
            const flows1 = { flows: [{ stages: ["m.login.dummy"] }], params: {} };
            const flows2 = { flows: [{ stages: ["m.login.email.identity"] }], params: {} };

            mockAuthedRequest.mockResolvedValueOnce(flows1);
            mockAuthedRequest.mockResolvedValueOnce(flows2);

            await authManager.getRegisterFlows();
            const result = await authManager.getRegisterFlows(true);

            expect(mockAuthedRequest).toHaveBeenCalledTimes(2);
            expect(result).toEqual(flows2);
        });

        it("should emit RegisterFlowUpdated event", async () => {
            const flows = { flows: [{ stages: ["m.login.dummy"] }], params: {} };
            mockAuthedRequest.mockResolvedValue(flows);

            const emitSpy = vi.spyOn(authManager, "emit");
            await authManager.getRegisterFlows();

            expect(emitSpy).toHaveBeenCalledWith(AuthEvent.RegisterFlowUpdated, flows);
        });
    });

    describe("Cache Management", () => {
        it("should clear all caches", async () => {
            const loginFlows = { flows: [{ type: "m.login.password" }] };
            const registerFlows = { flows: [{ stages: ["m.login.dummy"] }], params: {} };

            mockAuthedRequest.mockResolvedValueOnce(loginFlows);
            mockAuthedRequest.mockResolvedValueOnce(registerFlows);

            await authManager.getSupportedLoginFlows();
            await authManager.getRegisterFlows();

            authManager.clearCache();

            // After clearing, should make new requests
            await authManager.getSupportedLoginFlows();
            await authManager.getRegisterFlows();

            expect(mockAuthedRequest).toHaveBeenCalledTimes(4);
        });

        it("should get cache statistics", async () => {
            const loginFlows = { flows: [{ type: "m.login.password" }] };
            mockAuthedRequest.mockResolvedValue(loginFlows);

            await authManager.getSupportedLoginFlows();
            await authManager.getSupportedLoginFlows(); // Cache hit

            const stats = authManager.getCacheStats();

            expect(stats.loginFlows.size).toBe(1);
            expect(stats.loginFlows.hits).toBe(1);
            expect(stats.loginFlows.misses).toBe(1);
            expect(stats.registerFlows.size).toBe(0);
        });
    });

    describe("Error Handling", () => {
        it("should throw normalized error on login flow failure", async () => {
            const error = new Error("Network error");
            mockAuthedRequest.mockRejectedValue(error);

            await expect(authManager.getSupportedLoginFlows()).rejects.toThrow();
        });

        it("should throw normalized error on register flow failure", async () => {
            const error = new Error("Server error");
            mockAuthedRequest.mockRejectedValue(error);

            await expect(authManager.getRegisterFlows()).rejects.toThrow();
        });

        it("should handle empty login flows", async () => {
            mockAuthedRequest.mockResolvedValue({ flows: [] });

            const result = await authManager.getSupportedLoginFlows();

            expect(result.flows).toEqual([]);
            expect(await authManager.hasPasswordLogin()).toBe(false);
        });

        it("should handle empty response gracefully", async () => {
            mockAuthedRequest.mockResolvedValue({});

            const result = await authManager.getSupportedLoginFlows();

            expect(result).toEqual({});
        });
    });
});
