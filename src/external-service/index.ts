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
 * 支持三种 API 前缀: synapse_admin (/_synapse/admin/v1)、matrix_admin (/_matrix/admin/v1)、client (/_matrix/client/v1)
 * 以及 Webhook 路由前缀: /_synapse/external
 * 对应后端: synapse-rust/src/web/routes/external_service.rs
 */

import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { AdminPrefix, ClientPrefix } from "../http-api/prefix";
import type { ExternalServicePathPattern } from "./__generated__/route-table";
import { getOrCreateManager } from "../client-infra/manager-registry";

type StripSynapseAdminV1<P extends string> = P extends `/_synapse/admin/v1${infer Rest}` ? Rest : never;
type StripMatrixAdminV1<P extends string> = P extends `/_matrix/admin/v1${infer Rest}` ? Rest : never;
type StripClientV1<P extends string> = P extends `/_matrix/client/v1${infer Rest}` ? Rest : never;

function sap<P extends StripSynapseAdminV1<ExternalServicePathPattern>>(path: P): P {
    return path;
}

function map<P extends StripMatrixAdminV1<ExternalServicePathPattern>>(path: P): P {
    return path;
}

function cp<P extends StripClientV1<ExternalServicePathPattern>>(path: P): P {
    return path;
}

export type ExternalServiceApiPrefix = "synapse_admin" | "matrix_admin" | "client";

const EXTERNAL_SERVICE_PREFIX: Record<ExternalServiceApiPrefix, string> = {
    synapse_admin: AdminPrefix.V1,
    matrix_admin: "/_matrix/admin/v1",
    client: ClientPrefix.V1,
};

const WEBHOOK_PREFIX = "/_synapse/external";

