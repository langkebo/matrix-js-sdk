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

import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";
import { Method } from "../http-api";
import { ClientPrefix, AdminPrefix } from "../http-api/prefix";
import type { SamlPathPattern } from "./__generated__/route-table";
import {
    type SamlLoginResponse,
    type SamlAuthResult,
    type SamlLogoutResponse,
    type SamlMetadata,
    type SamlSpMetadata,
    type SamlAdminConfig,
    type SamlUserMapping,
    type SamlUserMappingPage,
    type SamlRefreshResult,
} from "./__generated__/dto";
import { getOrCreateManager } from "../client-infra/manager-registry";

/**
 * SAML Auth Manager - SAML 认证管理 API 封装
 *
 * 提供 SAML SSO 登录重定向、回调处理、登出、元数据查询等功能
 * 同时包含管理端的 SAML 配置和用户映射管理
 * 对接后端: synapse-rust/src/web/routes/saml.rs
 * API 路径:
 *   公共: /_matrix/client/r0/login/sso/redirect/saml, /login/saml/callback, /saml/metadata 等
 *   管理: /_synapse/admin/v1/saml/config, /saml/mappings 等
 *
 * 使用方式:
 * ```typescript
 * const manager = client.getSamlAuthManager();
 * // 发起 SAML SSO 登录
 * const redirectUrl = await manager.initiateLogin("https://app.example.com/login");
 * // 获取 SAML 元数据
 * const metadata = await manager.getIdpMetadata();
 * // 管理端: 获取 SAML 配置
 * const config = await manager.getAdminConfig();
 * ```
 */

export type {
    SamlLoginResponse,
    SamlAuthResult,
    SamlLogoutResponse,
    SamlMetadata,
    SamlSpMetadata,
    SamlAdminConfig,
    SamlUserMapping,
    SamlUserMappingPage,
    SamlRefreshResult,
};

type StripClient<P extends string> = P extends `/_matrix/client/r0${infer Rest}` ? Rest : never;
type StripAdmin<P extends string> = P extends `/_synapse/admin/v1${infer Rest}` ? Rest : never;

function cp<P extends StripClient<SamlPathPattern>>(path: P): P {
    return path;
}

function ap<P extends StripAdmin<SamlPathPattern>>(path: P): P {
    return path;
}

export class SamlAuthManager extends BaseManager {
    constructor(client: MatrixClient) {
        super(client);
    }

    async initiateLogin(redirectUrl?: string): Promise<string> {
        return await this.withRetry(async () => {
            const response = await this.client.http.authedRequest<SamlLoginResponse>(
                Method.Post,
                cp("/login/sso/redirect/saml"),
                undefined,
                { redirectUrl },
                { prefix: ClientPrefix.R0 },
            );
            return response.redirect_url;
        }, "initiateLogin");
    }

    getLoginRedirectUrl(redirectUrl: string): string {
        const baseUrl = this.client.getHomeserverUrl();
        const params = redirectUrl ? `?redirectUrl=${encodeURIComponent(redirectUrl)}` : "";
        return `${baseUrl}/_matrix/client/r0/login/sso/redirect/saml${params}`;
    }

