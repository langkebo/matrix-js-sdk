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
 * CAS Manager - CAS 单点登录认证管理
 *
 * 提供 CAS SSO 认证功能，包括服务管理、用户属性管理、
 * CAS 协议验证（serviceValidate/proxyValidate/p3/serviceValidate）、代理票据获取、登录登出等
 * 对应后端: synapse-rust/src/web/routes/cas.rs
 *
 * ⚠️ 后端路由挂载差异（2026-09-29 发现，待后端修复）:
 * 本 SDK 假设 CAS public 端点挂载在 /_synapse/cas 下，但后端 `cas_routes()`
 * 实际以 root-level 方式注册（无 nest 前缀），导致以下端点后端实际路径与
 * SDK 期望不一致：
 * - SDK 期望: /_synapse/cas/login, /_synapse/cas/serviceValidate ...
 * - 后端实际: /login, /serviceValidate ... （根级路径）
 *
 * 其中 `/_matrix/client/v3/login/sso/redirect/cas` 与
 * `/_synapse/admin/v1/cas/*` 管理端点不受影响（两者均为完整路径注册）。
 *
 * 详见后端 issue 文档：
 * synapse-rust/docs/audit/CAS_ROUTER_PREFIX_MISSING_2026-09-29.md
 *
 * 后端修复（加 nest("/_synapse/cas") 后）本文件无需改动，即可直接联调。
 */

import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { AdminPrefix } from "../http-api/prefix";
import type { CasPathPattern } from "./__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

type StripAdminV1<P extends string> = P extends `/_synapse/admin/v1${infer Rest}` ? Rest : never;

function ap<P extends StripAdminV1<CasPathPattern>>(path: P): P {
    return path;
}

export type CasApiPrefix = "synapse_admin" | "cas";

const CAS_API_PREFIX: Record<CasApiPrefix, string> = {
    synapse_admin: AdminPrefix.V1,
    cas: "/_synapse/cas",
};

export interface CasService {
    id: string;
    name: string;
    description?: string;
    service_url: string;
    enabled: boolean;
}

export interface CasServiceListResponse {
    services: CasService[];
    total?: number;
}

export interface CasServiceCreateRequest {
    name: string;
    service_url: string;
    description?: string;
    enabled?: boolean;
}

export interface CasServiceCreateResponse {
    id: string;
    name: string;
}

export interface CasServiceDeleteResponse {
    id: string;
}

export interface CasUserAttributes {
    attributes: Record<string, string[]>;
}

export interface CasUserAttributesResponse {
    user_id: string;
    attributes: Record<string, string[]>;
}

export interface CasAuthenticationSuccess {
    user: string;
    pgtIou?: string;
    proxies?: string[];
}

export interface CasAuthenticationFailure {
    code: string;
    description: string;
}

export interface CasServiceValidateResponse {
    serviceResponse: {
        authenticationSuccess?: CasAuthenticationSuccess;
        authenticationFailure?: CasAuthenticationFailure;
    };
}

export interface CasProxyResponse {
    proxyTicket: string;
}

export class CasManager extends BaseManager {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    private resolvePrefix(prefix: CasApiPrefix): string {
        return CAS_API_PREFIX[prefix];
    }

    /**
     * 解析 API 路径
     * 根据前缀类型返回正确的路径片段（不包含前缀本身）
     * 
     * 后端路由契约（ROUTE_CONTRACT.md）:
     * - synapse_admin: /_synapse/admin/v1/cas/services
     * - cas: /_synapse/cas/services
     * 
     * @param prefix 前缀类型
     * @param basePath 基础路径（如 /services, /users/{id}/attributes）
     */
    private resolvePath(prefix: CasApiPrefix, basePath: string): string {
        if (prefix === "synapse_admin") {
            // /_synapse/admin/v1 + /cas/services → /cas/services
            return `/cas${basePath}`;
        } else {
            // /_synapse/cas + /services → /services
            return basePath;
        }
    }

