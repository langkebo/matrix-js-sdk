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
 * Push Manager - 推送管理
 * 
 * 提供推送通知和推送规则管理功能
 * 对应后端: synapse-rust/src/web/routes/push.rs
 * 
 * 优化特性:
 * - LRU 缓存: Pushers 和 PushRules 缓存
 * - 重试机制: 指数退避重试
 * - 监控指标: 请求统计和性能监控
 */

import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { MatrixClient } from "../client";
import { InvalidParamError } from "../common/errors.ts";
import { AuthError, NotFoundError, RetryableError, ApiError } from "../errors";
import { logger } from "../logger.ts";
import { PushRuleKind, PushRuleAction, PushRuleActionName, IPushRule, IPushRules, PushRuleCondition } from "../@types/PushRules";
import { MatrixError } from "../http-api/errors.ts";

export type { IPushRules } from "../@types/PushRules";

export enum PushEvent {
    PushersUpdated = "PushersUpdated",
    PushRulesUpdated = "PushRulesUpdated",
    NotificationReceived = "NotificationReceived",
    PushError = "PushError",
}

export interface IPusher {
    pushkey: string;
    kind: string | null;
    app_id: string;
    app_display_name: string;
    device_display_name: string;
    profile_tag?: string;
    lang: string;
    data?: Record<string, unknown>;
    enabled?: boolean;
    device_id?: string;
}

export interface IPusherRequest {
    pushkey: string;
    kind?: string | null;
    app_id: string;
    app_display_name: string;
    device_display_name: string;
    profile_tag?: string;
    lang: string;
    data?: Record<string, unknown>;
    append?: boolean;
}

export interface ICreatePushRuleRequest {
    actions: PushRuleAction[];
    conditions?: PushRuleCondition[];
    pattern?: string;
    before?: string;
    after?: string;
}

export interface IUpdatePushRuleRequest {
    actions: PushRuleAction[];
    conditions?: PushRuleCondition[];
    pattern?: string;
}

export interface INotification {
    event_id: string;
    room_id: string;
    ts: number;
    profile_tag?: string;
    read: boolean;
    event: Record<string, unknown>;
}

export interface INotificationsResponse {
    notifications: INotification[];
    next_token?: string;
}

export interface IPushRuleSet {
    override?: IPushRule[];
    content?: IPushRule[];
    room?: IPushRule[];
    sender?: IPushRule[];
    underride?: IPushRule[];
}

export interface PushManagerMetrics {
    pushers: {
        total: number;
        cacheHitRate: number;
    };
    pushRules: {
        total: number;
        cacheHitRate: number;
    };
    requests: {
        total: number;
        successful: number;
        failed: number;
        retried: number;
    };
}

interface PushManagerEventMap {
    [PushEvent.PushersUpdated]: (pushers: IPusher[]) => void;
    [PushEvent.PushRulesUpdated]: (rules: IPushRules) => void;
    [PushEvent.NotificationReceived]: (notification: INotification) => void;
    [PushEvent.PushError]: (error: Error) => void;
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

export class PushManager extends TypedEventEmitter<PushEvent, PushManagerEventMap> {
    private client: MatrixClient;
    private pushersCache: LRUCache<IPusher[]>;
    private pushRulesCache: LRUCache<IPushRules>;
    private initialized: boolean = false;
    private readonly maxRetries = 3;
    private readonly retryDelay = 1000;

    private requestStats = {
        total: 0,
        successful: 0,
        failed: 0,
        retried: 0,
    };

    constructor(client: MatrixClient) {
        super();
        this.client = client;
        
        this.pushersCache = new LRUCache<IPusher[]>(10, 5 * 60 * 1000);
        this.pushRulesCache = new LRUCache<IPushRules>(10, 5 * 60 * 1000);
    }

