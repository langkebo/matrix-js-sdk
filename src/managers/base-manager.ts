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
import { ConnectionError, HTTPError, MatrixError, safeGetRetryAfterMs } from "../http-api/errors";
import type { QueryDict } from "../http-api/utils";
import type { Body, IRequestOpts } from "../http-api/interface";
import { Method } from "../http-api/method";
import { AdminPrefix, ClientPrefix } from "../http-api/prefix";
import { AuthError, NotFoundError, ApiError, SdkError, RetryableError, TimeoutError, ValidationError } from "../errors";
import { logger } from "../logger";
import { MatrixClient } from "../client";
import type { MatrixClientInternalMethods } from "../matrix-client-extensions";
import { extractNumber, extractString, hasTimeoutCode } from "../utils/type-guards";

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
    /** 透传至 IRequestOpts.abortSignal，用于取消请求（如 sliding sync 重发） */
    abortSignal?: AbortSignal;
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
     * 当前处于 `withRetry()` 调用链中的深度（并发安全计数器）。
     *
     * Managers 通常是单例，多个并发 `withRetry()` 调用会共享同一实例。使用布尔标志
     * 会在某个调用先结束时被重置为 `false`，导致其它在途调用中的 `request()` 误判
     * 为「未处于 withRetry」从而自行重试并写入统计，造成双重计数与嵌套重试
     * （见 FT-115）。改为深度计数器后，只要仍有任一 `withRetry()` 在途，
     * `request()` 就保持单次调用模式，全部退出后才恢复独立重试+统计。
     *
     * - `> 0`：`request()` 被外层 `withRetry()` 包装，只做单次调用，不重试、不写统计
     *   （由 `withRetry()` 统一负责），避免双重计数与嵌套重试。
     * - `0`：`request()` 被直接调用，自行负责重试与统计。
     */
    private _withRetryDepth = 0;

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

    // ─── 内部客户端访问（单点类型断言） ──────────────────────────
    /**
     * 将 `this.client` 类型断言为 `MatrixClient & MatrixClientInternalMethods`，
     * 使 Manager 可通过 `this.internalClient.xxx` 类型安全地访问 MatrixClient
     * 内部成员（syncApi、turnServers、serverClockDiff 等）。
     *
     * 这是整个 SDK 中唯一的 `as unknown as` 断言点（针对内部成员访问），
     * 替代了先前散落在各 Manager 中的 45 处类型断言。
     */
    protected get internalClient(): MatrixClient & MatrixClientInternalMethods {
        return this.client as unknown as MatrixClient & MatrixClientInternalMethods;
    }

    // ─── 核心：统一请求方法 ────────────────────────────────────

    /**
     * 发送 HTTP 请求，自动合并重试配置、错误归一化和请求统计。
     *
     * 当被 `withRetry()` 包装时（`_withRetryDepth > 0`），本方法退化为单次调用，
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
        if (spec.abortSignal) {
            opts.abortSignal = spec.abortSignal;
        }

        // 被外层 withRetry 包装时：仅做单次调用，不重试、不写统计
        if (this._withRetryDepth > 0) {
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
            Pick<RetryOptions, "idempotent" | "retryNonIdempotent" | "jitterRatio"> = {
            maxRetries: spec.retry?.maxRetries ?? this.retryOptions.maxRetries ?? 3,
            retryDelay: spec.retry?.retryDelay ?? this.retryOptions.retryDelay ?? 1000,
            backoffMultiplier: spec.retry?.backoffMultiplier ?? this.retryOptions.backoffMultiplier ?? 2,
            idempotent: spec.retry?.idempotent ?? isIdempotent,
            retryNonIdempotent: spec.retry?.retryNonIdempotent ?? this.retryOptions.retryNonIdempotent ?? false,
            jitterRatio: spec.retry?.jitterRatio ?? this.retryOptions.jitterRatio ?? 0,
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
                        const delay = this.computeRetryDelay(
                            currentDelay,
                            error,
                            normalized,
                            mergedRetry.jitterRatio ?? 0,
                        );
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

    // ─── P1 优化：统一前缀处理入口 ──────────────────────────────

    /**
     * 已知的 Matrix 前缀列表（按从长到短排序，避免短前缀误匹配）。
     *
     * 包含 C-S API 的所有标准版本前缀，以及 Admin/Media/Federation 命名空间。
     * 该列表是 SDK 的运行时前缀注册表——`authedRequestWithPrefix` 会按此列表
     * 剥离传入路径的前缀，并把剥离下来的前缀透传给 transport 层。
     *
     * P1 优化：替代前端 `MatrixHttpClient.ts` 中的 `stripMatrixPrefix` 手动逻辑。
     */
    protected static readonly KNOWN_PREFIXES: readonly string[] = [
        // 客户端 API
        "/_matrix/client/unstable/org.matrix.msc3575",
        "/_matrix/client/unstable/org.matrix.simplified_msc3575",
        "/_matrix/client/unstable/org.matrix.msc4186",
        "/_matrix/client/v4",
        "/_matrix/client/v3",
        "/_matrix/client/v1",
        "/_matrix/client/r0",
        "/_matrix/client",
        // Admin / Worker
        "/_synapse/worker",
        "/_synapse/admin/v2",
        "/_synapse/admin/v1",
        // Media
        "/_matrix/media/v3",
        "/_matrix/media/v1",
        "/_matrix/media/r0",
        "/_matrix/media",
        // Federation
        "/_matrix/federation/v2",
        "/_matrix/federation/v1",
        "/_matrix/key/v2",
        // Vendor
        "/_matrix/vendor/v1",
        // Identity
        "/_matrix/identity/v2",
    ] as const;

    /**
     * 从完整路径中剥离已知前缀，返回短路径和需要显式设置的 prefix。
     *
     * 若路径不含任何已知前缀，返回原路径（使用默认前缀 ClientPrefix.V3）。
     * 若路径仅由前缀组成（不包含具体子路径），返回 "/"。
     *
     * @example
     * _splitPrefix("/_matrix/client/v3/rooms") → { cleanPath: "/rooms", prefix: "/_matrix/client/v3" }
     * _splitPrefix("/rooms") → { cleanPath: "/rooms", prefix: undefined }
     * _splitPrefix("/_matrix/client/v3") → { cleanPath: "/", prefix: "/_matrix/client/v3" }
     */
    protected _splitPrefix(path: string): { cleanPath: string; prefix?: string } {
        for (const prefix of BaseManager.KNOWN_PREFIXES) {
            if (path === prefix) {
                return { cleanPath: "/", prefix };
            }
            if (path.startsWith(prefix + "/")) {
                return {
                    cleanPath: path.slice(prefix.length),
                    prefix,
                };
            }
        }
        // 路径不含已知前缀，使用默认行为（不加 prefix 选项，由 transport 自行决定）
        return { cleanPath: path };
    }

    /**
     * 带前缀的认证请求：自动剥离路径中已包含的 Matrix 前缀，避免双前缀拼接到 404。
     *
     * P1 优化：替代前端 `MatrixHttpClient.ts` 的 `stripMatrixPrefix + authedRequest` 两步调用，
     * 统一在 SDK 层处理所有已知前缀。调用方可直接传完整路径，无需关心 SDK 默认前缀。
     *
     * @param method - HTTP 方法
     * @param path - 完整路径（可能含 `/_matrix/client/v3` 等前缀）
     * @param queryParams - 查询参数
     * @param body - 请求体
     * @param opts - 透传至 IRequestOpts
     *
     * @example
     * // 两种调用方式等价:
     * await this.authedRequestWithPrefix('GET', '/_matrix/client/v3/rooms')
     * await this.authedRequestWithPrefix('GET', '/rooms')
     *
     * @example
     * // 跨命名空间调用（自动识别非默认前缀）:
     * await this.authedRequestWithPrefix('GET', '/_synapse/admin/v1/users')
     * await this.authedRequestWithPrefix('GET', '/_matrix/federation/v1/version')
     */
    public async authedRequestWithPrefix<T>(
        method: Method,
        path: string,
        queryParams?: QueryDict,
        body?: Body,
        opts?: IRequestOpts,
    ): Promise<T> {
        const { cleanPath, prefix } = this._splitPrefix(path);
        const mergedOpts: IRequestOpts = { ...(opts ?? {}) };
        if (prefix !== undefined) {
            mergedOpts.prefix = prefix;
        }
        return this.request<T>({
            method,
            path: cleanPath,
            queryParams,
            body,
            prefix: prefix ?? this.defaultPrefix,
            label: opts ? `${method} ${path}` : `${method} ${cleanPath}`,
        });
    }

    // ─── 错误归一化 ─────────────────────────────────────────────

    protected normalizeError(error: unknown, method: string): SdkError {
        const managerName = this.constructor.name;
        const err = error as Error;
        const plain = error as Record<string, unknown>; /* Dynamic: error shape varies by source */
        const httpStatus = extractNumber(plain, "httpStatus");
        const errcode = extractString(plain, "errcode");
        const code = extractString(plain, "code");

        if (error instanceof SdkError) {
            return error;
        }

        // P3 优化：在按 status code 分流之前，先识别 timeout / AbortError 这类
        // 跨 status code 的错误（HTTP 408 不一定由 server 返回，可能是 fetch AbortController 触发）。
        if (hasTimeoutCode(error) || code === "ABORT" || err?.name === "AbortError") {
            const timeoutMs = extractNumber(plain, "timeoutMs") ?? extractNumber(plain, "timeout");
            return new TimeoutError(
                `${managerName}.${method} timed out${timeoutMs ? ` after ${timeoutMs}ms` : ""}: ${err?.message ?? "Request timeout"}`,
                { timeoutMs, causeCode: code, cause: error },
            );
        }

        if (error instanceof MatrixError) {
            if (error.httpStatus === 401 || error.errcode === "M_UNKNOWN_TOKEN") {
                return new AuthError(`${managerName}.${method} failed: ${err?.message ?? "Unknown error"}`, error);
            }
            if (error.httpStatus === 404 || error.errcode === "M_NOT_FOUND") {
                return new NotFoundError(`${managerName}.${method} failed: ${err?.message ?? "Unknown error"}`, error);
            }
            if (error.httpStatus === 408) {
                return new TimeoutError(
                    `${managerName}.${method} failed: ${err?.message ?? "Server-side request timeout"}`,
                    { causeCode: errcode ?? "M_TIMEOUT", cause: error },
                );
            }
            if (error.httpStatus === 422 || error.errcode === "M_INVALID_PARAM_VALUE" || error.errcode === "M_BAD_JSON") {
                return new ValidationError(
                    `${managerName}.${method} failed: ${err?.message ?? "Invalid request payload"}`,
                    error,
                );
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
            if (error.httpStatus === 408) {
                return new TimeoutError(
                    `${managerName}.${method} failed: ${err?.message ?? "Request timeout"}`,
                    { causeCode: "M_TIMEOUT", cause: error },
                );
            }
            if (error.httpStatus === 422) {
                return new ValidationError(
                    `${managerName}.${method} failed: ${err?.message ?? "Invalid request payload"}`,
                    error,
                );
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

        // ISSUE-10b: ConnectionError (CORS / timeout / network down) is transient —
        // convert to RetryableError so withRetry's isRetryableErr check picks it
        // up automatically. Combined with ISSUE-03 txnId reuse, retries on flaky
        // networks no longer produce duplicate messages.
        if (error instanceof ConnectionError) {
            return new RetryableError(
                `${managerName}.${method} failed: ${err?.message ?? "Connection error"}`,
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
        if (httpStatus === 408) {
            return new TimeoutError(
                `${managerName}.${method} failed: ${err?.message ?? "Request timeout"}`,
                { causeCode: code ?? errcode, cause: error },
            );
        }
        if (httpStatus === 422 || errcode === "M_INVALID_PARAM_VALUE" || errcode === "M_BAD_JSON") {
            return new ValidationError(
                `${managerName}.${method} failed: ${err?.message ?? "Invalid request payload"}`,
                error,
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
        const retryNonIdempotent = options.retryNonIdempotent ?? this.retryOptions.retryNonIdempotent ?? false;

        let lastError: unknown;
        let currentDelay = retryDelay;

        // 标记进入 withRetry：内部 request() 将退化为单次调用，避免双重计数与嵌套重试。
        // 使用深度计数器而非布尔标志，确保并发 withRetry() 调用互不干扰（FT-115）：
        // 任一调用先结束只会把深度减 1，不会让其它在途调用误判为「已离开 withRetry」。
        this._withRetryDepth++;
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

                        if ((idempotent || retryNonIdempotent) && isRetryableErr) {
                            this.requestStats.retried++;
                            const delay = this.computeRetryDelay(currentDelay, error, normalized, jitterRatio);
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
            this._withRetryDepth--;
        }
    }

    /**
     * 清理 manager 持有的资源（监听器、定时器等）。
     *
     * 默认 no-op。子类按需 override——在 `client.stop()` 时由
     * `stopClientLifecycleServices` 统一遍历调用。
     */
    public stop(): void {}

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

    // ─── 重试延迟计算（request/withRetry 共享） ─────────────────

    /**
     * 计算单次重试延迟：基础退避 → 限流覆盖 → 抖动。
     *
     * 提取自 `request()` 与 `withRetry()` 的公共逻辑，确保两条重试路径在
     * 限流 `Retry-After` 覆盖与抖动（`jitterRatio`）行为上保持一致。
     */
    private computeRetryDelay(baseDelay: number, error: unknown, normalized: SdkError, jitterRatio: number): number {
        let delay = baseDelay;
        // Prefer the normalized SdkError path (post-normalizeError),
        // fall back to raw HTTPError for pre-normalize edge cases.
        if (normalized instanceof RetryableError && normalized.isRateLimitError()) {
            delay = normalized.retryAfter ?? baseDelay;
        } else if (error instanceof HTTPError && error.isRateLimitError()) {
            delay = safeGetRetryAfterMs(error, baseDelay);
        }
        if (jitterRatio > 0) {
            const jitter = delay * jitterRatio * (Math.random() * 2 - 1);
            delay = Math.max(0, delay + jitter);
        }
        return delay;
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
