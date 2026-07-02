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

import { BaseManager } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { AdminPrefix, ClientPrefix } from "../http-api/prefix";
import { MatrixClient } from "../client";
import { logger } from "../logger";
import { ValidationError } from "../errors";

export enum AppServiceEvent {
    ServiceRegistered = "ServiceRegistered",
    ServiceUpdated = "ServiceUpdated",
    ServiceUnregistered = "ServiceUnregistered",
    ServiceError = "ServiceError",
}

/**
 * 后端响应类型（`synapse-rust/src/web/routes/app_service.rs:127-154` 对应的 `AppServiceResponse`）。
 * - `id` 是 DB 行 id（i64）
 * - `as_id` 是业务 ID（和请求体 `id` 对应），**应该作为 Manager 的主键**
 * - `sender` 是后端从 `sender_localpart` 重命名后的字段
 */
export interface ApplicationServiceResponse {
    id: number;
    as_id: string;
    url: string;
    sender: string;
    description?: string;
    rate_limited: boolean;
    protocols: string[];
    is_enabled: boolean;
    created_ts: number;
}

export interface ApplicationService {
    /** 业务 ID（对应后端 as_id），作为 Manager 主键 */
    as_id: string;
    /** DB 行 id；仅调试/关联用，不作为主键 */
    db_id?: number;
    url: string;
    as_token?: string;
    hs_token?: string;
    sender_localpart: string;
    sender?: string;
    description?: string;
    rate_limited?: boolean;
    is_enabled?: boolean;
    created_ts?: number;
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

export interface UserAppservicesResponse {
    user_id: string;
    appservices: Array<{
        id?: string;
        as_id?: string;
        url?: string;
        sender_localpart?: string;
        namespaces?: object;
        [key: string]: unknown;
    }>;
}

export interface ApplicationServiceQueryUserResult {
    user_id: string;
    application_service: string | null;
    exists: boolean;
}

export interface ApplicationServiceQueryAliasResult {
    alias: string;
    application_service: string | null;
    exists: boolean;
}

export interface ApplicationServiceStateEntry {
    as_id: string;
    state_key: string;
    state_value: string;
    updated_ts: number;
}

export interface PingResult {
    duration: number;
}

export interface RegisterApplicationServiceRequest {
    /** 业务 ID（对应后端 RegisterAppServiceBody.id） */
    id: string;
    url: string;
    as_token: string;
    hs_token: string;
    /** 发送者（本地部分），后端将其映射为 sender_localpart 存储 */
    sender_localpart: string;
    description?: string;
    rate_limited?: boolean;
    protocols?: string[];
    namespaces?: ApplicationService["namespaces"];
}

export interface UpdateApplicationServiceRequest extends Partial<ApplicationService> {}

interface ApplicationServiceManagerEventMap {
    [AppServiceEvent.ServiceRegistered]: (serviceId: string, service: ApplicationService) => void;
    [AppServiceEvent.ServiceUpdated]: (serviceId: string, service: ApplicationService) => void;
    [AppServiceEvent.ServiceUnregistered]: (serviceId: string) => void;
    [AppServiceEvent.ServiceError]: (error: Error) => void;
}

export class ApplicationServiceManager extends BaseManager<AppServiceEvent, ApplicationServiceManagerEventMap> {
    private services: Map<string, ApplicationService> = new Map();
    private initialized: boolean = false;

    constructor(client: MatrixClient) {
        super(client);
    }

    /**
     * 将后端 AppServiceResponse 规范化为 SDK ApplicationService。
     * 后端 sender 字段实际是 sender_localpart 重命名后的结果。
     */
    private fromResponse(
        response: ApplicationServiceResponse,
        request?: RegisterApplicationServiceRequest,
    ): ApplicationService {
        return {
            as_id: response.as_id,
            db_id: response.id,
            url: response.url,
            sender_localpart: response.sender,
            sender: `@${response.sender}:${this.client.getDomain()}`,
            description: response.description,
            rate_limited: response.rate_limited,
            is_enabled: response.is_enabled,
            created_ts: response.created_ts,
            protocols: response.protocols,
            // 注册时由调用方提供的字段，后端响应中并不会回传
            as_token: request?.as_token,
            hs_token: request?.hs_token,
            namespaces: request?.namespaces,
        };
    }

