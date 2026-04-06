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
 * Profile Manager - 用户资料管理
 * 
 * 提供用户资料相关的功能：获取、设置显示名、头像等
 * 
 * 优化特性:
 * - LRU 缓存: 用户资料缓存 (200 条, TTL 10 分钟)
 * - 重试机制: 指数退避重试
 * - 监控指标: 请求统计和性能监控
 */

import { TypedEventEmitter } from "../models/typed-event-emitter";
import { MatrixClient } from "../client";
import { UserEvent } from "../models/user";
import { Method } from "../http-api/index";
import { type EmptyObject } from "../@types/common";
import { getHttpUriForMxc } from "../content-repo";
import * as utils from "../utils";
import { ClientPrefix } from "../http-api/prefix";
import { AuthError, NotFoundError, RetryableError, ApiError } from "../errors";
import { MatrixError } from "../http-api/errors";
import { logger } from "../logger";

const STABLE_MSC4133_EXTENDED_PROFILES = "org.matrix.msc4133.extended_profiles";
const UNSTABLE_MSC4133_EXTENDED_PROFILES = "org.matrix.msc4133.extended_profiles";

export enum ProfileEvent {
    ProfileUpdated = "ProfileUpdated",
    ProfileError = "ProfileError",
}

export interface IProfile {
    displayname?: string;
    avatar_url?: string;
}

export interface IExtendedProfile extends IProfile {
    [key: string]: unknown;
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

interface ProfileManagerEventMap {
    [ProfileEvent.ProfileUpdated]: (userId: string, profile: IProfile) => void;
    [ProfileEvent.ProfileError]: (error: Error) => void;
}

export class ProfileManager extends TypedEventEmitter<ProfileEvent, ProfileManagerEventMap> {
    private client: MatrixClient;
    private profileCache: LRUCache<IProfile>;
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
        this.profileCache = new LRUCache<IProfile>(200, 10 * 60 * 1000);
    }

    /**
     * Set profile information
     */
    public setProfileInfo(info: "avatar_url", data: { avatar_url: string }): Promise<EmptyObject>;
    public setProfileInfo(info: "displayname", data: { displayname: string }): Promise<EmptyObject>;
    public async setProfileInfo(info: "avatar_url" | "displayname", data: object): Promise<EmptyObject> {
        const path = utils.encodeUri("/profile/$userId/$info", {
            $userId: this.client.credentials.userId!,
            $info: info,
        });

        try {
            const result = await this.withRetry(async () => {
                return await this.client.http.authedRequest<EmptyObject>(Method.Put, path, undefined, data);
            }, "setProfileInfo");

            const userId = this.client.getUserId();
            if (userId) {
                this.profileCache.delete(userId);
            }

            return result;
        } catch (error) {
            throw this.normalizeError(error, "setProfileInfo");
        }
    }

    /**
     * Set display name
     */
    public async setDisplayName(name: string): Promise<EmptyObject> {
        const prom = await this.setProfileInfo("displayname", { displayname: name });
        const user = this.client.getUser(this.client.getUserId()!);
        if (user) {
            user.displayName = name;
            user.emit(UserEvent.DisplayName, user.events.presence, user);
        }
        return prom;
    }

    /**
     * Set avatar URL
     */
    public async setAvatarUrl(url: string): Promise<EmptyObject> {
        const prom = await this.setProfileInfo("avatar_url", { avatar_url: url });
        const user = this.client.getUser(this.client.getUserId()!);
        if (user) {
            user.avatarUrl = url;
            user.emit(UserEvent.AvatarUrl, user.events.presence, user);
        }
        return prom;
    }

    /**
     * Turn an MXC URL into an HTTP one
     */
    public mxcUrlToHttp(
        mxcUrl: string,
        width?: number,
        height?: number,
        resizeMethod?: string,
        allowDirectLinks?: boolean,
        allowRedirects?: boolean,
        useAuthentication?: boolean,
    ): string | null {
        return getHttpUriForMxc(
            this.client.baseUrl,
            mxcUrl,
            width,
            height,
            resizeMethod,
            allowDirectLinks,
            allowRedirects,
            useAuthentication,
        );
    }

    /**
     * Get profile information
     */
    public async getProfileInfo(
        userId: string,
        info?: string,
        forceRefresh = false,
    ): Promise<{ avatar_url?: string; displayname?: string }> {
        if (!userId) {
            throw new Error("userId is required");
        }

        const cacheKey = info ? `${userId}:${info}` : userId;

        if (!forceRefresh) {
            const cached = this.profileCache.get(cacheKey);
            if (cached) {
                return cached;
            }
        }

        try {
            const path = info
                ? utils.encodeUri("/profile/$userId/$info", { $userId: userId, $info: info })
                : utils.encodeUri("/profile/$userId", { $userId: userId });

            const result = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IProfile>(Method.Get, path);
            }, "getProfileInfo");

