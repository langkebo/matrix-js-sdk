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
 * - 统一的 HTTP 请求通道 (`request()`) 含可注入的 Transport seam
 * - 重试逻辑（幂等方法默认开启，非幂等方法需显式声明）
 * - 错误归一化（MatrixError/HTTPError → SdkError 子类）
 * - 请求统计
 * - 日志记录
 */

import { TypedEventEmitter } from "../models/typed-event-emitter";
import { HTTPError, MatrixError, safeGetRetryAfterMs } from "../http-api/errors";
import type { QueryDict } from "../http-api/utils";
import type { Body, IRequestOpts } from "../http-api/interface";
import { Method } from "../http-api/method";
import { AdminPrefix, ClientPrefix } from "../http-api/prefix";
import { AuthError, NotFoundError, ApiError, SdkError, RetryableError, ValidationError } from "../errors";
import { logger } from "../logger";
import { MatrixClient } from "../client";

// ─── 公共类型 ────────────────────────────────────────────────

export interface RetryOptions {
    maxRetries?: number;
    retryDelay?: number;
    backoffMultiplier?: number;
    idempotent?: boolean;
    retryNonIdempotent?: boolean;
    label?: string;
    /** 抖动比例（0~1），用于避免重试风暴。0 = 无抖动。 */
    jitterRatio?: number;
}

export interface RequestStats {
    total: number;
    successful: number;
    failed: number;
    retried: number;
}

/**
 * `request()` 方法的参数对象。
 */
export interface RequestSpec {
    method: Method;
    path: string;
    prefix?: string;
    queryParams?: QueryDict;
    body?: unknown;
    retry?: RetryOptions;
    /** 用于日志和错误消息的标签，默认使用 `path` */
    label?: string;
    /**
     * 是否携带用户 access token。
     *
     * - `true`（默认）：走 `client.http.authedRequest`（经 transport）。
     * - `false`：走 `client.http.request`（不带 token），用于 federation
     *   查询等无需用户鉴权的端点。
     */
    authenticated?: boolean;
    /** 透传至 IRequestOpts.localTimeoutMs，用于长轮询请求（如 sliding sync） */
    localTimeoutMs?: number;
    /** 透传至 IRequestOpts.headers，用于自定义请求头（如媒体上传的 Content-Type） */
    headers?: Record<string, string>;
}

/**
 * Transport 请求选项：在 `IRequestOpts` 基础上扩展 `authenticated` 字段。
 *
 * `authenticated` 决定是否携带用户 access token：
 * - `true`（默认）：走 `client.http.authedRequest`（带 token）。
 * - `false`：走 `client.http.request`（不带 token），用于公共端点。
 */
export type TransportOpts = IRequestOpts & { authenticated?: boolean };

/**
 * HTTP 传输层接口。
 *
 * 生产环境默认适配 `client.http.authedRequest`，测试可注入 in-memory fake。
 *
 * `opts.authenticated`（默认 `true`）决定是否携带用户 access token。
 * 自定义 Transport 实现可忽略该字段；测试用的 FakeTransport 通常直接走单一通道。
 */
export interface Transport {
    request<T>(method: Method, path: string, queryParams?: QueryDict, body?: Body, opts?: TransportOpts): Promise<T>;
}

/**
 * Manager 构造选项，向后兼容 `RetryOptions`。
 */
export interface ManagerOpts extends RetryOptions {
    transport?: Transport;
    /** 默认 API 前缀，不传时 fallback 为 `ClientPrefix.V3` */
    defaultPrefix?: string;
}

// ─── BaseManager ──────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
export abstract class BaseManager<
    Events extends string = string,
    EventMap extends Record<Events, any> = Record<Events, any>,
