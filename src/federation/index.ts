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
 * Federation Manager - 联邦管理
 * 
 * 提供联邦服务器管理、黑名单管理功能
 */

import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";

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

export class FederationManager extends TypedEventEmitter<FederationEvent, FederationManagerEventMap> {
    private client: any;
    private blacklist: Map<string, IBlacklistEntry> = new Map();
    private serverCache: Map<string, IFederationServer> = new Map();
    private initialized: boolean = false;

    constructor(client: any) {
        super();
        this.client = client;
    }

    async getBlacklist(): Promise<IBlacklistEntry[]> {
        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                "/_synapse/admin/v1/federation/blacklist",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );

            const entries: IBlacklistEntry[] = response.blacklist || [];
            this.blacklist.clear();
            entries.forEach(e => this.blacklist.set(e.serverName, e));

            this.emit(FederationEvent.BlacklistUpdated, entries);

            return entries;
        } catch (e) {
            logger.warn('FederationManager.getBlacklist failed:', e);
            return Array.from(this.blacklist.values());
        }
    }

    async addToBlacklist(serverName: string, reason?: string): Promise<void> {
        if (!serverName) {
            throw new Error("Server name is required");
        }

        try {
            await this.client.http.authedRequest(
                Method.Post,
                "/_synapse/admin/v1/federation/blacklist/add",
                undefined,
                { server_name: serverName, reason },
                { prefix: ClientPrefix.V3 }
            );

            const entry: IBlacklistEntry = {
                serverName,
                reason,
                addedAt: Date.now(),
                addedBy: this.client.getUserId(),
            };

            this.blacklist.set(serverName, entry);
            this.emit(FederationEvent.BlacklistUpdated, Array.from(this.blacklist.values()));
        } catch (error) {
            this.emit(FederationEvent.FederationError, error as Error);
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
                "/_synapse/admin/v1/federation/blacklist/remove",
                undefined,
                { server_name: serverName },
                { prefix: ClientPrefix.V3 }
            );

            this.blacklist.delete(serverName);
            this.emit(FederationEvent.BlacklistUpdated, Array.from(this.blacklist.values()));
        } catch (error) {
            this.emit(FederationEvent.FederationError, error as Error);
            throw error;
        }
    }

    async isBlacklisted(serverName: string): Promise<boolean> {
        if (this.blacklist.has(serverName)) {
            return true;
        }

        await this.getBlacklist();
        return this.blacklist.has(serverName);
    }

    async getServerStatus(serverName: string): Promise<IFederationStatus | null> {
        if (!serverName) {
            throw new Error("Server name is required");
        }

        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                `/_synapse/admin/v1/federation/status/${encodeURIComponent(serverName)}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );

            return {
                online: response.online || false,
                lastSuccessfulConnect: response.last_successful_connect,
                latency: response.latency,
            };
        } catch (e) {
            logger.warn('FederationManager.getServerStatus failed:', e);
            return null;
        }
    }

    async getFederationDestinations(): Promise<IFederationServer[]> {
        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                "/_synapse/admin/v1/federation/destinations",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );

            const servers: IFederationServer[] = response.destinations || [];
            servers.forEach(s => this.serverCache.set(s.serverName, s));

            return servers;
        } catch (e) {
            logger.warn('FederationManager.getFederationDestinations failed:', e);
            return Array.from(this.serverCache.values());
        }
    }

    async disconnectServer(serverName: string): Promise<void> {
        if (!serverName) {
            throw new Error("Server name is required");
        }

        try {
            await this.client.http.authedRequest(
                Method.Post,
                `/_synapse/admin/v1/federation/disconnect/${encodeURIComponent(serverName)}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        } catch (error) {
            this.emit(FederationEvent.FederationError, error as Error);
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
                `/_synapse/admin/v1/federation/reconnect/${encodeURIComponent(serverName)}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        } catch (error) {
            this.emit(FederationEvent.FederationError, error as Error);
            throw error;
        }
    }

    async getServerVersion(serverName: string): Promise<{ version: string } | null> {
        if (!serverName) {
            throw new Error("Server name is required");
        }

        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                `/_matrix/federation/v1/version`,
                undefined,
                undefined,
                { prefix: '' }
            );

            return {
                version: response.server?.version || 'unknown',
            };
        } catch (e) {
            logger.warn('FederationManager.getServerVersion failed:', e);
            return null;
        }
    }

    async getPublicRoomsOnServer(serverName: string, limit?: number, since?: string): Promise<any> {
        if (!serverName) {
            throw new Error("Server name is required");
        }

        try {
            const params: any = {};
            if (limit) params.limit = limit;
            if (since) params.since = since;

            const response = await this.client.http.authedRequest(
                Method.Get,
                `/_matrix/client/v3/publicRooms`,
                params,
                undefined,
                { prefix: ClientPrefix.V3 }
            );

            return response;
        } catch (error) {
            this.emit(FederationEvent.FederationError, error as Error);
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
            await this.getBlacklist();
            this.initialized = true;
        } catch (e) {
            logger.warn('FederationManager.start failed:', e);
        }
    }

    stop(): void {
        this.blacklist.clear();
        this.serverCache.clear();
        this.initialized = false;
    }
}

export class FederationBlacklistManager extends TypedEventEmitter<FederationEvent, FederationManagerEventMap> {
    private client: any;
    private blacklist: Map<string, IBlacklistEntry> = new Map();

    constructor(client: any) {
        super();
        this.client = client;
    }

    async getBlacklist(): Promise<IBlacklistEntry[]> {
        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                "/_synapse/admin/v1/federation/blacklist",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );

            const entries: IBlacklistEntry[] = response.blacklist || [];
            this.blacklist.clear();
            entries.forEach(e => this.blacklist.set(e.serverName, e));

            return entries;
        } catch (e) {
            logger.warn('FederationBlacklistManager.getBlacklist failed:', e);
            return Array.from(this.blacklist.values());
        }
    }

    async addServer(serverName: string, reason?: string): Promise<void> {
        if (!serverName) {
            throw new Error("Server name is required");
        }

        await this.client.http.authedRequest(
            Method.Post,
            "/_synapse/admin/v1/federation/blacklist/add",
            undefined,
            { server_name: serverName, reason },
            { prefix: ClientPrefix.V3 }
        );

        const entry: IBlacklistEntry = {
            serverName,
            reason,
            addedAt: Date.now(),
        };

        this.blacklist.set(serverName, entry);
        this.emit(FederationEvent.ServerAdded, serverName);
    }

    async removeServer(serverName: string): Promise<void> {
        if (!serverName) {
            throw new Error("Server name is required");
        }

        await this.client.http.authedRequest(
            Method.Post,
            "/_synapse/admin/v1/federation/blacklist/remove",
            undefined,
            { server_name: serverName },
            { prefix: ClientPrefix.V3 }
        );

        this.blacklist.delete(serverName);
        this.emit(FederationEvent.ServerRemoved, serverName);
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
