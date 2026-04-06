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
 * Crypto Keys Manager - 加密密钥管理
 * 
 * 提供密钥上传、下载、认领等功能
 * 对应后端: synapse-rust/src/web/routes/e2ee_routes.rs
 * 
 * 后端端点:
 * - POST /keys/upload
 * - POST /keys/query
 * - POST /keys/claim
 * - GET /keys/changes
 * - POST /keys/device_list/update
 * - POST /keys/signatures/upload
 * - POST /keys/device_signing/upload
 * - GET /rooms/{room_id}/keys/distribution
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { MatrixError } from "../http-api/errors.ts";
import { AuthError, NotFoundError, ApiError, SdkError } from "../errors.ts";
import { logger } from "../logger.ts";

export interface IDeviceKeys {
    user_id: string;
    device_id: string;
    algorithms: string[];
    keys: Record<string, string>;
    signatures: Record<string, Record<string, string>>;
    unsigned?: Record<string, unknown>;
}

export interface IOneTimeKey {
    key: string;
    signatures?: Record<string, Record<string, string>>;
}

export interface IKeysUploadRequest {
    device_keys?: IDeviceKeys;
    one_time_keys?: Record<string, IOneTimeKey | string>;
}

export interface IKeysUploadResponse {
    one_time_key_counts: Record<string, number>;
}

export interface IKeysQueryRequest {
    device_keys: Record<string, string[]>;
    timeout?: number;
    token?: string;
}

export interface IKeysQueryResponse {
    device_keys: Record<string, Record<string, IDeviceKeys>>;
    failures: Record<string, { errcode: string; error: string }>;
}

export interface IKeysClaimRequest {
    one_time_keys: Record<string, Record<string, string>>;
    timeout?: number;
}

export interface IKeysClaimResponse {
    one_time_keys: Record<string, Record<string, IOneTimeKey | string>>;
    failures: Record<string, { errcode: string; error: string }>;
}

export interface IKeysChangesResponse {
    changed: string[];
    left: string[];
}

export interface IKeySignaturesUploadRequest {
    signatures: Record<string, Record<string, Record<string, string>>>;
}

export interface IKeySignaturesUploadResponse {
    failures: Record<string, { errcode: string; error: string }>;
}

export interface IDeviceSigningUploadRequest {
    master_key?: IDeviceKeys;
    self_signing_key?: IDeviceKeys;
}

export interface IRoomKeyDistributionResponse {
    room_id: string;
    algorithm: string;
    session_id: string;
    session_key: string;
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

export class CryptoKeysManager {
    private client: MatrixClient;
    private deviceKeysCache: LRUCache<IDeviceKeys>;
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
        this.deviceKeysCache = new LRUCache<IDeviceKeys>(500, 10 * 60 * 1000);
    }

