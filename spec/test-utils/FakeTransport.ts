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

import { vi } from "vitest";
import type { Transport } from "../../src/managers/base-manager";
import type { Method } from "../../src/http-api/method";
import type { QueryDict } from "../../src/utils";
import type { Body, IRequestOpts } from "../../src/http-api/interface";

/**
 * Reusable in-memory Transport fake for unit testing managers.
 *
 * Inject via ManagerOpts.transport to bypass real HTTP calls and assert
 * on exactly what the manager sends through the transport layer.
 *
 * @example
 * ```typescript
 * const transport = new FakeTransport();
 * const manager = new AdminManager(mockClient, { transport });
 *
 * transport.respondWith({ user_id: "@alice:example.com" });
 * const user = await manager.getUser("@alice:example.com");
 *
 * transport.expectCalledWith("GET", "/v2/users/%40alice%3Aexample.com");
 * ```
 */
export class FakeTransport implements Transport {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public request = vi.fn<(...args: Parameters<Transport["request"]>) => Promise<any>>();

    constructor() {
        // Default: return empty object
        this.request.mockResolvedValue({});
    }

    /** Pre-configure a response for all subsequent calls */
    public respondWith<T>(response: T): this {
        this.request.mockResolvedValue(response);
        return this;
    }

    /** Pre-configure an error for all subsequent calls */
    public rejectWith(error: Error): this {
        this.request.mockRejectedValue(error);
        return this;
    }

    /** Reset call history (keeps response config) */
    public resetCalls(): void {
        this.request.mockClear();
    }

    /** Full reset — clears both call history and response config */
    public reset(): void {
        this.request.mockReset();
        this.request.mockResolvedValue({});
    }

    /** Assert request was called with specific method + path */
    public expectCalledWith(method: Method | string, path: string, body?: unknown): void {
        const calls = this.request.mock.calls;
        const match = calls.some(
            ([m, p, _q, b]) =>
                m === method && p === path && (body === undefined || JSON.stringify(b) === JSON.stringify(body)),
        );
        if (!match) {
            throw new Error(
                `Expected Transport.request to have been called with ${method} ${path}` +
                    (body !== undefined ? ` and body ${JSON.stringify(body)}` : "") +
                    `\n\nActual calls:\n${calls.map((c) => `  ${c[0]} ${c[1]}`).join("\n") || "  (none)"}`,
            );
        }
    }

    /** Assert request was called with the given arguments */
    public expectCalledWithArgs(
        method: Method | string,
        path: string,
        queryParams?: QueryDict,
        body?: Body,
        opts?: IRequestOpts,
    ): void {
        const calls = this.request.mock.calls;
        const match = calls.some(
            ([m, p, q, b, o]) =>
                m === method &&
                p === path &&
                (queryParams === undefined || JSON.stringify(q) === JSON.stringify(queryParams)) &&
                (body === undefined || JSON.stringify(b) === JSON.stringify(body)) &&
                (opts === undefined || JSON.stringify(o) === JSON.stringify(opts)),
        );
        if (!match) {
            throw new Error(
                `Expected Transport.request to have been called with ${method} ${path}` +
                    (queryParams !== undefined ? ` queryParams=${JSON.stringify(queryParams)}` : "") +
                    (body !== undefined ? ` body=${JSON.stringify(body)}` : "") +
                    (opts !== undefined ? ` opts=${JSON.stringify(opts)}` : "") +
                    `\n\nActual calls:\n${calls.map((c) => `  ${c[0]} ${c[1]} ${JSON.stringify(c[2])} ${JSON.stringify(c[3])} ${JSON.stringify(c[4])}`).join("\n") || "  (none)"}`,
            );
        }
    }
}
