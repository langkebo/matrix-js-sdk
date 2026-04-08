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

import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { Method } from "../http-api/method.ts";
import { MatrixClient } from "../client";
import { InvalidParamError } from "../common/errors.ts";
import { AuthError, NotFoundError, RetryableError, ApiError } from "../errors";
import { logger } from "../logger.ts";

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

interface CacheEntry<T> {
    value: T;
    timestamp: number;
}

class LRUCache<T> {
    private cache = new Map<string, CacheEntry<T>>();
    private readonly maxSize: number;
    private readonly ttl: number;
    private hits = 0;
    private misses = 0;

    constructor(maxSize: number, ttl: number) {
        this.maxSize = maxSize;
        this.ttl = ttl;
    }

    get(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) {
            this.misses++;
            return undefined;
        }

        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            this.misses++;
            return undefined;
        }

        this.hits++;
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.value;
    }

    set(key: string, value: T): void {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }

        this.cache.set(key, {
            value,
            timestamp: Date.now(),
        });
    }

    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) {
            return false;
        }

        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    clear(): void {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }

    size(): number {
        return this.cache.size;
    }

    entries(): IterableIterator<[string, CacheEntry<T>]> {
        return this.cache.entries();
    }

    getStats(): { size: number; hits: number; misses: number; hitRate: number } {
        const total = this.hits + this.misses;
        return {
            size: this.cache.size,
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? this.hits / total : 0,
        };
    }
}

export class PresenceManager extends TypedEventEmitter<PresenceEvent, PresenceManagerEventMap> {
    private client: MatrixClient;
    private presenceCache: LRUCache<IPresenceState>;
    private subscribedUsers: Set<string> = new Set();
    private initialized: boolean = false;

    constructor(client: MatrixClient) {
        super();
        this.client = client;
        this.presenceCache = new LRUCache<IPresenceState>(500, 5 * 60 * 1000);
    }

    private normalizeError(error: unknown, method: string): Error {
        const err = error as Error & { httpStatus?: number; errcode?: string };
        const message = err?.message ?? String(error);
        const errcode = err?.errcode ?? "UNKNOWN";
        if (err?.httpStatus === 401 || err?.errcode === "M_UNKNOWN_TOKEN") {
            return new AuthError(`PresenceManager.${method} failed: ${message}`, err);
        }
        if (err?.httpStatus === 404 || err?.errcode === "M_NOT_FOUND") {
            return new NotFoundError(`PresenceManager.${method} failed: ${message}`, err);
        }
        if (this.isRetryableError(err)) {
            return new RetryableError(`PresenceManager.${method} failed: ${message}`, err);
        }
        return new ApiError(`PresenceManager.${method} failed: ${message}`, errcode, err?.httpStatus ?? 0, err);
    }

    private isRetryableError(error: unknown): boolean {
        const err = error as Error & { code?: string; errno?: string };
        return err?.code === "ECONNRESET" ||
               err?.code === "ETIMEDOUT" ||
               err?.code === "ENOTFOUND" ||
               err?.code === "ECONNREFUSED" ||
               err?.errno === "ECONNRESET" ||
               err?.errno === "ETIMEDOUT";
    }

    private async presenceRequest<T>(
        method: Method,
        path: string,
        body?: Record<string, unknown>
    ): Promise<T> {
        return await this.client.http.authedRequest(
            method,
            path,
            {},
            body,
            { prefix: PRESENCE_PREFIX, priority: undefined }
        ) as Promise<T>;
    }

    async setPresence(presence: PresenceState, statusMsg?: string): Promise<void> {
        if (!presence) {
            throw new InvalidParamError("Presence state is required");
        }

        const validStates: PresenceState[] = ["online", "offline", "unavailable", "busy"];
        if (!validStates.includes(presence)) {
            throw new InvalidParamError(`Invalid presence state: ${presence}`);
        }

        try {
            const userId = this.client.getUserId();
            if (!userId) {
                throw new InvalidParamError("User ID is not available");
            }
            const body: Record<string, unknown> = { presence };

            if (statusMsg !== undefined) {
                body.status_msg = statusMsg;
            }

            await this.presenceRequest(
                Method.Put,
                `/presence/${encodeURIComponent(userId)}/status`,
                body
            );

            const state: IPresenceState = { presence, status_msg: statusMsg };
            this.presenceCache.set(userId, state);
            this.emit(PresenceEvent.PresenceUpdated, userId, state);
        } catch (error) {
            this.emit(PresenceEvent.PresenceError, error as Error);
            throw this.normalizeError(error, 'setPresence');
        }
    }

    async getPresence(userId: string): Promise<IPresenceState | null> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        if (this.presenceCache.has(userId)) {
            return this.presenceCache.get(userId) || null;
        }

