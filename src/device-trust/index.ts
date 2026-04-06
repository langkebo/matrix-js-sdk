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
 * Device Trust Manager - 设备信任管理
 * 
 * 提供设备验证、信任状态查询、安全摘要等功能
 * 对应后端: synapse-rust/src/web/routes/e2ee_routes.rs
 * 
 * 后端端点:
 * - POST /v3/device_verification/request
 * - POST /v3/device_verification/respond
 * - GET /v3/device_verification/status/{token}
 * - GET /v3/device_trust
 * - GET /v3/device_trust/{device_id}
 * - GET /v3/security/summary
 */

import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { MatrixClient } from "../client";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { MatrixError } from "../http-api/errors.ts";
import { AuthError, NotFoundError, ApiError, SdkError } from "../errors.ts";
import { logger } from "../logger.ts";

export enum DeviceTrustEvent {
    VerificationRequested = "VerificationRequested",
    VerificationResponded = "VerificationResponded",
    TrustChanged = "TrustChanged",
    SecuritySummaryUpdated = "SecuritySummaryUpdated",
}

export type TrustLevel = "verified" | "cross_signed" | "unverified" | "blacklisted";

export type VerificationStatus = "pending" | "approved" | "rejected" | "expired" | "not_found";

export type VerificationMethod = "sas" | "qr" | "emoji";

export interface IDeviceVerificationRequest {
    new_device_id?: string;
    device_id?: string;
    method?: VerificationMethod;
}

export interface IDeviceVerificationResponse {
    request_token: string;
    token: string;
    status: VerificationStatus;
    expires_at: number;
    methods_available: VerificationMethod[];
}

export interface IVerificationRespondResult {
    success: boolean;
    trust_level: TrustLevel;
}

export interface IDeviceTrustInfo {
    device_id: string;
    trust_level: TrustLevel;
    verified_at?: number;
    verified_by?: string;
}

export interface IDeviceTrustListResponse {
    devices: IDeviceTrustInfo[];
}

export interface ISecuritySummary {
    verified_devices: number;
    unverified_devices: number;
    blocked_devices: number;
    has_cross_signing_master: boolean;
    security_score: number;
    recommendations: string[];
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

interface DeviceTrustManagerEventMap {
    [DeviceTrustEvent.VerificationRequested]: (response: IDeviceVerificationResponse) => void;
    [DeviceTrustEvent.VerificationResponded]: (result: IVerificationRespondResult) => void;
    [DeviceTrustEvent.TrustChanged]: (deviceId: string, trustLevel: TrustLevel) => void;
    [DeviceTrustEvent.SecuritySummaryUpdated]: (summary: ISecuritySummary) => void;
}

export class DeviceTrustManager extends TypedEventEmitter<DeviceTrustEvent, DeviceTrustManagerEventMap> {
    private client: MatrixClient;
    private deviceTrustCache: LRUCache<IDeviceTrustInfo>;
    private securitySummaryCache: LRUCache<ISecuritySummary>;
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
        this.deviceTrustCache = new LRUCache<IDeviceTrustInfo>(200, 5 * 60 * 1000);
        this.securitySummaryCache = new LRUCache<ISecuritySummary>(1, 60 * 1000);
    }