    /**
     * 获取 CAS 服务列表
     * 对应 GET /_synapse/admin/v1/cas/services (admin 前缀) 或 GET /_synapse/cas/services (cas 前缀)
     *
     * @example
     * ```typescript
     * const services = await client.getCasManager().listServices("synapse_admin");
     * console.log(services.services.length, 'services found');
     * ```
     */
    public async listServices(prefix: CasApiPrefix = "synapse_admin"): Promise<CasServiceListResponse> {
        const prefixValue = this.resolvePrefix(prefix);
        // synapse_admin → /_synapse/admin/v1/cas/services, cas → /_synapse/cas/services
        const path = this.resolvePath(prefix, "/services");
        return await this.withRetry(async () => {
            return await this.request<CasServiceListResponse>({ method: Method.Get, path: path, prefix: prefixValue });
        }, "listServices");
    }

/**
     * 创建 CAS 服务
     * 对应 POST /_synapse/admin/v1/cas/services (admin 前缀) 或 POST /_synapse/cas/services (cas 前缀)
     *
     * @example
     * ```typescript
     * const service = await client.getCasManager().createService({
     *     name: "my-service", service_url: "https://example.com"
     * });
     * console.log(service.id);
     * ```
     */
    public async createService(
        data: CasServiceCreateRequest,
        prefix: CasApiPrefix = "synapse_admin",
    ): Promise<CasServiceCreateResponse> {
        const prefixValue = this.resolvePrefix(prefix);
        // synapse_admin → /_synapse/admin/v1/cas/services, cas → /_synapse/cas/services
        const path = this.resolvePath(prefix, "/services");
        return await this.withRetry(async () => {
            return await this.request<CasServiceCreateResponse>({
                method: Method.Post,
                path: path,
                body: data,
                prefix: prefixValue,
            });
        }, "createService");
    }

/**
     * 删除 CAS 服务
     * 对应 DELETE /_synapse/admin/v1/cas/services/{id} (admin 前缀) 或 DELETE /_synapse/cas/services/{id} (cas 前缀)
     */
    public async deleteService(
        serviceId: string,
        prefix: CasApiPrefix = "synapse_admin",
    ): Promise<CasServiceDeleteResponse> {
        this.requireNonEmptyString(serviceId, "serviceId");
        const prefixValue = this.resolvePrefix(prefix);
        // synapse_admin → /_synapse/admin/v1/cas/services/{id}, cas → /_synapse/cas/services/{id}
        const path = this.resolvePath(prefix, `/services/${encodeURIComponent(serviceId)}`);
        return await this.withRetry(async () => {
            return await this.request<CasServiceDeleteResponse>({
                method: Method.Delete,
                path: path,
                prefix: prefixValue,
            });
        }, "deleteService");
    }

/**
     * 获取用户属性
     * 对应 GET /_synapse/admin/v1/cas/users/{id}/attributes (admin 前缀) 或 GET /_synapse/cas/users/{id}/attributes (cas 前缀)
     */
    public async getUserAttributes(
        userId: string,
        prefix: CasApiPrefix = "synapse_admin",
    ): Promise<CasUserAttributesResponse> {
        this.requireNonEmptyString(userId, "userId");
        const prefixValue = this.resolvePrefix(prefix);
        // synapse_admin → /_synapse/admin/v1/cas/users/{id}/attributes, cas → /_synapse/cas/users/{id}/attributes
        const path = this.resolvePath(prefix, `/users/${encodeURIComponent(userId)}/attributes`);
        return await this.withRetry(async () => {
            return await this.request<CasUserAttributesResponse>({
                method: Method.Get,
                path: path,
                prefix: prefixValue,
            });
        }, "getUserAttributes");
    }

/**
     * 设置用户属性
     * 对应 POST /_synapse/admin/v1/cas/users/{id}/attributes (admin 前缀) 或 POST /_synapse/cas/users/{id}/attributes (cas 前缀)
     */
    public async setUserAttributes(
        userId: string,
        data: CasUserAttributes,
        prefix: CasApiPrefix = "synapse_admin",
    ): Promise<CasUserAttributesResponse> {
        this.requireNonEmptyString(userId, "userId");
        const prefixValue = this.resolvePrefix(prefix);
        // synapse_admin → /_synapse/admin/v1/cas/users/{id}/attributes, cas → /_synapse/cas/users/{id}/attributes
        const path = this.resolvePath(prefix, `/users/${encodeURIComponent(userId)}/attributes`);
        return await this.withRetry(async () => {
            return await this.request<CasUserAttributesResponse>({
                method: Method.Post,
                path: path,
                body: data,
                prefix: prefixValue,
            });
        }, "setUserAttributes");
    }