    async handleCallback(samlResponse: string, relayState?: string): Promise<SamlAuthResult> {
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<SamlAuthResult>(
                Method.Post,
                cp("/login/saml/callback"),
                undefined,
                { SAMLResponse: samlResponse, RelayState: relayState },
                { prefix: ClientPrefix.R0 },
            );
        }, "handleCallback");
    }

    /**
     * GET variant of handleCallback.
     * Convenience method that uses GET instead of POST for the SAML callback endpoint.
     *
     * @param params - Optional query parameters to include in the callback request
     */
    async getLoginCallback(params?: Record<string, string>): Promise<SamlAuthResult> {
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<SamlAuthResult>(
                Method.Get,
                cp("/login/saml/callback"),
                params,
                undefined,
                { prefix: ClientPrefix.R0 },
            );
        }, "getLoginCallback");
    }

    /**
     * GET variant for SSO redirect.
     * Convenience method that uses GET to retrieve the SAML SSO redirect URL.
     *
     * @param redirectUrl - Optional redirect URL after SSO completion
     */
    async getSsoRedirect(redirectUrl?: string): Promise<string> {
        return await this.withRetry(async () => {
            const queryParams = redirectUrl ? { redirectUrl } : undefined;
            const response = await this.client.http.authedRequest<SamlLoginResponse>(
                Method.Get,
                cp("/login/sso/redirect/saml"),
                queryParams,
                undefined,
                { prefix: ClientPrefix.R0 },
            );
            return response.redirect_url;
        }, "getSsoRedirect");
    }

    async logout(redirectUrl?: string): Promise<SamlLogoutResponse> {
        return await this.withRetry(async () => {
            const params = redirectUrl ? { redirectUrl } : undefined;
            return await this.client.http.authedRequest<SamlLogoutResponse>(
                Method.Get,
                cp("/logout/saml"),
                params,
                undefined,
                { prefix: ClientPrefix.R0 },
            );
        }, "logout");
    }

    async handleLogoutCallback(): Promise<void> {
        await this.withRetry(async () => {
            await this.client.http.authedRequest<Record<string, unknown>>( // Dynamic: SAML callback response is opaque
                Method.Get,
                cp("/logout/saml/callback"),
                undefined,
                undefined,
                { prefix: ClientPrefix.R0 },
            );
        }, "handleLogoutCallback");
    }

    async getIdpMetadata(): Promise<SamlMetadata> {
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<SamlMetadata>(
                Method.Get,
                cp("/saml/metadata"),
                undefined,
                undefined,
                { prefix: ClientPrefix.R0 },
            );
        }, "getIdpMetadata");
    }

    async getSpMetadata(): Promise<SamlSpMetadata> {
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<SamlSpMetadata>(
                Method.Get,
                cp("/saml/sp_metadata"),
                undefined,
                undefined,
                { prefix: ClientPrefix.R0 },
            );
        }, "getSpMetadata");
    }

    async getAdminConfig(): Promise<SamlAdminConfig> {
        return await this.samlAdminRequest<SamlAdminConfig>(Method.Get, ap("/saml/config"));
    }

    async updateAdminConfig(config: Partial<SamlAdminConfig>): Promise<SamlAdminConfig> {
        return await this.samlAdminRequest<SamlAdminConfig>(Method.Put, ap("/saml/config"), undefined, config);
    }

    async refreshMetadata(): Promise<SamlRefreshResult> {
        return await this.samlAdminRequest<SamlRefreshResult>(Method.Post, ap("/saml/metadata/refresh"));
    }

    async getUserMappings(limit?: number, from?: string): Promise<SamlUserMappingPage> {
        const params: Record<string, string | number> = {};
        if (limit) params.limit = limit;
        if (from) params.from = from;
        return await this.samlAdminRequest<SamlUserMappingPage>(Method.Get, ap("/saml/mappings"), params);
    }

    async getUserMapping(nameId: string): Promise<SamlUserMapping> {
        return await this.samlAdminRequest<SamlUserMapping>(
            Method.Get,
            ap(`/saml/mapping/${encodeURIComponent(nameId)}`) as StripAdmin<SamlPathPattern>,
        );
    }

    async updateUserMapping(nameId: string, mapping: Partial<SamlUserMapping>): Promise<SamlUserMapping> {
        return await this.samlAdminRequest<SamlUserMapping>(
            Method.Put,
            ap(`/saml/mapping/${encodeURIComponent(nameId)}`) as StripAdmin<SamlPathPattern>,
            undefined,
            mapping,
        );
    }

    async removeUserMapping(nameId: string): Promise<void> {
        await this.samlAdminRequest(
            Method.Delete,
            ap(`/saml/mapping/${encodeURIComponent(nameId)}`) as StripAdmin<SamlPathPattern>,
        );
    }

    async adminLogout(userId: string): Promise<void> {
        await this.samlAdminRequest(Method.Post, ap("/saml/logout"), undefined, { user_id: userId });
    }

    private async samlAdminRequest<T = void>(
        method: Method,
        path: string,
        queryParams?: Record<string, string | number>,
        body?: Record<string, unknown>, // Dynamic: admin request body varies by endpoint
    ): Promise<T> {
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<T>(
                method,
                path,
                queryParams as Record<string, string>,
                body,
                { prefix: AdminPrefix.V1 },
            );
        }, "adminRequest");
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getSamlAuthManager(): SamlAuthManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSamlAuthManager = function (): SamlAuthManager {
        return getOrCreateManager(this, "saml-auth", () => new SamlAuthManager(this));
    };
}

export default extendMatrixClient;
