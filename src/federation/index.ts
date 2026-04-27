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
 * Federation Manager - 联邦管理
 *
 * 提供联邦服务器管理、黑名单管理功能
 */

import { BaseManager } from "../managers/base-manager.ts";
import { Method } from "../http-api/method.ts";
import { AdminPrefix, ClientPrefix } from "../http-api/prefix.ts";
import { MatrixClient } from "../client.ts";
import { getOrCreateManager } from "../client-infra/manager-registry.ts";
import { logger } from "../logger.ts";

export enum FederationEvent {
    BlacklistUpdated = "BlacklistUpdated",
    ServerAdded = "ServerAdded",
    ServerRemoved = "ServerRemoved",
    FederationError = "FederationError",
}

export interface IFederationServer {
    serverName: string;
    addedAt?: number;
    reason?: string;
}

export interface IBlacklistEntry {
    serverName: string;
    reason?: string;
    addedAt: number;
    addedBy?: string;
}

export interface IFederationStatus {
    online: boolean;
    lastSuccessfulConnect?: number;
    latency?: number;
}

interface FederationManagerEventMap {
    [FederationEvent.BlacklistUpdated]: (blacklist: IBlacklistEntry[]) => void;
    [FederationEvent.ServerAdded]: (serverName: string) => void;
    [FederationEvent.ServerRemoved]: (serverName: string) => void;
    [FederationEvent.FederationError]: (error: Error) => void;
}

export class FederationManager extends BaseManager<FederationEvent, FederationManagerEventMap> {
    private blacklist: Map<string, IBlacklistEntry> = new Map();
    private serverCache: Map<string, IFederationServer> = new Map();
    private initialized: boolean = false;

    constructor(client: MatrixClient) {
        super(client);
    }

    /**
     * 获取联邦黑名单
     *
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 黑名单列表
     */
    async getBlacklist(throwOnError = true): Promise<IBlacklistEntry[]> {
        return this.client.http
            .authedRequest<{
                blacklist?: IBlacklistEntry[];
            }>(Method.Get, "/federation/blacklist", undefined, undefined, { prefix: AdminPrefix.V1 })
            .then(
                (response) => {
                    const entries: IBlacklistEntry[] = response.blacklist || [];
                    this.blacklist.clear();
                    entries.forEach((e) => this.blacklist.set(e.serverName, e));
                    this.emit(FederationEvent.BlacklistUpdated, entries);
                    return entries;
                },
                (e) => {
                    const error = this.normalizeError(e, "getBlacklist");
                    if (throwOnError) {
                        throw error;
                    }
                    logger.warn("FederationManager.getBlacklist failed:", error);
                    return Array.from(this.blacklist.values());
                },
            );
    }

