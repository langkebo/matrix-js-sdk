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
 * External Service Manager - 外部服务管理
 *
 * 提供外部服务的 CRUD、健康检查、Webhook 触发等功能
 * 支持两种 API 前缀: synapse_admin (/_synapse/admin/v1)、client (/_matrix/vendor/v1)
 * 以及 Webhook 路由前缀: /_synapse/external
 * 对应后端: synapse-rust/src/web/routes/external_service.rs
 */

import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { AdminPrefix, VendorPrefix } from "../http-api/prefix";
import type { ExternalServicePath } from "./__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type { PathAssert, StripAdminV1, StripVendor } from "../http-api/strip-prefix";

function sap<const P extends string>(path: P & PathAssert<P, StripAdminV1<ExternalServicePath>>): P {
    return path;
}

function cp<const P extends string>(path: P & PathAssert<P, StripVendor<ExternalServicePath>>): P {
    return path;
}

export type ExternalServiceApiPrefix = "synapse_admin" | "client";

const EXTERNAL_SERVICE_PREFIX: Record<ExternalServiceApiPrefix, string> = {
    synapse_admin: AdminPrefix.V1,
    // ISSUE-13: 私有端点迁 vendor 前缀（client 别名后端仍兼容）
    client: VendorPrefix,
};

const WEBHOOK_PREFIX = "/_synapse/external";

/**
 * Arbitrary configuration values for an external service.
 * Shape varies by service type (e.g. the generic webhook entry).
 */
export type ExternalServiceConfig = Record<string, unknown>; /* Dynamic: config shape varies by service type */

/**
 * Arbitrary JSON payload sent to an external service webhook endpoint.
 */
export type WebhookPayload = Record<string, unknown>; /* Dynamic: webhook payload varies by service */

export interface ExternalServiceItem {
    id: string;
    type: string;
    url: string;
    enabled: boolean;
}

export interface ExternalServiceListResponse {
    services: ExternalServiceItem[];
    total?: number;
}

export interface ExternalServiceCreateRequest {
    type: string;
    url: string;
    config?: ExternalServiceConfig;
    enabled?: boolean;
}

export interface ExternalServiceCreateResponse {
    id: string;
}

export interface ExternalServiceUpdateRequest {
    type?: string;
    url?: string;
    config?: ExternalServiceConfig;
    enabled?: boolean;
}

export interface ExternalServiceUpdateResponse {
    id: string;
}

export interface ExternalServiceDeleteResponse {
    id: string;
}

export interface ExternalServiceHealthResponse {
    status: string;
    services?: Array<{
        id: string;
        type: string;
        status: string;
        last_check?: number;
    }>;
}

export interface ExternalServiceSingleHealthResponse {
    id: string;
    type: string;
    status: string;
    last_check?: number;
    error?: string;
}

export interface ExternalServiceHealthCheckResponse {
    id: string;
    status: string;
    checked_at: number;
    healthy: boolean;
    error?: string;
}

export interface ExternalServiceWebhookResponse {
    success: boolean;
    message?: string;
}

export class ExternalServiceManager extends BaseManager {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    private resolvePrefix(prefix: ExternalServiceApiPrefix): string {
        return EXTERNAL_SERVICE_PREFIX[prefix];
    }

    private resolveListPath(prefix: ExternalServiceApiPrefix): string {
        switch (prefix) {
            case "synapse_admin":
                return sap("/external_services");
            case "client":
                throw new Error("Client prefix does not support listing services");
        }
    }

    private resolveServiceIdPath(prefix: ExternalServiceApiPrefix, serviceId: string): string {
        const encoded = encodeURIComponent(serviceId);
        switch (prefix) {
            case "synapse_admin":
                return sap(`/external_services/${encoded}`);
            case "client":
                return cp(`/external_services/${encoded}`);
        }
    }

    private resolveHealthPath(prefix: ExternalServiceApiPrefix): string {
        switch (prefix) {
            case "synapse_admin":
                return sap("/external_services/health");
            case "client":
                return cp("/external_services/health");
        }
    }

    /**
     * 列出外部服务。
     *
     * @param prefix - API 前缀，默认 `"synapse_admin"`
     * @returns 外部服务列表
     *
     * @example
     * ```typescript
     * const services = await client.getExternalServiceManager().listServices();
     * console.log(services.total);
     * ```
     */
    public async listServices(
        prefix: ExternalServiceApiPrefix = "synapse_admin",
    ): Promise<ExternalServiceListResponse> {
        const prefixValue = this.resolvePrefix(prefix);
        const path = this.resolveListPath(prefix);
        return await this.withRetry(async () => {
            return await this.request<ExternalServiceListResponse>({
                method: Method.Get,
                path: path,
                prefix: prefixValue,
            });
        }, "listServices");
    }

    /**
     * 创建外部服务。
     *
     * @param data - 创建请求体（类型、URL、可选配置与启用状态）
     * @param prefix - API 前缀，默认 `"synapse_admin"`
     * @returns 包含新服务 ID 的对象
     *
     * @example
     * ```typescript
     * const service = await client.getExternalServiceManager().createService({
     *     type: "webhook",
     *     url: "https://service.example.com/hook",
     * });
     * console.log(service.id);
     * ```
     */
    public async createService(
        data: ExternalServiceCreateRequest,
        prefix: ExternalServiceApiPrefix = "synapse_admin",
    ): Promise<ExternalServiceCreateResponse> {
        const prefixValue = this.resolvePrefix(prefix);
        const path = this.resolveListPath(prefix);
        return await this.withRetry(async () => {
            return await this.request<ExternalServiceCreateResponse>({
                method: Method.Post,
                path: path,
                body: data,
                prefix: prefixValue,
            });
        }, "createService");
    }

