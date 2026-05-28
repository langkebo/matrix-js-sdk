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

export enum InvalidCryptoStoreState {
    TooNew = "TOO_NEW",
}

// Type-safe helpers to extract fields from unknown error causes without `as any`
function extractStringField(cause: unknown, field: string): string | undefined {
    if (cause && typeof cause === "object" && field in cause) {
        const value = (cause as Record<string, unknown> /* Dynamic: error cause shape is unknown */)[field];
        return typeof value === "string" ? value : undefined;
    }
    return undefined;
}

function extractNumberField(cause: unknown, field: string): number | undefined {
    if (cause && typeof cause === "object" && field in cause) {
        const value = (cause as Record<string, unknown> /* Dynamic: error cause shape is unknown */)[field];
        return typeof value === "number" ? value : undefined;
    }
    return undefined;
}

function extractNestedField(cause: unknown, parentField: string, childField: string): unknown {
    if (cause && typeof cause === "object" && parentField in cause) {
        const parent = (cause as Record<string, unknown> /* Dynamic: error cause shape is unknown */)[parentField];
        if (parent && typeof parent === "object" && childField in (parent as Record<string, unknown> /* Dynamic: nested error field */)) {
            return (parent as Record<string, unknown> /* Dynamic: nested error field */)[childField];
        }
    }
    return undefined;
}

function extractHeaderField(cause: unknown, headerName: string): string | undefined {
    if (cause && typeof cause === "object" && "httpHeaders" in cause) {
        const headers = (cause as Record<string, unknown> /* Dynamic: error cause shape is unknown */).httpHeaders;
        if (headers && typeof headers === "object" && "get" in (headers as Record<string, unknown> /* Dynamic: httpHeaders shape is unknown */)) {
            return (headers as { get: (name: string) => string | null }).get(headerName) ?? undefined;
        }
    }
    return undefined;
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
        const retryAfter = extractNumberField(cause, "retryAfter") || extractNestedField(cause, "data", "retry_after_ms") as number | undefined;
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
