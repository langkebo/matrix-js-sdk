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
 * To-Device Manager - 设备消息管理
 * 
 * 提供设备间消息发送功能
 * 对应后端: synapse-rust/src/web/routes/e2ee_routes.rs
 * 
 * 后端端点:
 * - PUT /sendToDevice/{event_type}/{transaction_id}
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { MatrixError } from "../http-api/errors.ts";
import { AuthError, ApiError, SdkError } from "../errors.ts";
import { logger } from "../logger.ts";

export interface ToDeviceMessage {
    [userId: string]: {
        [deviceId: string]: Record<string, unknown>;
    };
}

export interface ToDeviceBatch {
    eventType: string;
    batch: ToDeviceMessage;
}

export interface ToDeviceResult {
    success: boolean;
    failures?: Record<string, Record<string, { error: string }>>;
}

export class ToDeviceManager {
    private client: MatrixClient;
    private txnId = 0;
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
    }

    /**
     * 发送设备间消息
     * PUT /_matrix/client/v3/sendToDevice/{event_type}/{txnId}
     */
    async sendToDevice(
        eventType: string,
        messages: ToDeviceMessage,
        txnId?: string
    ): Promise<ToDeviceResult> {
        const transactionId = txnId ?? this.makeTxnId();

        try {
            const result = await this.withRetry(async () => {
                return await this.client.http.authedRequest<ToDeviceResult>(
                    Method.Put,
                    `/sendToDevice/${encodeURIComponent(eventType)}/${encodeURIComponent(transactionId)}`,
                    undefined,
                    { messages },
                    { prefix: ClientPrefix.V3 }
                );
            }, "sendToDevice");

            return result;
        } catch (error) {
            throw this.normalizeError(error, "sendToDevice");
        }
    }

    /**
     * 批量发送设备间消息
     */
    async sendBatchToDevice(batch: ToDeviceBatch[]): Promise<ToDeviceResult[]> {
        const results: ToDeviceResult[] = [];

        for (const item of batch) {
            try {
                const result = await this.sendToDevice(item.eventType, item.batch);
                results.push(result);
            } catch (error) {
                results.push({
                    success: false,
                    failures: {
                        "_batch": {
                            "_error": { error: error instanceof Error ? error.message : String(error) }
                        }
                    }
                });
            }
        }

        return results;
    }

    /**
     * 发送加密的设备间消息
     */
    async sendEncryptedToDevice(
        eventType: string,
        encryptedMessages: ToDeviceMessage,
        txnId?: string
    ): Promise<ToDeviceResult> {
        return this.sendToDevice(eventType, encryptedMessages, txnId);
    }

    private makeTxnId(): string {
        return `mjs${Date.now()}${this.txnId++}`;
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
                    logger.info(`ToDeviceManager.${method} succeeded after ${attempt} retries`, {
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
                    logger.warn(`ToDeviceManager.${method} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms`, {
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
                return new AuthError(`ToDeviceManager.${method} failed: ${err?.message ?? 'Unknown error'}`, error);
            }
            return new ApiError(`ToDeviceManager.${method} failed: ${err?.message ?? 'Unknown error'}`, error.errcode ?? 'UNKNOWN', error.httpStatus ?? 0, error);
        }
        return new ApiError(`ToDeviceManager.${method} failed: ${err?.message ?? String(error)}`, 'UNKNOWN', 0, error);
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
        getToDeviceManager(): ToDeviceManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getToDeviceManager = function (): ToDeviceManager {
        return new ToDeviceManager(this);
    };
}

export default extendMatrixClient;