    private normalizeError(error: unknown, method: string): Error {
        if (error instanceof MatrixError) {
            if (error.httpStatus === 404 || error.errcode === "M_NOT_FOUND") {
                return new NotFoundError(`PushManager.${method} failed: ${error.message}`, error);
            }
            if (error.httpStatus === 401 || error.errcode === "M_UNKNOWN_TOKEN") {
                return new AuthError(`PushManager.${method} failed: ${error.message}`, error);
            }
            if (this.isRetryableError(error)) {
                return new RetryableError(`PushManager.${method} failed: ${error.message}`, error);
            }
            return new ApiError(
                `PushManager.${method} failed: ${error.message}`,
                error.errcode ?? "UNKNOWN",
                error.httpStatus,
                error
            );
        }
        const err = error as Record<string, unknown>;
        const message = (err?.message as string) ?? String(error);
        const httpStatus = err?.httpStatus as number | undefined;
        const errcode = err?.errcode as string | undefined;
        
        if (httpStatus === 404 || errcode === "M_NOT_FOUND") {
            return new NotFoundError(`PushManager.${method} failed: ${message}`, error as Error);
        }
        if (httpStatus === 401 || errcode === "M_UNKNOWN_TOKEN") {
            return new AuthError(`PushManager.${method} failed: ${message}`, error as Error);
        }
        if (this.isRetryableError(error)) {
            return new RetryableError(`PushManager.${method} failed: ${message}`, error as Error);
        }
        return new ApiError(
            `PushManager.${method} failed: ${message}`,
            errcode ?? "UNKNOWN",
            httpStatus ?? 0,
            error
        );
    }

    private isRetryableError(error: unknown): boolean {
        if (error instanceof MatrixError) {
            const retryableCodes = [
                "M_LIMIT_EXCEEDED",
                "M_SERVER_UNAVAILABLE",
            ];
            const retryableStatus = [429, 500, 502, 503, 504];
            return (
                retryableCodes.includes(error.errcode ?? "") ||
                retryableStatus.includes(error.httpStatus ?? 0)
            );
        }
        const err = error as Record<string, unknown>;
        if (err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT" || err?.code === "ENOTFOUND") {
            return true;
        }
        const httpStatus = err?.httpStatus as number | undefined;
        if (httpStatus && [429, 500, 502, 503, 504].includes(httpStatus)) {
            return true;
        }
        return false;
    }

    private getErrorType(error: unknown): string {
        if (error instanceof MatrixError) {
            return error.errcode ?? `http_${error.httpStatus}`;
        }
        if (error instanceof Error) {
            return error.name ?? "UnknownError";
        }
        return "UnknownError";
    }

    private async withRetry<T>(
        requestFn: () => Promise<T>,
        method: string,
        retries = this.maxRetries
    ): Promise<T> {
        let lastError: unknown;
        const startTime = Date.now();

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const result = await requestFn();
                this.recordRequest(true, attempt > 0);

                if (attempt > 0) {
                    logger.info(`PushManager.${method} succeeded after ${attempt} retries`, {
                        method,
                        attempts: attempt + 1,
                        duration: Date.now() - startTime,
                    });
                }

                return result;
            } catch (error: unknown) {
                lastError = error;

                if (!this.isRetryableError(error)) {
                    this.recordRequest(false, false);
                    this.emitMetric('api_error', method, {
                        error: this.getErrorType(error),
                        attempt: attempt + 1,
                        retryable: false
                    });
                    throw error;
                }

                if (attempt < retries) {
                    const delay = this.retryDelay * Math.pow(2, attempt);
                    logger.warn(`PushManager.${method} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms`, {
                        method,
                        attempt: attempt + 1,
                        maxAttempts: retries + 1,
                        delay,
                        error: this.getErrorType(error),
                    });

                    this.emitMetric('api_retry', method, {
                        attempt: attempt + 1,
                        delay,
                        error: this.getErrorType(error)
                    });

                    await this.sleep(delay);
                }
            }
        }

        this.recordRequest(false, true);
        const duration = Date.now() - startTime;
        this.emitMetric('api_failure', method, {
            attempts: retries + 1,
            duration,
            error: this.getErrorType(lastError)
        });