    async registerAppService(request: RegisterApplicationServiceRequest): Promise<ApplicationService> {
        if (!request.id || !request.url || !request.as_token || !request.hs_token || !request.sender_localpart) {
            throw new ValidationError("Missing required fields for application service registration");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<ApplicationServiceResponse>(
                    Method.Post,
                    "/application_services",
                    undefined,
                    {
                        id: request.id,
                        url: request.url,
                        as_token: request.as_token,
                        hs_token: request.hs_token,
                        sender_localpart: request.sender_localpart,
                        description: request.description,
                        rate_limited: request.rate_limited,
                        protocols: request.protocols,
                        namespaces: request.namespaces,
                    },
                    { prefix: AdminPrefix.V1 },
                );
            }, "registerAppService");

            const service = this.fromResponse(response, request);
            this.services.set(service.as_id, service);
            this.emit(AppServiceEvent.ServiceRegistered, service.as_id, service);

            return service;
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, this.normalizeError(error, "registerAppService"));
            throw error;
        }
    }

    async getApplicationService(asId: string): Promise<ApplicationService | null> {
        if (this.services.has(asId)) {
            return this.services.get(asId) || null;
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<ApplicationServiceResponse>(
                    Method.Get,
                    `/application_services/${encodeURIComponent(asId)}`,
                    undefined,
                    undefined,
                    { prefix: AdminPrefix.V1 },
                );
            }, "getApplicationService");

            const service = this.fromResponse(response);
            this.services.set(service.as_id, service);

            return service;
            // @swallow-error { owner: "integration-team", expires: "2026-12-31" }
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, this.normalizeError(error, "getApplicationService"));
            return null;
        }
    }

    async updateApplicationService(
        asId: string,
        request: UpdateApplicationServiceRequest,
    ): Promise<ApplicationService> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<ApplicationServiceResponse>(
                    Method.Put,
                    `/application_services/${encodeURIComponent(asId)}`,
                    undefined,
                    request,
                    { prefix: AdminPrefix.V1 },
                );
            }, "updateApplicationService");

            const existing = this.services.get(asId);
            const fresh = this.fromResponse(response);
            const updated: ApplicationService = {
                ...existing,
                ...fresh,
                as_id: asId,
            };

            this.services.set(asId, updated);
            this.emit(AppServiceEvent.ServiceUpdated, asId, updated);

            return updated;
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, this.normalizeError(error, "updateApplicationService"));
            throw error;
        }
    }

    async unregisterApplicationService(asId: string): Promise<void> {
        try {
            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Delete,
                    `/application_services/${encodeURIComponent(asId)}`,
                    undefined,
                    undefined,
                    { prefix: AdminPrefix.V1 },
                );
            }, "unregisterApplicationService");

            this.services.delete(asId);
            this.emit(AppServiceEvent.ServiceUnregistered, asId);
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, this.normalizeError(error, "unregisterApplicationService"));
            throw error;
        }
    }

    async listApplicationServices(): Promise<ApplicationService[]> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<
                    ApplicationServiceResponse[] | { application_services?: ApplicationServiceResponse[] }
                >(Method.Get, "/application_services", undefined, undefined, { prefix: AdminPrefix.V1 });
            }, "listApplicationServices");

            const rawList = Array.isArray(response) ? response : (response?.application_services ?? []);
            const services = rawList.map((r) => this.fromResponse(r));
            services.forEach((s) => this.services.set(s.as_id, s));

            return services;
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, this.normalizeError(error, "listApplicationServices"));
            return Array.from(this.services.values());
        }
    }

    /**
     * 查询某 userId 是否落在已注册 AS 的命名空间内。
     *
     * @remarks
     * 对应后端 `GET /_matrix/client/v3/appservice/user`，handler 使用 `AdminUser` 提取器，
     * 因此必须以**服务器管理员**身份调用；使用普通用户 access token 会直接 401/403。
     * 同一逻辑也挂在 `GET /_synapse/admin/v1/application_services/query/user`，推荐管理面板走该路径。
     */
    async checkUserId(userId: string): Promise<boolean> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<{
                    exists?: boolean;
                    application_service?: string | null;
                }>(Method.Get, "/appservice/user", { user_id: userId }, undefined, { prefix: ClientPrefix.V3 });
            }, "checkUserId");

            if (typeof response?.exists === "boolean") return response.exists;
            return response?.application_service != null;
        // @swallow-error { owner: "app-service", expires: "2026-12-31" }
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, this.normalizeError(error, "checkUserId"));
            return false;
        }
    }

    /**
     * 查询某 room alias 是否落在已注册 AS 的命名空间内。
     *
     * @remarks
     * 对应后端 `GET /_matrix/client/v3/appservice/alias`，同样需要管理员权限。见 {@link checkUserId}。
     */
    async checkAlias(alias: string): Promise<boolean> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<{
                    exists?: boolean;
                    application_service?: string | null;
                }>(Method.Get, "/appservice/alias", { alias }, undefined, { prefix: ClientPrefix.V3 });
            }, "checkAlias");

            if (typeof response?.exists === "boolean") return response.exists;
            return response?.application_service != null;
        // @swallow-error { owner: "app-service", expires: "2026-12-31" }
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, this.normalizeError(error, "checkAlias"));
            return false;
        }
    }

    async getUserAppservices(userId: string): Promise<UserAppservicesResponse | null> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<UserAppservicesResponse>(
                    Method.Get,
                    `/user/${encodeURIComponent(userId)}/appservice`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V1 },
                );
            }, "getUserAppservices");
        // @swallow-error { owner: "app-service", expires: "2026-12-31" }
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, this.normalizeError(error, "getUserAppservices"));
            return null;
        }
    }

    async pingApplicationService(serviceId: string): Promise<PingResult> {
        try {
            const startTime = Date.now();

            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Post,
                    `/application_services/${encodeURIComponent(serviceId)}/ping`,
                    undefined,
                    undefined,
                    { prefix: AdminPrefix.V1 },
                );
            }, "pingApplicationService");

            return { duration: Date.now() - startTime };
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, this.normalizeError(error, "pingApplicationService"));
            return { duration: -1 };
        }
    }

    async getProtocol(protocol: string): Promise<ApplicationServiceProtocol | null> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<ApplicationServiceProtocol>(
                    Method.Get,
                    `/thirdparty/protocol/${encodeURIComponent(protocol)}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "getProtocol");

            return response;
            // @swallow-error { owner: "integration-team", expires: "2026-12-31" }
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, this.normalizeError(error, "getProtocol"));
            return null;
        }
    }

    async getProtocols(): Promise<string[]> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<Record<string, ApplicationServiceProtocol>>(
                    Method.Get,
                    "/thirdparty/protocols",
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "getProtocols");

            return Object.keys(response || {});
            // @swallow-error { owner: "integration-team", expires: "2026-12-31" }
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, this.normalizeError(error, "getProtocols"));
            return [];
        }
    }

    async queryUsers(protocol: string, fields: Record<string, string>): Promise<ApplicationServiceUser[]> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<ApplicationServiceUser[]>(
                    Method.Get,
                    `/thirdparty/user/${encodeURIComponent(protocol)}`,
                    fields,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "queryUsers");

            return response;
            // @swallow-error { owner: "integration-team", expires: "2026-12-31" }
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, this.normalizeError(error, "queryUsers"));
            return [];
        }
    }

    async queryLocations(protocol: string, fields: Record<string, string>): Promise<unknown[]> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<unknown[]>(
                    Method.Get,
                    `/thirdparty/location/${encodeURIComponent(protocol)}`,
                    fields,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "queryLocations");

            return response;
            // @swallow-error { owner: "integration-team", expires: "2026-12-31" }
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, this.normalizeError(error, "queryLocations"));
            return [];
        }
    }

    getCachedService(serviceId: string): ApplicationService | null {
        return this.services.get(serviceId) || null;
    }

    // ===== Extended appservice admin endpoints (R2-AS-04) =====
    // The backend registers these under `/_synapse/admin/v1/application_services/...`
    // — they cover operational/introspection surfaces (state, users, namespaces,
    // events, statistics, query/user, query/alias) that were previously unreachable
    // from the SDK.

    async getApplicationServiceState(asId: string): Promise<ApplicationServiceStateEntry[]> {
        return this.withRetry(async () => {
            return await this.client.http.authedRequest(
                Method.Get,
                `/application_services/${encodeURIComponent(asId)}/state`,
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        }, "getApplicationServiceState");
    }

    async setApplicationServiceState(asId: string, stateKey: string, value: unknown): Promise<void> {
        await this.withRetry(async () => {
            return await this.client.http.authedRequest(
                Method.Put,
                `/application_services/${encodeURIComponent(asId)}/state/${encodeURIComponent(stateKey)}`,
                undefined,
                { value },
                { prefix: AdminPrefix.V1 },
            );
        }, "setApplicationServiceState");
    }

    async listApplicationServiceUsers(asId: string): Promise<{ users: ApplicationServiceUser[] }> {
        return this.withRetry(async () => {
            return await this.client.http.authedRequest(
                Method.Get,
                `/application_services/${encodeURIComponent(asId)}/users`,
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        }, "listApplicationServiceUsers");
    }

    async getApplicationServiceNamespaces(asId: string): Promise<Record<string, unknown> /* Dynamic: namespaces stored as raw JSON */> {
        return this.withRetry(async () => {
            return await this.client.http.authedRequest(
                Method.Get,
                `/application_services/${encodeURIComponent(asId)}/namespaces`,
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        }, "getApplicationServiceNamespaces");
    }

    async listApplicationServiceEvents(
        asId: string,
        params: { limit?: number; from?: string } = {},
    ): Promise<{ events: unknown[]; next_token?: string }> {
        const q: Record<string, string> = {};
        if (params.limit !== undefined) q.limit = String(params.limit);
        if (params.from !== undefined) q.from = params.from;
        return this.withRetry(async () => {
            return await this.client.http.authedRequest(
                Method.Get,
                `/application_services/${encodeURIComponent(asId)}/events`,
                q,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        }, "listApplicationServiceEvents");
    }

    async getApplicationServiceStatistics(asId: string): Promise<Record<string, unknown> /* Dynamic: statistics shape varies by backend version */> {
        return this.withRetry(async () => {
            return await this.client.http.authedRequest(
                Method.Get,
                `/application_services/${encodeURIComponent(asId)}/statistics`,
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        }, "getApplicationServiceStatistics");
    }

    async queryApplicationServiceUser(asId: string, userId: string): Promise<ApplicationServiceQueryUserResult> {
        return this.withRetry(async () => {
            return await this.client.http.authedRequest(
                Method.Get,
                `/application_services/${encodeURIComponent(asId)}/query/user/${encodeURIComponent(userId)}`,
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        }, "queryApplicationServiceUser");
    }

    async queryApplicationServiceAlias(asId: string, alias: string): Promise<ApplicationServiceQueryAliasResult> {
        return this.withRetry(async () => {
            return await this.client.http.authedRequest(
                Method.Get,
                `/application_services/${encodeURIComponent(asId)}/query/alias/${encodeURIComponent(alias)}`,
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        }, "queryApplicationServiceAlias");
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
            logger.warn("ApplicationServiceManager.start failed:", e);
        }
    }

    stop(): void {
        this.services.clear();
        this.initialized = false;
    }
}
