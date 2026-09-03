/*
Copyright 2022 The Matrix.org Foundation C.I.C.

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

import type { IAuthData } from "./interactive-auth";
import { extractNumber, extractString, extractNested, extractHeader } from "./utils/type-guards";

/**
 * Shape of an unknown error cause object when extracting fields.
 * Used by error-class constructors to inspect nested error data from
 * various sources (HTTP responses, native errors, etc.).
 *
 * @deprecated P2 优化：使用 `extractNumber` / `extractString` / `extractNested` /
 * `extractHeader` 替代直接 cast 为 `Record<string, unknown>`。保留此类型仅为
 * 兼容尚未迁移到 `type-guards.ts` 的代码。
 */
type ErrorCauseObject = Record<string, unknown>; /* Dynamic: error cause shape is unknown */

export enum InvalidCryptoStoreState {
    TooNew = "TOO_NEW",
}

// Type-safe helpers to extract fields from unknown error causes without `as any`
// P2 优化：这些 helpers 已迁移到 utils/type-guards.ts，下面保留为 thin re-export 以
// 维持向后兼容（部分第三方代码可能仍在 import 这些内部 helpers）。
function extractStringField(cause: unknown, field: string): string | undefined {
    return extractString(cause, field);
}

function extractNumberField(cause: unknown, field: string): number | undefined {
    return extractNumber(cause, field);
}

function extractNestedField(cause: unknown, parentField: string, childField: string): unknown {
    return extractNested(cause, parentField, childField);
}

function extractHeaderField(cause: unknown, headerName: string): string | undefined {
    return extractHeader(cause, headerName);
}

export class InvalidCryptoStoreError extends Error {
    public static TOO_NEW = InvalidCryptoStoreState.TooNew;

    public constructor(public readonly reason: InvalidCryptoStoreState) {
        const message =
            `Crypto store is invalid because ${reason}, ` +
            `please stop the client, delete all data and start the client again`;
        super(message);
        this.name = "InvalidCryptoStoreError";
    }
}

export class KeySignatureUploadError extends Error {
    public constructor(
        message: string,
        public readonly value: unknown,
    ) {
        super(message);
    }
}

export class ClientStoppedError extends Error {
    public constructor() {
        super("MatrixClient has been stopped");
    }
}

export class UnsupportedDelayedEventsEndpointError extends Error {
    public constructor(
        message: string,
        public clientEndpoint:
            | "sendDelayedEvent"
            | "updateDelayedEvent"
            | "cancelScheduledDelayedEvent"
            | "restartScheduledDelayedEvent"
            | "sendScheduledDelayedEvent"
            | "sendDelayedStateEvent"
            | "getDelayedEvents",
    ) {
        super(message);
        this.name = "UnsupportedDelayedEventsEndpointError";
    }
}

export class UnsupportedStickyEventsEndpointError extends Error {
    public constructor(
        message: string,
        public clientEndpoint: "sendStickyEvent" | "sendStickyStateEvent",
    ) {
        super(message);
        this.name = "UnsupportedStickyEventsEndpointError";
    }
}

/**
 * Base class for SDK errors - D7 Compliant
 */
export class SdkError extends Error {
    public readonly errorCode?: string;
    public readonly traceId?: string;
    public readonly userTip?: string;
    public readonly retryAfter?: number;
    public readonly isRetryable: boolean;
    public readonly statusCode: number;

    public constructor(
        message: string,
        options: {
            errorCode?: string;
            traceId?: string;
            userTip?: string;
            retryAfter?: number;
            isRetryable?: boolean;
            statusCode?: number;
            cause?: unknown;
        } = {},
    ) {
        super(message);
        this.name = this.constructor.name;
        this.errorCode = options.errorCode;
        this.traceId = options.traceId;
        this.userTip = options.userTip;
        this.retryAfter = options.retryAfter;
        this.isRetryable = options.isRetryable ?? false;
        this.statusCode = options.statusCode ?? 0;
        // Use Object.defineProperty for 'cause' to avoid ES5 class field limitations
        // and maintain compatibility with Error.cause (ES2022)
        if (options.cause !== undefined) {
            Object.defineProperty(this, "cause", { value: options.cause, enumerable: false, writable: true });
        }

        // Legacy compatibility aliases
        Object.defineProperty(this, "code", { value: this.errorCode, enumerable: false, writable: true });
        Object.defineProperty(this, "httpStatus", { value: this.statusCode, enumerable: false, writable: true });
        Object.defineProperty(this, "errcode", { value: this.errorCode, enumerable: false, writable: true });
    }
}

