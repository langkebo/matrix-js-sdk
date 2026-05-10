/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.

    http://www.apache.org/licenses/LICENSE-2.0
*/

import { logger } from "../logger";
import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { AdminPrefix } from "../http-api/prefix";
import { InvalidParamError } from "../common/errors";

/**
 * CasManager — CAS（Central Authentication Service）admin CRUD
 *
 * 对接后端 `synapse-rust/src/web/routes/cas.rs`：
 *   - POST   /_synapse/admin/v1/cas/services
 *   - GET    /_synapse/admin/v1/cas/services
 *   - DELETE /_synapse/admin/v1/cas/services/{service_id}
 *   - POST   /_synapse/admin/v1/cas/users/{user_id}/attributes
 *   - GET    /_synapse/admin/v1/cas/users/{user_id}/attributes
 *
 * CAS 公共协议端点（`/login`、`/serviceValidate`、`/proxyValidate`、`/proxy`、
 * `/p3/serviceValidate`、`/logout`）由浏览器直连重定向消费，返回 XML/text，不适合
 * 通过 SDK JSON 客户端封装，故仅提供 URL 构造助手 {@link CasManager.buildLoginUrl}
 * 等便于上层把用户跳转到 CAS。
 */

export interface CasService {
    service_id: string;
    name: string;
    description?: string;
    service_url_pattern: string;
    is_enabled: boolean;
}

export interface RegisterCasServiceRequest {
    service_id: string;
    name: string;
    description?: string;
    service_url_pattern: string;
    allowed_attributes?: string[];
    allowed_proxy_callbacks?: string[];
    require_secure?: boolean;
    single_logout?: boolean;
}

export interface CasUserAttribute {
    name: string;
    value: string;
}

export interface SetCasAttributeRequest {
    attribute_name: string;
    attribute_value: string;
}

export interface SetCasAttributeResponse {
    user_id: string;
    attribute_name: string;
    attribute_value: string;
}

export class CasManager extends BaseManager {
    public constructor(client: MatrixClient) {
        super(client);
    }

    public async registerService(request: RegisterCasServiceRequest): Promise<CasService> {
        this.requireNonEmpty(request.service_id, "service_id");
        this.requireNonEmpty(request.name, "name");
        this.requireNonEmpty(request.service_url_pattern, "service_url_pattern");
        try {
            return await this.client.http.authedRequest<CasService>(
                Method.Post,
                "/v1/cas/services",
                undefined,
                request,
                { prefix: AdminPrefix.V1 },
            );
        } catch (e) {
            throw this.normalizeError(e, "registerService");
        }
    }

    public async listServices(): Promise<CasService[]> {
        try {
            const response = await this.client.http.authedRequest<CasService[]>(
                Method.Get,
                "/v1/cas/services",
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
            return Array.isArray(response) ? response : [];
        } catch (e) {
            logger.warn("CasManager.listServices failed", e);
            return [];
        }
    }

    public async deleteService(serviceId: string): Promise<void> {
        this.requireNonEmpty(serviceId, "serviceId");
        try {
            await this.client.http.authedRequest<void>(
                Method.Delete,
                `/v1/cas/services/${encodeURIComponent(serviceId)}`,
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        } catch (e) {
            throw this.normalizeError(e, "deleteService");
        }
    }

    public async setUserAttribute(userId: string, request: SetCasAttributeRequest): Promise<SetCasAttributeResponse> {
        this.requireNonEmpty(userId, "userId");
        this.requireNonEmpty(request.attribute_name, "attribute_name");
        try {
            return await this.client.http.authedRequest<SetCasAttributeResponse>(
                Method.Post,
                `/v1/cas/users/${encodeURIComponent(userId)}/attributes`,
                undefined,
                request,
                { prefix: AdminPrefix.V1 },
            );
        } catch (e) {
            throw this.normalizeError(e, "setUserAttribute");
        }
    }

    public async getUserAttributes(userId: string): Promise<CasUserAttribute[]> {
        this.requireNonEmpty(userId, "userId");
        try {
            const response = await this.client.http.authedRequest<CasUserAttribute[]>(
                Method.Get,
                `/v1/cas/users/${encodeURIComponent(userId)}/attributes`,
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
            return Array.isArray(response) ? response : [];
        } catch (e) {
            logger.warn("CasManager.getUserAttributes failed", e);
            return [];
        }
    }

    /**
     * 构造 CAS 浏览器登录跳转 URL（不发起 HTTP 请求）。
     * 后端 `/login` handler 会 302 重定向到 `/cas/login?service=...`。
     */
    public buildLoginUrl(serviceUrl: string): string {
        this.requireNonEmpty(serviceUrl, "serviceUrl");
        const baseUrl = this.client.baseUrl.replace(/\/+$/, "");
        return `${baseUrl}/login?service=${encodeURIComponent(serviceUrl)}`;
    }

    /**
     * 构造 CAS 浏览器登出跳转 URL。
     */
    public buildLogoutUrl(serviceUrl?: string): string {
        const baseUrl = this.client.baseUrl.replace(/\/+$/, "");
        if (serviceUrl) {
            return `${baseUrl}/logout?service=${encodeURIComponent(serviceUrl)}`;
        }
        return `${baseUrl}/logout`;
    }

    private requireNonEmpty(value: string | undefined, field: string): void {
        if (!value || value.length === 0) {
            throw new InvalidParamError(`${field} is required`);
        }
    }

    public start(): void {}
    public stop(): void {}
}

declare module "../client.ts" {
    interface MatrixClient {
        getCasManager(): CasManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCasManager = function (): CasManager {
        return new CasManager(this);
    };
}

export default extendMatrixClient;