    /**
     * 更新外部服务。
     *
     * @param serviceId - 服务 ID
     * @param data - 更新请求体
     * @param prefix - API 前缀，默认 `"synapse_admin"`
     * @returns 包含被更新服务 ID 的对象
     *
     * @example
     * ```typescript
     * const result = await client.getExternalServiceManager().updateService("svc-1", { enabled: false });
     * console.log(result.id);
     * ```
     */
    public async updateService(
        serviceId: string,
        data: ExternalServiceUpdateRequest,
        prefix: ExternalServiceApiPrefix = "synapse_admin",
    ): Promise<ExternalServiceUpdateResponse> {
        this.requireNonEmptyString(serviceId, "serviceId");
        const prefixValue = this.resolvePrefix(prefix);
        const path = this.resolveServiceIdPath(prefix, serviceId);
        return await this.withRetry(async () => {
            return await this.request<ExternalServiceUpdateResponse>({
                method: Method.Put,
                path: path,
                body: data,
                prefix: prefixValue,
            });
        }, "updateService");
    }

    /**
     * 删除外部服务。
     *
     * @param serviceId - 服务 ID
     * @param prefix - API 前缀，默认 `"synapse_admin"`
     * @returns 包含被删除服务 ID 的对象
     *
     * @example
     * ```typescript
     * const result = await client.getExternalServiceManager().deleteService("svc-1");
     * console.log(result.id);
     * ```
     */
    public async deleteService(
        serviceId: string,
        prefix: ExternalServiceApiPrefix = "synapse_admin",
    ): Promise<ExternalServiceDeleteResponse> {
        this.requireNonEmptyString(serviceId, "serviceId");
        const prefixValue = this.resolvePrefix(prefix);
        const path = this.resolveServiceIdPath(prefix, serviceId);
        return await this.withRetry(async () => {
            return await this.request<ExternalServiceDeleteResponse>({
                method: Method.Delete,
                path: path,
                prefix: prefixValue,
            });
        }, "deleteService");
    }

    /**
     * 获取外部服务整体健康状态。
     *
     * @param prefix - API 前缀，默认 `"synapse_admin"`
     * @returns 健康状态响应
     *
     * @example
     * ```typescript
     * const health = await client.getExternalServiceManager().getHealth();
     * console.log(health.status);
     * ```
     */
    public async getHealth(prefix: ExternalServiceApiPrefix = "synapse_admin"): Promise<ExternalServiceHealthResponse> {
        const prefixValue = this.resolvePrefix(prefix);
        const path = this.resolveHealthPath(prefix);
        return await this.withRetry(async () => {
            return await this.request<ExternalServiceHealthResponse>({
                method: Method.Get,
                path: path,
                prefix: prefixValue,
            });
        }, "getHealth");
    }

    /**
     * 获取指定外部服务的健康状态。
     *
     * @param serviceId - 服务 ID
     * @returns 单个服务的健康状态响应
     *
     * @example
     * ```typescript
     * const health = await client.getExternalServiceManager().getServiceHealth("svc-1");
     * console.log(health.status);
     * ```
     */
    public async getServiceHealth(serviceId: string): Promise<ExternalServiceSingleHealthResponse> {
        this.requireNonEmptyString(serviceId, "serviceId");
        const encoded = encodeURIComponent(serviceId);
        return await this.withRetry(async () => {
            return await this.request<ExternalServiceSingleHealthResponse>({
                method: Method.Get,
                path: sap(`/external_services/${encoded}/health`),
                prefix: AdminPrefix.V1,
            });
        }, "getServiceHealth");
    }

    /**
     * 主动触发指定外部服务的健康检查。
     *
     * @param serviceId - 服务 ID
     * @returns 健康检查结果
     *
     * @example
     * ```typescript
     * const result = await client.getExternalServiceManager().checkServiceHealth("svc-1");
     * console.log(result.healthy);
     * ```
     */
    public async checkServiceHealth(serviceId: string): Promise<ExternalServiceHealthCheckResponse> {
        this.requireNonEmptyString(serviceId, "serviceId");
        const encoded = encodeURIComponent(serviceId);
        return await this.withRetry(async () => {
            return await this.request<ExternalServiceHealthCheckResponse>({
                method: Method.Post,
                path: sap(`/external_services/${encoded}/health/check`),
                prefix: AdminPrefix.V1,
            });
        }, "checkServiceHealth");
    }

    /**
     * 触发指定服务的通用 Webhook（`/_synapse/external/webhook/{id}`）。
     *
     * @param serviceId - 服务 ID
     * @param data - 可选 Webhook 载荷
     * @returns Webhook 响应
     *
     * @example
     * ```typescript
     * const result = await client.getExternalServiceManager().triggerWebhook("svc-1", { event: "ping" });
     * console.log(result.success);
     * ```
     */
    public async triggerWebhook(serviceId: string, data?: WebhookPayload): Promise<ExternalServiceWebhookResponse> {
        this.requireNonEmptyString(serviceId, "serviceId");
        const encoded = encodeURIComponent(serviceId);
        return await this.withRetry(async () => {
            return await this.request<ExternalServiceWebhookResponse>({
                method: Method.Post,
                path: `/webhook/${encoded}`,
                body: data,
                prefix: WEBHOOK_PREFIX,
            });
        }, "triggerWebhook");
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getExternalServiceManager = function (): ExternalServiceManager {
        registerManagerClass("externalService", ExternalServiceManager);
        return getOrCreateManager(this, "externalService", () => new ExternalServiceManager(this));
    };
}
