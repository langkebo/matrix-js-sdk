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
 * Federation Blacklist Sub-Manager - 联邦黑名单子管理器
 *
 * 提供联邦服务器黑名单 CRUD 功能。
 */

import { Method } from "../../http-api/method";
import { AdminPrefix } from "../../http-api/prefix";
import { MatrixClient } from "../../client";
import { BaseManager, type ManagerOpts } from "../../managers/base-manager";
import { logger } from "../../logger";
import { ValidationError } from "../../errors";
import type { IBlacklistEntry } from "./federation-blacklist-types";

export enum FederationBlacklistEvent {
    BlacklistUpdated = "BlacklistUpdated",
    BlacklistError = "BlacklistError",
}

interface FederationBlacklistEventMap {
    [FederationBlacklistEvent.BlacklistUpdated]: (blacklist: IBlacklistEntry[]) => void;
    [FederationBlacklistEvent.BlacklistError]: (error: Error) => void;
}

export class FederationBlacklistManager extends BaseManager<FederationBlacklistEvent, FederationBlacklistEventMap> {
    private blacklist: Map<string, IBlacklistEntry> = new Map();

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 获取联邦黑名单
     *
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 黑名单列表
     */
    async getBlacklist(throwOnError = true): Promise<IBlacklistEntry[]> {
        return this.request<{
            blacklist?: IBlacklistEntry[];
        }>({ method: Method.Get, path: "/federation/blacklist", prefix: AdminPrefix.V1 }).then(
            (response) => {
                const entries: IBlacklistEntry[] = response.blacklist || [];
                this.blacklist.clear();
                entries.forEach((e) => this.blacklist.set(e.serverName, e));
                this.emit(FederationBlacklistEvent.BlacklistUpdated, entries);
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
            throw new ValidationError("Server name is required");
        }

        try {
            await this.request({
                method: Method.Post,
                path: "/federation/blacklist/add",
                body: { server_name: serverName, reason },
                prefix: AdminPrefix.V1,
            });

            const entry: IBlacklistEntry = {
                serverName,
                reason,
                addedAt: Date.now(),
                addedBy: this.client.getUserId() ?? undefined,
            };

            this.blacklist.set(serverName, entry);
            this.emit(FederationBlacklistEvent.BlacklistUpdated, Array.from(this.blacklist.values()));
        } catch (e) {
            const error = this.normalizeError(e, "addToBlacklist");
            this.emit(FederationBlacklistEvent.BlacklistError, error);
            throw error;
        }
    }

    async removeFromBlacklist(serverName: string): Promise<void> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }

        try {
            await this.request({
                method: Method.Post,
                path: "/federation/blacklist/remove",
                body: { server_name: serverName },
                prefix: AdminPrefix.V1,
            });

            this.blacklist.delete(serverName);
            this.emit(FederationBlacklistEvent.BlacklistUpdated, Array.from(this.blacklist.values()));
        } catch (e) {
            const error = this.normalizeError(e, "removeFromBlacklist");
            this.emit(FederationBlacklistEvent.BlacklistError, error);
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

    getCachedBlacklist(): IBlacklistEntry[] {
        return Array.from(this.blacklist.values());
    }

    clearCache(): void {
        this.blacklist.clear();
    }
}