/**
 * Arbitrary configuration values for an external service.
 * Shape varies by service type (e.g. webhook, openclaw, trendradar).
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
    constructor(client: MatrixClient) {
        super(client);
    }

    private resolvePrefix(prefix: ExternalServiceApiPrefix): string {
        return EXTERNAL_SERVICE_PREFIX[prefix];
    }

    private resolveListPath(prefix: ExternalServiceApiPrefix): string {
        switch (prefix) {
            case "synapse_admin":
                return sap("/external_services");
            case "matrix_admin":
                return map("/external_services");
            case "client":
                throw new Error("Client prefix does not support listing services");
        }
    }

    private resolveServiceIdPath(prefix: ExternalServiceApiPrefix, serviceId: string): string {
        const encoded = encodeURIComponent(serviceId);
        switch (prefix) {
            case "synapse_admin":
                return sap(`/external_services/${encoded}`) as StripSynapseAdminV1<ExternalServicePathPattern>;
            case "matrix_admin":
                return map(`/external_services/${encoded}`) as StripMatrixAdminV1<ExternalServicePathPattern>;
            case "client":
                return cp(`/external_services/${encoded}`) as StripClientV1<ExternalServicePathPattern>;
        }
    }

    private resolveHealthPath(prefix: ExternalServiceApiPrefix): string {
        switch (prefix) {
            case "synapse_admin":
                return sap("/external_services/health");
            case "matrix_admin":
                return map("/external_services/health");
            case "client":
                return cp("/external_services/health");
        }
    }

    public async listServices(
        prefix: ExternalServiceApiPrefix = "synapse_admin",
    ): Promise<ExternalServiceListResponse> {
        const prefixValue = this.resolvePrefix(prefix);
        const path = this.resolveListPath(prefix);
        return await this.withRetry(async () => {
            return await this.request<ExternalServiceListResponse>({ method: Method.Get, path: path, prefix: prefixValue });
        }, "listServices");
    }

    public async createService(
        data: ExternalServiceCreateRequest,
        prefix: ExternalServiceApiPrefix = "synapse_admin",
    ): Promise<ExternalServiceCreateResponse> {
        const prefixValue = this.resolvePrefix(prefix);
        const path = this.resolveListPath(prefix);
        return await this.withRetry(async () => {
            return await this.request<ExternalServiceCreateResponse>({ method: Method.Post, path: path, body: data, prefix: prefixValue });
        }, "createService");
    }

    public async getService(
        serviceId: string,
        prefix: ExternalServiceApiPrefix = "synapse_admin",
    ): Promise<ExternalServiceItem> {
        this.requireNonEmptyString(serviceId, "serviceId");
        const prefixValue = this.resolvePrefix(prefix);
        const path = this.resolveServiceIdPath(prefix, serviceId);
        return await this.withRetry(async () => {
            return await this.request<ExternalServiceItem>({ method: Method.Get, path: path, prefix: prefixValue });
        }, "getService");
    }

    public async updateService(
        serviceId: string,
        data: ExternalServiceUpdateRequest,
        prefix: ExternalServiceApiPrefix = "synapse_admin",
    ): Promise<ExternalServiceUpdateResponse> {
        this.requireNonEmptyString(serviceId, "serviceId");
        const prefixValue = this.resolvePrefix(prefix);
        const path = this.resolveServiceIdPath(prefix, serviceId);
        return await this.withRetry(async () => {
            return await this.request<ExternalServiceUpdateResponse>({ method: Method.Put, path: path, body: data, prefix: prefixValue });
        }, "updateService");
    }

    public async deleteService(
        serviceId: string,
        prefix: ExternalServiceApiPrefix = "synapse_admin",
    ): Promise<ExternalServiceDeleteResponse> {
        this.requireNonEmptyString(serviceId, "serviceId");
        const prefixValue = this.resolvePrefix(prefix);
        const path = this.resolveServiceIdPath(prefix, serviceId);
        return await this.withRetry(async () => {
            return await this.request<ExternalServiceDeleteResponse>({ method: Method.Delete, path: path, prefix: prefixValue });
        }, "deleteService");
    }

    public async getHealth(
        prefix: ExternalServiceApiPrefix = "synapse_admin",
    ): Promise<ExternalServiceHealthResponse> {
        const prefixValue = this.resolvePrefix(prefix);
        const path = this.resolveHealthPath(prefix);
        return await this.withRetry(async () => {
            return await this.request<ExternalServiceHealthResponse>({ method: Method.Get, path: path, prefix: prefixValue });
        }, "getHealth");
    }

    public async getServiceHealth(serviceId: string): Promise<ExternalServiceSingleHealthResponse> {
        this.requireNonEmptyString(serviceId, "serviceId");
        const encoded = encodeURIComponent(serviceId);
        return await this.withRetry(async () => {
            return await this.request<ExternalServiceSingleHealthResponse>({ method: Method.Get, path: sap(`/external_services/${encoded}/health`) as StripSynapseAdminV1<ExternalServicePathPattern>, prefix: AdminPrefix.V1 });
        }, "getServiceHealth");
    }

    public async checkServiceHealth(serviceId: string): Promise<ExternalServiceHealthCheckResponse> {
        this.requireNonEmptyString(serviceId, "serviceId");
        const encoded = encodeURIComponent(serviceId);
        return await this.withRetry(async () => {
            return await this.request<ExternalServiceHealthCheckResponse>({ method: Method.Post, path: sap(`/external_services/${encoded}/health/check`) as StripSynapseAdminV1<ExternalServicePathPattern>, prefix: AdminPrefix.V1 });
        }, "checkServiceHealth");
    }

    public async triggerWebhook(
        serviceId: string,
        data?: WebhookPayload,
    ): Promise<ExternalServiceWebhookResponse> {
        this.requireNonEmptyString(serviceId, "serviceId");
        const encoded = encodeURIComponent(serviceId);
        return await this.withRetry(async () => {
            return await this.request<ExternalServiceWebhookResponse>({ method: Method.Post, path: `/webhook/${encoded}`, body: data, prefix: WEBHOOK_PREFIX });
        }, "triggerWebhook");
    }

    public async triggerOpenclawWebhook(
        serviceId: string,
        data?: WebhookPayload,
    ): Promise<ExternalServiceWebhookResponse> {
        this.requireNonEmptyString(serviceId, "serviceId");
        const encoded = encodeURIComponent(serviceId);
        return await this.withRetry(async () => {
            return await this.request<ExternalServiceWebhookResponse>({ method: Method.Post, path: `/openclaw/${encoded}/webhook`, body: data, prefix: WEBHOOK_PREFIX });
        }, "triggerOpenclawWebhook");
    }

    public async triggerTrendradarWebhook(
        serviceId: string,
        data?: WebhookPayload,
    ): Promise<ExternalServiceWebhookResponse> {
        this.requireNonEmptyString(serviceId, "serviceId");
        const encoded = encodeURIComponent(serviceId);
        return await this.withRetry(async () => {
            return await this.request<ExternalServiceWebhookResponse>({ method: Method.Post, path: `/trendradar/${encoded}/webhook`, body: data, prefix: WEBHOOK_PREFIX });
        }, "triggerTrendradarWebhook");
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getExternalServiceManager(): ExternalServiceManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getExternalServiceManager = function (): ExternalServiceManager {
        return getOrCreateManager(this, "external-service", () => new ExternalServiceManager(this));
    };
}

export default extendMatrixClient;
