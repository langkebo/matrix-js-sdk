/*
Copyright 2022 - 2024 The Matrix.org Foundation C.I.C.

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

import { parse as parseContentType, type ParsedMediaType } from "content-type";

import { logger } from "../logger";
import { sleep } from "../common/async";
import {
    ConnectionError,
    HTTPError,
    MatrixError,
    MatrixSafetyError,
    MatrixSafetyErrorCode,
    safeGetRetryAfterMs,
} from "./errors";

// Ponyfill for https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout
export function timeoutSignal(ms: number): AbortSignal {
    const controller = new AbortController();
    setTimeout(() => {
        controller.abort();
    }, ms);

    return controller.signal;
}

export function anySignal(signals: AbortSignal[]): {
    signal: AbortSignal;
    cleanup(): void;
} {
    const controller = new AbortController();

    function cleanup(): void {
        for (const signal of signals) {
            signal.removeEventListener("abort", onAbort);
        }
    }

    function onAbort(): void {
        controller.abort();
        cleanup();
    }

    for (const signal of signals) {
        if (signal.aborted) {
            onAbort();
            break;
        }
        signal.addEventListener("abort", onAbort);
    }

    return {
        signal: controller.signal,
        cleanup,
    };
}

/**
 * Attempt to turn an HTTP error response into a Javascript Error.
 *
 * If it is a JSON response, we will parse it into a MatrixError. Otherwise
 * we return a generic Error.
 *
 * @param response - response object
 * @param body - raw body of the response
 * @returns
 */
export function parseErrorResponse(response: XMLHttpRequest | Response, body?: string): Error {
    const httpHeaders = isXhr(response)
        ? new Headers(
              response
                  .getAllResponseHeaders()
                  .trim()
                  .split(/[\r\n]+/)
                  .map((header): [string, string] => {
                      const colonIdx = header.indexOf(":");
                      return [header.substring(0, colonIdx), header.substring(colonIdx + 1)];
                  }),
          )
        : response.headers;

    let contentType: ParsedMediaType | null;
    try {
        contentType = getResponseContentType(httpHeaders);
    } catch (e) {
        return <Error>e;
    }
    if (contentType?.type === "application/json" && body) {
        const errorBody = JSON.parse(body);
        if (errorBody.errcode && MatrixSafetyErrorCode.matches(errorBody.errcode)) {
            return new MatrixSafetyError(
                errorBody,
                response.status,
                isXhr(response) ? response.responseURL : response.url,
                undefined,
                httpHeaders,
            );
        }
        return new MatrixError(
            errorBody,
            response.status,
            isXhr(response) ? response.responseURL : response.url,
            undefined,
            httpHeaders,
        );
    }
    if (contentType?.type === "text/plain") {
        // ISSUE-07: 裸 413（body limit 层/反向代理直接拒绝，无 JSON errcode）
        // 兜底映射为 M_TOO_LARGE，应用层才能识别并引导用户。
        if (response.status === 413) {
            return new MatrixError(
                {
                    errcode: "M_TOO_LARGE",
                    error: body?.trim()
                        ? `Upload too large: ${body}`
                        : "Uploaded content exceeds the maximum allowed size",
                },
                response.status,
                isXhr(response) ? response.responseURL : response.url,
                undefined,
                httpHeaders,
            );
        }
        return new HTTPError(`Server returned ${response.status} error: ${body}`, response.status, httpHeaders);
    }
    if (response.status === 413) {
        // ISSUE-07: 无 Content-Type/空 body 的 413 同样兜底
        return new MatrixError(
            { errcode: "M_TOO_LARGE", error: "Uploaded content exceeds the maximum allowed size" },
            response.status,
            isXhr(response) ? response.responseURL : response.url,
            undefined,
            httpHeaders,
        );
    }
    return new HTTPError(`Server returned ${response.status} error`, response.status, httpHeaders);
}

function isXhr(response: XMLHttpRequest | Response): response is XMLHttpRequest {
    return "getResponseHeader" in response;
}

/**
 * extract the Content-Type header from response headers, and
 * parse it to a `{type, parameters}` object.
 *
 * returns null if no content-type header could be found.
 *
 * @param response - response object
 * @returns parsed content-type header, or null if not found
 */
function getResponseContentType(headers: Headers): ParsedMediaType | null {
    const contentType = headers.get("Content-Type");
    if (contentType === null) return null;

    try {
        return parseContentType(contentType);
    } catch (e) {
        throw new Error(`Error parsing Content-Type '${contentType}': ${e}`);
    }
}

