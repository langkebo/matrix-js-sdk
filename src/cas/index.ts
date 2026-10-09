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
 * ✅ 后端路由挂载（2026-10-01 复核）:
 * 后端 `cas.rs::routes()` 已把 CAS 协议面收敛到 `/_synapse/cas` 前缀
 * （`Router::new().nest("/_synapse/cas", cas_protocol_routes)`），
 * 与 SDK 的 `CAS_API_PREFIX.cas` 一致：
 * - `/_synapse/cas/login`、`/_synapse/cas/logout`
 * - `/_synapse/cas/serviceValidate`、`proxyValidate`、`p3/serviceValidate`、`proxy`
 *
 * 历史上后端曾以根级路径注册（`/login`、`/serviceValidate` …），
 * 对应 issue：synapse-rust/docs/audit/CAS_ROUTER_PREFIX_MISSING_2026-09-29.md
 * 该 issue 已修复，根级路径已下线 —— 生成表与契约文档中不得再出现它们。
 */

import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { AdminPrefix } from "../http-api/prefix";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

/**
 * CAS **协议面**前缀（`serviceValidate` / `proxyValidate` / `p3/serviceValidate` / `proxy` /
 * `login` / `logout` 走 `/_synapse/cas`）。
 */
export type CasApiPrefix = "synapse_admin" | "cas";

const CAS_API_PREFIX: Record<CasApiPrefix, string> = {
    synapse_admin: AdminPrefix.V1,
    cas: "/_synapse/cas",
};

/**
 * CAS **服务/用户属性管理面**的前缀。
 *
 * ⚠️ 这里刻意**只有一个取值**（P-13，2026-10-10 回源实测）：
 * 后端把服务与用户属性管理**只**注册在 `/_synapse/admin/v1/cas/…`
 * （`cas.rs` 的路由表里 `/_synapse/cas` 下**只有协议面**）。全仓 grep
 * `/_synapse/cas/services`、`/_synapse/cas/users` **零命中** ⇒ 传 `"cas"` 必然 **404**。
 *
 * 旧版本此处类型是 `CasApiPrefix`（含 `"cas"`），于是
 * `listServices("cas")` / `createService(…, "cas")` / `deleteService(…, "cas")` /
 * `setUserAttributes(…, "cas")` / `getUserAttributes(…, "cas")` 五个方法**全部不可用**，
 * 且 `cas.spec.ts` 还把该坏行为断言成了"预期"。
 *
 * 收窄成单一取值后，传 `"cas"` 变成**编译错误**（这才是这类缺陷该有的下场）。
 * 参数本身保留以维持调用形状（`listServices("synapse_admin")` 仍可编译）。
 */
export type CasServicePrefix = "synapse_admin";

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

/**
 * 注册 CAS 服务的请求体（对齐后端 `RegisterServiceBody`，2026-10-09 实测）。
 *
 * ⚠️ 三个必填字段与后端 serde 结构一一对应：`service_id` / `name` / `service_url_pattern`。
 * 旧版本这里是 `{ name, service_url, enabled? }` —— 既缺 `service_id`、又用 `service_url`
 * 顶替 `service_url_pattern`，且 `enabled` 后端无此字段 ⇒ 注册链路必然 400。
 */
export interface CasServiceCreateRequest {
    /** 服务标识（后端必填） */
    service_id: string;
    name: string;
    /** 服务 URL 匹配模式（后端字段名即 `service_url_pattern`，必填） */
    service_url_pattern: string;
    description?: string;
    allowed_attributes?: string[];
    allowed_proxy_callbacks?: string[];
    require_secure?: boolean;
    single_logout?: boolean;
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

    private resolvePrefix(prefix: CasServicePrefix): string {
        return CAS_API_PREFIX[prefix];
    }

    /**
     * 解析 API 路径（**服务管理面**，只有 `/_synapse/admin/v1/cas/…` 一种）
     *
     * 后端路由契约（ROUTE_CONTRACT.md）：
     * - `/_synapse/admin/v1/cas/services`（服务与用户属性管理**唯一**的注册面）
     *
     * ⚠️ `/_synapse/cas/services` **后端不存在** ⇒ 不再接受 `"cas"` 前缀（见 `CasServicePrefix`）。
     *
     * @param prefix 前缀类型（当前只有 `"synapse_admin"`）
     * @param basePath 基础路径（如 /services, /users/{id}/attributes）
     */
    private resolvePath(prefix: CasServicePrefix, basePath: string): string {
        // /_synapse/admin/v1 + /cas/services → /cas/services
        return `/cas${basePath}`;
    }

    /**
     * 获取 CAS 服务列表
     * 对应 GET /_synapse/admin/v1/cas/services（服务管理的**唯一**注册面；`/_synapse/cas` 下只有协议面）
     *
     * @example
     * ```typescript
     * const services = await client.getCasManager().listServices("synapse_admin");
     * console.log(services.services.length, 'services found');
     * ```
     */
    public async listServices(prefix: CasServicePrefix = "synapse_admin"): Promise<CasServiceListResponse> {
        const prefixValue = this.resolvePrefix(prefix);
        // synapse_admin → /_synapse/admin/v1/cas/services, cas → /_synapse/cas/services
        const path = this.resolvePath(prefix, "/services");
        return await this.withRetry(async () => {
            return await this.request<CasServiceListResponse>({ method: Method.Get, path: path, prefix: prefixValue });
        }, "listServices");
    }

    /**
     * 创建 CAS 服务
     * 对应 POST /_synapse/admin/v1/cas/services（服务管理的**唯一**注册面）
     *
     * @example
     * ```typescript
     * const service = await client.getCasManager().createService({
     *     service_id: "my-service",
     *     name: "my-service",
     *     service_url_pattern: "https://example.com",
     * });
     * console.log(service);
     * ```
     */
    public async createService(
        data: CasServiceCreateRequest,
        prefix: CasServicePrefix = "synapse_admin",
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
     * 对应 DELETE /_synapse/admin/v1/cas/services/{id}（服务管理的**唯一**注册面）
     */
    public async deleteService(
        serviceId: string,
        prefix: CasServicePrefix = "synapse_admin",
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
     * 对应 GET /_synapse/admin/v1/cas/users/{id}/attributes（服务管理的**唯一**注册面）
     */
    public async getUserAttributes(
        userId: string,
        prefix: CasServicePrefix = "synapse_admin",
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
     * 对应 POST /_synapse/admin/v1/cas/users/{id}/attributes（服务管理的**唯一**注册面）
     */
    public async setUserAttributes(
        userId: string,
        data: CasUserAttributes,
        prefix: CasServicePrefix = "synapse_admin",
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

    /**
     * 获取 CAS 代理票据。
     *
     * ⚠️ query 键名必须与后端一致：后端 `ProxyQuery` 是 `{ target_service, pgt }`
     * **两个都必填**，故这里下发 `target_service`（发 `targetService` 会因必填缺失而
     * **400**，2026-10-09 实测）。`pgt` 无值时不发送 —— 后端虽标为必填，但调用方
     * 无 `pgt` 时保持原有行为不变。
     *
     * @example
     * ```typescript
     * const result = await client.getCasManager().proxy("https://sso.example.com", "PGT-abc");
     * console.log(result.proxyTicket);
     * ```
     */
    public async proxy(targetService: string, pgt?: string): Promise<CasProxyResponse> {
        this.requireNonEmptyString(targetService, "targetService");
        const queryParams: Record<string, string> = { target_service: targetService };
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