        try {
            const response = await this.presenceRequest<IPresenceState>(
                Method.Get,
                `/presence/${encodeURIComponent(userId)}/status`
            );

            const state: IPresenceState = {
                presence: response.presence,
                status_msg: response.status_msg,
                last_active_ago: response.last_active_ago,
                currently_active: response.currently_active,
            };

            this.presenceCache.set(userId, state);
            return state;
        } catch (error: unknown) {
            const err = error as Error & { httpStatus?: number; errcode?: string };
            if (err?.httpStatus === 404 || err?.errcode === "M_NOT_FOUND") {
                return null;
            }
            throw this.normalizeError(error, 'getPresence');
        }
    }

    async getPresences(userIds: string[]): Promise<Map<string, IPresenceState>> {
        const result = new Map<string, IPresenceState>();

        for (const userId of userIds) {
            const presence = await this.getPresence(userId);
            if (presence) {
                result.set(userId, presence);
            }
        }

        return result;
    }

    async subscribeToPresence(userIds: string[]): Promise<void> {
        if (!userIds || userIds.length === 0) {
            throw new InvalidParamError("User IDs are required");
        }

        try {
            await this.presenceRequest(
                Method.Post,
                "/presence/list",
                { user_ids: userIds }
            );

            userIds.forEach(userId => this.subscribedUsers.add(userId));
        } catch (error) {
            this.emit(PresenceEvent.PresenceError, error as Error);
            throw this.normalizeError(error, 'subscribeToPresence');
        }
    }

    async unsubscribeFromPresence(userIds: string[]): Promise<void> {
        if (!userIds || userIds.length === 0) {
            throw new InvalidParamError("User IDs are required");
        }

        try {
            const remainingUsers = Array.from(this.subscribedUsers).filter(
                u => !userIds.includes(u)
            );

            await this.presenceRequest(
                Method.Post,
                "/presence/list",
                { user_ids: remainingUsers }
            );

            userIds.forEach(userId => this.subscribedUsers.delete(userId));
        } catch (error) {
            this.emit(PresenceEvent.PresenceError, error as Error);
            throw this.normalizeError(error, 'unsubscribeFromPresence');
        }
    }

    async getSubscribedPresence(): Promise<IPresenceEvent[]> {
        try {
            const response = await this.presenceRequest<IPresenceEvent[]>(
                Method.Get,
                "/presence/list"
            );

            const events: IPresenceEvent[] = response || [];

            events.forEach(event => {
                const state: IPresenceState = {
                    presence: event.presence,
                    status_msg: event.status_msg,
                    last_active_ago: event.last_active_ago,
                    currently_active: event.currently_active,
                };
                this.presenceCache.set(event.user_id, state);
            });

            this.emit(PresenceEvent.PresenceListUpdated, events);
            return events;
        } catch (error: unknown) {
            const err = error as Error & { httpStatus?: number; errcode?: string };
            if (err?.httpStatus === 404 || err?.errcode === "M_NOT_FOUND") {
                return [];
            }
            throw this.normalizeError(error, 'getSubscribedPresence');
        }
    }

    async getPresenceList(userId: string): Promise<IPresenceEvent[]> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        try {
            const response = await this.presenceRequest<IPresenceEvent[]>(
                Method.Get,
                `/presence/list/${encodeURIComponent(userId)}`
            );

            const events: IPresenceEvent[] = response || [];

            events.forEach(event => {
                const state: IPresenceState = {
                    presence: event.presence,
                    status_msg: event.status_msg,
                    last_active_ago: event.last_active_ago,
                    currently_active: event.currently_active,
                };
                this.presenceCache.set(event.user_id, state);
            });

            return events;
        } catch (error: unknown) {
            const err = error as Error & { httpStatus?: number; errcode?: string };
            if (err?.httpStatus === 404 || err?.errcode === "M_NOT_FOUND") {
                return [];
            }
            throw this.normalizeError(error, 'getPresenceList');
        }
    }

    async setOnline(statusMsg?: string): Promise<void> {
        await this.setPresence("online", statusMsg);
    }

    async setOffline(statusMsg?: string): Promise<void> {
        await this.setPresence("offline", statusMsg);
    }

    async setUnavailable(statusMsg?: string): Promise<void> {
        await this.setPresence("unavailable", statusMsg);
    }

    async setBusy(statusMsg?: string): Promise<void> {
        await this.setPresence("busy", statusMsg);
    }

    async clearStatusMessage(): Promise<void> {
        const userId = this.client.getUserId();
        if (!userId) return;
        const currentPresence = await this.getPresence(userId);
        if (currentPresence) {
            await this.setPresence(currentPresence.presence);
        }
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

    getCachedPresence(userId: string): IPresenceState | null {
        return this.presenceCache.get(userId) || null;
    }

    getCachedPresences(): Map<string, IPresenceState> {
        const result = new Map<string, IPresenceState>();
        for (const [key, entry] of this.presenceCache.entries()) {
            result.set(key, entry.value);
        }
        return result;
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

    async start(): Promise<void> {
        if (this.initialized) return;

        try {
            const userId = this.client.getUserId();
            if (userId) {
                await this.getPresence(userId);
            }
            this.initialized = true;
        } catch (e) {
            logger.warn('PresenceManager.start failed:', e);
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
        return new PresenceManager(this);
    };
}

export default extendMatrixClient;
