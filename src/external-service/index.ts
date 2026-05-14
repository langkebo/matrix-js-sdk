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
 * External Service Integration Manager - 外部服务集成管理
 *
 * 提供第三方外部服务的注册、管理和健康检查功能
 * 对应后端 API (管理端):
 * - GET /_synapse/admin/v1/external_services - 获取外部服务列表
 * - POST /_synapse/admin/v1/external_services - 注册外部服务
 * - GET /_synapse/admin/v1/external_services/{as_id}/health - 获取服务健康状态
 * - POST /_synapse/admin/v1/external_services/{as_id}/health/check - 检查服务健康
 * - DELETE /_synapse/admin/v1/external_services/{as_id} - 注销外部服务
 * - GET /_synapse/admin/v1/external_services/health - 获取所有服务健康状态
 */

import { BaseManager } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { AdminPrefix } from "../http-api/prefix";
import { Body } from "../http-api/interface";
import { logger } from "../logger";
import { MatrixClient } from "../client";
import { getOrCreateManager } from "../client-infra/manager-registry";
import { ValidationError } from "../errors";

export enum ExternalServiceEvent {
    ServiceRegistered = "ServiceRegistered",
    ServiceUnregistered = "ServiceUnregistered",
    ServiceHealthChanged = "ServiceHealthChanged",
    Error = "Error",
}

export type ExternalServiceType =
    | "trendradar"
    | "openclaw"
    | "generic_webhook"
    | "webhook"
    | "irc_bridge"
    | "irc"
    | "slack_bridge"
    | "slack"
    | "discord_bridge"
    | "discord"
    | "custom";

export interface IExternalService {
    asId: string;
    serviceType: string;
    serviceId: string;
    displayName: string;
    isEnabled: boolean;
    isHealthy: boolean;
    createdTs: number;
}

export interface IExternalServiceHealth {
    serviceId: string;
    serviceType: string;
    isHealthy: boolean;
    lastCheckTs: number;
    lastSuccessTs?: number;
    lastError?: string;
    consecutiveFailures: number;
}

export interface IRegisterExternalServiceRequest {
    serviceType: string;
    serviceId: string;
    displayName: string;
    webhookUrl?: string;
    apiKey?: string;
    config?: Record<string, unknown>;
}

export interface IUpdateExternalServiceRequest {
    displayName?: string;
    webhookUrl?: string;
    apiKey?: string;
    config?: Record<string, unknown>;
    isEnabled?: boolean;
}

export interface IHealthCheckResult {
    asId: string;
    isHealthy: boolean;
}

interface ExternalServiceManagerEventMap {
    [ExternalServiceEvent.ServiceRegistered]: (service: IExternalService) => void;
    [ExternalServiceEvent.ServiceUnregistered]: (asId: string) => void;
    [ExternalServiceEvent.ServiceHealthChanged]: (asId: string, isHealthy: boolean) => void;
    [ExternalServiceEvent.Error]: (error: Error) => void;
}

export class ExternalServiceManager extends BaseManager<ExternalServiceEvent, ExternalServiceManagerEventMap> {
    private servicesCache: Map<string, IExternalService> = new Map();

    constructor(client: MatrixClient) {
        super(client);
    }