> extends TypedEventEmitter<Events, EventMap> {
    /* eslint-enable @typescript-eslint/no-explicit-any */
    protected readonly client: MatrixClient;
    protected readonly transport: Transport;
    protected readonly defaultPrefix: string;
    protected retryOptions: RetryOptions;
    protected requestStats: RequestStats = {
        total: 0,
        successful: 0,
        failed: 0,
        retried: 0,
    };
    /**
     * 标记当前是否处于 `withRetry()` 调用链中。
     *
     * - `true`：`request()` 被外层 `withRetry()` 包装，此时 `request()` 只做单次调用，
     *   不重试、不写统计（由 `withRetry()` 统一负责），避免双重计数与嵌套重试。
     * - `false`：`request()` 被直接调用，自行负责重试与统计。
     */
    private _inWithRetry = false;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super();
        this.client = client;
        this.transport = opts?.transport ?? defaultHttpTransport(client);
        this.defaultPrefix = opts?.defaultPrefix ?? ClientPrefix.V3;
        this.retryOptions = {
            maxRetries: opts?.maxRetries ?? 3,
            retryDelay: opts?.retryDelay ?? 1000,
            backoffMultiplier: opts?.backoffMultiplier ?? 2,
            idempotent: opts?.idempotent ?? true,
            retryNonIdempotent: opts?.retryNonIdempotent ?? false,
            label: opts?.label,
        };
    }

    // ─── 核心：统一请求方法 ────────────────────────────────────

    /**
     * 发送 HTTP 请求，自动合并重试配置、错误归一化和请求统计。
     *
     * 当被 `withRetry()` 包装时（`_inWithRetry === true`），本方法退化为单次调用，
     * 重试与统计交由外层 `withRetry()` 统一负责，避免双重计数与嵌套重试。
     *
     * @example
     * const res = await this.request<IUserResponse>({
     *     method: Method.Get,
     *     path: "/users",
     *     prefix: ClientPrefix.V1,
     * });
     */
    protected async request<T>(spec: RequestSpec): Promise<T> {
        const label = spec.label ?? `${spec.method} ${spec.path}`;
        const prefix = spec.prefix ?? this.defaultPrefix;
        const authenticated = spec.authenticated !== false;

        const opts: TransportOpts = { prefix, authenticated };
        if (spec.localTimeoutMs !== undefined) {
            opts.localTimeoutMs = spec.localTimeoutMs;
        }
        if (spec.headers) {
            opts.headers = spec.headers;
        }

        // 被外层 withRetry 包装时：仅做单次调用，不重试、不写统计
        if (this._inWithRetry) {
            try {
                return await this.transport.request<T>(
                    spec.method,
                    spec.path,
                    spec.queryParams,
                    spec.body as Body | undefined,
                    opts,
                );
            } catch (error) {
                throw this.normalizeError(error, label);
            }
        }

        // 独立调用：自行负责重试与统计
        const isIdempotent = spec.method === Method.Get || spec.method === "HEAD";
        const mergedRetry: Required<Pick<RetryOptions, "maxRetries" | "retryDelay" | "backoffMultiplier">> &
            Pick<RetryOptions, "idempotent" | "retryNonIdempotent"> = {
            maxRetries: spec.retry?.maxRetries ?? this.retryOptions.maxRetries ?? 3,
            retryDelay: spec.retry?.retryDelay ?? this.retryOptions.retryDelay ?? 1000,
            backoffMultiplier: spec.retry?.backoffMultiplier ?? this.retryOptions.backoffMultiplier ?? 2,
            idempotent: spec.retry?.idempotent ?? isIdempotent,
            retryNonIdempotent: spec.retry?.retryNonIdempotent ?? this.retryOptions.retryNonIdempotent ?? false,
        };

        let lastError: unknown;
        let currentDelay = mergedRetry.retryDelay;

        for (let attempt = 0; attempt <= mergedRetry.maxRetries; attempt++) {
            try {
                this.requestStats.total++;
                const result = await this.transport.request<T>(
                    spec.method,
                    spec.path,
                    spec.queryParams,
                    spec.body as Body | undefined,
                    opts,
                );
                this.requestStats.successful++;
                return result;
            } catch (error) {
                lastError = error;
                this.requestStats.failed++;

                if (attempt < mergedRetry.maxRetries) {
                    const canRetry = mergedRetry.idempotent || mergedRetry.retryNonIdempotent;
                    const normalized = this.normalizeError(error, label);
                    const isRetryableErr =
                        normalized instanceof RetryableError ||
                        (error instanceof HTTPError && typeof error.httpStatus === "number" && error.httpStatus >= 500);

                    if (canRetry && isRetryableErr) {
                        this.requestStats.retried++;
                        let delay = currentDelay;
                        if (error instanceof HTTPError && error.isRateLimitError()) {
                            delay = safeGetRetryAfterMs(error, currentDelay);
                        }
                        logger.warn(
                            `${this.constructor.name}.${label}: Retry attempt ${attempt + 1}/${mergedRetry.maxRetries} after ${delay}ms`,
                            error,
                        );
                        await this.sleep(delay);
                        currentDelay *= mergedRetry.backoffMultiplier;
                        continue;
                    }
                }

                throw this.normalizeError(error, label);
            }
        }

        throw this.normalizeError(lastError, label);
    }

    // ─── 向后兼容 — admin 请求快捷方法 ───────────────────────────

    /**
     * @deprecated 请使用 `this.request({ method, path, prefix: AdminPrefix.V1 })` 替代。
     */
    protected async adminRequest<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, string | string[]>,
        body?: object,
        label?: string,
    ): Promise<T> {
        return this.request<T>({
            method,
            path,
            prefix: AdminPrefix.V1,
            queryParams,
            body: body ?? undefined,
            label,
        });
    }

    // ─── 错误归一化 ─────────────────────────────────────────────

    protected normalizeError(error: unknown, method: string): SdkError {
        const managerName = this.constructor.name;
        const err = error as Error;
        const plain = error as Record<string, unknown>; /* Dynamic: error shape varies by source */
        const httpStatus = plain?.httpStatus as number | undefined;
        const errcode = plain?.errcode as string | undefined;
        const code = plain?.code as string | undefined;

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

    // ─── 重试 & 统计（向后兼容） ─────────────────────────────────

    public setRetryOptions(options: RetryOptions): void {
        this.retryOptions = { ...this.retryOptions, ...options };
    }

    protected async withRetry<T>(fn: () => Promise<T>, optionsOrLabel: RetryOptions | string = {}): Promise<T> {
        const options = typeof optionsOrLabel === "string" ? {} : optionsOrLabel;
        const label = typeof optionsOrLabel === "string" ? optionsOrLabel : (options.label ?? "withRetry");

        const maxRetries = options.maxRetries ?? this.retryOptions.maxRetries ?? 3;
        const retryDelay = options.retryDelay ?? this.retryOptions.retryDelay ?? 1000;
        const backoffMultiplier = options.backoffMultiplier ?? this.retryOptions.backoffMultiplier ?? 2;
        const jitterRatio = options.jitterRatio ?? this.retryOptions.jitterRatio ?? 0;
        const idempotent = options.idempotent ?? this.retryOptions.idempotent ?? true;

        let lastError: unknown;
        let currentDelay = retryDelay;

        // 标记进入 withRetry：内部 request() 将退化为单次调用，避免双重计数与嵌套重试
        const prevFlag = this._inWithRetry;
        this._inWithRetry = true;
        try {
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
                        const normalized = this.normalizeError(error, label);
                        const isRetryableErr =
                            normalized instanceof RetryableError ||
                            (error instanceof HTTPError &&
                                typeof error.httpStatus === "number" &&
                                error.httpStatus >= 500);

                        if (idempotent && isRetryableErr) {
                            this.requestStats.retried++;
                            let delay = currentDelay;
                            if (error instanceof HTTPError && error.isRateLimitError()) {
                                delay = safeGetRetryAfterMs(error, currentDelay);
                            }
                            if (jitterRatio > 0) {
                                const jitter = delay * jitterRatio * (Math.random() * 2 - 1);
                                delay = Math.max(0, delay + jitter);
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
        } finally {
            this._inWithRetry = prevFlag;
        }
    }

    public getRequestStats(): RequestStats {
        return { ...this.requestStats };
    }

    public resetRequestStats(): void {
        this.requestStats = {
            total: 0,
            successful: 0,
            failed: 0,
            retried: 0,
        };
    }

    // ─── 验证 helper ────────────────────────────────────────────

    protected sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

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
}

// ─── 默认 HTTP 传输 ────────────────────────────────────────────

function defaultHttpTransport(client: MatrixClient): Transport {
    return {
        request<T>(
            method: Method,
            path: string,
            queryParams?: QueryDict,
            body?: Body,
            opts?: TransportOpts,
        ): Promise<T> {
            const { authenticated, ...httpOpts } = opts ?? {};
            if (authenticated === false) {
                return client.http.request<T>(method, path, queryParams, body, httpOpts);
            }
            return client.http.authedRequest<T>(method, path, queryParams, body, httpOpts ?? {});
        },
    };
}
