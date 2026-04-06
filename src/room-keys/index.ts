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
 * Room Keys Manager - 房间密钥请求管理
 * 
 * 提供房间密钥请求相关功能
 * 对应后端: synapse-rust/src/web/routes/e2ee_routes.rs
 * 
 * 后端端点:
 * - GET/POST /room_keys/request
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { MatrixError } from "../http-api/errors.ts";
import { AuthError, NotFoundError, ApiError, SdkError } from "../errors.ts";
import { logger } from "../logger.ts";

export interface RoomKeyRequest {
    request_id: string;
    room_id: string;
    session_id: string;
    device_id: string;
    state: "pending" | "approved" | "rejected";
    created_ts: number;
    updated_ts: number;
}

export interface RoomKeyRequestsResponse {
    requests: RoomKeyRequest[];
}

export interface CreateRoomKeyRequest {
    room_id: string;
    session_id: string;
    device_id?: string;
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

export class RoomKeysManager {
    private client: MatrixClient;
    private requestsCache: LRUCache<RoomKeyRequest[]>;
    private readonly maxRetries = 3;
    private readonly retryDelay = 1000;

    private requestStats = {
        total: 0,
        successful: 0,
        failed: 0,
        retried: 0,
    };

    constructor(client: MatrixClient) {
        this.client = client;
        this.requestsCache = new LRUCache<RoomKeyRequest[]>(50, 5 * 60 * 1000);
    }

    /**
     * 获取房间密钥请求列表
     * GET /_matrix/client/v3/room_keys/request
     */
    async getRoomKeyRequests(forceRefresh = false): Promise<RoomKeyRequestsResponse> {
        if (!forceRefresh) {
            const cached = this.requestsCache.get("__requests__");
            if (cached) {
                return { requests: cached };
            }
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<RoomKeyRequestsResponse>(
                    Method.Get,
                    "/room_keys/request",
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 }
                );
            }, "getRoomKeyRequests");

            if (response.requests) {
                this.requestsCache.set("__requests__", response.requests);
            }

            return response;
        } catch (error) {
            throw this.normalizeError(error, "getRoomKeyRequests");
        }
    }

    /**
     * 创建房间密钥请求
     * POST /_matrix/client/v3/room_keys/request
     */
    async createRoomKeyRequest(request: CreateRoomKeyRequest): Promise<void> {
        try {
            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Post,
                    "/room_keys/request",
                    undefined,
                    request,
                    { prefix: ClientPrefix.V3 }
                );
            }, "createRoomKeyRequest");

            this.requestsCache.delete("__requests__");
        } catch (error) {
            throw this.normalizeError(error, "createRoomKeyRequest");
        }
    }

    clearCache(): void {
        this.requestsCache.clear();
    }

    getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        return this.requestsCache.getStats();
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
                    logger.info(`RoomKeysManager.${method} succeeded after ${attempt} retries`, {
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
                    logger.warn(`RoomKeysManager.${method} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms`, {
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
        return false;
    }

    private normalizeError(error: unknown, method: string): SdkError {
        const err = error as Error;
        if (error instanceof MatrixError) {
            if (error.httpStatus === 401 || error.errcode === 'M_UNKNOWN_TOKEN') {
                return new AuthError(`RoomKeysManager.${method} failed: ${err?.message ?? 'Unknown error'}`, error);
            }
            if (error.httpStatus === 404 || error.errcode === 'M_NOT_FOUND') {
                return new NotFoundError(`RoomKeysManager.${method} failed: ${err?.message ?? 'Unknown error'}`, error);
            }
            return new ApiError(`RoomKeysManager.${method} failed: ${err?.message ?? 'Unknown error'}`, error.errcode ?? 'UNKNOWN', error.httpStatus ?? 0, error);
        }
        return new ApiError(`RoomKeysManager.${method} failed: ${err?.message ?? String(error)}`, 'UNKNOWN', 0, error);
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
}

declare module "../client.ts" {
    interface MatrixClient {
        getRoomKeysManager(): RoomKeysManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomKeysManager = function (): RoomKeysManager {
        return new RoomKeysManager(this);
    };
}

export default extendMatrixClient;
