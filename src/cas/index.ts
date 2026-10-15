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
 * 与 SDK 的 `CAS_PROTOCOL_PREFIX` 一致：
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

import type { CasPath } from "./__generated__/route-table";
import type { PathAssert, StripAdminV1, StripCasProtocol } from "../http-api/strip-prefix";

/**
 * 契约路径断言（**按 prefix 分设两个助手**）。
 *
 * 本模块的路径横跨两个前缀：服务管理面 `AdminPrefix.V1`（`/_synapse/admin/v1`）与
 * CAS SSO 协议面 `CAS_PROTOCOL_PREFIX`（`/_synapse/cas`）。分开断言可避免跨命名空间误匹配。
 */
function apu<const P extends string>(path: P & PathAssert<P, StripAdminV1<CasPath>>): P {
    return path;
}
function cpu<const P extends string>(path: P & PathAssert<P, StripCasProtocol<CasPath>>): P {
    return path;
}

/**
 * CAS 协议端点前缀（`/_synapse/cas`）。
 *
 * 历史上这里还有一层 `CasApiPrefix = "synapse_admin" | "cas"` 的二选一：
 * `"cas"` 变体会把管理端点拼成 `/_synapse/cas/admin/services`（**后端从未注册**，
 * 必然 404），对应后端 `cas.rs` 里自我声明的 `legacy_admin_routes`（根级
 * `/admin/services*`）。后端已按铁律 1 整段删除该兼容层，SDK 侧同步收敛为
 * 唯一形态 —— 管理端点固定打 `/_synapse/admin/v1/cas/*`，此处常量只服务
 * CAS 协议端点（serviceValidate / proxyValidate / proxy / login / logout）。
 */
const CAS_PROTOCOL_PREFIX = "/_synapse/cas";

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
    /** CAS XML 的 `<cas:attributes>` 子树（键 → 值数组） */
    attributes?: Record<string, string[]>;
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

/**
 * 解析 `GET /_synapse/cas/serviceValidate` 的 **text/plain** 响应（`yes\n<user>` / `no`）。
 *
 * 后端 `cas.rs::service_validate` 返回 text/plain，此前 SDK 按 JSON 解析 ⇒ 校验链恒不可用。
 */
function parseServiceValidateText(text: string): CasServiceValidateResponse {
    const lines = text.split("\n").map((l) => l.trim());
    if (lines[0] === "yes" && lines[1]) {
        return { serviceResponse: { authenticationSuccess: { user: lines[1] } } };
    }
    const description =
        lines.slice(1).join(" ").trim() || (lines[0] === "no" ? "Ticket not recognized" : text.slice(0, 200));
    return { serviceResponse: { authenticationFailure: { code: "INVALID_TICKET", description } } };
}

/**
 * 解析 CAS **XML** 响应（`cas_service.rs::to_xml` 的形状）。只覆盖后端实际生成的子集。
 */
function parseCasXmlResponse(xml: string): CasServiceValidateResponse {
    const failure = /<cas:authenticationFailure\s+code="([^"]*)"\s*>([\s\S]*?)<\/cas:authenticationFailure>/.exec(xml);
    if (failure) {
        return { serviceResponse: { authenticationFailure: { code: failure[1], description: failure[2].trim() } } };
    }
    const user = /<cas:user>([\s\S]*?)<\/cas:user>/.exec(xml)?.[1]?.trim();
    if (!user) {
        return {
            serviceResponse: {
                authenticationFailure: { code: "INVALID_RESPONSE", description: xml.trim().slice(0, 200) },
            },
        };
    }
    const pgt = /<cas:proxyGrantingTicket>([\s\S]*?)<\/cas:proxyGrantingTicket>/.exec(xml)?.[1]?.trim();
    const attributes: Record<string, string[]> = {};
    const attrsBlock = /<cas:attributes>([\s\S]*?)<\/cas:attributes>/.exec(xml)?.[1] ?? "";
    for (const m of attrsBlock.matchAll(/<cas:([A-Za-z0-9_.-]+)>([\s\S]*?)<\/cas:\1>/g)) {
        (attributes[m[1]] ??= []).push(m[2].trim());
    }
    return {
        serviceResponse: {
            authenticationSuccess: {
                user,
                ...(pgt ? { pgtIou: pgt } : {}),
                ...(Object.keys(attributes).length ? { attributes } : {}),
            },
        },
    };
}

