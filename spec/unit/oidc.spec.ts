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

import { describe, it, expect, beforeEach, vi } from "vitest";

import { OidcManager } from "../../src/oidc/manager";
import { FakeTransport } from "../test-utils/FakeTransport";

describe("OidcManager", () => {
    let mockClient: any;
    let transport: FakeTransport;
    let oidcManager: OidcManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn().mockResolvedValue({}),
                request: vi.fn().mockResolvedValue({}),
            },
            baseUrl: "https://matrix.test",
        };
        transport = new FakeTransport();
        oidcManager = new OidcManager(mockClient as any, { transport });
    });

    // ============ Discovery ============

    describe("discover", () => {
        it("should discover OIDC configuration", async () => {
            transport.respondWith({
                issuer: "https://matrix.test",
                authorization_endpoint: "https://matrix.test/authorize",
                token_endpoint: "https://matrix.test/token",
            });

            const result = await oidcManager.discover();

            expect(result.issuer).toBe("https://matrix.test");
            expect(result.authorization_endpoint).toBe("https://matrix.test/authorize");
            transport.expectCalledWithArgs(
                "GET",
                "/.well-known/openid-configuration",
                undefined,
                undefined,
                { prefix: "" },
            );
        });

        it("should cache discovery and emit event", async () => {
            transport.respondWith({
                issuer: "https://matrix.test",
                authorization_endpoint: "https://matrix.test/authorize",
                token_endpoint: "https://matrix.test/token",
            });
            const emitSpy = vi.spyOn(oidcManager, "emit");

            await oidcManager.discover();

            expect(emitSpy).toHaveBeenCalledWith("oidcDiscovered", { issuer: "https://matrix.test" });
            expect(oidcManager.getProvider()).toBe("https://matrix.test");
            expect(oidcManager.getCachedDiscovery()?.issuer).toBe("https://matrix.test");
        });
    });

    // ============ Authorize ============

    describe("authorize", () => {
        it("should authorize with required params", async () => {
            transport.respondWith({
                url: "https://matrix.test/authorize?code=abc",
            });

            const result = await oidcManager.authorize({
                client_id: "client123",
                redirect_uri: "https://app.test/callback",
                response_type: "code",
                scope: "openid",
            });

            expect(result).toContain("https://matrix.test/authorize");
            transport.expectCalledWithArgs(
                "GET",
                "/oidc/authorize",
                {
                    client_id: "client123",
                    redirect_uri: "https://app.test/callback",
                    response_type: "code",
                    scope: "openid",
                },
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("should authorize with optional params", async () => {
            transport.respondWith({ code: "abc" });

            await oidcManager.authorize({
                client_id: "client123",
                redirect_uri: "https://app.test/callback",
                response_type: "code",
                scope: "openid",
                state: "state123",
                nonce: "nonce123",
                code_challenge: "challenge123",
                code_challenge_method: "S256",
            });

            const callQuery = transport.request.mock.calls[0][2] as Record<string, string>;
            expect(callQuery.state).toBe("state123");
            expect(callQuery.nonce).toBe("nonce123");
            expect(callQuery.code_challenge).toBe("challenge123");
            expect(callQuery.code_challenge_method).toBe("S256");
        });

        it("should reject missing client_id", async () => {
            await expect(
                oidcManager.authorize({
                    client_id: "",
                    redirect_uri: "https://app.test/callback",
                    response_type: "code",
                    scope: "openid",
                } as any),
            ).rejects.toThrow();
        });
    });

    // ============ Token ============

    describe("token", () => {
        it("should exchange token with authorization code", async () => {
            transport.respondWith({
                access_token: "access-token-123",
                refresh_token: "refresh-token-123",
                token_type: "Bearer",
                expires_in: 3600,
            });

            const result = await oidcManager.token({
                grant_type: "authorization_code",
                code: "code123",
                redirect_uri: "https://app.test/callback",
                code_verifier: "verifier123",
                client_id: "client123",
            });

            expect(result.access_token).toBe("access-token-123");
            expect(result.refresh_token).toBe("refresh-token-123");
            expect(result.expires_in).toBe(3600);
            transport.expectCalledWithArgs(
                "POST",
                "/oidc/token",
                undefined,
                {
                    grant_type: "authorization_code",
                    code: "code123",
                    redirect_uri: "https://app.test/callback",
                    code_verifier: "verifier123",
                    client_id: "client123",
                },
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("should reject missing grant_type", async () => {
            await expect(
                oidcManager.token({ grant_type: "" } as any),
            ).rejects.toThrow();
        });
    });

    // ============ Refresh Token ============

    describe("refreshToken", () => {
        it("should refresh access token", async () => {
            transport.respondWith({
                access_token: "new-access-token",
                refresh_token: "new-refresh-token",
                token_type: "Bearer",
                expires_in: 7200,
            });
            const emitSpy = vi.spyOn(oidcManager, "emit");

            const result = await oidcManager.refreshToken("refresh-token-123");

            expect(result.access_token).toBe("new-access-token");
            transport.expectCalledWithArgs(
                "POST",
                "/oidc/token",
                undefined,
                {
                    grant_type: "refresh_token",
                    refresh_token: "refresh-token-123",
                },
                { prefix: "/_matrix/client/v3" },
            );
            expect(emitSpy).toHaveBeenCalledWith("oidcTokenRefreshed", { expires_in: 7200 });
        });

        it("should reject empty refresh token", async () => {
            await expect(oidcManager.refreshToken("")).rejects.toThrow();
        });
    });

    // ============ User Info ============

    describe("getUserInfo", () => {
        it("should get OIDC user info", async () => {
            transport.respondWith({
                sub: "user123",
                name: "Alice",
                email: "alice@example.com",
            });

            const result = await oidcManager.getUserInfo();

            expect(result.sub).toBe("user123");
            expect(result.name).toBe("Alice");
            transport.expectCalledWithArgs(
                "GET",
                "/oidc/userinfo",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    // ============ Built-in Login ============

    describe("builtinLogin", () => {
        it("should perform built-in OIDC login", async () => {
            transport.respondWith({ code: "auth-code-123" });

            const result = await oidcManager.builtinLogin({
                client_id: "client123",
                redirect_uri: "https://app.test/callback",
                username: "alice",
                password: "secret",
            });

            expect(result.code).toBe("auth-code-123");
            transport.expectCalledWithArgs(
                "POST",
                "/oidc/login",
                undefined,
                {
                    client_id: "client123",
                    redirect_uri: "https://app.test/callback",
                    scope: "openid",
                    username: "alice",
                    password: "secret",
                },
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("should reject missing username", async () => {
            await expect(
                oidcManager.builtinLogin({
                    client_id: "client123",
                    redirect_uri: "https://app.test/callback",
                    username: "",
                    password: "secret",
                } as any),
            ).rejects.toThrow();
        });
    });

    // ============ SSO Redirect ============

    describe("ssoRedirect", () => {
        it("should get SSO redirect URL", async () => {
            transport.respondWith({
                url: "https://sso.test/redirect",
            });

            const result = await oidcManager.ssoRedirect("https://app.test/callback");

            expect(result).toBe("https://sso.test/redirect");
            transport.expectCalledWithArgs(
                "GET",
                "/login/sso/redirect",
                { redirectUrl: "https://app.test/callback" },
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    // ============ Logout ============

    describe("logout", () => {
        it("should logout and emit event", async () => {
            transport.respondWith(undefined);
            const emitSpy = vi.spyOn(oidcManager, "emit");

            await oidcManager.logout();

            transport.expectCalledWithArgs(
                "POST",
                "/oidc/logout",
                undefined,
                {},
                { prefix: "/_matrix/client/v3" },
            );
            expect(emitSpy).toHaveBeenCalledWith("oidcLoggedOut", {});
        });
    });

    // ============ Stop ============

    describe("stop", () => {
        it("should clear cache and provider", () => {
            // Set up some state
            mockClient.http.request.mockResolvedValue({
                issuer: "https://matrix.test",
                authorization_endpoint: "https://matrix.test/authorize",
                token_endpoint: "https://matrix.test/token",
            });

            oidcManager.stop();

            expect(oidcManager.getProvider()).toBeNull();
            expect(oidcManager.getCachedDiscovery()).toBeNull();
        });
    });

    // ============ Build Callback URL ============

    describe("buildCallbackUrl", () => {
        it("should build OIDC callback URL", () => {
            const url = oidcManager.buildCallbackUrl("auth-code", "state123");

            expect(url).toContain("https://matrix.test/_matrix/client/v3/oidc/callback");
            expect(url).toContain("code=auth-code");
            expect(url).toContain("state=state123");
        });
    });
});
