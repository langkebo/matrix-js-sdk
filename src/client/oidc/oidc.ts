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

/**
 * OIDCManager - Matrix 集成 OIDC (OpenID Connect) 认证管理器
 *
 * 基于 synapse-rust OIDC 路由实现：
 * - GET  /.well-known/openid-configuration  (OIDC Discovery)
 * - GET  /.well-known/jwks.json             (JWKS 密钥集)
 * - GET  /_matrix/client/v3/oidc/authorize    (授权端点)
 * - GET  /_matrix/client/v3/oidc/callback   (回调端点)
 * - POST /_matrix/client/v3/oidc/token        (令牌端点)
 * - POST /_matrix/client/v3/oidc/login        (内置OIDC登录)
 * - POST /_matrix/client/v3/oidc/logout      (登出端点)
 * - GET  /_matrix/client/v3/oidc/userinfo     (用户信息端点)
 * - GET  /_matrix/client/v3/login/sso/redirect (SSO 重定向)
 * - GET  /_matrix/client/v3/login/sso/userinfo (SSO 用户信息)
 *
 * 支持 OAuth2 OIDC 认证流程
 */

import { MatrixClient } from "../client";
import type { ManagerOpts } from "../managers/base-manager";
import { InvalidParamError } from "../common/errors";
import { MatrixError } from "../http-api/errors";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * OIDC 配置信息 (从 OpenID Discovery 文档获取)
 */
export interface OIDCConfig {
    /** 发行者标识 (Issuer) */
    issuer: string;
    /** 授权端点 URL */
    authorization_endpoint: string;
    /** 令牌端点 URL */
    token_endpoint: string;
    /** 用户信息端点 URL (可选) */
    userinfo_endpoint?: string;
    /** JWKS URI 用于验证 ID Token (可选) */
    jwks_uri?: string;
    /** 注册端点 URL (可选) */
    registration_endpoint?: string;
    /** 支持的作用域列表 */
    scopes_supported?: string[];
    /** 支持的响应类型 */
    response_types_supported?: string[];
    /** 支持的 PKCE Code Challenge 方法 */
    code_challenge_methods_supported?: string[];
    /** 支持的授权类型 */
    grant_types_supported?: string[];
    /** 令牌端点认证方法 */
    token_endpoint_auth_methods_supported?: string[];
}

/**
 * OIDC 授权请求参数
 */
export interface OIDCAuthorizationRequest {
    /** 客户端 ID */
    client_id: string;
    /** 重定向 URI */
    redirect_uri: string;
    /** 响应类型 (通常为 "code") */
    response_type: string;
    /** 请求的作用域，默认 "openid profile email" */
    scope?: string;
    /** 状态参数，用于 CSRF 保护 */
    state?: string;
    /** Nonce 用于 ID Token 防重放攻击 */
    nonce?: string;
    /** PKCE Code Challenge (可选) */
    code_challenge?: string;
    /** PKCE Code Challenge 方法 (默认 S256) */
    code_challenge_method?: string;
}

/**
 * OIDC 令牌响应
 */
export interface OIDCTokenResponse {
    /** 访问令牌 */
    access_token: string;
    /** 令牌类型 (通常为 "Bearer") */
    token_type: string;
    /** 访问令牌有效期 (秒) */
    expires_in: number;
    /** 刷新令牌 (可选) */
    refresh_token?: string;
    /** ID Token (可选) */
    id_token?: string;
    /** 授予的作用域 */
    scope: string;
    /** 映射到 Matrix 用户 ID (可选) */
    matrix_user_id?: string;
    /** 设备 ID (可选) */
    device_id?: string;
}

/**
 * OIDC 用户信息响应
 */
export interface OIDCUserInfo {
    /** 用户唯一标识 (Subject) */
    sub: string;
    /** 用户显示名称 (可选) */
    name?: string;
    /** 用户头像 URL (可选) */
    picture?: string;
    /** 用户电子邮件 (可选) */
    email?: string;
}

/**
 * OIDC 登出请求
 */