        throw lastError;
    }

    private recordRequest(success: boolean, retried: boolean): void {
        this.requestStats.total++;
        if (success) {
            this.requestStats.successful++;
        } else {
            this.requestStats.failed++;
        }
        if (retried) {
            this.requestStats.retried++;
        }
    }

    private emitMetric(type: string, method: string, data: Record<string, unknown>): void {
        try {
            logger.debug(`Metric: ${type}.${method}`, { type, method, ...data, timestamp: Date.now() });
        } catch {
            // 忽略监控发送错误，不影响主流程
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ==================== Pushers ====================

    async getPushers(forceRefresh = false): Promise<IPusher[]> {
        if (!forceRefresh) {
            const cached = this.pushersCache.get("pushers");
            if (cached) {
                return cached;
            }
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<{ pushers: IPusher[] }>(
                    Method.Get,
                    "/pushers",
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 }
                );
            }, 'getPushers');

            const pushers = response?.pushers || [];
            this.pushersCache.set("pushers", pushers);
            this.emit(PushEvent.PushersUpdated, pushers);
            return pushers;
        } catch (error: unknown) {
            this.emit(PushEvent.PushError, this.normalizeError(error, 'getPushers'));
            throw this.normalizeError(error, 'getPushers');
        }
    }

    async setPusher(pusher: IPusherRequest): Promise<void> {
        if (!pusher.pushkey) {
            throw new InvalidParamError("pushkey is required");
        }
        if (!pusher.app_id) {
            throw new InvalidParamError("app_id is required");
        }

        try {
            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Post,
                    "/pushers/set",
                    undefined,
                    pusher,
                    { prefix: ClientPrefix.V3 }
                );
            }, 'setPusher');

            this.pushersCache.delete("pushers");
            await this.getPushers(true);
        } catch (error: unknown) {
            this.emit(PushEvent.PushError, this.normalizeError(error, 'setPusher'));
            throw this.normalizeError(error, 'setPusher');
        }
    }

    async removePusher(pushkey: string, appId: string): Promise<void> {
        if (!pushkey) {
            throw new InvalidParamError("pushkey is required");
        }
        if (!appId) {
            throw new InvalidParamError("appId is required");
        }

        try {
            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Post,
                    "/pushers/set",
                    undefined,
                    {
                        pushkey,
                        app_id: appId,
                        kind: null,
                    },
                    { prefix: ClientPrefix.V3 }
                );
            }, 'removePusher');

            this.pushersCache.delete("pushers");
            await this.getPushers(true);
        } catch (error: unknown) {
            this.emit(PushEvent.PushError, this.normalizeError(error, 'removePusher'));
            throw this.normalizeError(error, 'removePusher');
        }
    }

    getCachedPushers(): IPusher[] {
        return this.pushersCache.get("pushers") || [];
    }

    // ==================== Push Rules ====================

    async getPushRules(forceRefresh = false): Promise<IPushRules> {
        if (!forceRefresh) {
            const cached = this.pushRulesCache.get("pushRules");
            if (cached) {
                return cached;
            }
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IPushRules>(
                    Method.Get,
                    "/pushrules",
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 }
                );
            }, 'getPushRules');

            this.pushRulesCache.set("pushRules", response);
            this.emit(PushEvent.PushRulesUpdated, response);
            return response;
        } catch (error: unknown) {
            this.emit(PushEvent.PushError, this.normalizeError(error, 'getPushRules'));
            throw this.normalizeError(error, 'getPushRules');
        }
    }

    async getPushRulesByScope(scope: string): Promise<IPushRuleSet> {
        if (!scope) {
            throw new InvalidParamError("scope is required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IPushRuleSet>(
                    Method.Get,
                    `/pushrules/${encodeURIComponent(scope)}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 }
                );
            }, 'getPushRulesByScope');

            return response;
        } catch (error: unknown) {
            this.emit(PushEvent.PushError, this.normalizeError(error, 'getPushRulesByScope'));
            throw this.normalizeError(error, 'getPushRulesByScope');
        }
    }

    async getPushRulesByKind(scope: string, kind: PushRuleKind): Promise<IPushRule[]> {
        if (!scope) {
            throw new InvalidParamError("scope is required");
        }
        if (!kind) {
            throw new InvalidParamError("kind is required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<{ [key: string]: IPushRule[] }>(
                    Method.Get,
                    `/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 }
                );
            }, 'getPushRulesByKind');

            return response?.[kind] || [];
        } catch (error: unknown) {
            this.emit(PushEvent.PushError, this.normalizeError(error, 'getPushRulesByKind'));
            throw this.normalizeError(error, 'getPushRulesByKind');
        }
    }

    async getPushRule(scope: string, kind: PushRuleKind, ruleId: string): Promise<IPushRule | null> {
        if (!scope || !kind || !ruleId) {
            throw new InvalidParamError("scope, kind, and ruleId are required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IPushRule>(
                    Method.Get,
                    `/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}/${encodeURIComponent(ruleId)}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 }
                );
            }, 'getPushRule');

            return response;
        } catch (error: unknown) {
            const err = error as Record<string, unknown>;
            const httpStatus = err?.httpStatus as number | undefined;
            const errcode = err?.errcode as string | undefined;
            if ((error instanceof MatrixError && (error.httpStatus === 404 || error.errcode === "M_NOT_FOUND")) ||
                httpStatus === 404 || errcode === "M_NOT_FOUND") {
                return null;
            }
            this.emit(PushEvent.PushError, this.normalizeError(error, 'getPushRule'));
            throw this.normalizeError(error, 'getPushRule');
        }
    }

    async createPushRule(
        scope: string,
        kind: PushRuleKind,
        ruleId: string,
        rule: ICreatePushRuleRequest
    ): Promise<void> {
        if (!scope || !kind || !ruleId) {
            throw new InvalidParamError("scope, kind, and ruleId are required");
        }
        if (!rule.actions || rule.actions.length === 0) {
            throw new InvalidParamError("actions are required");
        }

        try {
            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Post,
                    `/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}/${encodeURIComponent(ruleId)}`,
                    undefined,
                    rule,
                    { prefix: ClientPrefix.V3 }
                );
            }, 'createPushRule');

            this.pushRulesCache.delete("pushRules");
            await this.getPushRules(true);
        } catch (error: unknown) {
            this.emit(PushEvent.PushError, this.normalizeError(error, 'createPushRule'));
            throw this.normalizeError(error, 'createPushRule');
        }
    }

    async updatePushRule(
        scope: string,
        kind: PushRuleKind,
        ruleId: string,
        rule: IUpdatePushRuleRequest
    ): Promise<void> {
        if (!scope || !kind || !ruleId) {
            throw new InvalidParamError("scope, kind, and ruleId are required");
        }

        try {
            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Put,
                    `/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}/${encodeURIComponent(ruleId)}`,
                    undefined,
                    rule,
                    { prefix: ClientPrefix.V3 }
                );
            }, 'updatePushRule');

            this.pushRulesCache.delete("pushRules");
            await this.getPushRules(true);
        } catch (error: unknown) {
            this.emit(PushEvent.PushError, this.normalizeError(error, 'updatePushRule'));
            throw this.normalizeError(error, 'updatePushRule');
        }
    }

    async deletePushRule(scope: string, kind: PushRuleKind, ruleId: string): Promise<void> {
        if (!scope || !kind || !ruleId) {
            throw new InvalidParamError("scope, kind, and ruleId are required");
        }

        try {
            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Delete,
                    `/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}/${encodeURIComponent(ruleId)}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 }
                );
            }, 'deletePushRule');

            this.pushRulesCache.delete("pushRules");
            await this.getPushRules(true);
        } catch (error: unknown) {
            this.emit(PushEvent.PushError, this.normalizeError(error, 'deletePushRule'));
            throw this.normalizeError(error, 'deletePushRule');
        }
    }

    async getPushRuleEnabled(scope: string, kind: PushRuleKind, ruleId: string): Promise<boolean> {
        if (!scope || !kind || !ruleId) {
            throw new InvalidParamError("scope, kind, and ruleId are required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<{ enabled: boolean }>(
                    Method.Get,
                    `/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}/${encodeURIComponent(ruleId)}/enabled`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 }
                );
            }, 'getPushRuleEnabled');

            return response?.enabled ?? true;
        } catch (error: unknown) {
            const err = error as Record<string, unknown>;
            const httpStatus = err?.httpStatus as number | undefined;
            const errcode = err?.errcode as string | undefined;
            if ((error instanceof MatrixError && (error.httpStatus === 404 || error.errcode === "M_NOT_FOUND")) ||
                httpStatus === 404 || errcode === "M_NOT_FOUND") {
                return false;
            }
            this.emit(PushEvent.PushError, this.normalizeError(error, 'getPushRuleEnabled'));
            throw this.normalizeError(error, 'getPushRuleEnabled');
        }
    }

    async setPushRuleEnabled(
        scope: string,
        kind: PushRuleKind,
        ruleId: string,
        enabled: boolean
    ): Promise<void> {
        if (!scope || !kind || !ruleId) {
            throw new InvalidParamError("scope, kind, and ruleId are required");
        }

        try {
            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Put,
                    `/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}/${encodeURIComponent(ruleId)}/enabled`,
                    undefined,
                    { enabled },
                    { prefix: ClientPrefix.V3 }
                );
            }, 'setPushRuleEnabled');

            this.pushRulesCache.delete("pushRules");
            await this.getPushRules(true);
        } catch (error: unknown) {
            this.emit(PushEvent.PushError, this.normalizeError(error, 'setPushRuleEnabled'));
            throw this.normalizeError(error, 'setPushRuleEnabled');
        }
    }

    async setPushRuleActions(
        scope: string,
        kind: PushRuleKind,
        ruleId: string,
        actions: PushRuleAction[]
    ): Promise<void> {
        if (!scope || !kind || !ruleId) {
            throw new InvalidParamError("scope, kind, and ruleId are required");
        }
        if (!actions || actions.length === 0) {
            throw new InvalidParamError("actions are required");
        }

        try {
            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Put,
                    `/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}/${encodeURIComponent(ruleId)}/actions`,
                    undefined,
                    { actions },
                    { prefix: ClientPrefix.V3 }
                );
            }, 'setPushRuleActions');

            this.pushRulesCache.delete("pushRules");
            await this.getPushRules(true);
        } catch (error: unknown) {
            this.emit(PushEvent.PushError, this.normalizeError(error, 'setPushRuleActions'));
            throw this.normalizeError(error, 'setPushRuleActions');
        }
    }

    getCachedPushRules(): IPushRules | null {
        return this.pushRulesCache.get("pushRules") || null;
    }

    // ==================== Notifications ====================

    async getNotifications(params?: {
        limit?: number;
        from?: string;
        only?: string;
    }): Promise<INotificationsResponse> {
        try {
            const queryParams: Record<string, string> = {};
            if (params?.limit) {
                queryParams.limit = params.limit.toString();
            }
            if (params?.from) {
                queryParams.from = params.from;
            }
            if (params?.only) {
                queryParams.only = params.only;
            }

            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<INotificationsResponse>(
                    Method.Get,
                    "/notifications",
                    Object.keys(queryParams).length > 0 ? queryParams : undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 }
                );
            }, 'getNotifications');

            return response || { notifications: [] };
        } catch (error: unknown) {
            this.emit(PushEvent.PushError, this.normalizeError(error, 'getNotifications'));
            throw this.normalizeError(error, 'getNotifications');
        }
    }

    async ackNotification(notificationId: string): Promise<void> {
        if (!notificationId) {
            throw new InvalidParamError("notificationId is required");
        }

        try {
            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Post,
                    `/notifications/${encodeURIComponent(notificationId)}/ack`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 }
                );
            }, 'ackNotification');
        } catch (error: unknown) {
            const err = error as Record<string, unknown>;
            const httpStatus = err?.httpStatus as number | undefined;
            const errcode = err?.errcode as string | undefined;
            if ((error instanceof MatrixError && (error.httpStatus === 404 || error.errcode === "M_NOT_FOUND")) ||
                httpStatus === 404 || errcode === "M_NOT_FOUND") {
                return;
            }
            this.emit(PushEvent.PushError, this.normalizeError(error, 'ackNotification'));
            throw this.normalizeError(error, 'ackNotification');
        }
    }

    // ==================== Convenience Methods ====================

    async muteRoom(roomId: string): Promise<void> {
        if (!roomId) {
            throw new InvalidParamError("roomId is required");
        }
        await this.createPushRule("global", PushRuleKind.RoomSpecific, roomId, {
            actions: [PushRuleActionName.DontNotify],
        });
    }

    async unmuteRoom(roomId: string): Promise<void> {
        if (!roomId) {
            throw new InvalidParamError("roomId is required");
        }
        await this.deletePushRule("global", PushRuleKind.RoomSpecific, roomId);
    }

    async isRoomMuted(roomId: string): Promise<boolean> {
        if (!roomId) {
            throw new InvalidParamError("roomId is required");
        }
        const rules = await this.getPushRulesByKind("global", PushRuleKind.RoomSpecific);
        const rule = rules.find(r => r.rule_id === roomId);
        return !!rule && rule.enabled && rule.actions.includes("dont_notify" as PushRuleAction);
    }

    async addKeywordHighlight(keyword: string): Promise<void> {
        if (!keyword) {
            throw new InvalidParamError("keyword is required");
        }
        await this.createPushRule("global", PushRuleKind.ContentSpecific, keyword, {
            actions: [PushRuleActionName.Notify, { set_tweak: "highlight", value: true } as PushRuleAction],
            pattern: keyword,
        });
    }

    async removeKeywordHighlight(keyword: string): Promise<void> {
        if (!keyword) {
            throw new InvalidParamError("keyword is required");
        }
        await this.deletePushRule("global", PushRuleKind.ContentSpecific, keyword);
    }

    async ignoreSender(userId: string): Promise<void> {
        if (!userId) {
            throw new InvalidParamError("userId is required");
        }
        await this.createPushRule("global", PushRuleKind.SenderSpecific, userId, {
            actions: [PushRuleActionName.DontNotify],
        });
    }

    async unignoreSender(userId: string): Promise<void> {
        if (!userId) {
            throw new InvalidParamError("userId is required");
        }
        await this.deletePushRule("global", PushRuleKind.SenderSpecific, userId);
    }

    // ==================== Lifecycle ====================

    async start(): Promise<void> {
        if (this.initialized) return;

        try {
            await Promise.all([
                this.getPushers(),
                this.getPushRules(),
            ]);
            this.initialized = true;
        } catch (e) {
            logger.warn('PushManager.start failed:', e);
        }
    }

    stop(): void {
        this.clearCache();
        this.initialized = false;
    }

    clearCache(): void {
        this.pushersCache.clear();
        this.pushRulesCache.clear();
    }

    // ==================== Metrics ====================

    getCacheStats(): {
        pushers: { size: number; hits: number; misses: number; hitRate: number };
        pushRules: { size: number; hits: number; misses: number; hitRate: number };
    } {
        return {
            pushers: this.pushersCache.getStats(),
            pushRules: this.pushRulesCache.getStats(),
        };
    }

    getRequestStats(): typeof this.requestStats {
        return { ...this.requestStats };
    }

    resetRequestStats(): void {
        this.requestStats = {
            total: 0,
            successful: 0,
            failed: 0,
            retried: 0,
        };
    }

    getMetrics(): PushManagerMetrics {
        const pushersStats = this.pushersCache.getStats();
        const pushRulesStats = this.pushRulesCache.getStats();
        const cachedPushers = this.pushersCache.get("pushers") || [];
        const cachedPushRules = this.pushRulesCache.get("pushRules");

        return {
            pushers: {
                total: cachedPushers.length,
                cacheHitRate: pushersStats.hitRate,
            },
            pushRules: {
                total: this.countPushRules(cachedPushRules),
                cacheHitRate: pushRulesStats.hitRate,
            },
            requests: { ...this.requestStats },
        };
    }

    private countPushRules(rules: IPushRules | null | undefined): number {
        if (!rules?.global) return 0;
        const g = rules.global;
        return (
            (g.override?.length || 0) +
            (g.content?.length || 0) +
            (g.room?.length || 0) +
            (g.sender?.length || 0) +
            (g.underride?.length || 0)
        );
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getPushManager(): PushManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getPushManager = function (): PushManager {
        return new PushManager(this);
    };
}

export default extendMatrixClient;
