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
 * Unified Error Handling Module - 统一错误处理模块
 *
 * 提供 SDK 统一的错误类型、错误码和错误处理工具
 */

export class SDKError extends Error {
    public constructor(
        message: string,
        public code: string,
        public statusCode?: number,
        public details?: unknown,
    ) {
        super(message);
        this.name = "SDKError";
    }
}

export const ErrorCodes = {
    NETWORK_ERROR: "NETWORK_ERROR",
    UNAUTHORIZED: "UNAUTHORIZED",
    FORBIDDEN: "FORBIDDEN",
    NOT_FOUND: "NOT_FOUND",
    BAD_REQUEST: "BAD_REQUEST",
    SERVER_ERROR: "SERVER_ERROR",
    TIMEOUT: "TIMEOUT",
    VALIDATION_ERROR: "VALIDATION_ERROR",
    RATE_LIMITED: "RATE_LIMITED",
    CONFLICT: "CONFLICT",
    SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export function createError(code: ErrorCode, message: string, statusCode?: number, details?: unknown): SDKError {
    return new SDKError(message, code, statusCode, details);
}

export function isSDKError(error: unknown): error is SDKError {
    return error instanceof SDKError;
}

/** Options for controlling error handling behavior in Manager methods */
export type ErrorHandlingOptions = {
    /** If true (default), errors are thrown. If false, errors are caught and null is returned. */
    throwOnError?: boolean;
    /** Optional callback when an error occurs, regardless of throwOnError */
    onError?: (error: SDKError) => void;
};

/** Default error handling options */
const DEFAULT_ERROR_OPTIONS: Required<ErrorHandlingOptions> = {
    throwOnError: true,
    onError: () => {},
};

/**
 * Unified error handler for Manager methods.
 * Replaces the inconsistent `throwOnError` parameter pattern with a structured options approach.
 *
 * Usage:
 *   return handleManagerError(error, { throwOnError: false }, "getUser");
 *   // or with the legacy boolean shorthand:
 *   return handleManagerError(error, throwOnError, "getUser");
 */
export function handleManagerError<T = null>(
    error: unknown,
    options: ErrorHandlingOptions | boolean = {},
    _context?: string,
): T | null {
    const opts = typeof options === "boolean"
        ? { throwOnError: options, onError: undefined }
        : { ...DEFAULT_ERROR_OPTIONS, ...options };

    let sdkError: SDKError;
    if (isSDKError(error)) {
        sdkError = error;
    } else if (error instanceof Error) {
        sdkError = createError(ErrorCodes.SERVER_ERROR, error.message);
    } else {
        sdkError = createError(ErrorCodes.SERVER_ERROR, "Unknown error");
    }

    opts.onError?.(sdkError);

    if (opts.throwOnError) {
        throw sdkError;
    }

    return null;
}

export async function withErrorHandling<T>(
    fn: () => Promise<T>,
    fallback?: T,
    onError?: (error: SDKError) => void,
): Promise<T> {
    try {
        return await fn();
    } catch (error) {
        let sdkError: SDKError;
        if (isSDKError(error)) {
            sdkError = error;
        } else if (error instanceof Error) {
            sdkError = createError(ErrorCodes.SERVER_ERROR, error.message);
        } else {
            sdkError = createError(ErrorCodes.SERVER_ERROR, "Unknown error");
        }
        onError?.(sdkError);
        if (fallback !== undefined) return fallback;
        throw sdkError;
    }
}

export function mapHttpError(status: number, message?: string): SDKError {
    switch (status) {
        case 400:
            return createError(ErrorCodes.BAD_REQUEST, message || "Bad request", status);
        case 401:
            return createError(ErrorCodes.UNAUTHORIZED, message || "Unauthorized", status);
        case 403:
            return createError(ErrorCodes.FORBIDDEN, message || "Forbidden", status);
        case 404:
            return createError(ErrorCodes.NOT_FOUND, message || "Not found", status);
        case 429:
            return createError(ErrorCodes.RATE_LIMITED, message || "Rate limited", status);
        case 500:
            return createError(ErrorCodes.SERVER_ERROR, message || "Internal server error", status);
        case 503:
            return createError(ErrorCodes.SERVICE_UNAVAILABLE, message || "Service unavailable", status);
        default:
            return createError(ErrorCodes.SERVER_ERROR, message || `HTTP error ${status}`, status);
    }
}

/**
 * Bridge utilities for converting SDK errors to application-level error formats.
 * Used by hula frontend to convert SDKError to AppError/AppException.
 */

/** Structured error info that can be consumed by application error handlers */
export type SDKErrorInfo = {
    code: string;
    message: string;
    statusCode?: number;
    details?: unknown;
    isRetryable: boolean;
    retryAfter?: unknown;
    traceId?: string;
};

/**
 * Convert any error to a structured SDKErrorInfo object.
 * This provides a stable serialization format that hula's AppError can consume
 * without depending on the SDKError class directly.
 */
export function toErrorInfo(error: unknown): SDKErrorInfo {
    if (isSDKError(error)) {
        return {
            code: error.code,
            message: error.message,
            statusCode: error.statusCode,
            details: error.details,
            isRetryable: error.code === ErrorCodes.RATE_LIMITED || error.code === ErrorCodes.SERVICE_UNAVAILABLE,
            retryAfter: error.details && typeof error.details === "object" && "retry_after_ms" in (error.details as Record<string, unknown>)
                ? (error.details as Record<string, unknown>).retry_after_ms
                : undefined,
        };
    }
    if (error instanceof Error) {
        return {
            code: ErrorCodes.SERVER_ERROR,
            message: error.message,
            isRetryable: false,
        };
    }
    return {
        code: ErrorCodes.SERVER_ERROR,
        message: "Unknown error",
        isRetryable: false,
    };
}

/**
 * Create an SDKError from an SDKErrorInfo object (reverse bridge).
 * Useful for re-creating errors from serialized error info.
 */
export function fromErrorInfo(info: SDKErrorInfo): SDKError {
    return new SDKError(info.message, info.code, info.statusCode, info.details);
}
