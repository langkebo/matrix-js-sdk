/*
Copyright 2026 HuLa/Tjg IM Project

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
 * Type guard utilities for safe runtime type narrowing.
 *
 * P2 优化：为 `unknown` / `Record<string, unknown>` 类型提供安全的属性访问，
 * 减少对 `as any` 的依赖，提升类型安全性。
 */

import { MatrixError, HTTPError } from "../http-api/errors";
import { SdkError } from "../errors";

// ─── 基础对象 guards ──────────────────────────────────────────

/**
 * Narrow a value to `Record<string, unknown>` if it is a non-null object.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object";
}

/**
 * Narrow a value to `Array<unknown>` if it is an array.
 */
export function isArray(value: unknown): value is Array<unknown> {
    return Array.isArray(value);
}

/**
 * Check whether an object has a property of the given name.
 * Unlike `"key" in obj`, this also narrows the type when `K` is a literal.
 *
 * @example
 * ```ts
 * const result = hasProperty(response, "errcode")
 *   ? response.errcode  // type: string | undefined
 *   : undefined;
 * ```
 */
export function hasProperty<T extends Record<string, unknown>, K extends string>(
    obj: T,
    key: K,
): obj is T & Record<K, unknown> {
    return key in obj;
}

// ─── Error guards ─────────────────────────────────────────────

/**
 * Check whether `error` is an SDK error (SdkError subclass).
 * Useful for catching SDK errors in generic `catch (error: unknown)` blocks.
 *
 * @example
 * ```ts
 * try {
 *   await room.sendEvent(content);
 * } catch (error: unknown) {
 *   if (isSdkError(error)) {
 *     console.error(error.errorCode, error.statusCode);
 *   }
 * }
 * ```
 */
export function isSdkError(error: unknown): error is SdkError {
    return error instanceof SdkError;
}

/**
 * Check whether `error` is a MatrixError.
 * MatrixError wraps Matrix protocol error responses (HTTP 200 with errcode body).
 *
 * @example
 * ```ts
 * if (isMatrixError(error) && error.errcode === "M_FORBIDDEN") {
 *   // handle forbidden
 * }
 * ```
 */
export function isMatrixError(error: unknown): error is MatrixError {
    return error instanceof MatrixError;
}

/**
 * Check whether `error` is an HTTPError.
 * HTTPError wraps raw HTTP failures (non-2xx status codes).
 */
export function isHTTPError(error: unknown): error is HTTPError {
    return error instanceof HTTPError;
}

// ─── Error cause guards ────────────────────────────────────────

/**
 * Extract a named string field from an unknown error cause.
 * Returns `undefined` if the field is missing or not a string.
 *
 * @param cause - The error cause (e.g. `error.cause`)
 * @param field - The field name to extract
 *
 * @example
 * ```ts
 * const errcode = extractString(cause, "errcode");
 * // errcode: string | undefined
 * ```
 */
export function extractString(cause: unknown, field: string): string | undefined {
    if (isObject(cause) && hasProperty(cause, field)) {
        const value = cause[field];
        return typeof value === "string" ? value : undefined;
    }
    return undefined;
}

/**
 * Extract a named number field from an unknown error cause.
 * Returns `undefined` if the field is missing or not a number.
 */
export function extractNumber(cause: unknown, field: string): number | undefined {
    if (isObject(cause) && hasProperty(cause, field)) {
        const value = cause[field];
        return typeof value === "number" ? value : undefined;
    }
    return undefined;
}

/**
 * Extract a nested field `parent.child` from an unknown error cause.
 * Returns `undefined` if either level is missing or not an object.
 *
 * @example
 * ```ts
 * const retryAfter = extractNested(cause, "data", "retry_after_ms");
 * ```
 */
export function extractNested(cause: unknown, parent: string, child: string): unknown {
    if (isObject(cause) && hasProperty(cause, parent)) {
        const parentValue = cause[parent];
        if (isObject(parentValue) && hasProperty(parentValue, child)) {
            return parentValue[child];
        }
    }
    return undefined;
}

