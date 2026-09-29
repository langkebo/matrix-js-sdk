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

import { OIDCManager, type OIDCConfig, type OIDCTokenResponse, type OIDCUserInfo } from "./oidc";
import type { MatrixClient } from "../../client";

describe("OIDCManager", () => {
    let mockClient: {
        baseUrl: string;
        http: {
            get: ReturnType<typeof vi.fn>;
            post: ReturnType<typeof vi.fn>;
        };
        logger: {
            debug: ReturnType<typeof vi.fn>;
            error: ReturnType<typeof vi.fn>;
            warn: ReturnType<typeof vi.fn>;
        };
    };

    let oidcManager: OIDCManager;

    beforeEach(() => {
        mockClient = {
            baseUrl: "https://example.com",
            http: {
                get: vi.fn(),
                post: vi.fn(),
            },
            logger: {
                debug: vi.fn(),
                error: vi.fn(),
                warn: vi.fn(),
            },
        } as unknown as {
            baseUrl: string;
            http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
            logger: { debug: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
        };
        oidcManager = new OIDCManager(mockClient as unknown as MatrixClient);
        vi.clearAllMocks();
    });

    // ---------------------------------------------------------------------
    // 类型定义测试
    // ---------------------------------------------------------------------
    describe("OIDCConfig", () => {
        it("should define a valid config", () => {
            const config: OIDCConfig = {
                issuer: "https://oidc.example.com",
                authorization_endpoint: "https://oidc.example.com/authorize",
                token_endpoint: "https://oidc.example.com/token",
                userinfo_endpoint: "https://oidc.example.com/userinfo",
                jwks_uri: "https://oidc.example.com/.well-known/jwks.json",
                scopes_supported: ["openid", "profile", "email"],
                response_types_supported: ["code"],
                code_challenge_methods_supported: ["S256"],
            };

            expect(config.issuer).toBe("https://oidc.example.com");
            expect(config.authorization_endpoint).toBe("https://oidc.example.com/authorize");
            expect(config.token_endpoint).toBe("https://oidc.example.com/token");
        });
    });

    describe("OIDCTokenResponse", () => {
        it("should define a valid token response", () => {
            const response: OIDCTokenResponse = {
                access_token: "test-access-token",
                token_type: "Bearer",
                expires_in: 3600,
                refresh_token: "test-refresh-token",
                scope: "openid profile email",
                matrix_user_id: "@user:example.com",
                device_id: "device123",
            };

            expect(response.access_token).toBe("test-access-token");
            expect(response.token_type).toBe("Bearer");
            expect(response.expires_in).toBe(3600);
            expect(response.matrix_user_id).toBe("@user:example.com");
        });
    });

    describe("OIDCUserInfo", () => {
        it("should define a valid user info response", () => {
            const userInfo: OIDCUserInfo = {
                sub: "@user:example.com",
                name: "Test User",
                picture: "https://example.com/avatar.jpg",
                email: "user@example.com",
            };

            expect(userInfo.sub).toBe("@user:example.com");
            expect(userInfo.name).toBe("Test User");
            expect(userInfo.email).toBe("user@example.com");
        });
    });

    // ---------------------------------------------------------------------
    // 构造函数测试
    // ---------------------------------------------------------------------
    describe("constructor", () => {
        it("should create an instance with client", () => {
            expect(oidcManager).toBeInstanceOf(OIDCManager);
        });

        it("should initialize with null currentProvider", () => {
            expect(oidcManager.getCurrentProvider()).toBeNull();
        });

        it("should initialize with null discoveryCache", () => {
            expect(oidcManager.getCachedConfiguration()).toBeNull();
        });
    });

    // ---------------------------------------------------------------------
    // getAuthorizationUrl 测试
    // ---------------------------------------------------------------------
    describe("getAuthorizationUrl", () => {
        it("should throw when client_id is missing", async () => {
            await expect(
                oidcManager.getAuthorizationUrl({
                    redirect_uri: "https://example.com/callback",
                    response_type: "code",
                    scope: "openid profile",
                } as any),
            ).rejects.toThrow("client_id is required");
        });

        it("should throw when redirect_uri is missing", async () => {
            await expect(
                oidcManager.getAuthorizationUrl({
                    client_id: "my-client",
                    response_type: "code",
                    scope: "openid profile",
                } as any),
            ).rejects.toThrow("redirect_uri is required");
        });

        it("should throw when OIDC configuration is not available", async () => {
            await expect(
                oidcManager.getAuthorizationUrl({
                    client_id: "my-client",
                    redirect_uri: "https://example.com/callback",
                    response_type: "code",
                    scope: "openid",
                }),
            ).rejects.toThrow("OIDC configuration not available");
        });
    });

    // ---------------------------------------------------------------------
    // exchangeCode 测试
    // ---------------------------------------------------------------------
    describe("exchangeCode", () => {
        it("should throw when code is missing", async () => {
            await expect(oidcManager.exchangeCode("", "https://example.com/callback")).rejects.toThrow(
                "code is required",
            );
        });

        it("should throw when OIDC configuration is not available", async () => {
            await expect(oidcManager.exchangeCode("test-code", "https://example.com/callback")).rejects.toThrow(
                "OIDC configuration not available",
            );
        });
    });

    // ---------------------------------------------------------------------
    // builtinLogin 测试
    // ---------------------------------------------------------------------
    describe("builtinLogin", () => {
        it("should throw when client_id is missing", async () => {
            await expect(
                oidcManager.builtinLogin({
                    redirect_uri: "https://example.com/callback",
                    username: "testuser",
                    password: "testpass",
                } as any),
            ).rejects.toThrow("client_id is required");
        });

        it("should throw when redirect_uri is missing", async () => {
            await expect(
                oidcManager.builtinLogin({
                    client_id: "my-client",
                    username: "testuser",
                    password: "testpass",
                } as any),
            ).rejects.toThrow("redirect_uri is required");
        });

        it("should throw when username is missing", async () => {
            await expect(
                oidcManager.builtinLogin({
                    client_id: "my-client",
                    redirect_uri: "https://example.com/callback",
                    password: "testpass",
                } as any),
            ).rejects.toThrow("username is required");
        });

        it("should throw when password is missing", async () => {
            await expect(
                oidcManager.builtinLogin({
                    client_id: "my-client",
                    redirect_uri: "https://example.com/callback",
                    username: "testuser",
                } as any),
            ).rejects.toThrow("password is required");
        });
    });

    // ---------------------------------------------------------------------
    // getToken 测试
    // ---------------------------------------------------------------------
    describe("getToken", () => {
        it("should throw when grant_type is missing", async () => {
            await expect(oidcManager.getToken({} as any)).rejects.toThrow("grant_type is required");
        });
    });

    // ---------------------------------------------------------------------
    // refreshToken 测试
    // ---------------------------------------------------------------------
    describe("refreshToken", () => {
        it("should throw when refreshToken is missing", async () => {
            await expect(oidcManager.refreshToken("")).rejects.toThrow("refreshToken is required");
        });
    });

    // ---------------------------------------------------------------------
    // buildCallbackUrl 测试
    // ---------------------------------------------------------------------
    describe("buildCallbackUrl", () => {
        it("should build a valid callback URL", () => {
            const url = oidcManager.buildCallbackUrl("test-code", "test-state");
            expect(url).toContain("code=test-code");
            expect(url).toContain("state=test-state");
            expect(url).toContain("/_matrix/client/v3/oidc/callback");
        });

        it("should build URL with baseUrl that has trailing slash", () => {
            const manager = new OIDCManager({
                baseUrl: "https://example.com/",
                http: { get: vi.fn(), post: vi.fn() },
                logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
            } as any);

            const url = manager.buildCallbackUrl("test-code", "test-state");
            expect(url).toBe("https://example.com/_matrix/client/v3/oidc/callback?code=test-code&state=test-state");
        });
    });

    // ---------------------------------------------------------------------
    // stop 测试
    // ---------------------------------------------------------------------
    describe("stop", () => {
        it("should clear discovery cache", () => {
            // 通过 public API 设置缓存
            (oidcManager as any).discoveryCache = { issuer: "test" };

            oidcManager.stop();

            expect(oidcManager.getCachedConfiguration()).toBeNull();
        });

        it("should clear current provider", () => {
            // 通过 public API 设置
            (oidcManager as any).currentProvider = "test-provider";

            oidcManager.stop();

            expect(oidcManager.getCurrentProvider()).toBeNull();
        });
    });

    // ---------------------------------------------------------------------
    // getCurrentProvider 测试
    // ---------------------------------------------------------------------
    describe("getCurrentProvider", () => {
        it("should return null initially", () => {
            expect(oidcManager.getCurrentProvider()).toBeNull();
        });
    });

    // ---------------------------------------------------------------------
    // getCachedConfiguration 测试
    // ---------------------------------------------------------------------
    describe("getCachedConfiguration", () => {
        it("should return null initially", () => {
            expect(oidcManager.getCachedConfiguration()).toBeNull();
        });
    });

    // ---------------------------------------------------------------------
    // discoverConfiguration 测试
    // ---------------------------------------------------------------------
    describe("discoverConfiguration", () => {
        it("should throw when issuer is empty", async () => {
            await expect(oidcManager.discoverConfiguration("")).rejects.toThrow("issuer is required");
        });

        it("should throw when issuer is whitespace", async () => {
            await expect(oidcManager.discoverConfiguration("   ")).rejects.toThrow("issuer is required");
        });
    });

    // ---------------------------------------------------------------------
    // getUserInfo 测试
    // ---------------------------------------------------------------------
    describe("getUserInfo", () => {
        it("should call the correct endpoint", async () => {
            const mockUserInfo: OIDCUserInfo = {
                sub: "@user:example.com",
                name: "Test User",
                email: "test@example.com",
            };

            mockClient.http.get.mockResolvedValue(mockUserInfo);

            const result = await oidcManager.getUserInfo();

            expect(mockClient.http.get).toHaveBeenCalledWith("/_matrix/client/v3/oidc/userinfo");
            expect(result).toEqual(mockUserInfo);
        });
    });

    // ---------------------------------------------------------------------
    // logout 测试
    // ---------------------------------------------------------------------
    describe("logout", () => {
        it("should call logout endpoint with empty body when no request provided", async () => {
            mockClient.http.post.mockResolvedValue(undefined);

            await oidcManager.logout();

            expect(mockClient.http.post).toHaveBeenCalledWith("/_matrix/client/v3/oidc/logout", {});
        });

        it("should call logout endpoint with request body", async () => {
            mockClient.http.post.mockResolvedValue(undefined);

            await oidcManager.logout({ refresh_token: "test-token", device_id: "device123" });

            expect(mockClient.http.post).toHaveBeenCalledWith("/_matrix/client/v3/oidc/logout", {
                refresh_token: "test-token",
                device_id: "device123",
            });
        });
    });
});