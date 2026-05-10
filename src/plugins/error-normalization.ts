import { HTTPError, MatrixError, safeGetRetryAfterMs } from "../http-api/errors";

export interface SdkErrorMetadata {
    errorCode?: string;
    traceId?: string;
    userTip?: string;
    retryAfter?: number;
    isRetryable?: boolean;
}

function getHeaderTraceId(headers?: Headers): string | undefined {
    return headers?.get("x-trace-id") || headers?.get("x-request-id") || headers?.get("trace-id") || undefined;
}

function getObjectTraceId(error: Record<string, unknown>): string | undefined {
    const candidates = [
        error.traceId,
        error.trace_id,
        error.requestId,
        error.request_id,
        (error.data as Record<string, unknown> | undefined)?.trace_id,
        (error.data as Record<string, unknown> | undefined)?.request_id,
    ];
    return candidates.find((value): value is string => typeof value === "string" && value.length > 0);
}

export function extractRetryAfter(error: unknown): number | undefined {
    if (error instanceof HTTPError && error.isRateLimitError()) {
        return safeGetRetryAfterMs(error, 0);
    }

    const plain = error as Record<string, unknown> | undefined;
    const retryAfter =
        plain?.retryAfter ??
        plain?.retry_after_ms ??
        (plain?.data as Record<string, unknown> | undefined)?.retry_after_ms;

    return typeof retryAfter === "number" && Number.isFinite(retryAfter) ? retryAfter : undefined;
}

export function inferUserTip(httpStatus?: number, errcode?: string, retryAfter?: number): string | undefined {
    if (httpStatus === 401 || errcode === "M_UNKNOWN_TOKEN") {
        return "Re-authenticate and try again.";
    }
    if (httpStatus === 403 || errcode === "M_FORBIDDEN") {
        return "Check permissions before retrying.";
    }
    if (httpStatus === 404 || errcode === "M_NOT_FOUND") {
        return "Confirm the resource still exists.";
    }
    if (httpStatus === 409 || errcode === "M_CONFLICT") {
        return "Refresh the latest state, then retry your change.";
    }
    if (httpStatus === 429 || errcode === "M_LIMIT_EXCEEDED") {
        if (retryAfter !== undefined) {
            return `Wait ${retryAfter}ms before retrying.`;
        }
        return "Request was rate-limited. Retry with backoff.";
    }
    if (typeof httpStatus === "number" && httpStatus >= 500) {
        return "Temporary server failure. Retry after a short delay.";
    }
    return undefined;
}

export function getSdkErrorMetadata(error: unknown): SdkErrorMetadata {
    const plain = error as Record<string, unknown> | undefined;
    const httpStatus =
        error instanceof HTTPError ? error.httpStatus : typeof plain?.httpStatus === "number" ? plain.httpStatus : 0;
    const errcode =
        error instanceof MatrixError
            ? error.errcode
            : typeof plain?.errcode === "string"
              ? plain.errcode
              : typeof plain?.code === "string"
                ? plain.code
                : undefined;
    const retryAfter = extractRetryAfter(error);
    const traceId =
        error instanceof HTTPError
            ? getHeaderTraceId(error.httpHeaders) || getObjectTraceId(plain ?? {})
            : getObjectTraceId(plain ?? {});

    return {
        errorCode: errcode,
        traceId,
        retryAfter,
        userTip: inferUserTip(httpStatus, errcode, retryAfter),
        isRetryable:
            httpStatus === 429 ||
            (typeof httpStatus === "number" && httpStatus >= 500) ||
            errcode === "M_LIMIT_EXCEEDED",
    };
}
