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
 * OIDC Manager - OpenID Connect 认证管理
 *
 * 对接后端: synapse-rust/src/web/routes/oidc.rs
 * 后端提供完整的 OIDC Provider 和 Consumer 功能:
 *   - GET  /.well-known/openid-configuration  (OIDC Discovery)
 *   - GET  /.well-known/jwks.json             (JWKS 密钥集)
 *   - GET  /v3/oidc/authorize                 (授权端点)
 *   - POST /v3/oidc/register                  (动态客户端注册)
 *   - POST /v3/oidc/token                     (令牌端点)
 *   - GET  /v3/oidc/userinfo                  (用户信息)
 *   - POST /v3/oidc/logout                    (登出)
 *   - GET  /v3/oidc/callback                  (回调)
 *   - POST /v3/oidc/login                     (内置OIDC登录)
 *   - GET  /v3/login/sso/redirect             (SSO重定向)
 *   - GET  /v3/login/sso/userinfo             (SSO用户信息)
 */

import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { InvalidParamError } from "../common/errors";
import type { OidcPathPattern } from "./__generated__/route-table";
import { getOrCreateManager } from "../client-infra/manager-registry";

type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function op<P extends StripV3<OidcPathPattern>>(path: P): P {
    return path;
}

function publicPath<P extends OidcPathPattern>(path: P): P {
    return path;
}

export interface IOidcDiscovery {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    userinfo_endpoint?: string;
    jwks_uri?: string;
    registration_endpoint?: string;
    scopes_supported?: string[];
    response_types_supported?: string[];
    code_challenge_methods_supported?: string[];
}

export interface IOidcUserInfo {
    sub: string;
    name?: string;
    picture?: string;
    email?: string;
}

export interface IOidcTokenResponse {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    token_type: string;
    expires_in: number;
}

export interface IOidcTokenRequest {
    grant_type: string;
    code?: string;
    redirect_uri?: string;
    code_verifier?: string;
    refresh_token?: string;
    client_id?: string;
    client_secret?: string;
}

export interface IOidcAuthorizationParams {
    client_id: string;
    redirect_uri: string;
    response_type: string;
    scope: string;
    state?: string;
    nonce?: string;
    code_challenge?: string;
    code_challenge_method?: string;
}

export interface IOidcClientRegistration {
    client_id: string;
    client_secret?: string;
    client_name?: string;
    redirect_uris: string[];
}

export interface IOidcLoginRequest {
    client_id: string;
    redirect_uri: string;
    scope?: string;
    state?: string;
    nonce?: string;
    code_verifier?: string;
    username: string;
    password: string;
}

export interface IOidcLoginResponse {
    code: string;
}

export interface IOidcLogoutRequest {
    client_id?: string;
    post_logout_redirect_uri?: string;
    id_token_hint?: string;
}

export interface IOidcJwks {
    keys: Array<{
        kty: string;
        kid: string;
        use?: string;
        alg?: string;
        n?: string;
        e?: string;
    }>;
}

export interface IOidcRegisterRequest {
    client_name?: string;
    redirect_uris: string[];
    grant_types?: string[];
    response_types?: string[];
    token_endpoint_auth_method?: string;
}

export interface OidcManagerEvents {
    oidcDiscovered: (payload: { issuer: string }) => void;
    oidcTokenRefreshed: (payload: { expires_in: number }) => void;
    oidcAuthorized: (payload: { state: string; code: string }) => void;
    oidcLoggedOut: (payload: Record<string, never>) => void;
    oidcError: (payload: { error: Error }) => void;
}

export class OidcManager extends BaseManager<keyof OidcManagerEvents, OidcManagerEvents> {
    private currentProvider: string | null = null;
    private discoveryCache: IOidcDiscovery | null = null;

    constructor(client: MatrixClient) {
        super(client);
    }

    /**
     * @deprecated The .well-known/openid-configuration route is now deprecated in the Ledger.
     */
    async discover(): Promise<IOidcDiscovery> {
        return this.withRetry(async () => {
            const response = await this.client.http.request<IOidcDiscovery>(
                Method.Get,
                publicPath("/.well-known/openid-configuration"),
                undefined,
                undefined,
                { prefix: "" },
            );
            this.discoveryCache = response;
            this.currentProvider = response.issuer;
            this.emit("oidcDiscovered", { issuer: response.issuer });
            return response;
        }, "discover");
    }

    /**
     * @deprecated The .well-known/jwks.json route is now deprecated in the Ledger.
     */
    async getJwks(): Promise<IOidcJwks> {
        return this.withRetry(
            () =>
                this.client.http.request<IOidcJwks>(
                    Method.Get,
                    publicPath("/.well-known/jwks.json"),
                    undefined,
                    undefined,
                    {
                        prefix: "",
                    },
                ),
            "getJwks",
        );
    }