/**
 * Extract a header value from an error cause that carries `httpHeaders`.
 * Handles both browser `Headers` objects and plain `{ get(name: string): string | null }`.
 */
export function extractHeader(cause: unknown, headerName: string): string | undefined {
    if (!isObject(cause) || !hasProperty(cause, "httpHeaders")) {
        return undefined;
    }
    const headers = cause.httpHeaders;
    if (typeof headers !== "object" || headers === null) {
        return undefined;
    }
    if ("get" in headers) {
        return (headers as { get: (name: string) => string | null }).get(headerName) ?? undefined;
    }
    return undefined;
}

// ─── SdkError subclass guards ──────────────────────────────────

/**
 * Type predicate narrowing to `RetryableError` — used for retry policy checks.
 *
 * @example
 * ```ts
 * if (isRetryableError(error)) {
 *   console.log(`Retryable: ${error.retryAfter}ms`);
 * }
 * ```
 */
// Lazy import to avoid circular dependency — import lazily inside the guard
export function isRetryableError(error: unknown): error is import("../errors").RetryableError {
    const cls = error?.constructor as { name?: string } | undefined;
    return cls?.name === "RetryableError";
}

/**
 * Type predicate narrowing to `TimeoutError` — used for timeout-specific handling.
 */
export function isTimeoutError(error: unknown): error is import("../errors").TimeoutError {
    const cls = error?.constructor as { name?: string } | undefined;
    return cls?.name === "TimeoutError";
}

/**
 * Type predicate narrowing to `ValidationError` — used for input validation handling.
 */
export function isValidationError(error: unknown): error is import("../errors").ValidationError {
    const cls = error?.constructor as { name?: string } | undefined;
    return cls?.name === "ValidationError" || cls?.name === "InvalidParamError";
}

/**
 * Type predicate narrowing to `AuthError` — used for auth-specific handling.
 */
export function isAuthError(error: unknown): error is import("../errors").AuthError {
    const cls = error?.constructor as { name?: string } | undefined;
    return cls?.name === "AuthError";
}

/**
 * Type predicate narrowing to `NotFoundError` — used for 404 handling.
 */
export function isNotFoundError(error: unknown): error is import("../errors").NotFoundError {
    const cls = error?.constructor as { name?: string } | undefined;
    return cls?.name === "NotFoundError";
}

// ─── Network error code guards ─────────────────────────────────

/**
 * Known Node.js / fetch network error codes that indicate a timeout.
 * See: https://nodejs.org/api/errors.html#common-system-errors
 */
const TIMEOUT_ERROR_CODES = new Set([
    "ETIMEDOUT",      // Connection timed out
    "ECONNRESET",     // Connection reset by peer (often timeout-related)
    "ESOCKETTIMEDOUT",// Socket timeout
    "ETIMEDOUT",      // Alias for ETIMEDOUT on some platforms
    "ETIME",          // Operation timed out
    "ENOTFOUND",      // DNS lookup failed (sometimes used as timeout)
    "EHOSTUNREACH",   // Host unreachable
    "ENETUNREACH",    // Network unreachable
    "EPIPE",          // Broken pipe (connection dropped)
    "ECONNREFUSED",    // Connection refused (sometimes as timeout fallback)
] as const);

/**
 * Check whether a raw error's `code` field indicates a network/timeout problem.
 *
 * @param error - Any caught error
 * @param code - The `error.code` value to check
 *
 * @example
 * ```ts
 * } catch (error: unknown) {
 *   if (isNetworkErrorCode((error as NodeJS.ErrnoException).code)) {
 *     // handle timeout / network failure
 *   }
 * }
 * ```
 */
export function isNetworkErrorCode(code: string | undefined): boolean {
    return code !== undefined && TIMEOUT_ERROR_CODES.has(code as (typeof TIMEOUT_ERROR_CODES extends Set<infer T> ? T : never));
}

/**
 * Check whether an error cause carries a timeout/connection-reset error code.
 * Combines the check with a loose `code` field extraction.
 */
export function hasTimeoutCode(cause: unknown): boolean {
    return isNetworkErrorCode(extractString(cause, "code"));
}
