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

import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { AdminPrefix, ClientPrefix } from "../http-api/prefix";
import { MatrixClient } from "../client";
import { logger } from "../logger";
import { ValidationError } from "../errors";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

import type { AppServicePath } from "./__generated__/route-table";
import type { ThirdpartyPath } from "../third-party/__generated__/route-table";
import type { PathAssert, StripAdminV1, StripV1, StripV3 } from "../http-api/strip-prefix";

/**
 * 契约路径断言（**按前缀分设三个助手**，避免跨命名空间误匹配）。
 *
 * 本模块的 21 处路径横跨三个前缀：`AdminPrefix.V1`（`/_synapse/admin/v1`）、
 * `ClientPrefix.V3`、`ClientPrefix.V1`。若只用一个助手链式剥离，`/_matrix/client/v1/...`
 * 形态的调用点可能被 admin 表里的同名尾段放行，故按 prefix 分开断言。
 *
 * `cpu3` 另 union 了 `ThirdpartyPath`：本模块有 4 处 thirdparty 路由（`/thirdparty/*`），
 * 它们在契约里属 **third-party** 模块（见 `src/third-party/__generated__/route-table.ts`），
 * 与 `room-summary` 借 `RoomPath` 的做法同例。
 */
function apu<const P extends string>(path: P & PathAssert<P, StripAdminV1<AppServicePath>>): P {
    return path;
}
function cpu3<const P extends string>(path: P & PathAssert<P, StripV3<AppServicePath | ThirdpartyPath>>): P {
    return path;
}
function cpu1<const P extends string>(path: P & PathAssert<P, StripV1<AppServicePath>>): P {
    return path;
}

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

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
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

    /**
     * 注册一个新的应用服务（Application Service）。
     *
     * @param request - 应用服务注册参数
     * @returns 规范化后的应用服务对象
     *
     * @throws {ValidationError} 缺少必填字段时抛出
     * @throws {ApiError} 后端请求失败时透传
     *
     * @example
     * ```typescript
     * const service = await client.getAppServiceManager().registerAppService({
     *     id: "my-appservice",
     *     url: "https://as.example.org",
     *     as_token: "as-token",
     *     hs_token: "hs-token",
     *     sender_localpart: "appservice",
     * });
     * ```
     */
    async registerAppService(request: RegisterApplicationServiceRequest): Promise<ApplicationService> {
        if (!request.id || !request.url || !request.as_token || !request.hs_token || !request.sender_localpart) {
            throw new ValidationError("Missing required fields for application service registration");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.request<ApplicationServiceResponse>({
                    method: Method.Post,
                    path: apu("/appservices"),
                    body: {
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
                    prefix: AdminPrefix.V1,
                });
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

    /**
     * 按业务 ID 获取应用服务；命中本地缓存则直接返回。
     *
     * @param asId - 应用服务业务 ID
     * @returns 应用服务对象；不存在时返回 `null`
     *
     * @example
     * ```typescript
     * const service = await client.getAppServiceManager().getApplicationService("my-appservice");
     * ```
     */
    async getApplicationService(asId: string): Promise<ApplicationService | null> {
        if (this.services.has(asId)) {
            return this.services.get(asId) || null;
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.request<ApplicationServiceResponse>({
                    method: Method.Get,
                    path: apu(`/appservices/${encodeURIComponent(asId)}`),
                    prefix: AdminPrefix.V1,
                });
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

    /**
     * 更新指定应用服务的配置。
     *
     * @param asId - 应用服务业务 ID
     * @param request - 需要更新的字段
     * @returns 更新后的应用服务对象
     *
     * @throws {ApiError} 后端请求失败时透传
     *
     * @example
     * ```typescript
     * const updated = await client
     *     .getAppServiceManager()
     *     .updateApplicationService("my-appservice", { url: "https://new.example.org" });
     * ```
     */
    async updateApplicationService(
        asId: string,
        request: UpdateApplicationServiceRequest,
    ): Promise<ApplicationService> {
        try {
            const response = await this.withRetry(async () => {
                return await this.request<ApplicationServiceResponse>({
                    method: Method.Put,
                    path: apu(`/appservices/${encodeURIComponent(asId)}`),
                    body: request,
                    prefix: AdminPrefix.V1,
                });
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

    /**
     * 注销指定应用服务。
     *
     * @param asId - 应用服务业务 ID
     * @returns 注销完成时 resolves
     *
     * @throws {ApiError} 后端请求失败时透传
     *
     * @example
     * ```typescript
     * await client.getAppServiceManager().unregisterApplicationService("my-appservice");
     * ```
     */
    async unregisterApplicationService(asId: string): Promise<void> {
        try {
            await this.withRetry(async () => {
                return await this.request({
                    method: Method.Delete,
                    path: apu(`/appservices/${encodeURIComponent(asId)}`),
                    prefix: AdminPrefix.V1,
                });
            }, "unregisterApplicationService");

            this.services.delete(asId);
            this.emit(AppServiceEvent.ServiceUnregistered, asId);
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, this.normalizeError(error, "unregisterApplicationService"));
            throw error;
        }
    }

    /**
     * 列出当前注册的全部应用服务。
     *
     * @returns 应用服务数组；请求失败时回退到本地缓存
     *
     * @example
     * ```typescript
     * const services = await client.getAppServiceManager().listApplicationServices();
     * ```
     */
    async listApplicationServices(): Promise<ApplicationService[]> {
        try {
            const response = await this.withRetry(async () => {
                return await this.request<ApplicationServiceResponse[] | { services?: ApplicationServiceResponse[] }>({
                    method: Method.Get,
                    path: apu("/appservices"),
                    prefix: AdminPrefix.V1,
                });
            }, "listApplicationServices");

            const rawList = Array.isArray(response) ? response : (response?.services ?? []);
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
     * 同一逻辑也挂在 `GET /_synapse/admin/v1/appservices/query/user`，推荐管理面板走该路径。
     *
     * @example
     * ```typescript
     * const inNamespace = await client.getAppServiceManager().checkUserId("@alice:example.org");
     * ```
     */
    async checkUserId(userId: string): Promise<boolean> {
        try {
            const response = await this.withRetry(async () => {
                return await this.request<{
                    exists?: boolean;
                    application_service?: string | null;
                }>({
                    method: Method.Get,
                    path: cpu3("/appservice/user"),
                    queryParams: { user_id: userId },
                    prefix: ClientPrefix.V3,
                });
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
     *
     * @example
     * ```typescript
     * const inNamespace = await client.getAppServiceManager().checkAlias("#room:example.org");
     * ```
     */
    async checkAlias(alias: string): Promise<boolean> {
        try {
            const response = await this.withRetry(async () => {
                return await this.request<{
                    exists?: boolean;
                    application_service?: string | null;
                }>({
                    method: Method.Get,
                    path: cpu3("/appservice/alias"),
                    queryParams: { alias },
                    prefix: ClientPrefix.V3,
                });
            }, "checkAlias");

            if (typeof response?.exists === "boolean") return response.exists;
            return response?.application_service != null;
            // @swallow-error { owner: "app-service", expires: "2026-12-31" }
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, this.normalizeError(error, "checkAlias"));
            return false;
        }
    }

    /**
     * 获取指定用户关联的应用服务信息。
     *
     * @param userId - 用户 ID
     * @returns 用户关联的应用服务响应；请求失败时返回 `null`
     *
     * @example
     * ```typescript
     * const result = await client.getAppServiceManager().getUserAppservices("@alice:example.org");
     * ```
     */
    async getUserAppservices(userId: string): Promise<UserAppservicesResponse | null> {
        try {
            return await this.withRetry(async () => {
                return await this.request<UserAppservicesResponse>({
                    method: Method.Get,
                    path: cpu1(`/user/${encodeURIComponent(userId)}/appservice`),
                    prefix: ClientPrefix.V1,
                });
            }, "getUserAppservices");
            // @swallow-error { owner: "app-service", expires: "2026-12-31" }
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, this.normalizeError(error, "getUserAppservices"));
            return null;
        }
    }

    /**
     * 探测指定应用服务的连通性并返回耗时。
     *
     * @param serviceId - 应用服务业务 ID
     * @returns 包含往返耗时的结果；失败时 `duration` 为 `-1`
     *
     * @example
     * ```typescript
     * const { duration } = await client.getAppServiceManager().pingApplicationService("my-appservice");
     * ```
     */
    async pingApplicationService(serviceId: string): Promise<PingResult> {
        try {
            const startTime = Date.now();

            await this.withRetry(async () => {
                return await this.request({
                    method: Method.Post,
                    path: apu(`/appservices/${encodeURIComponent(serviceId)}/ping`),
                    prefix: AdminPrefix.V1,
                });
            }, "pingApplicationService");

            return { duration: Date.now() - startTime };
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, this.normalizeError(error, "pingApplicationService"));
            return { duration: -1 };
        }
    }

    /**
     * 获取指定第三方协议的定义。
     *
     * @param protocol - 协议标识
     * @returns 协议定义；请求失败时返回 `null`
     *
     * @example
     * ```typescript
     * const protocol = await client.getAppServiceManager().getProtocol("irc");
     * ```
     */
    async getProtocol(protocol: string): Promise<ApplicationServiceProtocol | null> {
        try {
            const response = await this.withRetry(async () => {
                return await this.request<ApplicationServiceProtocol>({
                    method: Method.Get,
                    path: cpu3(`/thirdparty/protocol/${encodeURIComponent(protocol)}`),
                    prefix: ClientPrefix.V3,
                });
            }, "getProtocol");

            return response;
            // @swallow-error { owner: "integration-team", expires: "2026-12-31" }
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, this.normalizeError(error, "getProtocol"));
            return null;
        }
    }

    /**
     * 获取服务器支持的全部第三方协议标识。
     *
     * @returns 协议标识数组；请求失败时返回空数组
     *
     * @example
     * ```typescript
     * const protocols = await client.getAppServiceManager().getProtocols();
     * ```
     */
    async getProtocols(): Promise<string[]> {
        try {
            const response = await this.withRetry(async () => {
                return await this.request<Record<string, ApplicationServiceProtocol>>({
                    method: Method.Get,
                    path: cpu3("/thirdparty/protocols"),
                    prefix: ClientPrefix.V3,
                });
            }, "getProtocols");

            return Object.keys(response || {});
            // @swallow-error { owner: "integration-team", expires: "2026-12-31" }
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, this.normalizeError(error, "getProtocols"));
            return [];
        }
    }

    /**
     * 按第三方协议字段查询用户。
     *
     * @param protocol - 协议标识
     * @param fields - 协议查询字段
     * @returns 匹配的用户数组；请求失败时返回空数组
     *
     * @example
     * ```typescript
     * const users = await client.getAppServiceManager().queryUsers("irc", { nick: "alice" });
     * ```
     */
    async queryUsers(protocol: string, fields: Record<string, string>): Promise<ApplicationServiceUser[]> {
        try {
            const response = await this.withRetry(async () => {
                return await this.request<ApplicationServiceUser[]>({
                    method: Method.Get,
                    path: cpu3(`/thirdparty/user/${encodeURIComponent(protocol)}`),
                    queryParams: fields,
                    prefix: ClientPrefix.V3,
                });
            }, "queryUsers");

            return response;
            // @swallow-error { owner: "integration-team", expires: "2026-12-31" }
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, this.normalizeError(error, "queryUsers"));
            return [];
        }
    }

    /**
     * 按第三方协议字段查询位置。
     *
     * @param protocol - 协议标识
     * @param fields - 协议查询字段
     * @returns 匹配的位置数组；请求失败时返回空数组
     *
     * @example
     * ```typescript
     * const locations = await client.getAppServiceManager().queryLocations("irc", { channel: "#matrix" });
     * ```
     */
    async queryLocations(protocol: string, fields: Record<string, string>): Promise<unknown[]> {
        try {
            const response = await this.withRetry(async () => {
                return await this.request<unknown[]>({
                    method: Method.Get,
                    path: cpu3(`/thirdparty/location/${encodeURIComponent(protocol)}`),
                    queryParams: fields,
                    prefix: ClientPrefix.V3,
                });
            }, "queryLocations");

            return response;
            // @swallow-error { owner: "integration-team", expires: "2026-12-31" }
        } catch (error) {
            this.emit(AppServiceEvent.ServiceError, this.normalizeError(error, "queryLocations"));
            return [];
        }
    }

    /**
     * 从本地缓存读取应用服务。
     *
     * @param serviceId - 应用服务业务 ID
     * @returns 缓存的应用服务对象；不存在时返回 `null`
     *
     * @example
     * ```typescript
     * const cached = client.getAppServiceManager().getCachedService("my-appservice");
     * ```
     */
    getCachedService(serviceId: string): ApplicationService | null {
        return this.services.get(serviceId) || null;
    }

    // ===== Extended appservice admin endpoints (R2-AS-04) =====
    // The backend registers these under `/_synapse/admin/v1/appservices/...`
    // — they cover operational/introspection surfaces (state, users, namespaces,
    // events, statistics, query/user, query/alias) that were previously unreachable
    // from the SDK.

    /**
     * 获取指定应用服务的状态条目列表。
     *
     * @param asId - 应用服务业务 ID
     * @returns 状态条目数组
     *
     * @example
     * ```typescript
     * const state = await client.getAppServiceManager().getApplicationServiceState("my-appservice");
     * ```
     */
    async getApplicationServiceState(asId: string): Promise<ApplicationServiceStateEntry[]> {
        return this.withRetry(async () => {
            return await this.request({
                method: Method.Get,
                path: apu(`/appservices/${encodeURIComponent(asId)}/state`),
                prefix: AdminPrefix.V1,
            });
        }, "getApplicationServiceState");
    }

    /**
     * 设置指定应用服务的状态条目。
     *
     * @param asId - 应用服务业务 ID
     * @param stateKey - 状态键
     * @param value - 状态值
     * @returns 设置完成时 resolves
     *
     * @example
     * ```typescript
     * await client
     *     .getAppServiceManager()
     *     .setApplicationServiceState("my-appservice", "enabled", true);
     * ```
     */
    async setApplicationServiceState(asId: string, stateKey: string, value: unknown): Promise<void> {
        await this.withRetry(async () => {
            return await this.request({
                // 后端形状（`app_service.rs::set_app_service_state` + `SetStateBody`）：
                // `POST /_synapse/admin/v1/appservices/{as_id}/state`，body `{state_key, state_value}`。
                // 原先的 `PUT .../state/{state_key}` 两边都不存在（上游 `synapse/rest/admin/`
                // 根本没有 appservice 模块）—— 2026-10-01 契约核对后按后端形状改正。
                method: Method.Post,
                path: apu(`/appservices/${encodeURIComponent(asId)}/state`),
                body: { state_key: stateKey, state_value: value },
                prefix: AdminPrefix.V1,
            });
        }, "setApplicationServiceState");
    }

    /**
     * 列出指定应用服务管理的用户。
     *
     * @param asId - 应用服务业务 ID
     * @returns 包含用户数组的对象
     *
     * @example
     * ```typescript
     * const { users } = await client.getAppServiceManager().listApplicationServiceUsers("my-appservice");
     * ```
     */
    async listApplicationServiceUsers(asId: string): Promise<{ users: ApplicationServiceUser[] }> {
        return this.withRetry(async () => {
            return await this.request({
                method: Method.Get,
                path: apu(`/appservices/${encodeURIComponent(asId)}/users`),
                prefix: AdminPrefix.V1,
            });
        }, "listApplicationServiceUsers");
    }

    /**
     * 获取指定应用服务的命名空间配置。
     *
     * @param asId - 应用服务业务 ID
     * @returns 命名空间原始 JSON 对象
     *
     * @example
     * ```typescript
     * const namespaces = await client
     *     .getAppServiceManager()
     *     .getApplicationServiceNamespaces("my-appservice");
     * ```
     */
    async getApplicationServiceNamespaces(
        asId: string,
    ): Promise<Record<string, unknown> /* Dynamic: namespaces stored as raw JSON */> {
        return this.withRetry(async () => {
            return await this.request({
                method: Method.Get,
                path: apu(`/appservices/${encodeURIComponent(asId)}/namespaces`),
                prefix: AdminPrefix.V1,
            });
        }, "getApplicationServiceNamespaces");
    }

    /**
     * 分页列出指定应用服务的事件。
     *
     * @param asId - 应用服务业务 ID
     * @param params - 分页参数，`limit` 限制条数、`from` 为续页令牌
     * @returns 包含事件数组与可选 `next_token` 的分页结果
     *
     * @example
     * ```typescript
     * const { events, next_token } = await client
     *     .getAppServiceManager()
     *     .listApplicationServiceEvents("my-appservice", { limit: 50 });
     * ```
     */
    async listApplicationServiceEvents(
        asId: string,
        params: { limit?: number; from?: string } = {},
    ): Promise<{ events: unknown[]; next_token?: string }> {
        const q: Record<string, string> = {};
        if (params.limit !== undefined) q.limit = String(params.limit);
        if (params.from !== undefined) q.from = params.from;
        return this.withRetry(async () => {
            return await this.request({
                method: Method.Get,
                path: apu(`/appservices/${encodeURIComponent(asId)}/events`),
                queryParams: q,
                prefix: AdminPrefix.V1,
            });
        }, "listApplicationServiceEvents");
    }

    /**
     * 获取应用服务的全局统计信息。
     *
     * @returns 随后端版本变化的统计信息原始 JSON 对象
     *
     * @example
     * ```typescript
     * const stats = await client.getAppServiceManager().getApplicationServiceStatistics();
     * ```
     */
    async getApplicationServiceStatistics(): Promise<
        Record<string, unknown> /* Dynamic: statistics shape varies by backend version */
    > {
        return this.withRetry(async () => {
            return await this.request({
                // 后端是**全局**统计（`app_service.rs::get_statistics`，路径里没有 `{as_id}`）——
                // SDK 原先的 `.../{as}/statistics` 形状后端与上游都没有 ⇒ 参数一并去掉。
                method: Method.Get,
                path: apu("/appservices/statistics"),
                prefix: AdminPrefix.V1,
            });
        }, "getApplicationServiceStatistics");
    }

    /**
     * 查询哪个应用服务管理指定用户。
     *
     * @param userId - 待查询的用户 ID
     * @returns 用户与所属应用服务的查询结果
     *
     * @example
     * ```typescript
     * const result = await client
     *     .getAppServiceManager()
     *     .queryApplicationServiceUser("@alice:example.org");
     * ```
     */
    async queryApplicationServiceUser(userId: string): Promise<ApplicationServiceQueryUserResult> {
        return this.withRetry(async () => {
            return await this.request({
                // 后端：`GET .../appservices/query/user?user_id=…`（`query_user` 用 `Query<QueryUser>`），
                // 语义是"哪个 AS 管理该 user" ⇒ 不需要 `asId`。
                method: Method.Get,
                path: apu("/appservices/query/user"),
                queryParams: { user_id: userId },
                prefix: AdminPrefix.V1,
            });
        }, "queryApplicationServiceUser");
    }

    /**
     * 查询哪个应用服务管理指定别名。
     *
     * @param alias - 待查询的房间别名（形如 `#room:example.org`）
     * @returns 别名与所属应用服务的查询结果
     *
     * @example
     * ```typescript
     * const result = await client
     *     .getAppServiceManager()
     *     .queryApplicationServiceAlias("#room:example.org");
     * ```
     */
    async queryApplicationServiceAlias(alias: string): Promise<ApplicationServiceQueryAliasResult> {
        return this.withRetry(async () => {
            return await this.request({
                // 同 `queryApplicationServiceUser`：`GET .../appservices/query/alias?alias=…`。
                method: Method.Get,
                path: apu("/appservices/query/alias"),
                queryParams: { alias },
                prefix: AdminPrefix.V1,
            });
        }, "queryApplicationServiceAlias");
    }

    /**
     * 获取本地缓存中已加载的全部应用服务。
     *
     * @returns 缓存中的应用服务数组
     *
     * @example
     * ```typescript
     * const services = client.getAppServiceManager().getCachedServices();
     * ```
     */
    getCachedServices(): ApplicationService[] {
        return Array.from(this.services.values());
    }

    /**
     * 清空本地应用服务缓存。
     *
     * @example
     * ```typescript
     * client.getAppServiceManager().clearCache();
     * ```
     */
    clearCache(): void {
        this.services.clear();
    }

    /**
     * 启动管理器并预加载应用服务列表。
     *
     * 若已初始化则直接返回；加载失败时记录警告且不抛出。
     *
     * @example
     * ```typescript
     * await client.getAppServiceManager().start();
     * ```
     */
    async start(): Promise<void> {
        if (this.initialized) return;

        try {
            await this.listApplicationServices();
            this.initialized = true;
        } catch (e) {
            logger.warn("ApplicationServiceManager.start failed:", e);
        }
    }

    /**
     * 停止管理器并清空缓存与初始化标记。
     *
     * @example
     * ```typescript
     * client.getAppServiceManager().stop();
     * ```
     */
    stop(): void {
        this.services.clear();
        this.initialized = false;
    }
}

/**
 * 将 `getAppServiceManager` 挂到 `MatrixClient.prototype` 上，使前端可经 SDK 调用
 * 应用服务管理端点（对应 `synapse-rust/src/web/routes/app_service.rs` 的 25 条路由）。
 *
 * 遵循本 fork 的 `extendMatrixClient` 约定：由 `extendMatrixClientWithManagers()`
 * 统一动态调用（见 `src/manager-extensions/index.ts`，已登记 `includeAppService`）。
 */
export function extendMatrixClient(): void {
    MatrixClient.prototype.getAppServiceManager = function (): ApplicationServiceManager {
        registerManagerClass("app-service", ApplicationServiceManager);
        return getOrCreateManager(this, "app-service", () => new ApplicationServiceManager(this));
    };
}