export interface OIDCLogoutRequest {
    /** 刷新令牌 (可选，用于注销时撤销) */
    refresh_token?: string;
    /** 设备 ID (可选，用于注销特定设备) */
    device_id?: string;
}

/**
 * OIDC 登录请求 (内置 OIDC)
 */
export interface OIDCLoginRequest {
    /** 客户端 ID */
    client_id: string;
    /** 重定向 URI */
    redirect_uri: string;
    /** 请求的作用域 (可选，默认 "openid") */
    scope?: string;
    /** 状态参数 (可选) */
    state?: string;
    /** Nonce (可选) */
    nonce?: string;
    /** PKCE Code Verifier (可选) */
    code_verifier?: string;
    /** 用户名 */
    username: string;
    /** 密码 */
    password: string;
}

/**
 * OIDC 登录响应
 */
export interface OIDCLoginResponse {
    /** 授权码 */
    code: string;
}

/**
 * OIDC 注册请求
 */
export interface OIDCRegisterRequest {
    /** 客户端名称 (可选) */
    client_name?: string;
    /** 重定向 URI 列表 (必需) */
    redirect_uris: string[];
    /** 授权类型列表 (可选) */
    grant_types?: string[];
    /** 响应类型列表 (可选) */
    response_types?: string[];
    /** 令牌端点认证方法 (可选) */
    token_endpoint_auth_method?: string;
}

/**
 * OIDC 客户端注册响应
 */
export interface OIDCRegistration {
    /** 客户端 ID */
    client_id: string;
    /** 客户端密钥 (可选) */
    client_secret?: string;
    /** 客户端名称 (可选) */
    client_name?: string;
    /** 重定向 URI 列表 */
    redirect_uris: string[];
}

/**
 * JWKS 密钥集
 */
export interface OIDCJwks {
    /** 密钥列表 */
    keys: Array<{
        /** 密钥类型 (RSA) */
        kty: string;
        /** 密钥 ID */
        kid: string;
        /** 用途 (sig) */
        use?: string;
        /** 加密算法 (RS256) */
        alg?: string;
        /** 模数 (Base64URL 编码) */
        n?: string;
        /** 指数 (Base64URL 编码) */
        e?: string;
    }>;
}

/**
 * OIDC 回调请求参数
 */
export interface OIDCCallbackRequest {
    /** 授权码 (可选) */
    code?: string;
    /** 状态参数 (可选) */
    state?: string;
    /** 错误代码 (可选) */
    error?: string;
    /** 错误描述 (可选) */
    error_description?: string;
}

/**
 * OIDCManager 错误类型
 */
export interface OidcError {
    /** 错误代码 */
    error: string;
    /** 错误描述 */
    error_description?: string;
}

// ============================================================================
// OIDCManager 类
// ============================================================================

/**
 * OIDCManager - 处理 Matrix 集成 OIDC 认证
 *
 * 提供完整的 OAuth2 OIDC 认证流程支持，包括：
 * - 发现 OIDC 提供者配置
 * - 生成授权 URL
 * - 交换授权码获取令牌
 * - 获取用户信息
 * - 刷新令牌
 * - 登出
 * - 内置 OIDC 登录
 */
export class OIDCManager {
    /** 当前 OIDC 提供者标识 */
    private currentProvider: string | null = null;
    /** 发现缓存 */
    private discoveryCache: OIDCConfig | null = null;
    /** PKCE 会话存储 */
    private pkceStore: Map<string, { codeVerifier: string; redirectUri: string }> = new Map();

    constructor(private readonly client: MatrixClient, private opts?: ManagerOpts) {
        this.opts = opts || {};
    }

