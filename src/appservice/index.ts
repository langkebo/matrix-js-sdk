import { logger } from "../logger"
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
 * Application Service Manager - 应用服务管理
 * 
 * 提供应用服务的注册、查询、管理功能
 */

import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { Method } from "../http-api/method.ts";

export enum AppServiceEvent {
    ServiceRegistered = "ServiceRegistered",
    ServiceUpdated = "ServiceUpdated",
    ServiceUnregistered = "ServiceUnregistered",
    ServiceError = "ServiceError",
}

export interface ApplicationService {
    id: string;
    url: string;
    as_token: string;
    hs_token: string;
    sender_localpart: string;
    sender?: string;
    rate_limited?: boolean;
    protocols?: string[];
    namespaces?: {
        users?: ApplicationServiceNamespace[];
        rooms?: ApplicationServiceNamespace[];
        aliases?: ApplicationServiceNamespace[];
    };
}

export interface ApplicationServiceNamespace {
    exclusive: boolean;
    regex: string;
    group_id?: string;
}

export interface ApplicationServiceUser {
    user_id: string;
    displayname?: string;
    avatar_url?: string;
}

export interface ApplicationServiceProtocol {
    instances: ApplicationServiceProtocolInstance[];
}

export interface ApplicationServiceProtocolInstance {
    network_id: string;
    desc: string;
    icon?: string;
    field?: string;
}

export interface PingResult {
    duration: number;
}

export interface RegisterApplicationServiceRequest {
    id: string;
    url: string;
    as_token: string;
    hs_token: string;
    sender_localpart: string;
    rate_limited?: boolean;
    protocols?: string[];
    namespaces?: ApplicationService['namespaces'];
}

export interface UpdateApplicationServiceRequest extends Partial<ApplicationService> {}

interface ApplicationServiceManagerEventMap {
    [AppServiceEvent.ServiceRegistered]: (serviceId: string, service: ApplicationService) => void;
    [AppServiceEvent.ServiceUpdated]: (serviceId: string, service: ApplicationService) => void;
    [AppServiceEvent.ServiceUnregistered]: (serviceId: string) => void;
    [AppServiceEvent.ServiceError]: (error: Error) => void;
}

export class ApplicationServiceManager extends TypedEventEmitter<AppServiceEvent, ApplicationServiceManagerEventMap> {
    private _client: any;
    private services: Map<string, ApplicationService> = new Map();
    private initialized: boolean = false;

    constructor(client: any) {
        super();
        this._client = client;
    }

