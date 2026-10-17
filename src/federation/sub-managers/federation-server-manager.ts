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
 * Federation Server Sub-Manager - 联邦服务器子管理器
 *
 * 提供联邦服务器状态查询、连接管理功能。
 */

import { Method } from "../../http-api/method";
import { AdminPrefix } from "../../http-api/prefix";
import { MatrixClient } from "../../client";
import { BaseManager, type ManagerOpts, type RequestSpec } from "../../managers/base-manager";
import { logger } from "../../logger";
import { ValidationError } from "../../errors";
import type { IFederationServer, IFederationStatus } from "./federation-server-types";

export enum FederationServerEvent {
    ServerAdded = "ServerAdded",
    ServerRemoved = "ServerRemoved",
    FederationError = "FederationError",
}

interface FederationServerEventMap {
    [FederationServerEvent.ServerAdded]: (serverName: string) => void;
    [FederationServerEvent.ServerRemoved]: (serverName: string) => void;
    [FederationServerEvent.FederationError]: (error: Error) => void;
}

export class FederationServerManager extends BaseManager<FederationServerEvent, FederationServerEventMap> {
    private serverCache: Map<string, IFederationServer> = new Map();

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * Federation 端点（`/_matrix/federation/v1/*`、`/_synapse/federation/v1/*`）
     * 是 server-to-server 接口，不需要用户 access token。
     *
     * 当 `prefix === ""` 时自动走 `client.http.request`（不带 token）；
     * admin 端点（`prefix === AdminPrefix.V1`）仍走默认的 `authedRequest`。
     */
    protected async request<T>(spec: RequestSpec): Promise<T> {
        if (spec.prefix === "") {
            return super.request<T>({ ...spec, authenticated: false });
        }
        return super.request<T>(spec);
    }