    public async serviceValidate(
        service: string,
        ticket?: string,
        pgtUrl?: string,
        renew?: boolean,
    ): Promise<CasServiceValidateResponse> {
        this.requireNonEmptyString(service, "service");
        const queryParams: Record<string, string> = { service };
        if (ticket) queryParams.ticket = ticket;
        if (pgtUrl) queryParams.pgtUrl = pgtUrl;
        if (renew) queryParams.renew = "true";
        return await this.withRetry(async () => {
            return await this.request<CasServiceValidateResponse>({
                method: Method.Get,
                path: "/serviceValidate",
                queryParams: queryParams,
                prefix: CAS_API_PREFIX.cas,
            });
        }, "serviceValidate");
    }

    public async proxyValidate(
        service: string,
        ticket?: string,
        pgtUrl?: string,
        renew?: boolean,
    ): Promise<CasServiceValidateResponse> {
        this.requireNonEmptyString(service, "service");
        const queryParams: Record<string, string> = { service };
        if (ticket) queryParams.ticket = ticket;
        if (pgtUrl) queryParams.pgtUrl = pgtUrl;
        if (renew) queryParams.renew = "true";
        return await this.withRetry(async () => {
            return await this.request<CasServiceValidateResponse>({
                method: Method.Get,
                path: "/proxyValidate",
                queryParams: queryParams,
                prefix: CAS_API_PREFIX.cas,
            });
        }, "proxyValidate");
    }

    public async p3ServiceValidate(
        service: string,
        ticket?: string,
        pgtUrl?: string,
        renew?: boolean,
    ): Promise<CasServiceValidateResponse> {
        this.requireNonEmptyString(service, "service");
        const queryParams: Record<string, string> = { service };
        if (ticket) queryParams.ticket = ticket;
        if (pgtUrl) queryParams.pgtUrl = pgtUrl;
        if (renew) queryParams.renew = "true";
        return await this.withRetry(async () => {
            return await this.request<CasServiceValidateResponse>({
                method: Method.Get,
                path: "/p3/serviceValidate",
                queryParams: queryParams,
                prefix: CAS_API_PREFIX.cas,
            });
        }, "p3ServiceValidate");
    }

    public async proxy(targetService: string, pgt?: string): Promise<CasProxyResponse> {
        this.requireNonEmptyString(targetService, "targetService");
        const queryParams: Record<string, string> = { targetService };
        if (pgt) queryParams.pgt = pgt;
        return await this.withRetry(async () => {
            return await this.request<CasProxyResponse>({
                method: Method.Get,
                path: "/proxy",
                queryParams: queryParams,
                prefix: CAS_API_PREFIX.cas,
            });
        }, "proxy");
    }

    public getLoginUrl(redirectUrl?: string): string {
        const baseUrl = this.client.getHomeserverUrl();
        const params = redirectUrl ? `?redirectUrl=${encodeURIComponent(redirectUrl)}` : "";
        return `${baseUrl}${CAS_API_PREFIX.cas}/login${params}`;
    }

    public async handleLogout(): Promise<void> {
        await this.request<Record<string, unknown> /* Dynamic: CAS logout response varies by server */>({
            method: Method.Get,
            path: "/logout",
            prefix: CAS_API_PREFIX.cas,
        });
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCasManager = function (): CasManager {
        registerManagerClass("cas", CasManager);
        return getOrCreateManager(this, "cas", () => new CasManager(this));
    };
}
