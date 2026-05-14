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

import { BaseManager } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { MatrixClient } from "../client";
import { InvalidParamError } from "../common/errors";
import { logger } from "../logger";
import { getOrCreateManager } from "../client-infra/manager-registry";
import { LRUCache } from "../utils/lru-cache";
import { AdminValidators } from "../admin/validators";
import { AuthError, ValidationError } from "../errors";
import type { PresencePathPattern } from "./__generated__/route-table";

const PRESENCE_PREFIX = "/_matrix/client/v3";

type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function pp<P extends StripV3<PresencePathPattern>>(path: P): P {
    return path;
}

export enum PresenceEvent {
    PresenceUpdated = "PresenceUpdated",
    PresenceListUpdated = "PresenceListUpdated",
    PresenceError = "PresenceError",
}

export type PresenceState = "online" | "offline" | "unavailable" | "away" | "busy";

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
    presences: IPresenceEvent[];
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
            const p = await this.getPresence(id, false, false);
            if (p) {
                result.set(id, p);
            }
        }
        return result;
    }

    /**
     * 设置当前用户的在线状态
     *
     * @param state - 在线状态（online, offline, unavailable, busy）
     * @param statusMsg - 状态消息（可选）
     *
     * @example
     * ```typescript
     * // 设置为在线
     * await presenceManager.setPresence("online");
     *
     * // 设置为忙碌并添加状态消息
     * await presenceManager.setPresence("busy", "In a meeting");
     *
     * // 设置为离线
     * await presenceManager.setPresence("offline");
     *
     * // 监听在线状态更新
     * presenceManager.on(PresenceEvent.PresenceUpdated, (userId, presence) => {
     *     console.log(`${userId} is now ${presence.presence}`);
     * });
     * ```
     *
     * @throws {ValidationError} 如果状态值无效
     * @throws {AuthError} 如果用户未登录
     * @throws {ApiError} 如果 API 调用失败
     */
    async setPresence(state: PresenceState, statusMsg?: string): Promise<void> {
        if (!state) {
            throw new InvalidParamError("Presence state is required");
        }
        const allowed: PresenceState[] = ["online", "offline", "unavailable", "away", "busy"];
        if (!allowed.includes(state)) {
            throw new InvalidParamError(`Invalid presence state. Must be one of: ${allowed.join(", ")}`);
        }

        const userId = this.client.getUserId();
        if (!userId) {
            throw new AuthError("Client not logged in");
        }

        try {
            await this.withRetry(
                () =>
                    this.client.http.authedRequest(
                        Method.Put,
                        pp(`/presence/${encodeURIComponent(userId)}/status`),
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
                currently_active: state === "online",
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
     * @param userId - 用户 ID（格式：@localpart:homeserver）
     * @param forceFetch - 是否强制从服务器获取（默认 false，使用缓存）
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 用户在线状态，如果不存在或出错则返回 null
     *
     * @example
     * ```typescript
     * // 获取用户在线状态
     * const presence = await presenceManager.getPresence("@alice:example.com");
     * if (presence) {
     *     console.log("Status:", presence.presence);
     *     console.log("Message:", presence.status_msg);
     *     console.log("Last active:", presence.last_active_ago, "ms ago");
     * }
     *
     * // 强制刷新（不使用缓存）
     * const freshPresence = await presenceManager.getPresence("@alice:example.com", true);
     *
     * // 不抛出错误
     * const presence = await presenceManager.getPresence("@bob:example.com", false, false);
     * if (!presence) {
     *     console.log("User not found or offline");
     * }
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 格式无效
     * @throws {NotFoundError} 如果用户不存在且 throwOnError 为 true
     * @throws {ApiError} 如果 API 调用失败
     */
    async getPresence(
        userId: string,
        forceFetch: boolean = false,
        throwOnError = true,
    ): Promise<IPresenceState | null> {
        AdminValidators.validateUserId(userId);

        if (!forceFetch && this.presenceCache.has(userId)) {
            return this.presenceCache.get(userId)!;
        }

        return this.withRetry(
            () =>
                this.client.http.authedRequest<IPresenceState>(
                    Method.Get,
                    pp(`/presence/${encodeURIComponent(userId)}/status`),
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

    /**
     * 订阅用户在线状态
     *
     * @param userIds - 用户 ID 列表
     *
     * @example
     * ```typescript
     * // 订阅多个用户的在线状态
     * await presenceManager.subscribe([
     *     "@alice:example.com",
     *     "@bob:example.com"
     * ]);
     *
     * // 监听在线状态变化
     * presenceManager.on(PresenceEvent.PresenceChanged, (userId, state) => {
     *     console.log(`${userId} is now ${state.presence}`);
     * });
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 列表为空或格式无效
     * @throws {ApiError} 如果 API 调用失败
     */
    async subscribe(userIds: string[]): Promise<void> {
        if (!userIds || userIds.length === 0) {
            throw new ValidationError("User IDs list cannot be empty");
        }
        userIds.forEach((userId) => AdminValidators.validateUserId(userId));
        await this.subscribeToPresence(userIds);
    }

    /**
     * 取消订阅用户在线状态
     *
     * @param userIds - 用户 ID 列表
     *
     * @example
     * ```typescript
     * // 取消订阅用户的在线状态
     * await presenceManager.unsubscribe([
     *     "@alice:example.com",
     *     "@bob:example.com"
     * ]);
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 列表为空或格式无效
     * @throws {ApiError} 如果 API 调用失败
     */
    async unsubscribe(userIds: string[]): Promise<void> {
        if (!userIds || userIds.length === 0) {
            throw new ValidationError("User IDs list cannot be empty");
        }
        userIds.forEach((userId) => AdminValidators.validateUserId(userId));
        await this.unsubscribeFromPresence(userIds);
    }

    /**
     * 获取在线状态列表
     *
     * @param targetUserId - 目标用户 ID（可选）
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 在线状态列表
     *
     * @example
     * ```typescript
     * // 获取所有订阅的用户在线状态
     * const presences = await presenceManager.getPresenceList();
     * presences.forEach(p => {
     *     console.log(`${p.user_id}: ${p.presence}`);
     * });
     *
     * // 获取特定用户的在线状态列表
     * const presences = await presenceManager.getPresenceList("@alice:example.com");
     *
     * // 监听在线状态列表更新
     * presenceManager.on(PresenceEvent.PresenceListUpdated, (presences) => {
     *     console.log(`Received ${presences.length} presence updates`);
     * });
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 格式无效
     * @throws {ApiError} 如果 API 调用失败
     */
    async getPresenceList(targetUserId?: string, throwOnError = true): Promise<IPresenceEvent[]> {
        if (targetUserId !== undefined && !targetUserId) {
            throw new InvalidParamError("User ID cannot be empty");
        }
        if (targetUserId) {
            AdminValidators.validateUserId(targetUserId);
        }
        const request = targetUserId
            ? this.withRetry(
                  () =>
                      this.client.http.authedRequest<IPresenceList>(
                          Method.Get,
                          pp(`/presence/list/${encodeURIComponent(targetUserId)}`),
                          {},
                          undefined,
                          { prefix: PRESENCE_PREFIX, priority: undefined },
                      ),
                  "getPresenceList",
              )
            : this.withRetry(
                  () =>
                      this.client.http.authedRequest<IPresenceList>(
                          Method.Post,
                          pp("/presence/list"),
                          {},
                          {},
                          {
                              prefix: PRESENCE_PREFIX,
                              priority: undefined,
                          },
                      ),
                  "getPresenceList",
              );

        return request.then(
            (response) => {
                const presences = response.presences ?? [];
                presences.forEach((p) => {
                    this.presenceCache.set(p.user_id, {
                        presence: p.presence,
                        status_msg: p.status_msg,
                        last_active_ago: p.last_active_ago,
                        currently_active: p.currently_active,
                    });
                    this.subscribedUsers.add(p.user_id);
                });
                this.emit(PresenceEvent.PresenceListUpdated, presences);
                return presences;
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
     * @param throwOnError - 是否抛出错误（默认 true，传 false 时保留兼容 fallback）
     * @returns 在线状态列表
     */
    async getPresenceListByIds(userIds: string[], throwOnError = true): Promise<IPresenceEvent[]> {
        if (!userIds || userIds.length === 0) return [];
        const presences = await Promise.all<IPresenceEvent | null>(
            userIds.map(async (userId): Promise<IPresenceEvent | null> => {
                const presence = await this.getPresence(userId, true, throwOnError);
                if (!presence) {
                    return null;
                }
                return {
                    user_id: userId,
                    presence: presence.presence,
                    status_msg: presence.status_msg,
                    last_active_ago: presence.last_active_ago,
                    currently_active: presence.currently_active,
                };
            }),
        );
        return presences.filter((presence): presence is IPresenceEvent => presence !== null);
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
            const response = await this.withRetry(
                () =>
                    this.client.http.authedRequest<IPresenceList>(
                        Method.Post,
                        pp("/presence/list"),
                        {},
                        { subscribe: userIds },
                        { prefix: PRESENCE_PREFIX, priority: undefined },
                    ),
                "subscribeToPresence",
            );
            userIds.forEach((id) => this.subscribedUsers.add(id));
            (response.presences ?? []).forEach((presence) => {
                this.presenceCache.set(presence.user_id, {
                    presence: presence.presence,
                    status_msg: presence.status_msg,
                    last_active_ago: presence.last_active_ago,
                    currently_active: presence.currently_active,
                });
            });
            this.emit(PresenceEvent.PresenceListUpdated, response.presences ?? []);
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
            const response = await this.withRetry(
                () =>
                    this.client.http.authedRequest<IPresenceList>(
                        Method.Post,
                        pp("/presence/list"),
                        {},
                        { unsubscribe: userIds },
                        { prefix: PRESENCE_PREFIX, priority: undefined },
                    ),
                "unsubscribeFromPresence",
            );
            userIds.forEach((id) => this.subscribedUsers.delete(id));
            (response.presences ?? []).forEach((presence) => {
                this.presenceCache.set(presence.user_id, {
                    presence: presence.presence,
                    status_msg: presence.status_msg,
                    last_active_ago: presence.last_active_ago,
                    currently_active: presence.currently_active,
                });
                this.subscribedUsers.add(presence.user_id);
            });
            this.emit(PresenceEvent.PresenceListUpdated, response.presences ?? []);
        } catch (e) {
            const error = this.normalizeError(e, "unsubscribeFromPresence");
            this.emit(PresenceEvent.PresenceError, error);
            throw error;
        }
    }

    async getSubscribedPresence(): Promise<IPresenceEvent[]> {
        return this.getPresenceList(undefined, false);
    }

    /**
     * 清除状态消息
     *
     * @example
     * ```typescript
     * // 清除状态消息，保持当前在线状态
     * await presenceManager.clearStatusMessage();
     * ```
     */
    async clearStatusMessage(): Promise<void> {
        const me = this.client.getUserId();
        if (!me) return;
        const state = await this.getPresence(me, true, false);
        if (!state) return;
        await this.setPresence(state.presence);
    }

    /**
     * 设置为在线状态
     *
     * @param status - 状态消息（可选）
     *
     * @example
     * ```typescript
     * // 设置为在线
     * await presenceManager.setOnline();
     *
     * // 设置为在线并附带状态消息
     * await presenceManager.setOnline("Working on project");
     * ```
     */
    async setOnline(status?: string): Promise<void> {
        await this.setPresence("online", status);
    }

    /**
     * 设置为离线状态
     *
     * @param status - 状态消息（可选）
     *
     * @example
     * ```typescript
     * // 设置为离线
     * await presenceManager.setOffline();
     *
     * // 设置为离线并附带状态消息
     * await presenceManager.setOffline("Away from keyboard");
     * ```
     */
    async setOffline(status?: string): Promise<void> {
        await this.setPresence("offline", status);
    }

    /**
     * 设置为忙碌状态
     *
     * @param status - 状态消息（可选）
     *
     * @example
     * ```typescript
     * // 设置为忙碌
     * await presenceManager.setUnavailable();
     *
     * // 设置为忙碌并附带状态消息
     * await presenceManager.setUnavailable("In a meeting");
     * ```
     */
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