            this.profileCache.set(cacheKey, result);
            this.emit(ProfileEvent.ProfileUpdated, userId, result);

            return result;
        } catch (error) {
            throw this.normalizeError(error, "getProfileInfo");
        }
    }

    /**
     * Get display name for a user
     */
    public async getDisplayName(userId: string, forceRefresh = false): Promise<string | null> {
        try {
            const profile = await this.getProfileInfo(userId, undefined, forceRefresh);
            return profile.displayname ?? null;
        } catch (error) {
            logger.warn(`ProfileManager.getDisplayName failed for ${userId}:`, error);
            return null;
        }
    }

    /**
     * Get avatar URL for a user
     */
    public async getAvatarUrl(userId: string, forceRefresh = false): Promise<string | null> {
        try {
            const profile = await this.getProfileInfo(userId, undefined, forceRefresh);
            return profile.avatar_url ?? null;
        } catch (error) {
            logger.warn(`ProfileManager.getAvatarUrl failed for ${userId}:`, error);
            return null;
        }
    }

    /**
     * Get own display name
     */
    public async getMyDisplayName(forceRefresh = false): Promise<string | null> {
        const userId = this.client.getUserId();
        if (!userId) return null;
        return this.getDisplayName(userId, forceRefresh);
    }

    /**
     * Get own avatar URL
     */
    public async getMyAvatarUrl(forceRefresh = false): Promise<string | null> {
        const userId = this.client.getUserId();
        if (!userId) return null;
        return this.getAvatarUrl(userId, forceRefresh);
    }

    /**
     * Get cached profile for a user
     */
    public getCachedProfile(userId: string): IProfile | null {
        return this.profileCache.get(userId) ?? null;
    }

    /**
     * Get cached display name for a user
     */
    public getCachedDisplayName(userId: string): string | null {
        const profile = this.profileCache.get(userId);
        return profile?.displayname ?? null;
    }

    /**
     * Get cached avatar URL for a user
     */
    public getCachedAvatarUrl(userId: string): string | null {
        const profile = this.profileCache.get(userId);
        return profile?.avatar_url ?? null;
    }

    /**
     * Invalidate cache for a specific user
     */
    public invalidateCache(userId: string): void {
        this.profileCache.delete(userId);
    }

    /**
     * Determine if the server supports extended profiles (MSC4133)
     */
    public async doesServerSupportExtendedProfiles(): Promise<boolean> {
        return (
            (await this.client.isVersionSupported("v1.16")) ||
            (await this.client.doesServerSupportUnstableFeature(UNSTABLE_MSC4133_EXTENDED_PROFILES)) ||
            (await this.client.doesServerSupportUnstableFeature(STABLE_MSC4133_EXTENDED_PROFILES))
        );
    }

    /**
     * Get the prefix used for extended profile requests
     */
    private async getExtendedProfileRequestPrefix(): Promise<string> {
        if (
            (await this.client.isVersionSupported("v1.16")) ||
            (await this.client.doesServerSupportUnstableFeature("uk.tcpip.msc4133.stable"))
        ) {
            return ClientPrefix.V3;
        }
        return "/_matrix/client/unstable/uk.tcpip.msc4133";
    }

    /**
     * Fetch a user's extended profile (MSC4133)
     */
    public async getExtendedProfile(userId: string, forceRefresh = false): Promise<Record<string, unknown>> {
        if (!(await this.doesServerSupportExtendedProfiles())) {
            throw new Error("Server does not support extended profiles");
        }

        const cacheKey = `extended:${userId}`;

        if (!forceRefresh) {
            const cached = this.profileCache.get(cacheKey);
            if (cached) {
                return cached as unknown as Record<string, unknown>;
            }
        }

        try {
            const result = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IExtendedProfile>(
                    Method.Get,
                    utils.encodeUri("/profile/$userId", { $userId: userId }),
                    undefined,
                    undefined,
                    {
                        prefix: await this.getExtendedProfileRequestPrefix(),
                    },
                );
            }, "getExtendedProfile");

            this.profileCache.set(cacheKey, result as IProfile);

            return result as unknown as Record<string, unknown>;
        } catch (error) {
            throw this.normalizeError(error, "getExtendedProfile");
        }
    }

    /**
     * Fetch a specific key from the user's extended profile
     */
    public async getExtendedProfileProperty(userId: string, key: string, forceRefresh = false): Promise<unknown> {
        if (!(await this.doesServerSupportExtendedProfiles())) {
            throw new Error("Server does not support extended profiles");
        }

        const cacheKey = `extended:${userId}:${key}`;

        if (!forceRefresh) {
            const cached = this.profileCache.get(cacheKey);
            if (cached) {
                return cached;
            }
        }

        try {
            const result = await this.withRetry(async () => {
                return await this.client.http.authedRequest<unknown>(
                    Method.Get,
                    utils.encodeUri("/profile/$userId/$key", { $userId: userId, $key: key }),
                );
            }, "getExtendedProfileProperty");

            this.profileCache.set(cacheKey, result as IProfile);

            return result;
        } catch (error) {
            throw this.normalizeError(error, "getExtendedProfileProperty");
        }
    }

    /**
     * Clear all caches
     */
    public clearCache(): void {
        this.profileCache.clear();
    }

    /**
     * Get cache statistics
     */
    public getCacheStats(): {
        profiles: { size: number; hits: number; misses: number; hitRate: number };
    } {
        return {
            profiles: this.profileCache.getStats(),
        };
    }

    /**
     * Get request statistics
     */
    public getRequestStats(): typeof this.requestStats {
        return { ...this.requestStats };
    }

    /**
     * Reset request statistics
     */
    public resetRequestStats(): void {
        this.requestStats = {
            total: 0,
            successful: 0,
            failed: 0,
            retried: 0,
        };
    }

    /**
     * Retry wrapper with exponential backoff
     */
    private async withRetry<T>(
        requestFn: () => Promise<T>,
        method: string,
        retries = this.maxRetries,
    ): Promise<T> {
        let lastError: unknown;
        const startTime = Date.now();

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const result = await requestFn();
                this.recordRequest(true, attempt > 0);

                if (attempt > 0) {
                    logger.info(`ProfileManager.${method} succeeded after ${attempt} retries`, {
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
                        retryable: false,
                    });
                    throw error;
                }

                if (attempt < retries) {
                    const delay = this.retryDelay * Math.pow(2, attempt);
                    logger.warn(`ProfileManager.${method} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms`, {
                        method,
                        attempt: attempt + 1,
                        maxAttempts: retries + 1,
                        delay,
                        error: this.getErrorType(error),
                    });

                    this.emitMetric('api_retry', method, {
                        attempt: attempt + 1,
                        delay,
                        error: this.getErrorType(error),
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
            error: this.getErrorType(lastError),
        });

        throw lastError;
    }

    /**
     * Record request statistics
     */
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

    /**
     * Check if error is retryable
     */
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

    /**
     * Normalize error
     */
    private normalizeError(error: unknown, method: string): Error {
        if (error instanceof MatrixError) {
            if (error.httpStatus === 404 || error.errcode === "M_NOT_FOUND") {
                return new NotFoundError(`ProfileManager.${method} failed: ${error.message}`, error);
            }
            if (error.httpStatus === 401 || error.errcode === "M_UNKNOWN_TOKEN") {
                return new AuthError(`ProfileManager.${method} failed: ${error.message}`, error);
            }
            if (this.isRetryableError(error)) {
                return new RetryableError(`ProfileManager.${method} failed: ${error.message}`, error);
            }
            return new ApiError(
                `ProfileManager.${method} failed: ${error.message}`,
                error.errcode ?? "UNKNOWN",
                error.httpStatus,
                error,
            );
        }
        const err = error as Record<string, unknown>;
        const message = (err?.message as string) ?? String(error);
        const httpStatus = err?.httpStatus as number | undefined;
        const errcode = err?.errcode as string | undefined;

        if (httpStatus === 404 || errcode === "M_NOT_FOUND") {
            return new NotFoundError(`ProfileManager.${method} failed: ${message}`, error as Error);
        }
        if (httpStatus === 401 || errcode === "M_UNKNOWN_TOKEN") {
            return new AuthError(`ProfileManager.${method} failed: ${message}`, error as Error);
        }
        if (this.isRetryableError(error)) {
            return new RetryableError(`ProfileManager.${method} failed: ${message}`, error as Error);
        }
        return new ApiError(
            `ProfileManager.${method} failed: ${message}`,
            errcode ?? "UNKNOWN",
            httpStatus ?? 0,
            error,
        );
    }

    /**
     * Get error type for logging
     */
    private getErrorType(error: unknown): string {
        if (error instanceof MatrixError) {
            return error.errcode ?? `http_${error.httpStatus}`;
        }
        if (error instanceof Error) {
            return error.name ?? "UnknownError";
        }
        return "UnknownError";
    }

    /**
     * Emit metric for monitoring
     */
    private emitMetric(type: string, method: string, data: Record<string, unknown>): void {
        try {
            logger.debug(`Metric: ${type}.${method}`, { type, method, ...data, timestamp: Date.now() });
        } catch {
            // Ignore metric emission errors
        }
    }

    /**
     * Sleep utility
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        /**
         * Get the profile manager
         */
        getProfileManager(): ProfileManager;
    }
}

/**
 * Extend MatrixClient with profile manager
 */
export function extendMatrixClient(): void {
    MatrixClient.prototype.getProfileManager = function (): ProfileManager {
        return new ProfileManager(this);
    };
}

export default extendMatrixClient;
