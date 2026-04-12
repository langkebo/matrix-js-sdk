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
 * Presence Manager - 在线状态管理
 *
 * 提供用户在线状态的设置、查询、订阅功能
 * 对应后端: synapse-rust/src/web/routes/presence.rs
 */

import { BaseManager } from "../managers/base-manager.ts";
import { Method } from "../http-api/method.ts";
import { MatrixClient } from "../client";
import { InvalidParamError } from "../common/errors.ts";
import { logger } from "../logger.ts";
import { getOrCreateManager } from "../client-infra/manager-registry.ts";
import { LRUCache } from "../utils/lru-cache.ts";

const PRESENCE_PREFIX = "/_matrix/client/v3";

export enum PresenceEvent {
    PresenceUpdated = "PresenceUpdated",
    PresenceListUpdated = "PresenceListUpdated",
    PresenceError = "PresenceError",
}

export type PresenceState = "online" | "offline" | "unavailable" | "busy";

export interface IPresenceState {
    presence: PresenceState;
    status_msg?: string;
    last_active_ago?: number;
    currently_active?: boolean;
}

export interface IPresenceEvent {
    user_id: string;
    presence: PresenceState;
    status_msg?: string;
    last_active_ago?: number;
    currently_active?: boolean;
}

export interface IPresenceList {
    presence: string[];
    presence_list: IPresenceEvent[];
}

interface PresenceManagerEventMap {
    [PresenceEvent.PresenceUpdated]: (userId: string, presence: IPresenceState) => void;
    [PresenceEvent.PresenceListUpdated]: (presences: IPresenceEvent[]) => void;
    [PresenceEvent.PresenceError]: (error: Error) => void;
}
export class PresenceManager extends BaseManager<PresenceEvent, PresenceManagerEventMap> {
    private presenceCache: LRUCache<IPresenceState>;
    private subscribedUsers: Set<string> = new Set();
    private initialized: boolean = false;

    constructor(client: MatrixClient) {
        super(client);
        this.presenceCache = new LRUCache<IPresenceState>({
            maxSize: 500,
            ttl: 5 * 60 * 1000,
            name: "index.ts-ipresencestate",
        });
    }

    async getPresences(userIds: string[]): Promise<Map<string, IPresenceState>> {
        const result = new Map<string, IPresenceState>();
        for (const id of userIds ?? []) {
            const p = await this.getPresence(id);
            if (p) {
                result.set(id, p);
            }
        }
        return result;
    }

    async setPresence(state: PresenceState, statusMsg?: string): Promise<void> {
        if (!state) {
            throw new InvalidParamError("Presence state is required");
        }
        const allowed: PresenceState[] = ["online", "offline", "unavailable", "busy"];
        if (!allowed.includes(state)) {
            throw new InvalidParamError("Invalid presence state");
        }

        const userId = this.client.getUserId();
        if (!userId) {
            throw new Error("Client not logged in");
        }

        try {
            await this.withRetry(
                () =>
                    this.client.http.authedRequest(
                        Method.Put,
                        `/presence/${encodeURIComponent(userId)}/status`,
                        {},
                        {
                            presence: state,
                            status_msg: statusMsg,
                        },
                        { prefix: PRESENCE_PREFIX, priority: undefined },
                    ),
                "setPresence",
            );

            const newState: IPresenceState = {
                presence: state,
                status_msg: statusMsg,
                last_active_ago: 0,
                currently_active: true,
            };

            this.presenceCache.set(userId, newState);
            this.emit(PresenceEvent.PresenceUpdated, userId, newState);
        } catch (e) {
            const error = this.normalizeError(e, "setPresence");
            this.emit(PresenceEvent.PresenceError, error);
            throw error;
        }
    }

    /**
     * 获取用户在线状态
     *
     * @param userId - 用户 ID
     * @param forceFetch - 是否强制从服务器获取
     * @param throwOnError - 是否抛出错误（默认 false，向后兼容）
     * @returns 用户在线状态
     */
    async getPresence(
        userId: string,
        forceFetch: boolean = false,
        throwOnError = false,
    ): Promise<IPresenceState | null> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        if (!forceFetch && this.presenceCache.has(userId)) {
            return this.presenceCache.get(userId)!;
        }

