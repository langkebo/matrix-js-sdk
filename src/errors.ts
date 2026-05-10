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

export enum InvalidCryptoStoreState {
    TooNew = "TOO_NEW",
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
        (this as any).cause = options.cause;

        // Legacy compatibility
        (this as any).code = this.errorCode;
        (this as any).httpStatus = this.statusCode;
        (this as any).errcode = this.errorCode;
    }
}

export class AuthError extends SdkError {
    public constructor(message: string, cause?: unknown) {
        const errcode = (cause as any)?.errcode || "AUTH_ERROR";
        const httpStatus = (cause as any)?.httpStatus || 401;
        super(message, {
            errorCode: errcode,
            statusCode: httpStatus,
            cause,
        });
    }
}

export class NotFoundError extends SdkError {
    public constructor(message: string, cause?: unknown) {
        const errcode = (cause as any)?.errcode || "NOT_FOUND";
        const httpStatus = (cause as any)?.httpStatus || 404;
        super(message, {
            errorCode: errcode,
            statusCode: httpStatus,
            cause,
        });
    }
}

export class RetryableError extends SdkError {
    public constructor(message: string, cause?: unknown) {
        const errcode = (cause as any)?.errcode || "RETRYABLE";
        const httpStatus = (cause as any)?.httpStatus || 500;
        const retryAfter = (cause as any)?.retryAfter || (cause as any)?.data?.retry_after_ms;
        const traceId = (cause as any)?.httpHeaders?.get?.("x-trace-id");

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
