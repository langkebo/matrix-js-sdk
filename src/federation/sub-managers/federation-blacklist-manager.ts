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
     * 获取联邦黑名单，并以返回结果刷新本地缓存、广播更新事件。
     *
     * @param throwOnError - 是否抛出错误（默认 true）；为 false 时失败返回本地缓存。
     * @returns 黑名单条目列表；当 `throwOnError` 为 false 且请求失败时返回本地缓存的黑名单。
     *
     * @example
     * ```typescript
     * const blacklist = await client.getFederationManager().blacklist.getBlacklist();
     * console.log(blacklist.map((entry) => entry.serverName));
     * ```
     *
     * @throws {Error} 当请求失败且 `throwOnError` 为 true 时抛出。
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

    /**
     * 将某服务器加入联邦黑名单（不会向该服务器发起联邦请求），并广播更新事件。
     *
     * @param serverName - 要拉黑的服务器名称（如 `example.com`）。
     * @param reason - 可选，拉黑原因。
     * @returns 无返回值；成功后本地缓存同步更新。
     *
     * @example
     * ```typescript
     * await client.getFederationManager().blacklist.addToBlacklist("evil.example.com", "spam");
     * ```
     *
     * @throws {ValidationError} 当 serverName 为空时抛出。
     * @throws {Error} 当请求失败时抛出。
     */
    async addToBlacklist(serverName: string, reason?: string): Promise<void> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }

        try {
            // 后端：`POST /_synapse/admin/v1/federation/blacklist/{server_name}`，server_name 走路径参数。
            // 旧的 `/federation/blacklist/add` 是**不存在的路径**（由 quality:path-contract 门禁发现）。
            await this.request({
                method: Method.Post,
                path: `/federation/blacklist/${encodeURIComponent(serverName)}`,
                body: { reason },
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

    /**
     * 将某服务器从联邦黑名单中移除，并广播更新事件。
     *
     * @param serverName - 要解除拉黑的服务器名称（如 `example.com`）。
     * @returns 无返回值；成功后本地缓存同步更新。
     *
     * @example
     * ```typescript
     * await client.getFederationManager().blacklist.removeFromBlacklist("evil.example.com");
     * ```
     *
     * @throws {ValidationError} 当 serverName 为空时抛出。
     * @throws {Error} 当请求失败时抛出。
     */
    async removeFromBlacklist(serverName: string): Promise<void> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }

        try {
            // 后端：`DELETE /_synapse/admin/v1/federation/blacklist/{server_name}`。
            // 旧的 `POST /federation/blacklist/remove` **方法错且路径错**。
            await this.request({
                method: Method.Delete,
                path: `/federation/blacklist/${encodeURIComponent(serverName)}`,
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

    /**
     * 判断某服务器是否在联邦黑名单中；本地缓存未命中时会静默刷新一次黑名单。
     *
     * 静默刷新失败时不会抛出错误，仅以当前本地缓存为准。
     *
     * @param serverName - 服务器名称（如 `example.com`）。
     * @returns 该服务器是否已被拉黑。
     *
     * @example
     * ```typescript
     * const blocked = await client.getFederationManager().blacklist.isBlacklisted("evil.example.com");
     * console.log(blocked);
     * ```
     */
    async isBlacklisted(serverName: string): Promise<boolean> {
        if (this.blacklist.has(serverName)) {
            return true;
        }

        await this.getBlacklist(false);
        return this.blacklist.has(serverName);
    }

    /**
     * 列出本地缓存中的全部黑名单条目，不会发起网络请求。
     *
     * @returns 缓存的黑名单条目列表；缓存为空时返回空数组。
     *
     * @example
     * ```typescript
     * const entries = client.getFederationManager().blacklist.getCachedBlacklist();
     * console.log(entries.map((entry) => entry.serverName));
     * ```
     */
    getCachedBlacklist(): IBlacklistEntry[] {
        return Array.from(this.blacklist.values());
    }

    /**
     * 清空本地黑名单缓存。
     *
     * @returns 无返回值。
     *
     * @example
     * ```typescript
     * client.getFederationManager().blacklist.clearCache();
     * ```
     */
    clearCache(): void {
        this.blacklist.clear();
    }
}