    async authorize(params: IOidcAuthorizationParams): Promise<string> {
        if (!params.client_id) {
            throw new InvalidParamError("client_id is required");
        }
        if (!params.redirect_uri) {
            throw new InvalidParamError("redirect_uri is required");
        }
        if (!params.response_type) {
            throw new InvalidParamError("response_type is required");
        }
        if (!params.scope) {
            throw new InvalidParamError("scope is required");
        }

        return this.withRetry(async () => {
            const queryParams: Record<string, string> = {
                client_id: params.client_id,
                redirect_uri: params.redirect_uri,
                response_type: params.response_type,
                scope: params.scope,
            };
            if (params.state) queryParams.state = params.state;
            if (params.nonce) queryParams.nonce = params.nonce;
            if (params.code_challenge) queryParams.code_challenge = params.code_challenge;
            if (params.code_challenge_method) queryParams.code_challenge_method = params.code_challenge_method;

            const response = await this.client.http.request<{ url?: string; code?: string }>(
                Method.Get,
                op("/oidc/authorize"),
                queryParams,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            return response.url || response.code || "";
        }, "authorize");
    }

    async registerClient(request: IOidcRegisterRequest): Promise<IOidcClientRegistration> {
        if (!request.redirect_uris || request.redirect_uris.length === 0) {
            throw new InvalidParamError("redirect_uris is required and must be non-empty");
        }

        return this.withRetry(
            () =>
                this.client.http.request<IOidcClientRegistration>(
                    Method.Post,
                    op("/oidc/register"),
                    undefined,
                    {
                        client_name: request.client_name,
                        redirect_uris: request.redirect_uris,
                        grant_types: request.grant_types,
                        response_types: request.response_types,
                        token_endpoint_auth_method: request.token_endpoint_auth_method,
                    },
                    { prefix: ClientPrefix.V3 },
                ),
            "registerClient",
        );
    }

    async token(request: IOidcTokenRequest): Promise<IOidcTokenResponse> {
        if (!request.grant_type) {
            throw new InvalidParamError("grant_type is required");
        }

        return this.withRetry(
            () =>
                this.client.http.request<IOidcTokenResponse>(
                    Method.Post,
                    op("/oidc/token"),
                    undefined,
                    {
                        grant_type: request.grant_type,
                        code: request.code,
                        redirect_uri: request.redirect_uri,
                        code_verifier: request.code_verifier,
                        refresh_token: request.refresh_token,
                        client_id: request.client_id,
                        client_secret: request.client_secret,
                    },
                    { prefix: ClientPrefix.V3 },
                ),
            "token",
        );
    }

    async getUserInfo(): Promise<IOidcUserInfo> {
        return this.withRetry(
            () =>
                this.client.http.authedRequest<IOidcUserInfo>(Method.Get, op("/oidc/userinfo"), undefined, undefined, {
                    prefix: ClientPrefix.V3,
                }),
            "getUserInfo",
        );
    }

    async refreshToken(refreshToken: string): Promise<IOidcTokenResponse> {
        if (!refreshToken) {
            throw new InvalidParamError("refreshToken is required");
        }

        const response = await this.token({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
        });
        this.emit("oidcTokenRefreshed", { expires_in: response.expires_in });
        return response;
    }

    async logout(request?: IOidcLogoutRequest): Promise<void> {
        return this.withRetry(
            () =>
                this.client.http.authedRequest<void>(Method.Post, op("/oidc/logout"), undefined, request ?? {}, {
                    prefix: ClientPrefix.V3,
                }),
            "logout",
        ).then(() => {
            this.emit("oidcLoggedOut", {});
        });
    }

    async builtinLogin(request: IOidcLoginRequest): Promise<IOidcLoginResponse> {
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

        return this.withRetry(
            () =>
                this.client.http.request<IOidcLoginResponse>(
                    Method.Post,
                    op("/oidc/login"),
                    undefined,
                    {
                        client_id: request.client_id,
                        redirect_uri: request.redirect_uri,
                        scope: request.scope ?? "openid",
                        state: request.state,
                        nonce: request.nonce,
                        code_verifier: request.code_verifier,
                        username: request.username,
                        password: request.password,
                    },
                    { prefix: ClientPrefix.V3 },
                ),
            "builtinLogin",
        );
    }

    async oidcLogin(body: IOidcLoginRequest): Promise<IOidcLoginResponse> {
        return this.builtinLogin(body);
    }

    async ssoRedirect(redirectUrl?: string): Promise<string> {
        return this.withRetry(async () => {
            const queryParams = redirectUrl ? { redirectUrl } : undefined;
            const response = await this.client.http.request<{ url: string }>(
                Method.Get,
                op("/login/sso/redirect"),
                queryParams,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            return response.url;
        }, "ssoRedirect");
    }

    /**
     * 构造 OIDC 回调 URL。
     * @param code - 授权码
     * @param state - 状态
     */
    public buildCallbackUrl(code: string, state: string): string {
        const baseUrl = this.client.baseUrl.replace(/\/+$/, "");
        const path = op("/oidc/callback");
        return `${baseUrl}/_matrix/client/v3${path}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
    }

    async ssoUserInfo(): Promise<IOidcUserInfo> {
        return this.withRetry(
            () =>
                this.client.http.authedRequest<IOidcUserInfo>(Method.Get, op("/login/sso/userinfo"), undefined, undefined, {
                    prefix: ClientPrefix.V3,
                }),
            "ssoUserInfo",
        );
    }

    getProvider(): string | null {
        return this.currentProvider;
    }

    getCachedDiscovery(): IOidcDiscovery | null {
        return this.discoveryCache;
    }

    stop(): void {
        this.discoveryCache = null;
        this.currentProvider = null;
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getOidcManager(): OidcManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getOidcManager = function (): OidcManager {
        return getOrCreateManager(this, "oidc", () => new OidcManager(this));
    };
}

export default extendMatrixClient;