    async addToBlacklist(serverName: string, reason?: string): Promise<void> {
        if (!serverName) {
            throw new Error("Server name is required");
        }

        try {
            await this.client.http.authedRequest(
                Method.Post,
                "/federation/blacklist/add",
                undefined,
                { server_name: serverName, reason },
                { prefix: AdminPrefix.V1 },
            );

            const entry: IBlacklistEntry = {
                serverName,
                reason,
                addedAt: Date.now(),
                addedBy: this.client.getUserId() ?? undefined,
            };

            this.blacklist.set(serverName, entry);
            this.emit(FederationEvent.BlacklistUpdated, Array.from(this.blacklist.values()));
        } catch (e) {
            const error = this.normalizeError(e, "addToBlacklist");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    async removeFromBlacklist(serverName: string): Promise<void> {
        if (!serverName) {
            throw new Error("Server name is required");
        }

        try {
            await this.client.http.authedRequest(
                Method.Post,
                "/federation/blacklist/remove",
                undefined,
                { server_name: serverName },
                { prefix: AdminPrefix.V1 },
            );

            this.blacklist.delete(serverName);
            this.emit(FederationEvent.BlacklistUpdated, Array.from(this.blacklist.values()));
        } catch (e) {
            const error = this.normalizeError(e, "removeFromBlacklist");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    async isBlacklisted(serverName: string): Promise<boolean> {
        if (this.blacklist.has(serverName)) {
            return true;
        }

        await this.getBlacklist(false);
        return this.blacklist.has(serverName);
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
            throw new Error("Server name is required");
        }

        return this.client.http
            .authedRequest<{
                online?: boolean;
                last_successful_connect?: number;
                latency?: number;
            }>(Method.Get, `/federation/status/${encodeURIComponent(serverName)}`, undefined, undefined, {
                prefix: AdminPrefix.V1,
            })
            .then(
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
        return this.client.http
            .authedRequest<{
                destinations?: IFederationServer[];
            }>(Method.Get, "/federation/destinations", undefined, undefined, { prefix: AdminPrefix.V1 })
            .then(
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
            throw new Error("Server name is required");
        }

        try {
            await this.client.http.authedRequest(
                Method.Post,
                `/federation/disconnect/${encodeURIComponent(serverName)}`,
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        } catch (e) {
            const error = this.normalizeError(e, "disconnectServer");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    async reconnectServer(serverName: string): Promise<void> {
        if (!serverName) {
            throw new Error("Server name is required");
        }

        try {
            await this.client.http.authedRequest(
                Method.Post,
                `/federation/reconnect/${encodeURIComponent(serverName)}`,
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        } catch (e) {
            const error = this.normalizeError(e, "reconnectServer");
            this.emit(FederationEvent.FederationError, error);
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
            throw new Error("Server name is required");
        }

        return this.client.http
            .authedRequest<{
                server?: { version?: string };
            }>(Method.Get, `/_matrix/federation/v1/version`, undefined, undefined, { prefix: "" })
            .then(
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

    async getPublicRoomsOnServer(
        serverName: string,
        limit?: number,
        since?: string,
    ): Promise<{ chunk: unknown[]; next_batch?: string; prev_batch?: string }> {
        if (!serverName) {
            throw new Error("Server name is required");
        }

        try {
            const params: { limit?: number; since?: string } = {};
            if (limit !== undefined) params.limit = limit;
            if (since !== undefined) params.since = since;

            const response = await this.client.http.authedRequest<{
                chunk?: unknown[];
                next_batch?: string;
                prev_batch?: string;
            }>(Method.Get, "/publicRooms", params, undefined, { prefix: ClientPrefix.V3 });

            const result: { chunk: unknown[]; next_batch?: string; prev_batch?: string } = {
                chunk: response.chunk || [],
            };
            if (response.next_batch) result.next_batch = response.next_batch;
            if (response.prev_batch) result.prev_batch = response.prev_batch;

            return result;
        } catch (e) {
            const error = this.normalizeError(e, "getPublicRoomsOnServer");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    getCachedBlacklist(): IBlacklistEntry[] {
        return Array.from(this.blacklist.values());
    }

    getCachedServer(serverName: string): IFederationServer | null {
        return this.serverCache.get(serverName) || null;
    }

    getCachedServers(): IFederationServer[] {
        return Array.from(this.serverCache.values());
    }

    clearCache(): void {
        this.blacklist.clear();
        this.serverCache.clear();
    }

    async start(): Promise<void> {
        if (this.initialized) return;

        try {
            await this.getBlacklist(false);
            this.initialized = true;
        } catch (e) {
            const error = this.normalizeError(e, "start");
            logger.warn("FederationManager.start failed:", error);
        }
    }

    stop(): void {
        this.blacklist.clear();
        this.serverCache.clear();
        this.initialized = false;
    }
}

export class FederationBlacklistManager extends BaseManager<FederationEvent, FederationManagerEventMap> {
    private blacklist: Map<string, IBlacklistEntry> = new Map();

    constructor(client: MatrixClient) {
        super(client);
    }

    /**
     * 获取联邦黑名单
     *
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 黑名单列表
     */
    async getBlacklist(throwOnError = true): Promise<IBlacklistEntry[]> {
        return this.client.http
            .authedRequest<{
                blacklist?: IBlacklistEntry[];
            }>(Method.Get, "/federation/blacklist", undefined, undefined, { prefix: AdminPrefix.V1 })
            .then(
                (response) => {
                    const entries: IBlacklistEntry[] = response.blacklist || [];
                    this.blacklist.clear();
                    entries.forEach((e) => this.blacklist.set(e.serverName, e));
                    return entries;
                },
                (e) => {
                    const error = this.normalizeError(e, "getBlacklist");
                    if (throwOnError) {
                        throw error;
                    }
                    logger.warn("FederationBlacklistManager.getBlacklist failed:", error);
                    return Array.from(this.blacklist.values());
                },
            );
    }

    async addServer(serverName: string, reason?: string): Promise<void> {
        if (!serverName) {
            throw new Error("Server name is required");
        }

        try {
            await this.client.http.authedRequest(
                Method.Post,
                "/federation/blacklist/add",
                undefined,
                { server_name: serverName, reason },
                { prefix: AdminPrefix.V1 },
            );

            const entry: IBlacklistEntry = {
                serverName,
                reason,
                addedAt: Date.now(),
            };

            this.blacklist.set(serverName, entry);
            this.emit(FederationEvent.ServerAdded, serverName);
        } catch (e) {
            const error = this.normalizeError(e, "addServer");
            throw error;
        }
    }

    async removeServer(serverName: string): Promise<void> {
        if (!serverName) {
            throw new Error("Server name is required");
        }

        try {
            await this.client.http.authedRequest(
                Method.Post,
                "/federation/blacklist/remove",
                undefined,
                { server_name: serverName },
                { prefix: AdminPrefix.V1 },
            );

            this.blacklist.delete(serverName);
            this.emit(FederationEvent.ServerRemoved, serverName);
        } catch (e) {
            const error = this.normalizeError(e, "removeServer");
            throw error;
        }
    }

    isBlacklisted(serverName: string): boolean {
        return this.blacklist.has(serverName);
    }

    getCachedBlacklist(): IBlacklistEntry[] {
        return Array.from(this.blacklist.values());
    }

    clear(): void {
        this.blacklist.clear();
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getFederationManager(): FederationManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getFederationManager = function (): FederationManager {
        return getOrCreateManager(this, "federation", () => new FederationManager(this));
    };
}

export default extendMatrixClient;