        return this.withRetry(
            () =>
                this.client.http.authedRequest<IPresenceState>(
                    Method.Get,
                    `/presence/${encodeURIComponent(userId)}/status`,
                    {},
                    undefined,
                    { prefix: PRESENCE_PREFIX, priority: undefined },
                ),
            "getPresence",
        ).then(
            (response) => {
                this.presenceCache.set(userId, response);
                return response;
            },
            (e) => {
                const error = this.normalizeError(e, "getPresence");
                if (throwOnError) {
                    throw error;
                }
                if (error.name === "NotFoundError") {
                    logger.warn(`PresenceManager.getPresence failed for ${userId}:`, error);
                    return null;
                }
                throw error;
            },
        );
    }

    async subscribe(userIds: string[]): Promise<void> {
        if (!userIds || userIds.length === 0) return;

        try {
            await this.withRetry(
                () =>
                    this.client.http.authedRequest(
                        Method.Post,
                        "/presence/list/update",
                        {},
                        {
                            invite: userIds,
                        },
                        { prefix: PRESENCE_PREFIX, priority: undefined },
                    ),
                "subscribe",
            );

            userIds.forEach((id) => this.subscribedUsers.add(id));
        } catch (e) {
            const error = this.normalizeError(e, "subscribe");
            this.emit(PresenceEvent.PresenceError, error);
            throw error;
        }
    }

    async unsubscribe(userIds: string[]): Promise<void> {
        if (!userIds || userIds.length === 0) return;

        try {
            await this.withRetry(
                () =>
                    this.client.http.authedRequest(
                        Method.Post,
                        "/presence/list/update",
                        {},
                        {
                            drop: userIds,
                        },
                        { prefix: PRESENCE_PREFIX, priority: undefined },
                    ),
                "unsubscribe",
            );

            userIds.forEach((id) => this.subscribedUsers.delete(id));
        } catch (e) {
            const error = this.normalizeError(e, "unsubscribe");
            this.emit(PresenceEvent.PresenceError, error);
            throw error;
        }
    }

    /**
     * 获取在线状态列表
     *
     * @param targetUserId - 目标用户 ID（可选）
     * @param throwOnError - 是否抛出错误（默认 false，向后兼容）
     * @returns 在线状态列表
     */
    async getPresenceList(targetUserId?: string, throwOnError = false): Promise<IPresenceEvent[]> {
        if (typeof targetUserId === "string" && targetUserId.length === 0) {
            throw new InvalidParamError("User ID is required");
        }
        const request = targetUserId
            ? this.withRetry(
                  () =>
                      this.client.http.authedRequest<IPresenceEvent[]>(
                          Method.Get,
                          `/presence/list/${encodeURIComponent(targetUserId)}`,
                          {},
                          undefined,
                          { prefix: PRESENCE_PREFIX, priority: undefined },
                      ),
                  "getPresenceList",
              )
            : this.withRetry(
                  () =>
                      this.client.http.authedRequest<IPresenceEvent[]>(Method.Get, "/presence/list", {}, undefined, {
                          prefix: PRESENCE_PREFIX,
                          priority: undefined,
                      }),
                  "getPresenceList",
              );

        return request.then(
            (response) => {
                response.forEach((p) => {
                    this.presenceCache.set(p.user_id, {
                        presence: p.presence,
                        status_msg: p.status_msg,
                        last_active_ago: p.last_active_ago,
                        currently_active: p.currently_active,
                    });
                });
                this.emit(PresenceEvent.PresenceListUpdated, response);
                return response;
            },
            (e) => {
                const error = this.normalizeError(e, "getPresenceList");
                if (throwOnError) {
                    throw error;
                }
                if (error.name === "NotFoundError") {
                    logger.warn("PresenceManager.getPresenceList failed:", error);
                    return [];
                }
                throw error;
            },
        );
    }

    /**
     * 根据用户 ID 列表获取在线状态
     *
     * @param userIds - 用户 ID 列表
     * @param throwOnError - 是否抛出错误（默认 false，向后兼容）
     * @returns 在线状态列表
     */
    async getPresenceListByIds(userIds: string[], throwOnError = false): Promise<IPresenceEvent[]> {
        if (!userIds || userIds.length === 0) return [];

        return this.withRetry(
            () =>
                this.client.http.authedRequest<IPresenceEvent[]>(
                    Method.Post,
                    "/presence/list/get",
                    {},
                    { user_ids: userIds },
                    { prefix: PRESENCE_PREFIX, priority: undefined },
                ),
            "getPresenceListByIds",
        ).then(
            (response) => {
                response.forEach((p) => {
                    this.presenceCache.set(p.user_id, {
                        presence: p.presence,
                        status_msg: p.status_msg,
                        last_active_ago: p.last_active_ago,
                        currently_active: p.currently_active,
                    });
                });
                return response;
            },
            (e) => {
                const error = this.normalizeError(e, "getPresenceListByIds");
                if (throwOnError) {
                    throw error;
                }
                logger.warn("PresenceManager.getPresenceListByIds failed:", error);
                if (error.name === "NotFoundError") {
                    return [];
                }
                throw error;
            },
        );
    }

    getSubscribedUsers(): string[] {
        return Array.from(this.subscribedUsers);
    }

    isSubscribed(userId: string): boolean {
        return this.subscribedUsers.has(userId);
    }

    getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        return this.presenceCache.getStats();
    }

    clearCache(): void {
        this.presenceCache.clear();
    }

    getCachedPresence(userId: string): IPresenceState | null {
        return this.presenceCache.get(userId) ?? null;
    }

    getCachedPresences(): Map<string, IPresenceState> {
        const out = new Map<string, IPresenceState>();
        for (const [k, v] of this.presenceCache.entries()) {
            out.set(k, v.value);
        }
        return out;
    }

    async subscribeToPresence(userIds: string[]): Promise<void> {
        if (!Array.isArray(userIds) || userIds.length === 0) {
            throw new InvalidParamError("userIds cannot be empty");
        }
        try {
            await this.withRetry(
                () =>
                    this.client.http.authedRequest(
                        Method.Post,
                        "/presence/list",
                        {},
                        { user_ids: userIds },
                        { prefix: PRESENCE_PREFIX, priority: undefined },
                    ),
                "subscribeToPresence",
            );
            userIds.forEach((id) => this.subscribedUsers.add(id));
        } catch (e) {
            const error = this.normalizeError(e, "subscribeToPresence");
            this.emit(PresenceEvent.PresenceError, error);
            throw error;
        }
    }

    async unsubscribeFromPresence(userIds: string[]): Promise<void> {
        if (!Array.isArray(userIds) || userIds.length === 0) {
            throw new InvalidParamError("userIds cannot be empty");
        }
        try {
            await this.withRetry(
                () =>
                    this.client.http.authedRequest(
                        Method.Post,
                        "/presence/list/update",
                        {},
                        { drop: userIds },
                        { prefix: PRESENCE_PREFIX, priority: undefined },
                    ),
                "unsubscribeFromPresence",
            );
            userIds.forEach((id) => this.subscribedUsers.delete(id));
        } catch (e) {
            const error = this.normalizeError(e, "unsubscribeFromPresence");
            this.emit(PresenceEvent.PresenceError, error);
            throw error;
        }
    }

    async getSubscribedPresence(): Promise<IPresenceEvent[]> {
        return this.getPresenceList();
    }

    async clearStatusMessage(): Promise<void> {
        const me = this.client.getUserId();
        if (!me) return;
        const state = await this.getPresence(me, true);
        if (!state) return;
        await this.setPresence(state.presence);
    }

    async setOnline(status?: string): Promise<void> {
        await this.setPresence("online", status);
    }

    async setOffline(status?: string): Promise<void> {
        await this.setPresence("offline", status);
    }

    async setUnavailable(status?: string): Promise<void> {
        await this.setPresence("unavailable", status);
    }

    async setBusy(status?: string): Promise<void> {
        await this.setPresence("busy", status);
    }

    updatePresenceFromSync(event: IPresenceEvent): void {
        const state: IPresenceState = {
            presence: event.presence,
            status_msg: event.status_msg,
            last_active_ago: event.last_active_ago,
            currently_active: event.currently_active,
        };
        this.presenceCache.set(event.user_id, state);
        this.emit(PresenceEvent.PresenceUpdated, event.user_id, state);
    }

    async start(): Promise<void> {
        if (this.initialized) return;

        try {
            await this.getPresenceList();
            this.initialized = true;
        } catch (e) {
            const error = this.normalizeError(e, "start");
            logger.warn("PresenceManager.start failed:", error);
        }
    }

    stop(): void {
        this.presenceCache.clear();
        this.subscribedUsers.clear();
        this.initialized = false;
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getPresenceManager(): PresenceManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getPresenceManager = function (): PresenceManager {
        return getOrCreateManager(this, "presence", () => new PresenceManager(this));
    };
}

export default extendMatrixClient;
