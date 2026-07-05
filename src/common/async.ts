/*
Copyright 2015, 2016, 2019, 2023 The Matrix.org Foundation C.I.C.

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

import promiseRetry from "p-retry";
import { type BaseLogger } from "../logger";

/**
 * Returns a promise which resolves with a given value after the given number of ms
 */
export function sleep<T>(ms: number, value?: T): Promise<T> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms, value);
    });
}

/**
 * Utility to log the duration of a promise.
 *
 * @param logger - The logger to log to.
 * @param name - The name of the operation.
 * @param block - The block to execute.
 */
export async function logDuration<T>(logger: BaseLogger, name: string, block: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
        return await block();
    } finally {
        const end = Date.now();
        logger.debug(`[Perf]: ${name} took ${end - start}ms`);
    }
}

/**
 * Utility to log the duration of a synchronous block.
 *
 * @param logger - The logger to log to.
 * @param name - The name of the operation.
 * @param block - The block to execute.
 */
export function logDurationSync<T>(logger: BaseLogger, name: string, block: () => T): T {
    const start = Date.now();
    try {
        return block();
    } finally {
        const end = Date.now();
        logger.debug(`[Perf]: ${name} took ${end - start}ms`);
    }
}

export async function promiseMapSeries<T>(
    promises: Array<T | Promise<T>>,
    fn: (t: T) => Promise<unknown> | undefined, // if async we don't care about the type as we only await resolution
): Promise<void> {
    for (const o of promises) {
        await fn(await o);
    }
}

export function promiseTry<T>(fn: () => T | Promise<T>): Promise<T> {
    return Promise.resolve(fn());
}

/**
 * Retries the function until it succeeds or is interrupted. The given function must return
 * a promise which throws/rejects on error, otherwise the retry will assume the request
 * succeeded. The promise chain returned will contain the successful promise. The given function
 * should always return a new promise.
 * @param promiseFn - The function to call to get a fresh promise instance. Takes an
 * attempt count as an argument, for logging/debugging purposes.
 * @param shouldRetry - Optional function which is called with the error the latest rejection from promiseFn,
 * retrying will ba aborted if this return false.
 * @returns The promise for the retried operation.
 */
export function simpleRetryOperation<T>(
    promiseFn: (attempt: number) => Promise<T>,
    shouldRetry?: (e: unknown) => boolean,
): Promise<T> {
    return promiseRetry(
        (attempt: number) => {
            return promiseFn(attempt);
        },
        {
            retries: Infinity,
            shouldRetry: shouldRetry ? ({ error }): boolean => shouldRetry(error) : undefined,
            factor: 2,
            minTimeout: 3000, // ms
            maxTimeout: 15000, // ms
        },
    );
}