    async uploadKeys(content: IKeysUploadRequest): Promise<IKeysUploadResponse> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IKeysUploadResponse>(
                    Method.Post,
                    "/keys/upload",
                    undefined,
                    content,
                    { prefix: ClientPrefix.V3 }
                );
            }, "uploadKeys");

            return response;
        } catch (error) {
            throw this.normalizeError(error, "uploadKeys");
        }
    }

    async queryKeys(userIds: string[], opts: { token?: string; timeout?: number } = {}): Promise<IKeysQueryResponse> {
        const cacheKey = `query:${userIds.join(",")}`;
        const cached = this.deviceKeysCache.get(cacheKey);
        if (cached && !opts.token) {
            return {
                device_keys: {
                    [cached.user_id]: {
                        [cached.device_id]: cached,
                    },
                },
                failures: {},
            };
        }

        const content: IKeysQueryRequest = {
            device_keys: {},
        };

        for (const userId of userIds) {
            content.device_keys[userId] = [];
        }

        if (opts.token) content.token = opts.token;
        if (opts.timeout) content.timeout = opts.timeout;

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IKeysQueryResponse>(
                    Method.Post,
                    "/keys/query",
                    undefined,
                    content,
                    { prefix: ClientPrefix.V3 }
                );
            }, "queryKeys");

            for (const [userId, devices] of Object.entries(response.device_keys || {})) {
                for (const [deviceId, deviceKeys] of Object.entries(devices)) {
                    this.deviceKeysCache.set(`${userId}:${deviceId}`, deviceKeys);
                }
            }

            return response;
        } catch (error) {
            throw this.normalizeError(error, "queryKeys");
        }
    }

    async claimKeys(devices: [string, string][], keyAlgorithm = "signed_curve25519", timeout?: number): Promise<IKeysClaimResponse> {
        const queries: Record<string, Record<string, string>> = {};
        for (const [userId, deviceId] of devices) {
            if (!queries[userId]) {
                queries[userId] = {};
            }
            queries[userId][deviceId] = keyAlgorithm;
        }

        const content: IKeysClaimRequest = {
            one_time_keys: queries,
        };
        if (timeout) content.timeout = timeout;

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IKeysClaimResponse>(
                    Method.Post,
                    "/keys/claim",
                    undefined,
                    content,
                    { prefix: ClientPrefix.V3 }
                );
            }, "claimKeys");

            return response;
        } catch (error) {
            throw this.normalizeError(error, "claimKeys");
        }
    }

    async getKeysChanges(from: string, to: string): Promise<IKeysChangesResponse> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IKeysChangesResponse>(
                    Method.Get,
                    "/keys/changes",
                    { from, to },
                    undefined,
                    { prefix: ClientPrefix.V3 }
                );
            }, "getKeysChanges");

            return response;
        } catch (error) {
            throw this.normalizeError(error, "getKeysChanges");
        }
    }

    async updateDeviceList(): Promise<void> {
        try {
            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Post,
                    "/keys/device_list/update",
                    undefined,
                    {},
                    { prefix: ClientPrefix.V3 }
                );
            }, "updateDeviceList");
        } catch (error) {
            throw this.normalizeError(error, "updateDeviceList");
        }
    }

    async uploadKeySignatures(signatures: IKeySignaturesUploadRequest["signatures"]): Promise<IKeySignaturesUploadResponse> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IKeySignaturesUploadResponse>(
                    Method.Post,
                    "/keys/signatures/upload",
                    undefined,
                    { signatures },
                    { prefix: ClientPrefix.V3 }
                );
            }, "uploadKeySignatures");

            return response;
        } catch (error) {
            throw this.normalizeError(error, "uploadKeySignatures");
        }
    }

    async uploadDeviceSigning(masterKey?: IDeviceKeys, selfSigningKey?: IDeviceKeys): Promise<void> {
        const content: IDeviceSigningUploadRequest = {};
        if (masterKey) content.master_key = masterKey;
        if (selfSigningKey) content.self_signing_key = selfSigningKey;

        try {
            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Post,
                    "/keys/device_signing/upload",
                    undefined,
                    content,
                    { prefix: ClientPrefix.V3 }
                );
            }, "uploadDeviceSigning");
        } catch (error) {
            throw this.normalizeError(error, "uploadDeviceSigning");
        }
    }

    async getRoomKeyDistribution(roomId: string): Promise<IRoomKeyDistributionResponse> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IRoomKeyDistributionResponse>(
                    Method.Get,
                    `/rooms/${encodeURIComponent(roomId)}/keys/distribution`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 }
                );
            }, "getRoomKeyDistribution");

            return response;
        } catch (error) {
            throw this.normalizeError(error, "getRoomKeyDistribution");
        }
    }

    getDeviceKeysFromCache(userId: string, deviceId: string): IDeviceKeys | undefined {
        return this.deviceKeysCache.get(`${userId}:${deviceId}`);
    }

    clearCache(): void {
        this.deviceKeysCache.clear();
    }

    getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        return this.deviceKeysCache.getStats();
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
                    logger.info(`CryptoKeysManager.${method} succeeded after ${attempt} retries`, {
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
                    logger.warn(`CryptoKeysManager.${method} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms`, {
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
                return new AuthError(`CryptoKeysManager.${method} failed: ${err?.message ?? 'Unknown error'}`, error);
            }
            if (error.httpStatus === 404 || error.errcode === 'M_NOT_FOUND') {
                return new NotFoundError(`CryptoKeysManager.${method} failed: ${err?.message ?? 'Unknown error'}`, error);
            }
            return new ApiError(`CryptoKeysManager.${method} failed: ${err?.message ?? 'Unknown error'}`, error.errcode ?? 'UNKNOWN', error.httpStatus ?? 0, error);
        }
        return new ApiError(`CryptoKeysManager.${method} failed: ${err?.message ?? String(error)}`, 'UNKNOWN', 0, error);
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
        getCryptoKeysManager(): CryptoKeysManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCryptoKeysManager = function (): CryptoKeysManager {
        return new CryptoKeysManager(this);
    };
}

export default extendMatrixClient;
