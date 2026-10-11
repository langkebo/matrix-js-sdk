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
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api";
import { ClientPrefix, AdminPrefix } from "../http-api/prefix";
import type { SamlPath } from "./__generated__/route-table";
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
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type { PathAssert, StripAdminV1, StripV3 } from "../http-api/strip-prefix";

/**
 * SAML Auth Manager - SAML 认证管理 API 封装
 *
 * 提供 SAML SSO 登录重定向、回调处理、登出、元数据查询等功能
 * 同时包含管理端的 SAML 配置和用户映射管理
 * 对接后端: synapse-rust/src/web/routes/saml.rs
 * API 路径:
 *   公共: /_matrix/client/v3/login/sso/redirect/saml, /login/saml/callback, /saml/metadata 等
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

function cp<const P extends string>(path: P & PathAssert<P, StripV3<SamlPath>>): P {
    return path;
}

function ap<const P extends string>(path: P & PathAssert<P, StripAdminV1<SamlPath>>): P {
    return path;
}

export class SamlAuthManager extends BaseManager {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 发起 SAML SSO 登录（POST），返回后端生成的登录跳转地址。
     *
     * @param redirectUrl 登录成功后的回跳地址，可选。
     * @returns 供浏览器跳转的登录 URL。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getSamlAuthManager();
     * const url = await mgr.initiateLogin("https://app.example.com/login");
     * window.location.href = url;
     * ```
     */
    async initiateLogin(redirectUrl?: string): Promise<string> {
        return await this.withRetry(async () => {
            const response = await this.request<SamlLoginResponse>({
                method: Method.Post,
                path: cp("/login/sso/redirect/saml"),
                body: { redirectUrl },
                prefix: ClientPrefix.V3,
            });
            return response.redirect_url;
        }, "initiateLogin");
    }

    /**
     * 拼出 SAML 登录的浏览器跳转地址（纯 URL 拼接，**不发网络请求**）。
     *
     * ⚠️ 本后端为**单 IdP 模型**：IdP 由 `/_synapse/admin/v1/saml/config` 配置，
     * 路由表中**不存在** `{idp_id}` 形态 ⇒ **不要传 `idp_id`** —— 后端
     * `SamlLoginQuery` 带 `deny_unknown_fields`，多传一个键即 **400**。
     * 需要多 IdP 时走后端配置，不要在本方法上开参数口子（见 `W-01` 收口论证）。
     *
     * @param redirectUrl 登录成功后的回跳地址；传空串则不拼 `?redirectUrl=`。
     * @returns 供浏览器整页跳转的绝对 URL。
     *
     * @example
     * ```typescript
     * const url = client.getSamlAuthManager().getLoginRedirectUrl("https://app.example/callback");
     * window.location.href = url; // 浏览器整页跳转
     * ```
     */
    getLoginRedirectUrl(redirectUrl: string): string {
        const baseUrl = this.client.getHomeserverUrl();
        const params = redirectUrl ? `?redirectUrl=${encodeURIComponent(redirectUrl)}` : "";
        return `${baseUrl}/_matrix/client/v3/login/sso/redirect/saml${params}`;
    }

    /**
     * GET variant of initiateLogin.
     * Initiates SAML SSO login via redirect (GET /_matrix/client/v3/login/sso/redirect/saml).
     * When the browser is expected to handle the redirect directly.
     *
     * @param redirectUrl - Optional URL to redirect to after SSO completion
     * @returns The redirect URL to navigate the browser to
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getSamlAuthManager();
     * const result = await mgr.initiateLoginGet("https://app.example.com/login");
     * ```
     */
    async initiateLoginGet(redirectUrl?: string): Promise<SamlLoginResponse> {
        return await this.withRetry(async () => {
            const queryParams = redirectUrl ? { redirectUrl } : undefined;
            return await this.request<SamlLoginResponse>({
                method: Method.Get,
                path: cp("/login/sso/redirect/saml"),
                queryParams: queryParams,
                prefix: ClientPrefix.V3,
            });
        }, "initiateLoginGet");
    }

    /**
     * 拼出 SAML 登出的浏览器跳转地址（纯 URL 拼接，**不发网络请求**）。
     *
     * @param redirectUrl 登出后的回跳地址，传空串则不拼 `?redirectUrl=`。
     * @returns 供浏览器整页跳转的绝对 URL。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getSamlAuthManager();
     * const url = mgr.getLogoutRedirectUrl("https://app.example.com/goodbye");
     * window.location.href = url;
     * ```
     */
    getLogoutRedirectUrl(redirectUrl?: string): string {
        const baseUrl = this.client.getHomeserverUrl();
        const params = redirectUrl ? `?redirectUrl=${encodeURIComponent(redirectUrl)}` : "";
        return `${baseUrl}/_matrix/client/v3/logout/saml${params}`;
    }

    /**
     * 发起 SAML 登出（GET /logout/saml），返回后端给出的登出结果。
     *
     * @param redirectUrl 登出后的回跳地址，可选。
     * @returns 登出响应对象。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getSamlAuthManager();
     * const result = await mgr.initiateLogout("https://app.example.com/goodbye");
     * ```
     */
    async initiateLogout(redirectUrl?: string): Promise<SamlLogoutResponse> {
        return await this.withRetry(async () => {
            const params = redirectUrl ? { redirectUrl } : undefined;
            return await this.request<SamlLogoutResponse>({
                method: Method.Get,
                path: cp("/logout/saml"),
                queryParams: params,
                prefix: ClientPrefix.V3,
            });
        }, "initiateLogout");
    }

    /**
     * 处理 IdP 回调（POST /login/saml/callback），用 SAMLResponse 换取认证结果。
     *
     * @param samlResponse IdP 返回的 SAMLResponse（Base64 编码）。
     * @param relayState 可选的 RelayState，用于关联原始请求。
     * @returns SAML 认证结果（访问令牌、用户 ID 等）。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getSamlAuthManager();
     * const result = await mgr.handleCallback(samlResponse, relayState);
     * ```
     */
    async handleCallback(samlResponse: string, relayState?: string): Promise<SamlAuthResult> {
        return await this.withRetry(async () => {
            return await this.request<SamlAuthResult>({
                method: Method.Post,
                path: cp("/login/saml/callback"),
                body: { SAMLResponse: samlResponse, RelayState: relayState },
                prefix: ClientPrefix.V3,
            });
        }, "handleCallback");
    }

    /**
     * GET variant of handleCallback.
     * Convenience method that uses GET instead of POST for the SAML callback endpoint.
     *
     * @param params - Optional query parameters to include in the callback request
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getSamlAuthManager();
     * const result = await mgr.getLoginCallback({ SAMLResponse: samlResponse });
     * ```
     */
    async getLoginCallback(params?: Record<string, string>): Promise<SamlAuthResult> {
        return await this.withRetry(async () => {
            return await this.request<SamlAuthResult>({
                method: Method.Get,
                path: cp("/login/saml/callback"),
                queryParams: params,
                prefix: ClientPrefix.V3,
            });
        }, "getLoginCallback");
    }

    /**
     * GET variant for SSO redirect.
     * Convenience method that uses GET to retrieve the SAML SSO redirect URL.
     *
     * @param redirectUrl - Optional redirect URL after SSO completion
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getSamlAuthManager();
     * const url = await mgr.getSsoRedirect("https://app.example.com/login");
     * ```
     */
    async getSsoRedirect(redirectUrl?: string): Promise<string> {
        return await this.withRetry(async () => {
            const queryParams = redirectUrl ? { redirectUrl } : undefined;
            const response = await this.request<SamlLoginResponse>({
                method: Method.Get,
                path: cp("/login/sso/redirect/saml"),
                queryParams: queryParams,
                prefix: ClientPrefix.V3,
            });
            return response.redirect_url;
        }, "getSsoRedirect");
    }

    /**
     * 执行 SAML 登出（GET /logout/saml），返回后端给出的登出结果。
     *
     * @param redirectUrl 登出后的回跳地址，可选。
     * @returns 登出响应对象。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getSamlAuthManager();
     * const result = await mgr.logout("https://app.example.com/goodbye");
     * ```
     */
    async logout(redirectUrl?: string): Promise<SamlLogoutResponse> {
        return await this.withRetry(async () => {
            const params = redirectUrl ? { redirectUrl } : undefined;
            return await this.request<SamlLogoutResponse>({
                method: Method.Get,
                path: cp("/logout/saml"),
                queryParams: params,
                prefix: ClientPrefix.V3,
            });
        }, "logout");
    }

    /**
     * 处理 SAML 登出回调（GET /logout/saml/callback），完成登出流程收尾。
     *
     * @returns 无返回值。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getSamlAuthManager();
     * await mgr.handleLogoutCallback();
     * ```
     */
    async handleLogoutCallback(): Promise<void> {
        await this.withRetry(async () => {
            await this.request<Record<string, unknown>>({
                // Dynamic: SAML callback response is opaque
                method: Method.Get,
                path: cp("/logout/saml/callback"),
                prefix: ClientPrefix.V3,
            });
        }, "handleLogoutCallback");
    }

    /**
     * 获取 IdP 的 SAML 元数据（GET /saml/metadata）。
     *
     * @returns IdP 元数据对象。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getSamlAuthManager();
     * const metadata = await mgr.getIdpMetadata();
     * ```
     */
    async getIdpMetadata(): Promise<SamlMetadata> {
        return await this.withRetry(async () => {
            return await this.request<SamlMetadata>({
                method: Method.Get,
                path: cp("/saml/metadata"),
                prefix: ClientPrefix.V3,
            });
        }, "getIdpMetadata");
    }

    /**
     * 获取本服务提供方（SP）的 SAML 元数据（GET /saml/sp_metadata）。
     *
     * @returns SP 元数据对象。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getSamlAuthManager();
     * const spMetadata = await mgr.getSpMetadata();
     * ```
     */
    async getSpMetadata(): Promise<SamlSpMetadata> {
        return await this.withRetry(async () => {
            return await this.request<SamlSpMetadata>({
                method: Method.Get,
                path: cp("/saml/sp_metadata"),
                prefix: ClientPrefix.V3,
            });
        }, "getSpMetadata");
    }

    /**
     * 获取管理端的 SAML 配置（GET /_synapse/admin/v1/saml/config）。
     *
     * @returns 当前 SAML 管理配置。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getSamlAuthManager();
     * const config = await mgr.getAdminConfig();
     * ```
     */
    async getAdminConfig(): Promise<SamlAdminConfig> {
        return await this.samlAdminRequest<SamlAdminConfig>(Method.Get, ap("/saml/config"));
    }

    /**
     * 更新管理端的 SAML 配置（PUT /_synapse/admin/v1/saml/config），返回更新后的配置。
     *
     * @param config 需要更新的配置字段（部分更新）。
     * @returns 更新后的完整 SAML 管理配置。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getSamlAuthManager();
     * const config = await mgr.updateAdminConfig({ enabled: true });
     * ```
     */
    async updateAdminConfig(config: Partial<SamlAdminConfig>): Promise<SamlAdminConfig> {
        return await this.samlAdminRequest<SamlAdminConfig>(Method.Put, ap("/saml/config"), undefined, config);
    }

    /**
     * 触发管理端重新拉取 IdP 元数据（POST /_synapse/admin/v1/saml/metadata/refresh）。
     *
     * @returns 元数据刷新结果。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getSamlAuthManager();
     * const result = await mgr.refreshMetadata();
     * ```
     */
    async refreshMetadata(): Promise<SamlRefreshResult> {
        return await this.samlAdminRequest<SamlRefreshResult>(Method.Post, ap("/saml/metadata/refresh"));
    }

    /**
     * 分页获取管理端的 SAML 用户映射列表（GET /_synapse/admin/v1/saml/mappings）。
     *
     * @param limit 每页返回数量，可选。
     * @param from 分页起始游标，可选。
     * @returns 用户映射分页结果。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getSamlAuthManager();
     * const page = await mgr.getUserMappings(50);
     * ```
     */
    async getUserMappings(limit?: number, from?: string): Promise<SamlUserMappingPage> {
        const params: Record<string, string | number> = {};
        if (limit) params.limit = limit;
        if (from) params.from = from;
        return await this.samlAdminRequest<SamlUserMappingPage>(Method.Get, ap("/saml/mappings"), params);
    }

    /**
     * 获取指定 NameID 的单个 SAML 用户映射（GET /_synapse/admin/v1/saml/mapping/{nameId}）。
     *
     * @param nameId SAML NameID 标识。
     * @returns 对应的用户映射。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getSamlAuthManager();
     * const mapping = await mgr.getUserMapping("user@example.com");
     * ```
     */
    async getUserMapping(nameId: string): Promise<SamlUserMapping> {
        return await this.samlAdminRequest<SamlUserMapping>(
            Method.Get,
            ap(`/saml/mapping/${encodeURIComponent(nameId)}`),
        );
    }

    /**
     * 创建或更新指定 NameID 的 SAML 用户映射（PUT /_synapse/admin/v1/saml/mapping/{nameId}）。
     *
     * @param nameId SAML NameID 标识。
     * @param mapping 需要写入的映射字段（部分字段）。
     * @returns 更新后的用户映射。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getSamlAuthManager();
     * const mapping = await mgr.updateUserMapping("user@example.com", { matrix_id: "@user:example.com" });
     * ```
     */
    async updateUserMapping(nameId: string, mapping: Partial<SamlUserMapping>): Promise<SamlUserMapping> {
        return await this.samlAdminRequest<SamlUserMapping>(
            Method.Put,
            ap(`/saml/mapping/${encodeURIComponent(nameId)}`),
            undefined,
            mapping,
        );
    }

    /**
     * 删除指定 NameID 的 SAML 用户映射（DELETE /_synapse/admin/v1/saml/mapping/{nameId}）。
     *
     * @param nameId SAML NameID 标识。
     * @returns 无返回值。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getSamlAuthManager();
     * await mgr.removeUserMapping("user@example.com");
     * ```
     */
    async removeUserMapping(nameId: string): Promise<void> {
        await this.samlAdminRequest(Method.Delete, ap(`/saml/mapping/${encodeURIComponent(nameId)}`));
    }

    /**
     * 以管理员身份登出指定用户（POST /_synapse/admin/v1/saml/logout）。
     *
     * @param userId 需要被登出的用户 ID。
     * @returns 无返回值。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getSamlAuthManager();
     * await mgr.adminLogout("@user:example.com");
     * ```
     */
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
            return await this.request<T>({
                method: method,
                path: path,
                queryParams: queryParams as Record<string, string>,
                body: body,
                prefix: AdminPrefix.V1,
            });
        }, "adminRequest");
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSamlAuthManager = function (): SamlAuthManager {
        registerManagerClass("samlAuth", SamlAuthManager);
        return getOrCreateManager(this, "samlAuth", () => new SamlAuthManager(this));
    };
}