export class AuthError extends SdkError {
    public constructor(message: string, cause?: unknown) {
        const errcode = extractStringField(cause, "errcode") || "AUTH_ERROR";
        const httpStatus = extractNumberField(cause, "httpStatus") || 401;
        super(message, {
            errorCode: errcode,
            statusCode: httpStatus,
            cause,
        });
    }
}

export class UIAError extends SdkError {
    public readonly data: IAuthData;

    public constructor(data: IAuthData, cause?: unknown) {
        const message = typeof data.error === "string" ? data.error : "User-Interactive Authentication required";
        super(message, {
            errorCode: "M_UIA_REQUIRED",
            statusCode: 401,
            cause,
        });
        this.name = "UIAError";
        this.data = data;
    }
}

export class NotFoundError extends SdkError {
    public constructor(message: string, cause?: unknown) {
        const errcode = extractStringField(cause, "errcode") || "NOT_FOUND";
        const httpStatus = extractNumberField(cause, "httpStatus") || 404;
        super(message, {
            errorCode: errcode,
            statusCode: httpStatus,
            cause,
        });
    }
}

export class RetryableError extends SdkError {
    public constructor(message: string, cause?: unknown) {
        const errcode = extractStringField(cause, "errcode") || "RETRYABLE";
        const httpStatus = extractNumberField(cause, "httpStatus") || 500;
        const retryAfter =
            extractNumberField(cause, "retryAfter") ||
            (extractNestedField(cause, "data", "retry_after_ms") as number | undefined);
        const traceId = extractHeaderField(cause, "x-trace-id");

        super(message, {
            errorCode: errcode,
            statusCode: httpStatus,
            retryAfter,
            traceId,
            isRetryable: true,
            cause,
        });
    }

    /**
     * Check if this error was due to rate-limiting on the server side.
     *
     * Mirrors {@link HTTPError.isRateLimitError} for unified error handling
     * after {@link BaseManager.normalizeError} converts HTTPError to SdkError.
     *
     * @returns Whether this error is due to rate-limiting (HTTP 429 or M_LIMIT_EXCEEDED).
     */
    public isRateLimitError(): boolean {
        return this.statusCode === 429 || this.errorCode === "M_LIMIT_EXCEEDED";
    }
}

export class ApiError extends SdkError {
    public constructor(message: string, errorCode: string = "API_ERROR", statusCode: number = 0, cause?: unknown) {
        super(message, {
            errorCode,
            statusCode,
            cause,
        });
    }
}

export class ValidationError extends SdkError {
    public constructor(message: string, cause?: unknown) {
        super(message, {
            errorCode: "VALIDATION_ERROR",
            statusCode: 400,
            cause,
        });
    }
}

/**
 * Invalid parameter error.
 *
 * Kept as a distinct class for API ergonomics, but extends {@link ValidationError}
 * so generic validation callers and `instanceof ValidationError` checks continue
 * to work after the 2026 validator unification.
 */
export class InvalidParamError extends ValidationError {
    public constructor(message: string, cause?: unknown) {
        super(message, cause);
        this.name = "InvalidParamError";
    }
}

/**
 * Timeout error - raised when a network request exceeds its deadline.
 *
 * P3 优化：与 {@link RetryableError} 不同，超时错误默认是**可重试**的，
 * 但调用方通常希望走"短延时重试 + 用户可观察"的路径，而非常规重试策略。
 *
 * 用于映射以下场景：
 * - `AbortController` 触发的请求取消（`AbortError`）
 * - Node.js `ETIMEDOUT` / `ESOCKETTIMEDOUT` / `ETIME` 错误码
 * - HTTP 408（Request Timeout）
 *
 * @example
 * ```ts
 * try {
 *   await manager.request({ method: Method.Get, path: "/rooms/123" });
 * } catch (error: unknown) {
 *   if (error instanceof TimeoutError) {
 *     console.warn(`Request timed out after ${error.timeoutMs}ms`);
 *   }
 * }
 * ```
 */
export class TimeoutError extends SdkError {
    public readonly timeoutMs: number;
    public readonly causeCode?: string;

    public constructor(message: string, options: { timeoutMs?: number; causeCode?: string; cause?: unknown } = {}) {
        super(message, {
            errorCode: "TIMEOUT",
            statusCode: 408,
            isRetryable: true,
            cause: options.cause,
        });
        this.name = "TimeoutError";
        this.timeoutMs = options.timeoutMs ?? 0;
        this.causeCode = options.causeCode;
    }

    /**
     * Check whether this timeout was triggered by an explicit AbortController call
     * (i.e. user cancellation rather than a network-level deadline).
     */
    public isUserCancelled(): boolean {
        return this.causeCode === "ABORT" || this.causeCode === "AbortError";
    }
}