export class CasManager extends BaseManager {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 获取 CAS 服务列表
     * 对应 GET /_synapse/admin/v1/cas/services（服务管理的**唯一**注册面；`/_synapse/cas` 下只有协议面）
     *
     * @example
     * ```typescript
     * const services = await client.getCasManager().listServices();
     * console.log(services.services.length, 'services found');
     * ```
     */
    public async listServices(): Promise<CasServiceListResponse> {
        const path = apu("/cas/services");
        return await this.withRetry(async () => {
            // 后端 `cas.rs::list_services` 返回**裸数组**（`Json(Vec<ServiceResponse>)`），
            // 不是 `{ services }` ⇒ 此前 `.services` 恒 undefined。
            const raw = await this.request<CasService[] | CasServiceListResponse>({
                method: Method.Get,
                path: path,
                prefix: AdminPrefix.V1,
            });
            if (Array.isArray(raw)) {
                return { services: raw, total: raw.length };
            }
            const services = raw.services ?? [];
            return { services, total: raw.total ?? services.length };
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
    public async createService(data: CasServiceCreateRequest): Promise<CasServiceCreateResponse> {
        const path = apu("/cas/services");
        return await this.withRetry(async () => {
            return await this.request<CasServiceCreateResponse>({
                method: Method.Post,
                path: path,
                body: data,
                prefix: AdminPrefix.V1,
            });
        }, "createService");
    }

    /**
     * 删除 CAS 服务
     * 对应 DELETE /_synapse/admin/v1/cas/services/{id}（服务管理的**唯一**注册面）
     *
     * @example
     * ```typescript
     * const result = await client.getCasManager().deleteService("my-service");
     * console.log(result.id);
     * ```
     */
    public async deleteService(serviceId: string): Promise<CasServiceDeleteResponse> {
        this.requireNonEmptyString(serviceId, "serviceId");
        const path = apu(`/cas/services/${encodeURIComponent(serviceId)}`);
        return await this.withRetry(async () => {
            return await this.request<CasServiceDeleteResponse>({
                method: Method.Delete,
                path: path,
                prefix: AdminPrefix.V1,
            });
        }, "deleteService");
    }

    /**
     * 获取用户属性
     * 对应 GET /_synapse/admin/v1/cas/users/{id}/attributes（服务管理的**唯一**注册面）
     *
     * @example
     * ```typescript
     * const result = await client.getCasManager().getUserAttributes("@alice:example.org");
     * console.log(result.attributes);
     * ```
     */
    public async getUserAttributes(userId: string): Promise<CasUserAttributesResponse> {
        this.requireNonEmptyString(userId, "userId");
        const path = apu(`/cas/users/${encodeURIComponent(userId)}/attributes`);
        return await this.withRetry(async () => {
            return await this.request<CasUserAttributesResponse>({
                method: Method.Get,
                path: path,
                prefix: AdminPrefix.V1,
            });
        }, "getUserAttributes");
    }

    /**
     * 设置用户属性
     * 对应 POST /_synapse/admin/v1/cas/users/{id}/attributes（服务管理的**唯一**注册面）
     *
     * @example
     * ```typescript
     * const result = await client.getCasManager().setUserAttributes("@alice:example.org", {
     *     attributes: { role: ["admin"] },
     * });
     * console.log(result.attributes);
     * ```
     */
    public async setUserAttributes(userId: string, data: CasUserAttributes): Promise<CasUserAttributesResponse> {
        this.requireNonEmptyString(userId, "userId");
        const path = apu(`/cas/users/${encodeURIComponent(userId)}/attributes`);
        return await this.withRetry(async () => {
            return await this.request<CasUserAttributesResponse>({
                method: Method.Post,
                path: path,
                body: data,
                prefix: AdminPrefix.V1,
            });
        }, "setUserAttributes");
    }

    /**
     * CAS 2.0 serviceValidate：校验 service ticket（返回 text/plain，SDK 解析为结构化结果）。
     *
     * @param service - 目标服务 URL
     * @param ticket - 可选 service ticket
     * @param pgtUrl - 可选代理回调 URL（对应 `pgt_url`）
     * @param renew - 是否强制重新认证
     * @returns 校验结果（含 authenticationSuccess / authenticationFailure）
     *
     * @example
     * ```typescript
     * const result = await client.getCasManager().serviceValidate("https://app.example.com", "ST-abc");
     * console.log(result.serviceResponse.authenticationSuccess?.user);
     * ```
     */
    public async serviceValidate(
        service: string,
        ticket?: string,
        pgtUrl?: string,
        renew?: boolean,
    ): Promise<CasServiceValidateResponse> {
        this.requireNonEmptyString(service, "service");
        const queryParams: Record<string, string> = { service };
        if (ticket) queryParams.ticket = ticket;
        if (pgtUrl) queryParams.pgt_url = pgtUrl;
        if (renew) queryParams.renew = "true";
        return await this.withRetry(async () => {
            const text = await this.request<string>({
                method: Method.Get,
                path: cpu("/serviceValidate"),
                queryParams: queryParams,
                prefix: CAS_PROTOCOL_PREFIX,
                textResponse: true,
            });
            return parseServiceValidateText(text);
        }, "serviceValidate");
    }

    /**
     * CAS 2.0 proxyValidate：校验 service ticket 与 proxy ticket（返回 XML，SDK 解析为结构化结果）。
     *
     * @param service - 目标服务 URL
     * @param ticket - 可选 service ticket
     * @param pgtUrl - 可选代理回调 URL（对应 `pgt_url`）
     * @param renew - 是否强制重新认证
     * @returns 校验结果（含 authenticationSuccess / authenticationFailure）
     *
     * @example
     * ```typescript
     * const result = await client.getCasManager().proxyValidate("https://app.example.com", "ST-abc");
     * console.log(result.serviceResponse.authenticationSuccess?.user);
     * ```
     */
    public async proxyValidate(
        service: string,
        ticket?: string,
        pgtUrl?: string,
        renew?: boolean,
    ): Promise<CasServiceValidateResponse> {
        this.requireNonEmptyString(service, "service");
        const queryParams: Record<string, string> = { service };
        if (ticket) queryParams.ticket = ticket;
        if (pgtUrl) queryParams.pgt_url = pgtUrl;
        if (renew) queryParams.renew = "true";
        return await this.withRetry(async () => {
            const xml = await this.request<string>({
                method: Method.Get,
                path: cpu("/proxyValidate"),
                queryParams: queryParams,
                prefix: CAS_PROTOCOL_PREFIX,
                textResponse: true,
            });
            return parseCasXmlResponse(xml);
        }, "proxyValidate");
    }

    /**
     * CAS 3.0 p3/serviceValidate：校验 service ticket 并返回属性（返回 XML，SDK 解析为结构化结果）。
     *
     * @param service - 目标服务 URL
     * @param ticket - 可选 service ticket
     * @param pgtUrl - 可选代理回调 URL（对应 `pgt_url`）
     * @param renew - 是否强制重新认证
     * @returns 校验结果（含 authenticationSuccess / authenticationFailure）
     *
     * @example
     * ```typescript
     * const result = await client.getCasManager().p3ServiceValidate("https://app.example.com", "ST-abc");
     * console.log(result.serviceResponse.authenticationSuccess?.attributes);
     * ```
     */
    public async p3ServiceValidate(
        service: string,
        ticket?: string,
        pgtUrl?: string,
        renew?: boolean,
    ): Promise<CasServiceValidateResponse> {
        this.requireNonEmptyString(service, "service");
        const queryParams: Record<string, string> = { service };
        if (ticket) queryParams.ticket = ticket;
        if (pgtUrl) queryParams.pgt_url = pgtUrl;
        if (renew) queryParams.renew = "true";
        return await this.withRetry(async () => {
            const xml = await this.request<string>({
                method: Method.Get,
                path: cpu("/p3/serviceValidate"),
                queryParams: queryParams,
                prefix: CAS_PROTOCOL_PREFIX,
                textResponse: true,
            });
            return parseCasXmlResponse(xml);
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
     * @throws {Error} 后端返回 `authenticationFailure`（无 `proxyGrantingTicket`）时
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
            const xml = await this.request<string>({
                method: Method.Get,
                path: cpu("/proxy"),
                queryParams: queryParams,
                prefix: CAS_PROTOCOL_PREFIX,
                textResponse: true,
            });
            const parsed = parseCasXmlResponse(xml);
            const ticket = parsed.serviceResponse.authenticationSuccess?.pgtIou;
            if (!ticket) {
                throw new Error(
                    `CAS proxy failed: ${parsed.serviceResponse.authenticationFailure?.code ?? "INVALID_RESPONSE"}`,
                );
            }
            return { proxyTicket: ticket };
        }, "proxy");
    }

    /**
     * 构造 CAS 登录跳转 URL（`/_synapse/cas/login`）。
     *
     * @param redirectUrl - 可选登录成功后的重定向地址
     * @returns 拼接好的登录 URL
     *
     * @example
     * ```typescript
     * const url = client.getCasManager().getLoginUrl("https://app.example.com/callback");
     * window.location.href = url;
     * ```
     */
    public getLoginUrl(redirectUrl?: string): string {
        const baseUrl = this.client.getHomeserverUrl();
        const params = redirectUrl ? `?redirectUrl=${encodeURIComponent(redirectUrl)}` : "";
        return `${baseUrl}${CAS_PROTOCOL_PREFIX}/login${params}`;
    }

    /**
     * 执行 CAS 登出（调用 `/_synapse/cas/logout`）。
     *
     * @example
     * ```typescript
     * await client.getCasManager().handleLogout();
     * ```
     */
    public async handleLogout(): Promise<void> {
        await this.request<Record<string, unknown> /* Dynamic: CAS logout response varies by server */>({
            method: Method.Get,
            path: cpu("/logout"),
            prefix: CAS_PROTOCOL_PREFIX,
        });
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCasManager = function (): CasManager {
        registerManagerClass("cas", CasManager);
        return getOrCreateManager(this, "cas", () => new CasManager(this));
    };
}
