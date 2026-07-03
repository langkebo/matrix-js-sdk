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

    private resolveServicePath(prefix: CasApiPrefix, adminPath: string, casPath: string): string {
        return prefix === "synapse_admin" ? adminPath : casPath;
    }

    public async listServices(prefix: CasApiPrefix = "synapse_admin"): Promise<CasServiceListResponse> {
        const prefixValue = this.resolvePrefix(prefix);
        const path = this.resolveServicePath(prefix, ap("/cas/services"), "/admin/services");
        return await this.withRetry(async () => {
            return await this.request<CasServiceListResponse>({ method: Method.Get, path: path, prefix: prefixValue });
        }, "listServices");
    }

    public async createService(
        data: CasServiceCreateRequest,
        prefix: CasApiPrefix = "synapse_admin",
    ): Promise<CasServiceCreateResponse> {
        const prefixValue = this.resolvePrefix(prefix);
        const path = this.resolveServicePath(prefix, ap("/cas/services"), "/admin/services");
        return await this.withRetry(async () => {
            return await this.request<CasServiceCreateResponse>({
                method: Method.Post,
                path: path,
                body: data,
                prefix: prefixValue,
            });
        }, "createService");
    }

    public async deleteService(
        serviceId: string,
        prefix: CasApiPrefix = "synapse_admin",
    ): Promise<CasServiceDeleteResponse> {
        this.requireNonEmptyString(serviceId, "serviceId");
        const prefixValue = this.resolvePrefix(prefix);
        const path = this.resolveServicePath(
            prefix,
            ap(`/cas/services/${encodeURIComponent(serviceId)}`) as StripAdminV1<CasPathPattern>,
            `/admin/services/${encodeURIComponent(serviceId)}`,
        );
        return await this.withRetry(async () => {
            return await this.request<CasServiceDeleteResponse>({
                method: Method.Delete,
                path: path,
                prefix: prefixValue,
            });
        }, "deleteService");
    }

    public async getUserAttributes(
        userId: string,
        prefix: CasApiPrefix = "synapse_admin",
    ): Promise<CasUserAttributesResponse> {
        this.requireNonEmptyString(userId, "userId");
        const prefixValue = this.resolvePrefix(prefix);
        const path = this.resolveServicePath(
            prefix,
            ap(`/cas/users/${encodeURIComponent(userId)}/attributes`) as StripAdminV1<CasPathPattern>,
            `/admin/users/${encodeURIComponent(userId)}/attributes`,
        );
        return await this.withRetry(async () => {
            return await this.request<CasUserAttributesResponse>({
                method: Method.Get,
                path: path,
                prefix: prefixValue,
            });
        }, "getUserAttributes");
    }

    public async setUserAttributes(
        userId: string,
        data: CasUserAttributes,
        prefix: CasApiPrefix = "synapse_admin",
    ): Promise<CasUserAttributesResponse> {
        this.requireNonEmptyString(userId, "userId");
        const prefixValue = this.resolvePrefix(prefix);
        const path = this.resolveServicePath(
            prefix,
            ap(`/cas/users/${encodeURIComponent(userId)}/attributes`) as StripAdminV1<CasPathPattern>,
            `/admin/users/${encodeURIComponent(userId)}/attributes`,
        );
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

export default extendMatrixClient;