    private async adminRequest<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, string>,
        body?: Body,
    ): Promise<T> {
        return await this.client.http.authedRequest<T>(method, path, queryParams, body, {
            prefix: AdminPrefix.V1,
        });
    }

    /**
     * Register a new external service
     * POST /_synapse/admin/v1/external_services
     */
    public async registerService(request: IRegisterExternalServiceRequest): Promise<IExternalService> {
        try {
            const response = await this.adminRequest<{
                as_id: string;
                service_type: string;
                service_id: string;
                display_name: string;
                is_enabled?: boolean;
                is_healthy?: boolean;
                created_ts: number;
            }>(Method.Post, "/external_services", undefined, {
                service_type: request.serviceType,
                service_id: request.serviceId,
                display_name: request.displayName,
                webhook_url: request.webhookUrl,
                api_key: request.apiKey,
                config: request.config,
            });

            const service: IExternalService = {
                asId: response.as_id,
                serviceType: response.service_type,
                serviceId: response.service_id,
                displayName: response.display_name,
                isEnabled: response.is_enabled ?? true,
                isHealthy: response.is_healthy ?? true,
                createdTs: response.created_ts,
            };

            this.servicesCache.set(service.asId, service);
            this.emit(ExternalServiceEvent.ServiceRegistered, service);

            return service;
        } catch (error) {
            logger.error("ExternalServiceManager.registerService failed:", error);
            this.emit(ExternalServiceEvent.Error, error as Error);
            throw error;
        }
    }

    /**
     * Update an existing external service
     * PUT /_synapse/admin/v1/external_services/{as_id}
     */
    public async updateService(asId: string, request: IUpdateExternalServiceRequest): Promise<IExternalService> {
        if (!asId) {
            throw new ValidationError("Service ID is required");
        }

        const body: Record<string, unknown> = {};
        if (request.displayName !== undefined) body.display_name = request.displayName;
        if (request.webhookUrl !== undefined) body.webhook_url = request.webhookUrl;
        if (request.apiKey !== undefined) body.api_key = request.apiKey;
        if (request.config !== undefined) body.config = request.config;
        if (request.isEnabled !== undefined) body.is_enabled = request.isEnabled;

        const response = await this.adminRequest<{
            as_id: string;
            service_type: string;
            service_id: string;
            display_name: string;
            is_enabled?: boolean;
            is_healthy?: boolean;
            created_ts: number;
        }>(Method.Put, `/external_services/${encodeURIComponent(asId)}`, undefined, body);

        const service: IExternalService = {
            asId: response.as_id,
            serviceType: response.service_type,
            serviceId: response.service_id,
            displayName: response.display_name,
            isEnabled: response.is_enabled ?? true,
            isHealthy: response.is_healthy ?? true,
            createdTs: response.created_ts,
        };

        this.servicesCache.set(service.asId, service);
        return service;
    }

    /**
     * List all registered external services
     * GET /_synapse/admin/v1/external_services
     */
    public async listServices(serviceType?: string): Promise<IExternalService[]> {
        try {
            const queryParams = serviceType ? { service_type: serviceType } : undefined;

            const response = await this.adminRequest<
                {
                    as_id: string;
                    service_type: string;
                    service_id: string;
                    display_name: string;
                    is_enabled?: boolean;
                    is_healthy?: boolean;
                    created_ts: number;
                }[]
            >(Method.Get, "/external_services", queryParams);

            const services: IExternalService[] = response.map((s) => ({
                asId: s.as_id,
                serviceType: s.service_type,
                serviceId: s.service_id,
                displayName: s.display_name,
                isEnabled: s.is_enabled ?? true,
                isHealthy: s.is_healthy ?? true,
                createdTs: s.created_ts,
            }));

            services.forEach((s) => this.servicesCache.set(s.asId, s));

            return services;
            // @swallow-error { owner: "external-service", expires: "2026-12-31" }
        } catch (error) {
            logger.error("ExternalServiceManager.listServices failed:", error);
            return Array.from(this.servicesCache.values());
        }
    }

    /**
     * Get health status for a specific service
     * GET /_synapse/admin/v1/external_services/{as_id}/health
     */
    public async getServiceHealth(asId: string): Promise<IExternalServiceHealth | null> {
        if (!asId) {
            throw new ValidationError("Service ID is required");
        }

        try {
            const response = await this.adminRequest<{
                service_id: string;
                service_type: string;
                is_healthy?: boolean;
                last_check_ts: number;
                last_success_ts?: number;
                last_error?: string;
                consecutive_failures?: number;
            }>(Method.Get, `/external_services/${encodeURIComponent(asId)}/health`);

            return {
                serviceId: response.service_id,
                serviceType: response.service_type,
                isHealthy: response.is_healthy ?? false,
                lastCheckTs: response.last_check_ts,
                lastSuccessTs: response.last_success_ts,
                lastError: response.last_error,
                consecutiveFailures: response.consecutive_failures ?? 0,
            };
            // @swallow-error { owner: "external-service", expires: "2026-12-31" }
        } catch (error) {
            logger.warn(`ExternalServiceManager.getServiceHealth failed for ${asId}:`, error);
            return null;
        }
    }

    /**
     * Check health for a specific service (trigger a fresh check)
     * POST /_synapse/admin/v1/external_services/{as_id}/health/check
     */
    public async checkServiceHealth(asId: string): Promise<IHealthCheckResult> {
        if (!asId) {
            throw new ValidationError("Service ID is required");
        }

        try {
            const response = await this.adminRequest<{ as_id: string; is_healthy?: boolean }>(
                Method.Post,
                `/external_services/${encodeURIComponent(asId)}/health/check`,
            );

            return {
                asId: response.as_id,
                isHealthy: response.is_healthy ?? false,
            };
        } catch (error) {
            logger.error(`ExternalServiceManager.checkServiceHealth failed for ${asId}:`, error);
            throw error;
        }
    }

    /**
     * Unregister an external service
     * DELETE /_synapse/admin/v1/external_services/{as_id}
     */
    public async unregisterService(asId: string): Promise<void> {
        if (!asId) {
            throw new ValidationError("Service ID is required");
        }

        try {
            await this.adminRequest(Method.Delete, `/external_services/${encodeURIComponent(asId)}`);

            this.servicesCache.delete(asId);
            this.emit(ExternalServiceEvent.ServiceUnregistered, asId);
        } catch (error) {
            logger.error(`ExternalServiceManager.unregisterService failed for ${asId}:`, error);
            this.emit(ExternalServiceEvent.Error, error as Error);
            throw error;
        }
    }

    /**
     * Get health status for all services
     * GET /_synapse/admin/v1/external_services/health
     */
    public async getAllHealthStatus(): Promise<IExternalServiceHealth[]> {
        try {
            const response = await this.adminRequest<
                {
                    service_id: string;
                    service_type: string;
                    is_healthy?: boolean;
                    last_check_ts: number;
                    last_success_ts?: number;
                    last_error?: string;
                    consecutive_failures?: number;
                }[]
            >(Method.Get, "/external_services/health");

            return response.map((s) => ({
                serviceId: s.service_id,
                serviceType: s.service_type,
                isHealthy: s.is_healthy ?? false,
                lastCheckTs: s.last_check_ts,
                lastSuccessTs: s.last_success_ts,
                lastError: s.last_error,
                consecutiveFailures: s.consecutive_failures ?? 0,
            }));
            // @swallow-error { owner: "external-service", expires: "2026-12-31" }
        } catch (error) {
            logger.error("ExternalServiceManager.getAllHealthStatus failed:", error);
            return [];
        }
    }

    /**
     * Register a TrendRadar service
     */
    public async registerTrendRadarService(
        serviceId: string,
        displayName: string,
        webhookUrl?: string,
        apiKey?: string,
    ): Promise<IExternalService> {
        return this.registerService({
            serviceType: "trendradar",
            serviceId,
            displayName,
            webhookUrl,
            apiKey,
        });
    }

    /**
     * Register an OpenClaw service
     */
    public async registerOpenClawService(
        serviceId: string,
        displayName: string,
        webhookUrl?: string,
        apiKey?: string,
    ): Promise<IExternalService> {
        return this.registerService({
            serviceType: "openclaw",
            serviceId,
            displayName,
            webhookUrl,
            apiKey,
        });
    }

    /**
     * Register a generic webhook service
     */
    public async registerWebhookService(
        serviceId: string,
        displayName: string,
        webhookUrl: string,
        apiKey?: string,
    ): Promise<IExternalService> {
        return this.registerService({
            serviceType: "generic_webhook",
            serviceId,
            displayName,
            webhookUrl,
            apiKey,
        });
    }

    /**
     * Get a cached service by ID
     */
    public getCachedService(asId: string): IExternalService | undefined {
        return this.servicesCache.get(asId);
    }

    /**
     * Get all cached services
     */
    public getCachedServices(): IExternalService[] {
        return Array.from(this.servicesCache.values());
    }

    /**
     * Clear the services cache
     */
    public clearCache(): void {
        this.servicesCache.clear();
    }

    /**
     * Check if a service is registered
     */
    public async isServiceRegistered(asId: string): Promise<boolean> {
        const cached = this.servicesCache.get(asId);
        if (cached) {
            return true;
        }

        const services = await this.listServices();
        return services.some((s) => s.asId === asId);
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getExternalServiceManager(): ExternalServiceManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getExternalServiceManager = function (): ExternalServiceManager {
        return getOrCreateManager(this, "externalService", () => new ExternalServiceManager(this));
    };
}

export default ExternalServiceManager;
