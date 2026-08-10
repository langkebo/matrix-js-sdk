/*
Copyright 2026 The Matrix.org Foundation C.I.C.

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

import { describe, it, expect, vi, beforeAll, afterEach, type Mocked } from "vitest";
import debug from "debug";
import * as RustSdkCryptoJs from "@matrix-org/matrix-sdk-crypto-wasm";
import { OlmMachine, StoreHandle } from "@matrix-org/matrix-sdk-crypto-wasm";

import { DebugLogger } from "../../../src";
import { initRustCrypto } from "../../../src/rust-crypto";

beforeAll(async () => {
    // Load the WASM up front so that `vi.spyOn` can target the real `StoreHandle` / `OlmMachine`.
    // This mirrors the established pattern in `rust-crypto.spec.ts`.
    await RustSdkCryptoJs.initAsync();
}, 15000);

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Build a minimal `OlmMachine` mock satisfying the surface touched during `initRustCrypto`.
 * Mirrors the helper used in `rust-crypto.spec.ts`.
 */
function makeTestOlmMachine(): Mocked<OlmMachine> {
    return {
        registerRoomKeyUpdatedCallback: vi.fn(),
        registerUserIdentityUpdatedCallback: vi.fn(),
        getSecretsFromInbox: vi.fn().mockResolvedValue([]),
        deleteSecretsFromInbox: vi.fn(),
        registerReceiveSecretCallback: vi.fn(),
        registerDevicesUpdatedCallback: vi.fn(),
        registerRoomKeysWithheldCallback: vi.fn(),
        outgoingRequests: vi.fn(),
        isBackupEnabled: vi.fn().mockResolvedValue(false),
        verifyBackup: vi.fn().mockResolvedValue({ trusted: vi.fn().mockReturnValue(false) }),
        getBackupKeys: vi.fn(),
        getIdentity: vi.fn().mockResolvedValue(null),
        trackedUsers: vi.fn(),
    } as unknown as Mocked<OlmMachine>;
}

describe("ISSUE-08b crypto store default encryption", () => {
    it("refuses to open unencrypted in-memory store by default", async () => {
        // Stub the store and OlmMachine so that the pre-fix implementation would resolve
        // rather than throw — making the missing guard observable as a clean RED.
        const mockStore = { free: vi.fn() } as unknown as StoreHandle;
        vi.spyOn(StoreHandle, "open").mockResolvedValue(mockStore);
        vi.spyOn(OlmMachine, "initFromStore").mockResolvedValue(makeTestOlmMachine());

        await expect(
            initRustCrypto({
                logger: new DebugLogger(debug("matrix-js-sdk:test:crypto-store-default")),
                http: {} as any,
                userId: "@alice:example.org",
                deviceId: "DEVICE",
                secretStorage: {} as any,
                cryptoCallbacks: {} as any,
                // 故意不传 storePrefix / storeKey / storePassphrase / allowInMemoryStore
            } as any),
        ).rejects.toThrow(/unencrypted in-memory crypto store/);
    });

    it("allows in-memory store only with explicit allowInMemoryStore", async () => {
        const mockStore = { free: vi.fn() } as unknown as StoreHandle;
        vi.spyOn(StoreHandle, "open").mockResolvedValue(mockStore);
        vi.spyOn(OlmMachine, "initFromStore").mockResolvedValue(makeTestOlmMachine());

        await expect(
            initRustCrypto({
                logger: new DebugLogger(debug("matrix-js-sdk:test:crypto-store-default")),
                http: {} as any,
                userId: "@alice:example.org",
                deviceId: "DEVICE",
                secretStorage: {} as any,
                cryptoCallbacks: {} as any,
                allowInMemoryStore: true,
            } as any),
        ).resolves.not.toThrow();
    });
});
