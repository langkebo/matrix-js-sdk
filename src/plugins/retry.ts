import { MatrixError } from "../http-api/errors";
import { RetryableError, SdkError } from "../errors";

export interface RetryPolicyOptions {
    maxRetries?: number;
    retryDelay?: number;
    backoffMultiplier?: number;
    maxDelay?: number;
    jitterRatio?: number;
    enabled?: boolean;
    idempotent?: boolean;
    retryNonIdempotent?: boolean;
    label?: string;
}

export function computeRetryDelay(
    attempt: number,
    options: RetryPolicyOptions,
    random: () => number = Math.random,
): number {
    const retryDelay = options.retryDelay ?? 1000;
    const backoffMultiplier = options.backoffMultiplier ?? 2;
    const maxDelay = options.maxDelay ?? 30000;
    const jitterRatio = options.jitterRatio ?? 0.2;

    const exponentialDelay = retryDelay * Math.pow(backoffMultiplier, attempt);
    const cappedDelay = Math.min(exponentialDelay, maxDelay);
    const jitterWindow = cappedDelay * jitterRatio;
    const jitter = (random() * 2 - 1) * jitterWindow;

    return Math.max(0, Math.round(cappedDelay + jitter));
}

export function shouldRetryError(error: unknown): boolean {
    if (error instanceof RetryableError) return true;
    if (error instanceof SdkError) {
        return (error as SdkError & { isRetryable?: boolean }).isRetryable === true;
    }
    if (error instanceof MatrixError) {
        return error.isRateLimitError() || (typeof error.httpStatus === "number" && error.httpStatus >= 500);
    }

    const plain = error as Record<string, unknown> | undefined;
    const code = plain?.code;
    const httpStatus = plain?.httpStatus;
    const errcode = plain?.errcode;

    return (
        code === "ECONNRESET" ||
        code === "ETIMEDOUT" ||
        code === "ENOTFOUND" ||
        code === "ECONNABORTED" ||
        errcode === "M_LIMIT_EXCEEDED" ||
        httpStatus === 429 ||
        (typeof httpStatus === "number" && httpStatus >= 500)
    );
}

export function canRetryRequest(options: RetryPolicyOptions): boolean {
    if (options.enabled === false) return false;
    if (options.idempotent === false && options.retryNonIdempotent !== true) return false;
    return true;
}