    async registerAppService(request: RegisterApplicationServiceRequest): Promise<ApplicationService> {
        if (!request.id || !request.url || !request.as_token || !request.hs_token || !request.sender_localpart) {
            throw new Error("Missing required fields for application service registration");
        }

        try {
            const response = await this._client.http.authedRequest(
                Method.Post,
                "/_synapse/admin/v1/application_services",
                undefined,
                request,
                { prefix: "/_synapse/admin/v1" }
            );

            const service: ApplicationService = {
                id: request.id,
                url: request.url,
                as_token: request.as_token,
                hs_token: request.hs_token,
                sender_localpart: request.sender_localpart,
                sender: `@${request.sender_localpart}:${this._client.getDomain()}`,
                rate_limited: request.rate_limited,
                protocols: request.protocols,
                namespaces: request.namespaces,
            };

            this.services.set(service.id, service);
            this.emit(AppServiceEvent.ServiceRegistered, service.id, service);

            return service;
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, error as Error);
            throw error;
        }
    }

    async getApplicationService(serviceId: string): Promise<ApplicationService | null> {
        if (this.services.has(serviceId)) {
            return this.services.get(serviceId) || null;
        }

        try {
            const response = await this._client.http.authedRequest(
                Method.Get,
                `/_synapse/admin/v1/application_services/${encodeURIComponent(serviceId)}`,
                undefined,
                undefined,
                { prefix: "/_synapse/admin/v1" }
            );

            const service = response as ApplicationService;
            this.services.set(serviceId, service);

            return service;
        } catch (e) {
            logger.warn('ApplicationServiceManager.getApplicationService failed:', e);
            return null;
        }
    }

    async updateApplicationService(serviceId: string, request: UpdateApplicationServiceRequest): Promise<ApplicationService> {
        try {
            const response = await this._client.http.authedRequest(
                Method.Put,
                `/_synapse/admin/v1/application_services/${encodeURIComponent(serviceId)}`,
                undefined,
                request,
                { prefix: "/_synapse/admin/v1" }
            );

            const existing = this.services.get(serviceId);
            const updated: ApplicationService = {
                ...existing,
                ...request,
                id: serviceId,
            } as ApplicationService;

            this.services.set(serviceId, updated);
            this.emit(AppServiceEvent.ServiceUpdated, serviceId, updated);

            return updated;
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, error as Error);
            throw error;
        }
    }

    async unregisterApplicationService(serviceId: string): Promise<void> {
        try {
            await this._client.http.authedRequest(
                Method.Delete,
                `/_synapse/admin/v1/application_services/${encodeURIComponent(serviceId)}`,
                undefined,
                undefined,
                { prefix: "/_synapse/admin/v1" }
            );

            this.services.delete(serviceId);
            this.emit(AppServiceEvent.ServiceUnregistered, serviceId);
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, error as Error);
            throw error;
        }
    }

    async listApplicationServices(): Promise<ApplicationService[]> {
        try {
            const response = await this._client.http.authedRequest(
                Method.Get,
                "/_synapse/admin/v1/application_services",
                undefined,
                undefined,
                { prefix: "/_synapse/admin/v1" }
            );

            const services = (response.application_services || []) as ApplicationService[];
            services.forEach(s => this.services.set(s.id, s));

            return services;
        } catch (e) {
            logger.warn('ApplicationServiceManager.listApplicationServices failed:', e);
            return Array.from(this.services.values());
        }
    }

    async checkUserId(userId: string): Promise<boolean> {
        try {
            const response = await this._client.http.authedRequest(
                Method.Get,
                "/_matrix/client/v3/appservice/user",
                { user_id: userId },
                undefined,
                { prefix: "/_matrix/client/v3" }
            );

            return response.exists === true;
        } catch (e) {
            return false;
        }
    }

    async checkAlias(alias: string): Promise<boolean> {
        try {
            const response = await this._client.http.authedRequest(
                Method.Get,
                "/_matrix/client/v3/appservice/alias",
                { alias },
                undefined,
                { prefix: "/_matrix/client/v3" }
            );

            return response.exists === true;
        } catch (e) {
            return false;
        }
    }

    async pingApplicationService(serviceId: string): Promise<PingResult> {
        try {
            const startTime = Date.now();
            
            await this._client.http.authedRequest(
                Method.Post,
                `/_synapse/admin/v1/application_services/${encodeURIComponent(serviceId)}/ping`,
                undefined,
                undefined,
                { prefix: "/_synapse/admin/v1" }
            );

            return { duration: Date.now() - startTime };
        } catch (e) {
            logger.warn('ApplicationServiceManager.pingApplicationService failed:', e);
            return { duration: -1 };
        }
    }

    async getProtocol(protocol: string): Promise<ApplicationServiceProtocol | null> {
        try {
            const response = await this._client.http.authedRequest(
                Method.Get,
                `/_matrix/client/v3/thirdparty/protocol/${encodeURIComponent(protocol)}`,
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" }
            );

            return response as ApplicationServiceProtocol;
        } catch (e) {
            logger.warn('ApplicationServiceManager.getProtocol failed:', e);
            return null;
        }
    }

    async getProtocols(): Promise<string[]> {
        try {
            const response = await this._client.http.authedRequest(
                Method.Get,
                "/_matrix/client/v3/thirdparty/protocols",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" }
            );

            return Object.keys(response || {});
        } catch (e) {
            logger.warn('ApplicationServiceManager.getProtocols failed:', e);
            return [];
        }
    }

    async queryUsers(protocol: string, fields: Record<string, string>): Promise<ApplicationServiceUser[]> {
        try {
            const response = await this._client.http.authedRequest(
                Method.Get,
                `/_matrix/client/v3/thirdparty/user/${encodeURIComponent(protocol)}`,
                fields,
                undefined,
                { prefix: "/_matrix/client/v3" }
            );

            return response as ApplicationServiceUser[];
        } catch (e) {
            logger.warn('ApplicationServiceManager.queryUsers failed:', e);
            return [];
        }
    }

    async queryLocations(protocol: string, fields: Record<string, string>): Promise<any[]> {
        try {
            const response = await this._client.http.authedRequest(
                Method.Get,
                `/_matrix/client/v3/thirdparty/location/${encodeURIComponent(protocol)}`,
                fields,
                undefined,
                { prefix: "/_matrix/client/v3" }
            );

            return response;
        } catch (e) {
            logger.warn('ApplicationServiceManager.queryLocations failed:', e);
            return [];
        }
    }

    getCachedService(serviceId: string): ApplicationService | null {
        return this.services.get(serviceId) || null;
    }

    getCachedServices(): ApplicationService[] {
        return Array.from(this.services.values());
    }

    clearCache(): void {
        this.services.clear();
    }

    async start(): Promise<void> {
        if (this.initialized) return;

        try {
            await this.listApplicationServices();
            this.initialized = true;
        } catch (e) {
            logger.warn('ApplicationServiceManager.start failed:', e);
        }
    }

    stop(): void {
        this.services.clear();
        this.initialized = false;
    }
}