/**
 * Retries a network operation run in a callback.
 * @param maxAttempts - maximum attempts to try
 * @param callback - callback that returns a promise of the network operation. If rejected with ConnectionError, it will be retried by calling the callback again.
 * @returns the result of the network operation
 * @throws {@link ConnectionError} If after maxAttempts the callback still throws ConnectionError
 */
export async function retryNetworkOperation<T>(maxAttempts: number, callback: () => Promise<T>): Promise<T> {
    let attempts = 0;
    let lastConnectionError: ConnectionError | null = null;
    while (attempts < maxAttempts) {
        try {
            if (attempts > 0) {
                const timeout = 1000 * Math.pow(2, attempts);
                logger.log(`network operation failed ${attempts} times, retrying in ${timeout}ms...`);
                await sleep(timeout);
            }
            return await callback();
        } catch (err) {
            if (err instanceof ConnectionError) {
                attempts += 1;
                lastConnectionError = err;
            } else {
                throw err;
            }
        }
    }
    throw lastConnectionError;
}

/**
 * Calculate the backoff time for a request retry attempt.
 * This produces wait times of 2, 4, 8, and 16 seconds (30s total) after which we give up. If the
 * failure was due to a rate limited request, the time specified in the error is returned.
 *
 * Returns -1 if the error is not retryable, or if we reach the maximum number of attempts.
 *
 * @param err - The error thrown by the http call
 * @param attempts - The number of attempts made so far, including the one that just failed.
 * @param retryConnectionError - Whether to retry on {@link ConnectionError} (CORS, connection is down, etc.)
 */
export function calculateRetryBackoff(err: unknown, attempts: number, retryConnectionError: boolean): number {
    if (attempts > 4) {
        return -1; // give up
    }

    if (err instanceof ConnectionError && !retryConnectionError) {
        return -1;
    }

    const httpErr = err as { httpStatus?: number; name?: string };
    if (httpErr.httpStatus && Math.floor(httpErr.httpStatus / 100) === 4 && httpErr.httpStatus !== 429) {
        // client error; no amount of retrying will save you now (except for rate limiting which is handled below)
        return -1;
    }

    if (httpErr.name === "AbortError") {
        // this is a client timeout, that is already very high 60s/80s
        // we don't want to retry, as it could do it for very long
        return -1;
    }

    // If we are trying to send an event (or similar) that is too large in any way, then retrying won't help
    if (httpErr.name === "M_TOO_LARGE") {
        return -1;
    }

    return safeGetRetryAfterMs(err, 1000 * Math.pow(2, attempts));
}

export type QueryDict = Record<string, string[] | string | number | boolean | undefined>;

/**
 * Encode a dictionary of query parameters.
 * Omits any undefined/null values.
 * @param params - A dict of key/values to encode e.g.
 * `{"foo": "bar", "baz": "taz"}`
 * @returns The encoded string e.g. foo=bar&baz=taz
 */
export function encodeParams(params: QueryDict, urlSearchParams?: URLSearchParams): URLSearchParams {
    const searchParams = urlSearchParams ?? new URLSearchParams();
    for (const [key, val] of Object.entries(params)) {
        if (val !== undefined && val !== null) {
            if (Array.isArray(val)) {
                val.forEach((v) => {
                    searchParams.append(key, String(v));
                });
            } else {
                searchParams.append(key, String(val));
            }
        }
    }
    return searchParams;
}

/**
 * Replace a stable parameter with the unstable naming for params
 */
export function replaceParam(stable: string, unstable: string, dict: QueryDict): QueryDict {
    const result = {
        ...dict,
        [unstable]: dict[stable],
    };
    delete result[stable];
    return result;
}

/**
 * Encodes a URI according to a set of template variables. Variables will be
 * passed through encodeURIComponent.
 * @param pathTemplate - The path with template variables e.g. '/foo/$bar'.
 * @param variables - The key/value pairs to replace the template
 * variables with. E.g. `{ "$bar": "baz" }`.
 * @returns The result of replacing all template variables e.g. '/foo/baz'.
 */
export function encodeUri(pathTemplate: string, variables: Record<string, string | null | undefined>): string {
    for (const key in variables) {
        if (!variables.hasOwnProperty(key)) {
            continue;
        }
        const value = variables[key];
        if (value === undefined || value === null) {
            continue;
        }
        pathTemplate = pathTemplate.replace(key, encodeURIComponent(value));
    }
    return pathTemplate;
}

export function ensureNoTrailingSlash(url: string): string;
export function ensureNoTrailingSlash(url: undefined): undefined;
export function ensureNoTrailingSlash(url?: string): string | undefined;
export function ensureNoTrailingSlash(url?: string): string | undefined {
    if (url?.endsWith("/")) {
        return url.slice(0, -1);
    } else {
        return url;
    }
}