    /**
     * 获取服务器状态
     *
     * 契约（2026-10-01 核对）：上游 Synapse v1.162.0 与本仓后端都**没有**
     * `/federation/status/{server}`；权威形状是
     * `GET /_synapse/admin/v1/federation/destinations/{destination}`
     * （`synapse-web/src/routes/admin/federation.rs::get_destination`），返回
     * `{destination, retry_last_ts, retry_interval, failure_ts, last_successful_ts,
     *   failure_count, status, updated_ts}`（`status` 默认 `"active"`）。
     * 因此 `online` 由 `status === "active"` 推导，`lastSuccessfulConnect` 取
     * `last_successful_ts`；后端不提供 `latency`，**不再臆造**该字段。
     *
     * @param serverName - 服务器名称（如 `example.com`）。
     * @param throwOnError - 是否抛出错误（默认 true）；为 false 时失败返回 `null`。
     * @returns 服务器状态；当 `throwOnError` 为 false 且请求失败时返回 `null`。
     *
     * @example
     * ```typescript
     * const status = await client.getFederationManager().server.getServerStatus("example.com");
     * console.log(status?.online);
     * ```
     *
     * @throws {ValidationError} 当 serverName 为空时抛出。
     * @throws {Error} 当请求失败且 `throwOnError` 为 true 时抛出。
     */
    async getServerStatus(serverName: string, throwOnError = true): Promise<IFederationStatus | null> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }

        return this.request<{
            destination?: string | null;
            retry_last_ts?: number | null;
            failure_ts?: number | null;
            last_successful_ts?: number | null;
            failure_count?: number;
            status?: string;
        }>({
            method: Method.Get,
            path: `/federation/destinations/${encodeURIComponent(serverName)}`,
            prefix: AdminPrefix.V1,
        }).then(
            (response) => {
                return {
                    online: response.status === "active",
                    lastSuccessfulConnect: response.last_successful_ts ?? undefined,
                };
            },
            (e) => {
                const error = this.normalizeError(e, "getServerStatus");
                if (throwOnError) {
                    throw error;
                }
                logger.warn("FederationManager.getServerStatus failed:", error);
                return null;
            },
        );
    }

    /**
     * 获取联邦目的地列表（后端已知的联邦目标服务器）。
     *
     * @param throwOnError - 是否抛出错误（默认 true）；为 false 时失败返回本地缓存。
     * @returns 目的地列表；当 `throwOnError` 为 false 且请求失败时返回本地缓存的服务器列表。
     *
     * @example
     * ```typescript
     * const destinations = await client.getFederationManager().server.getFederationDestinations();
     * console.log(destinations.map((d) => d.serverName));
     * ```
     *
     * @throws {Error} 当请求失败且 `throwOnError` 为 true 时抛出。
     */
    async getFederationDestinations(throwOnError = true): Promise<IFederationServer[]> {
        return this.request<{
            destinations?: IFederationServer[];
        }>({ method: Method.Get, path: "/federation/destinations", prefix: AdminPrefix.V1 }).then(
            (response) => {
                const servers: IFederationServer[] = response.destinations || [];
                servers.forEach((s) => this.serverCache.set(s.serverName, s));
                return servers;
            },
            (e) => {
                const error = this.normalizeError(e, "getFederationDestinations");
                if (throwOnError) {
                    throw error;
                }
                logger.warn("FederationManager.getFederationDestinations failed:", error);
                return Array.from(this.serverCache.values());
            },
        );
    }

    /**
     * 重置与某目的地的连接（等价于"重新连接"）。
     *
     * 契约（2026-10-01 核对）：上游 Synapse v1.162.0 的
     * `synapse/rest/admin/federation.py` 只有
     * `POST /_synapse/admin/v1/federation/destinations/{destination}/reset_connection`；
     * 本仓后端同样注册该路径（外加 `.../reset` 别名）。SDK 原先的
     * `/federation/reconnect/{server}` **上游与本仓都没有**。
     *
     * 与之配套的"断开某 server"（`/federation/disconnect/{server}`）已**删除**：
     * 上游与本仓都没有该语义，最接近的只有 `reset_connection`（清掉重试状态、允许立即重试），
     * 而不是"断开"。保留它只会继续对一个不存在的端点发请求。
     *
     * @param serverName - 服务器名称（如 `example.com`）。
     * @returns 无返回值；成功后该目的地的重试状态被清空，可立即重试。
     *
     * @example
     * ```typescript
     * await client.getFederationManager().server.reconnectServer("example.com");
     * ```
     *
     * @throws {ValidationError} 当 serverName 为空时抛出。
     * @throws {Error} 当请求失败时抛出。
     */
    async reconnectServer(serverName: string): Promise<void> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }

        try {
            await this.request({
                method: Method.Post,
                path: `/federation/destinations/${encodeURIComponent(serverName)}/reset_connection`,
                prefix: AdminPrefix.V1,
            });
        } catch (e) {
            const error = this.normalizeError(e, "reconnectServer");
            this.emit(FederationServerEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 获取本服务器对外声明的联邦版本信息。
     *
     * 对应 GET /_matrix/federation/v1/version；`serverName` 仅用于入参校验。
     *
     * @param serverName - 服务器名称（如 `example.com`）。
     * @param throwOnError - 是否抛出错误（默认 true）；为 false 时失败返回 `null`。
     * @returns 服务器版本（缺省为 `"unknown"`）；当 `throwOnError` 为 false 且请求失败时返回 `null`。
     *
     * @example
     * ```typescript
     * const version = await client.getFederationManager().server.getServerVersion("example.com");
     * console.log(version?.version);
     * ```
     *
     * @throws {ValidationError} 当 serverName 为空时抛出。
     * @throws {Error} 当请求失败且 `throwOnError` 为 true 时抛出。
     */
    async getServerVersion(serverName: string, throwOnError = true): Promise<{ version: string } | null> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }

        return this.request<{
            server?: { version?: string };
        }>({ method: Method.Get, path: "/_matrix/federation/v1/version", prefix: "" }).then(
            (response) => {
                return {
                    version: response.server?.version || "unknown",
                };
            },
            (e) => {
                const error = this.normalizeError(e, "getServerVersion");
                if (throwOnError) {
                    throw error;
                }
                logger.warn("FederationManager.getServerVersion failed:", error);
                return null;
            },
        );
    }

    /**
     * 从本地缓存中读取指定服务器的信息，不会发起网络请求。
     *
     * 缓存由 {@link getFederationDestinations} 成功返回时写入。
     *
     * @param serverName - 服务器名称（如 `example.com`）。
     * @returns 缓存的服务器信息；未命中时返回 `null`。
     *
     * @example
     * ```typescript
     * const server = client.getFederationManager().server.getCachedServer("example.com");
     * console.log(server?.serverName);
     * ```
     */
    getCachedServer(serverName: string): IFederationServer | null {
        return this.serverCache.get(serverName) || null;
    }

    /**
     * 列出本地缓存中的全部服务器，不会发起网络请求。
     *
     * @returns 缓存的服务器信息列表；缓存为空时返回空数组。
     *
     * @example
     * ```typescript
     * const servers = client.getFederationManager().server.getCachedServers();
     * console.log(servers.length);
     * ```
     */
    getCachedServers(): IFederationServer[] {
        return Array.from(this.serverCache.values());
    }

    /**
     * 清空本地服务器缓存。
     *
     * @returns 无返回值。
     *
     * @example
     * ```typescript
     * client.getFederationManager().server.clearCache();
     * ```
     */
    clearCache(): void {
        this.serverCache.clear();
    }
}