    async requestVerification(request: IDeviceVerificationRequest): Promise<IDeviceVerificationResponse> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IDeviceVerificationResponse>(
                    Method.Post,
                    "/device_verification/request",
                    undefined,
                    {
                        new_device_id: request.new_device_id,
                        device_id: request.device_id,
                        method: request.method ?? "sas",
                    },
                    { prefix: ClientPrefix.V3 }
                );
            }, "requestVerification");

            this.emit(DeviceTrustEvent.VerificationRequested, response);
            return response;
        } catch (error) {
            throw this.normalizeError(error, "requestVerification");
        }
    }

    async respondToVerification(token: string, approved: boolean): Promise<IVerificationRespondResult> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IVerificationRespondResult>(
                    Method.Post,
                    "/device_verification/respond",
                    undefined,
                    {
                        token,
                        approved,
                    },
                    { prefix: ClientPrefix.V3 }
                );
            }, "respondToVerification");

            this.emit(DeviceTrustEvent.VerificationResponded, response);
            return response;
        } catch (error) {
            throw this.normalizeError(error, "respondToVerification");
        }
    }

    async getVerificationStatus(token: string): Promise<IDeviceVerificationResponse> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IDeviceVerificationResponse>(
                    Method.Get,
                    `/device_verification/status/${encodeURIComponent(token)}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 }
                );
            }, "getVerificationStatus");

            return response;
        } catch (error) {
            throw this.normalizeError(error, "getVerificationStatus");
        }
    }

    async getDeviceTrustList(forceRefresh = false): Promise<IDeviceTrustInfo[]> {
        if (!forceRefresh) {
            const cached = this.deviceTrustCache.get("__list__");
            if (cached) {
                return [cached];
            }
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IDeviceTrustListResponse>(
                    Method.Get,
                    "/device_trust",
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 }
                );
            }, "getDeviceTrustList");

            const devices = response.devices || [];
            devices.forEach(device => {
                this.deviceTrustCache.set(device.device_id, device);
            });

            return devices;
        } catch (error) {
            throw this.normalizeError(error, "getDeviceTrustList");
        }
    }

    async getDeviceTrust(deviceId: string, forceRefresh = false): Promise<IDeviceTrustInfo | null> {
        if (!deviceId) {
            throw new Error("Device ID is required");
        }

        if (!forceRefresh) {
            const cached = this.deviceTrustCache.get(deviceId);
            if (cached) {
                return cached;
            }
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IDeviceTrustInfo>(
                    Method.Get,
                    `/device_trust/${encodeURIComponent(deviceId)}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 }
                );
            }, "getDeviceTrust");

            this.deviceTrustCache.set(deviceId, response);
            return response;
        } catch (error) {
            const httpStatus = (error as { httpStatus?: number })?.httpStatus;
            const errcode = (error as { errcode?: string })?.errcode;
            
            if (httpStatus === 404 || errcode === "M_NOT_FOUND") {
                return null;
            }
            throw this.normalizeError(error, "getDeviceTrust");
        }
    }

    async getSecuritySummary(forceRefresh = false): Promise<ISecuritySummary> {
        if (!forceRefresh) {
            const cached = this.securitySummaryCache.get("__summary__");
            if (cached) {
                return cached;
            }
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<ISecuritySummary>(
                    Method.Get,
                    "/security/summary",
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 }
                );
            }, "getSecuritySummary");

            this.securitySummaryCache.set("__summary__", response);
            this.emit(DeviceTrustEvent.SecuritySummaryUpdated, response);
            return response;
        } catch (error) {
            throw this.normalizeError(error, "getSecuritySummary");
        }
    }

    async isDeviceTrusted(deviceId: string): Promise<boolean> {
        const trustInfo = await this.getDeviceTrust(deviceId);
        if (!trustInfo) {
            return false;
        }
        return trustInfo.trust_level === "verified" || trustInfo.trust_level === "cross_signed";
    }

    async isDeviceBlocked(deviceId: string): Promise<boolean> {
        const trustInfo = await this.getDeviceTrust(deviceId);
        if (!trustInfo) {
            return false;
        }
        return trustInfo.trust_level === "blacklisted";
    }

    clearCache(): void {
        this.deviceTrustCache.clear();
        this.securitySummaryCache.clear();
    }

    getCacheStats(): {
        deviceTrust: { size: number; hits: number; misses: number; hitRate: number };
        securitySummary: { size: number; hits: number; misses: number; hitRate: number };
    } {
        return {
            deviceTrust: this.deviceTrustCache.getStats(),
            securitySummary: this.securitySummaryCache.getStats(),
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
                    logger.info(`DeviceTrustManager.${method} succeeded after ${attempt} retries`, {
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
                    logger.warn(`DeviceTrustManager.${method} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms`, {
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
                return new AuthError(`DeviceTrustManager.${method} failed: ${err?.message ?? 'Unknown error'}`, error);
            }
            if (error.httpStatus === 404 || error.errcode === 'M_NOT_FOUND') {
                return new NotFoundError(`DeviceTrustManager.${method} failed: ${err?.message ?? 'Unknown error'}`, error);
            }
            return new ApiError(`DeviceTrustManager.${method} failed: ${err?.message ?? 'Unknown error'}`, error.errcode ?? 'UNKNOWN', error.httpStatus ?? 0, error);
        }
        return new ApiError(`DeviceTrustManager.${method} failed: ${err?.message ?? String(error)}`, 'UNKNOWN', 0, error);
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
        getDeviceTrustManager(): DeviceTrustManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getDeviceTrustManager = function (): DeviceTrustManager {
        return new DeviceTrustManager(this);
    };
}

export default extendMatrixClient;
