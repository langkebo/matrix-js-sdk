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
 * A3 — a stopped crypto backend must not stay bound.
 *
 * `initRustCrypto()` bails out whenever `cryptoBackend` is already set. If `stopClient()`
 * only stopped the backend (which closes its OlmMachine) without dropping the binding, the
 * client became a **one-shot crypto host**: reusing it after a reconnect would re-enable
 * sync with dead crypto and silently stop decrypting.
 *
 * The tests below pin that contract behaviourally rather than by inspecting internals: a
 * client created **without** `userId` cannot get past `initRustCrypto`'s later guard, so the
 * observable difference is "resolves silently" (still bound) vs "throws" (re-initialisable).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "../../src/index";
import { releaseCryptoBackend } from "../../src/client-lifecycle-stop";
import type { MatrixClient } from "../../src/client";

const BASE_URL = "https://server.invalid";

/** A client that was never given a userId: `initRustCrypto` can never fully succeed on it. */
function makeClientWithoutUserId(): MatrixClient {
    // Deliberately no userId/deviceId: the only thing we want to observe is whether
    // initRustCrypto() gets far enough to complain about it.
    return createClient({ baseUrl: BASE_URL });
}

describe("crypto binding release on stopClient (A3)", () => {
    let client: MatrixClient;
    let fakeBackend: { stop: ReturnType<typeof vi.fn>; stopped: boolean };

    beforeEach(() => {
        client = makeClientWithoutUserId();
        fakeBackend = { stop: vi.fn(), stopped: false };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client as any).cryptoBackend = fakeBackend;
    });

    it("does not re-initialise while a live backend is bound (baseline)", async () => {
        await expect(client.initRustCrypto({ allowInMemoryStore: true })).resolves.toBeUndefined();
        expect(fakeBackend.stop).not.toHaveBeenCalled();
    });

    it("releaseCryptoBackend stops the backend and clears the binding", () => {
        releaseCryptoBackend(client);

        expect(fakeBackend.stop).toHaveBeenCalledTimes(1);
        expect(client.getCrypto()).toBeUndefined();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((client as any).cryptoBackend).toBeUndefined();
    });

    it("releaseCryptoBackend is idempotent and tolerates a client without crypto", () => {
        releaseCryptoBackend(client);
        expect(() => releaseCryptoBackend(client)).not.toThrow();
        expect(fakeBackend.stop).toHaveBeenCalledTimes(1);

        const bare = makeClientWithoutUserId();
        expect(() => releaseCryptoBackend(bare)).not.toThrow();
    });

    it("stopClient() releases the binding even when the client was never started", () => {
        client.stopClient();

        expect(fakeBackend.stop).toHaveBeenCalledTimes(1);
        expect(client.getCrypto()).toBeUndefined();
    });

    it("stopClient() releases the binding on the started path too", () => {
        // Start-state teardown (room sweeps, manager stops, cache purge) goes through
        // stopClientLifecycleServices, which must release crypto as well.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client as any).clientRunning = true;

        client.stopClient();

        expect(fakeBackend.stop).toHaveBeenCalledTimes(1);
        expect(client.getCrypto()).toBeUndefined();
    });

    it("allows initRustCrypto() to run again after stopClient()", async () => {
        client.stopClient();

        // Reaching the "unknown userId" guard proves the `cryptoBackend` short-circuit is
        // gone — i.e. the same client can be re-initialised. Before A3 this resolved
        // silently instead, which is exactly how E2EE died without a single error.
        await expect(client.initRustCrypto({ allowInMemoryStore: true })).rejects.toThrow(/unknown userId/);
    });

    it("repeated stopClient() calls are no-ops for crypto", () => {
        client.stopClient();
        expect(() => client.stopClient()).not.toThrow();
        expect(fakeBackend.stop).toHaveBeenCalledTimes(1);
    });
});
