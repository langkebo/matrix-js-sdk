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
import { MatrixError } from "../http-api/errors";
import { AuthError, NotFoundError, ApiError, SdkError, RetryableError } from "../errors";
import { logger } from "../logger";
import { MatrixClient } from "../client";

export interface RetryOptions {
    maxRetries?: number;
    retryDelay?: number;
    backoffMultiplier?: number;
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
export abstract class BaseManager<
    Events extends string = string,
    EventMap extends Record<Events, any> = Record<Events, any>
> extends TypedEventEmitter<Events, EventMap> {
    protected readonly client: MatrixClient;
    protected requestStats: RequestStats = {
        total: 0,
        successful: 0,
        failed: 0,
        retried: 0,
    };

    constructor(client: MatrixClient) {
        super();
        this.client = client;
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

        // If already a SdkError, return as-is
        if (error instanceof SdkError) {
            return error;
        }

        if (error instanceof MatrixError) {
            if (error.httpStatus === 401 || error.errcode === 'M_UNKNOWN_TOKEN') {
                return new AuthError(
                    `${managerName}.${method} failed: ${err?.message ?? 'Unknown error'}`,
                    error
                );
            }
            if (error.httpStatus === 404 || error.errcode === 'M_NOT_FOUND') {
                return new NotFoundError(
                    `${managerName}.${method} failed: ${err?.message ?? 'Unknown error'}`,
                    error
                );
            }
            if (error.httpStatus && error.httpStatus >= 500) {
                return new RetryableError(
                    `${managerName}.${method} failed: ${err?.message ?? 'Unknown error'}`,
                    error
                );
            }
            return new ApiError(
                `${managerName}.${method} failed: ${err?.message ?? 'Unknown error'}`,
                error.errcode,
                error.httpStatus,
                error
            );
        }

        return new ApiError(
            `${managerName}.${method} failed: ${err?.message ?? String(error)}`,
            'UNKNOWN',
            0,
            error
        );
    }

    /**
     * Execute a function with retry logic
     *
     * @param fn - The function to execute
     * @param options - Retry options
     * @returns The result of the function
     */
    protected async withRetry<T>(
        fn: () => Promise<T>,
        options: RetryOptions = {}
    ): Promise<T> {
        const {
            maxRetries = 3,
            retryDelay = 1000,
            backoffMultiplier = 2,
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
                    const normalizedError = this.normalizeError(error, 'withRetry');
                    if (normalizedError instanceof RetryableError ||
                        (error instanceof MatrixError && error.httpStatus && error.httpStatus >= 500)) {
                        this.requestStats.retried++;
                        logger.warn(
                            `${this.constructor.name}: Retry attempt ${attempt + 1}/${maxRetries} after ${currentDelay}ms`,
                            error
                        );
                        await this.sleep(currentDelay);
                        currentDelay *= backoffMultiplier;
                        continue;
                    }
                }

                throw error;
            }
        }

        throw lastError;
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
    protected sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
