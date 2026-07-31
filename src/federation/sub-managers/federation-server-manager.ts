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
     * @param serverName - 服务器名称
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 服务器状态
     */
    async getServerStatus(serverName: string, throwOnError = true): Promise<IFederationStatus | null> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }

        return this.request<{
            online?: boolean;
            last_successful_connect?: number;
            latency?: number;
        }>({
            method: Method.Get,
            path: `/federation/status/${encodeURIComponent(serverName)}`,
            prefix: AdminPrefix.V1,
        }).then(
            (response) => {
                return {
                    online: response.online || false,
                    lastSuccessfulConnect: response.last_successful_connect,
                    latency: response.latency,
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
     * 获取联邦目的地列表
     *
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 目的地列表
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

    async disconnectServer(serverName: string): Promise<void> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }

        try {
            await this.request({
                method: Method.Post,
                path: `/federation/disconnect/${encodeURIComponent(serverName)}`,
                prefix: AdminPrefix.V1,
            });
        } catch (e) {
            const error = this.normalizeError(e, "disconnectServer");
            this.emit(FederationServerEvent.FederationError, error);
            throw error;
        }
    }

    async reconnectServer(serverName: string): Promise<void> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }

        try {
            await this.request({
                method: Method.Post,
                path: `/federation/reconnect/${encodeURIComponent(serverName)}`,
                prefix: AdminPrefix.V1,
            });
        } catch (e) {
            const error = this.normalizeError(e, "reconnectServer");
            this.emit(FederationServerEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 获取服务器版本
     *
     * @param serverName - 服务器名称
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 服务器版本
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

    getCachedServer(serverName: string): IFederationServer | null {
        return this.serverCache.get(serverName) || null;
    }

    getCachedServers(): IFederationServer[] {
        return Array.from(this.serverCache.values());
    }

    clearCache(): void {
        this.serverCache.clear();
    }
}