    /**
     * 发现 OIDC 提供者配置
     * 从 /.well-known/openid-configuration 获取配置
     * @param issuer - OIDC 提供者的 Issuer 标识
     */
    async discoverConfiguration(issuer: string): Promise<OIDCConfig> {
        if (!issuer) {
            throw new InvalidParamError("issuer is required");
        }

        const url = issuer.endsWith("/") ? `${issuer}.well-known/openid-configuration` : `${issuer}/.well-known/openid-configuration`;

        try {
            const response = await this.client.http.fetchFn(url, {
                method: "GET",
                headers: { "Content-Type": "application/json" },
            });

            if (!response.ok) {
                throw new MatrixError(`Failed to fetch OIDC configuration: HTTP ${response.status}`, undefined, response.status);
            }

            const config: OIDCConfig = await response.json();
            this.discoveryCache = config;
            this.currentProvider = issuer;

            this.client.logger.debug(`[OIDC] Discovered configuration for issuer: ${issuer}`);
            return config;
        } catch (e) {
            const error = e instanceof Error ? e : new Error("Unknown error during OIDC discovery");
            this.client.logger.error(`[OIDC] Discovery failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取加密 OIDC 授权 URL
     * 生成用于 OAuth2 授权码流程的授权 URL
     * @param params - 授权请求参数
     */
    async getAuthorizationUrl(params: OIDCAuthorizationRequest): Promise<string> {
        if (!params.client_id) {
            throw new InvalidParamError("client_id is required");
        }
        if (!params.redirect_uri) {
            throw new InvalidParamError("redirect_uri is required");
        }

        const baseUrl = this.discoveryCache?.authorization_endpoint;
        if (!baseUrl) {
            throw new Error("OIDC configuration not available. Call discoverConfiguration() first.");
        }

        // 生成 state 和 nonce
        const state = params.state || this.generateState();
        const nonce = params.nonce || this.generateState();

        // 生成 PKCE
        const { codeVerifier, codeChallenge } = await this.generatePkce();

        // 存储 code_verifier 用于回调时交换令牌
        this.pkceStore.set(state, { codeVerifier, redirectUri: params.redirect_uri });

        // 构建授权 URL
        const url = new URL(baseUrl);
        url.searchParams.set("client_id", params.client_id);
        url.searchParams.set("redirect_uri", params.redirect_uri);
        url.searchParams.set("response_type", params.response_type || "code");
        url.searchParams.set("scope", params.scope || "openid profile email");
        url.searchParams.set("state", state);
        url.searchParams.set("nonce", nonce);

        if (codeChallenge) {
            url.searchParams.set("code_challenge", codeChallenge);
            url.searchParams.set("code_challenge_method", params.code_challenge_method || "S256");
        }

        return url.toString();
    }

    /**
     * 交换授权码获取令牌
     * @param code - 授权码
     * @param redirectUri - 回调的重定向 URI
     * @param codeVerifier - PKCE Code Verifier
     * @param state - 状态参数 (用于获取存储的 code_verifier)
     */
    async exchangeCode(
        code: string,
        redirectUri: string,
        codeVerifier?: string,
        state?: string,
    ): Promise<OIDCTokenResponse> {
        if (!code) {
            throw new InvalidParamError("code is required");
        }

        const tokenEndpoint = this.discoveryCache?.token_endpoint;
        if (!tokenEndpoint) {
            throw new Error("OIDC configuration not available. Call discoverConfiguration() first.");
        }

        // 如果没有提供 code_verifier，尝试从存储中获取
        let finalCodeVerifier = codeVerifier;
        if (!codeVerifier && state) {
            const pkceSession = this.pkceStore.get(state);
            if (pkceSession) {
                finalCodeVerifier = pkceSession.codeVerifier;
            }
        }

        const params = new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            client_id: "", // 需要从配置中获取或传递
        });

        if (finalCodeVerifier) {
            params.set("code_verifier", finalCodeVerifier);
        }

        const response = await fetch(tokenEndpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: params.toString(),
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorData: OidcError;
            try {
                errorData = JSON.parse(errorText);
            } catch {
                errorData = { error: "unknown_error", error_description: errorText };
            }
            throw new MatrixError(
                `OIDC token exchange failed: ${errorData.error} - ${errorData.error_description || ""}`,
                errorData,
                response.status,
            );
        }

        const tokenResponse: OIDCTokenResponse = await response.json();

        // 清理 PKCE 存储
        if (state) {
            this.pkceStore.delete(state);
        }

        return tokenResponse;
    }

    /**
     * 使用内置 OIDC 登录
     * 适用于 synapse-rust 内置 OIDC 提供者
     */
    async builtinLogin(request: OIDCLoginRequest): Promise<OIDCLoginResponse> {
        if (!request.client_id) {
            throw new InvalidParamError("client_id is required");
        }
        if (!request.redirect_uri) {
            throw new InvalidParamError("redirect_uri is required");
        }
        if (!request.username) {
            throw new InvalidParamError("username is required");
        }
        if (!request.password) {
            throw new InvalidParamError("password is required");
        }

        const path = "/_matrix/client/v3/oidc/login";
        const body = {
            client_id: request.client_id,
            redirect_uri: request.redirect_uri,
            scope: request.scope || "openid",
            state: request.state,
            nonce: request.nonce,
            code_verifier: request.code_verifier,
            username: request.username,
            password: request.password,
        };

        const response = await this.client.http.post<{ code: string }>(path, body);
        return { code: response.code };
    }

    /**
     * 使用 Matrix API 获取令牌
     * POST /_matrix/client/v3/oidc/token
     */
    async getToken(request: {
        grant_type: string;
        code?: string;
        redirect_uri?: string;
        code_verifier?: string;
        refresh_token?: string;
        client_id?: string;
        client_secret?: string;
    }): Promise<OIDCTokenResponse> {
        if (!request.grant_type) {
            throw new InvalidParamError("grant_type is required");
        }

        const path = "/_matrix/client/v3/oidc/token";

        const body: Record<string, unknown> = {
            grant_type: request.grant_type,
        };

        if (request.code !== undefined) body.code = request.code;
        if (request.redirect_uri !== undefined) body.redirect_uri = request.redirect_uri;
        if (request.code_verifier !== undefined) body.code_verifier = request.code_verifier;
        if (request.refresh_token !== undefined) body.refresh_token = request.refresh_token;
        if (request.client_id !== undefined) body.client_id = request.client_id;
        if (request.client_secret !== undefined) body.client_secret = request.client_secret;

        return this.client.http.post<OIDCTokenResponse>(path, body);
    }

    /**
     * 获取当前用户的 OIDC 用户信息
     * GET /_matrix/client/v3/oidc/userinfo
     */
    async getUserInfo(): Promise<OIDCUserInfo> {
        const path = "/_matrix/client/v3/oidc/userinfo";
        return this.client.http.get<OIDCUserInfo>(path);
    }

    /**
     * 刷新令牌
     * @param refreshToken - 刷新令牌
     */
    async refreshToken(refreshToken: string): Promise<OIDCTokenResponse> {
        if (!refreshToken) {
            throw new InvalidParamError("refreshToken is required");
        }

        return this.getToken({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
        });
    }

    /**
     * OIDC 登出
     * POST /_matrix/client/v3/oidc/logout
     */
    async logout(request?: OIDCLogoutRequest): Promise<void> {
        const path = "/_matrix/client/v3/oidc/logout";

        if (request) {
            await this.client.http.post<void>(path, request);
        } else {
            await this.client.http.post<void>(path, {});
        }
    }

    /**
     * 获取开放id发现文档
     * GET /.well-known/openid-configuration
     */
    async getOpenIdConfiguration(): Promise<OIDCConfig> {
        const baseUrl = this.client.baseUrl;
        const url = baseUrl.endsWith("/")
            ? `${baseUrl}.well-known/openid-configuration`
            : `${baseUrl}/.well-known/openid-configuration`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new MatrixError(`Failed to fetch OpenID configuration: HTTP ${response.status}`);
        }

        return response.json();
    }

    /**
     * 获取 JWKS 密钥集
     * GET /.well-known/jwks.json
     */
    async getJwks(): Promise<OIDCJwks> {
        const baseUrl = this.client.baseUrl;
        const url = baseUrl.endsWith("/")
            ? `${baseUrl}.well-known/jwks.json`
            : `${baseUrl}/.well-known/jwks.json`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new MatrixError(`Failed to fetch JWKS: HTTP ${response.status}`);
        }

        return response.json();
    }

    /**
     * 使用 SSO 重定向登录
     * GET /_matrix/client/v3/login/sso/redirect
     */
    async ssoRedirect(redirectUrl?: string): Promise<string> {
        const path = "/_matrix/client/v3/login/sso/redirect";
        const queryParams = redirectUrl ? { redirectUrl: redirectUrl } : undefined;

        const response = await this.client.http.get<{ url: string }>(path, undefined, queryParams);
        return response.url;
    }

    /**
     * 获取 SSO 用户信息
     * GET /_matrix/client/v3/login/sso/userinfo
     */
    async ssoUserInfo(): Promise<OIDCUserInfo> {
        const path = "/_matrix/client/v3/login/sso/userinfo";
        return this.client.http.get<OIDCUserInfo>(path);
    }

    /**
     * 处理 OIDC 回调
     * GET /_matrix/client/v3/oidc/callback
     * @param searchParams - 回调 URL 的查询参数
     */
    async handleCallback(searchParams: URLSearchParams): Promise<OIDCTokenResponse> {
        const code = searchParams.get("code");
        const state = searchParams.get("state");
        const error = searchParams.get("error");
        const errorDescription = searchParams.get("error_description");

        if (error) {
            throw new Error(`OIDC authorization failed: ${error} - ${errorDescription || ""}`);
        }

        if (!code) {
            throw new Error("Missing authorization code in callback");
        }

        // 获取重定向 URI
        const redirectUri = state ? this.pkceStore.get(state)?.redirectUri : this.client.baseUrl;

        return this.exchangeCode(code, redirectUri, undefined, state || undefined);
    }

    /**
     * 构建回调 URL
     * @param code - 授权码
     * @param state - 状态参数
     */
    buildCallbackUrl(code: string, state: string): string {
        const baseUrl = this.client.baseUrl.replace(/\/+$/, "");
        const callbackUrl = new URL("/_matrix/client/v3/oidc/callback", baseUrl);
        callbackUrl.searchParams.set("code", code);
        callbackUrl.searchParams.set("state", state);
        return callbackUrl.toString();
    }

    // ========================================================================
    // 工具方法
    // ========================================================================

    /**
     * 生成随机状态字符串
     */
    private generateState(): string {
        return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
            byte.toString(16).padStart(2, "0"),
        ).join("");
    }

    /**
     * 生成 PKCE code_verifier 和 code_challenge
     */
    private async generatePkce(): Promise<{ codeVerifier: string; codeChallenge: string }> {
        const codeVerifier = this.generateState();
        const encoder = new TextEncoder();
        const data = encoder.encode(codeVerifier);
        const hash = await crypto.subtle.digest("SHA-256", data);
        const base64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
        const codeChallenge = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        return { codeVerifier, codeChallenge };
    }

    /**
     * 获取当前 OIDC 提供者
     */
    getCurrentProvider(): string | null {
        return this.currentProvider;
    }

    /**
     * 获取缓存的发现配置
     */
    getCachedConfiguration(): OIDCConfig | null {
        return this.discoveryCache;
    }

    /**
     * 停止 OIDCManager
     * 清除所有缓存
     */
    stop(): void {
        this.discoveryCache = null;
        this.currentProvider = null;
        this.pkceStore.clear();
    }
}

// ============================================================================
// 导出类型
// ============================================================================

export type {
    OIDCConfig,
    OIDCAuthorizationRequest,
    OIDCTokenResponse,
    OIDCUserInfo,
    OIDCLogoutRequest,
    OIDCLoginRequest,
    OIDCLoginResponse,
    OIDCRegisterRequest,
    OIDCRegistration,
    OIDCJwks,
    OIDCCallbackRequest,
    OidcError,
};