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
 * Base Manager - 管理器基类
 *
 * 提供所有 Manager 类的通用功能：
 * - 统一的错误处理和规范化
 * - 重试逻辑
 * - 请求统计
 * - 日志记录
 */

import { TypedEventEmitter } from "../models/typed-event-emitter";
import { HTTPError, MatrixError, safeGetRetryAfterMs } from "../http-api/errors";
import { Method } from "../http-api/method";
import { AdminPrefix } from "../http-api/prefix";
import { AuthError, NotFoundError, ApiError, SdkError, RetryableError, ValidationError } from "../errors";
import { logger } from "../logger";
import { MatrixClient } from "../client";

export interface RetryOptions {
    maxRetries?: number;
    retryDelay?: number;
    backoffMultiplier?: number;
    idempotent?: boolean;
    retryNonIdempotent?: boolean;
    label?: string;
}

export interface RequestStats {
    total: number;
    successful: number;
    failed: number;
    retried: number;
}

/**
 * Base class for all Manager classes
 *
 * Provides common functionality like error handling, retry logic, and request statistics.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export abstract class BaseManager<
    Events extends string = string,
    EventMap extends Record<Events, any> = Record<Events, any>,
> extends TypedEventEmitter<Events, EventMap> {
/* eslint-enable @typescript-eslint/no-explicit-any */
    protected readonly client: MatrixClient;
    protected retryOptions: RetryOptions = {};
    protected requestStats: RequestStats = {
        total: 0,
        successful: 0,
        failed: 0,
        retried: 0,
    };

    constructor(client: MatrixClient, retryOptions?: RetryOptions) {
        super();
        this.client = client;
        if (retryOptions) {
            this.retryOptions = retryOptions;
        }
    }

    /**
     * Normalize an error into a standard SdkError
     *
     * @param error - The error to normalize
     * @param method - The method name where the error occurred
     * @returns A normalized SdkError
     */
    protected normalizeError(error: unknown, method: string): SdkError {
        const managerName = this.constructor.name;
        const err = error as Error;
        const plain = error as Record<string, unknown>;
        const httpStatus = plain?.httpStatus as number | undefined;
        const errcode = plain?.errcode as string | undefined;
        const code = plain?.code as string | undefined;

        // If already a SdkError, return as-is
        if (error instanceof SdkError) {
            return error;
        }

        if (error instanceof MatrixError) {
            if (error.httpStatus === 401 || error.errcode === "M_UNKNOWN_TOKEN") {
                return new AuthError(`${managerName}.${method} failed: ${err?.message ?? "Unknown error"}`, error);
            }
            if (error.httpStatus === 404 || error.errcode === "M_NOT_FOUND") {
                return new NotFoundError(`${managerName}.${method} failed: ${err?.message ?? "Unknown error"}`, error);
            }
            if (error.httpStatus === 429 || error.errcode === "M_LIMIT_EXCEEDED" || error.isRateLimitError()) {
                return new RetryableError(`${managerName}.${method} failed: ${err?.message ?? "Rate limited"}`, error);
            }
            if (error.httpStatus && error.httpStatus >= 500) {
                return new RetryableError(`${managerName}.${method} failed: ${err?.message ?? "Unknown error"}`, error);
            }
            return new ApiError(
                `${managerName}.${method} failed: ${err?.message ?? "Unknown error"}`,
                error.errcode,
                error.httpStatus,
                error,
            );
        }

        if (error instanceof HTTPError) {
            if (error.httpStatus === 401) {
                return new AuthError(`${managerName}.${method} failed: ${err?.message ?? "Unknown error"}`, error);
            }
            if (error.httpStatus === 404) {
                return new NotFoundError(`${managerName}.${method} failed: ${err?.message ?? "Unknown error"}`, error);
            }
            if (error.httpStatus === 429 || error.isRateLimitError()) {
                return new RetryableError(`${managerName}.${method} failed: ${err?.message ?? "Rate limited"}`, error);
            }
            if (error.httpStatus && error.httpStatus >= 500) {
                return new RetryableError(`${managerName}.${method} failed: ${err?.message ?? "Unknown error"}`, error);
            }
            return new ApiError(
                `${managerName}.${method} failed: ${err?.message ?? "Unknown error"}`,
                "UNKNOWN",
                error.httpStatus,
                error,
            );
        }

        if (httpStatus === 401 || errcode === "M_UNKNOWN_TOKEN") {
            return new AuthError(`${managerName}.${method} failed: ${err?.message ?? "Unknown error"}`, error as Error);
        }
        if (httpStatus === 404 || errcode === "M_NOT_FOUND") {
            return new NotFoundError(
                `${managerName}.${method} failed: ${err?.message ?? "Unknown error"}`,
                error as Error,
            );
        }
        if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ENOTFOUND" || code === "ECONNABORTED") {
            return new RetryableError(
                `${managerName}.${method} failed: ${err?.message ?? "Unknown error"}`,
                error as Error,
            );
        }

        if (httpStatus === 429 || errcode === "M_LIMIT_EXCEEDED") {
            return new RetryableError(
                `${managerName}.${method} failed: ${err?.message ?? "Rate limited"}`,
                error as Error,
            );
        }
        if (typeof httpStatus === "number" && httpStatus >= 500) {
            return new RetryableError(
                `${managerName}.${method} failed: ${err?.message ?? "Unknown error"}`,
                error as Error,
            );
        }

        return new ApiError(
            `${managerName}.${method} failed: ${err?.message ?? String(error)}`,
            errcode ?? "UNKNOWN",
            httpStatus ?? 0,
            error,
        );
    }

    /**
     * Execute a function with retry logic
     *
     * @param fn - The function to execute
     * @param optionsOrLabel - Retry options or a label for logging
     * @returns The result of the function
     */
    public setRetryOptions(options: RetryOptions): void {
        this.retryOptions = { ...this.retryOptions, ...options };
    }

    protected async withRetry<T>(fn: () => Promise<T>, optionsOrLabel: RetryOptions | string = {}): Promise<T> {
        const options = typeof optionsOrLabel === "string" ? {} : optionsOrLabel;
        const label = typeof optionsOrLabel === "string" ? optionsOrLabel : (options.label ?? "withRetry");

        const {
            maxRetries = this.retryOptions.maxRetries ?? 3,
            retryDelay = this.retryOptions.retryDelay ?? 1000,
            backoffMultiplier = this.retryOptions.backoffMultiplier ?? 2,
            idempotent = true,
            retryNonIdempotent = false,
        } = options;

        let lastError: unknown;
        let currentDelay = retryDelay;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                this.requestStats.total++;
                const result = await fn();
                this.requestStats.successful++;
                return result;
            } catch (error) {
                lastError = error;
                this.requestStats.failed++;

                if (attempt < maxRetries) {
                    // Check if error is retryable
                    const normalizedError = this.normalizeError(error, label);
                    const canRetryRequest = idempotent || retryNonIdempotent;
                    if (
                        (canRetryRequest && normalizedError instanceof RetryableError) ||
                        (canRetryRequest && error instanceof HTTPError && error.httpStatus && error.httpStatus >= 500)
                    ) {
                        this.requestStats.retried++;
                        let delay = currentDelay;
                        if (error instanceof HTTPError && error.isRateLimitError()) {
                            delay = safeGetRetryAfterMs(error, currentDelay);
                        }
                        logger.warn(
                            `${this.constructor.name}.${label}: Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`,
                            error,
                        );
                        await this.sleep(delay);
                        currentDelay *= backoffMultiplier;
                        continue;
                    }
                }

                throw this.normalizeError(error, label);
            }
        }

        throw this.normalizeError(lastError, label);
    }

    /**
     * Get request statistics
     *
     * @returns Request statistics
     */
    public getRequestStats(): RequestStats {
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
     * Sleep for a specified duration
     *
     * @param ms - Duration in milliseconds
     */
    protected requireNonEmptyString(value: string | undefined | null, fieldName: string): asserts value is string {
        if (!value || value.trim().length === 0) {
            throw new ValidationError(`${fieldName} is required`);
        }
    }

    protected requirePositiveInteger(value: number | undefined | null, fieldName: string): void {
        if (value === undefined || value === null || !Number.isInteger(value) || value <= 0) {
            throw new ValidationError(`${fieldName} must be a positive integer`);
        }
    }

    protected requireNonNull<T>(value: T | undefined | null, fieldName: string): asserts value is T {
        if (value === undefined || value === null) {
            throw new ValidationError(`${fieldName} is required`);
        }
    }

    protected requireNonEmptyArray(value: unknown[] | undefined | null, fieldName: string): asserts value is unknown[] {
        if (!value || value.length === 0) {
            throw new ValidationError(`${fieldName} must be a non-empty array`);
        }
    }

    protected requireMaxLength(value: string | undefined | null, maxLength: number, fieldName: string): void {
        if (value && value.length > maxLength) {
            throw new ValidationError(`${fieldName} too long (max ${maxLength} characters)`);
        }
    }

    protected async adminRequest<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, string | string[]>,
        body?: object,
        label?: string,
    ): Promise<T> {
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<T>(
                method,
                path,
                queryParams,
                body,
                { prefix: AdminPrefix.V1 },
            );
        }, label ?? "adminRequest");
    }

    protected sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
