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

import { RUST_SDK_STORE_PREFIX } from "./rust-crypto/constants";

import type { MatrixClient } from "./client";

/**
 * Delete the stores used by the rust matrix-sdk-crypto, in case they were used.
 * Extracted from clearStores to keep client.ts thin.
 */
async function deleteRustSdkStore(client: MatrixClient, cryptoDatabasePrefix?: string): Promise<void> {
    let indexedDB: IDBFactory;
    try {
        indexedDB = globalThis.indexedDB;
        if (!indexedDB) return; // No indexedDB support
    } catch {
        // No indexedDB support
        return;
    }
    for (const dbname of [
        `${cryptoDatabasePrefix ?? RUST_SDK_STORE_PREFIX}::matrix-sdk-crypto`,
        `${cryptoDatabasePrefix ?? RUST_SDK_STORE_PREFIX}::matrix-sdk-crypto-meta`,
    ]) {
        const prom = new Promise((resolve) => {
            client.logger.info(`Removing IndexedDB instance ${dbname}`);
            const req = indexedDB.deleteDatabase(dbname);
            req.onsuccess = (_): void => {
                client.logger.info(`Removed IndexedDB instance ${dbname}`);
                resolve(0);
            };
            req.onerror = (e): void => {
                // In private browsing, Firefox has a globalThis.indexedDB, but attempts to delete an indexeddb
                // (even a non-existent one) fail with "DOMException: A mutation operation was attempted on a
                // database that did not allow mutations."
                //
                // it seems like the only thing we can really do is ignore the error.
                client.logger.warn(`Failed to remove IndexedDB instance ${dbname}:`, e);
                resolve(0);
            };
            req.onblocked = (): void => {
                client.logger.info(`cannot yet remove IndexedDB instance ${dbname}`);
            };
        });
        await prom;
    }
}

/**
 * Clear any data out of the persistent stores used by the client.
 * Extracted from clearStores to keep client.ts thin.
 */
export async function clearClientStores(
    client: MatrixClient,
    args: {
        cryptoDatabasePrefix?: string;
    } = {},
): Promise<void> {
    if (client.clientRunning) {
        throw new Error("Cannot clear stores while client is running");
    }

    const promises: Promise<void>[] = [];

    promises.push(client.store.deleteAllData());
    if (client.legacyCryptoStore) {
        promises.push(client.legacyCryptoStore.deleteAllData());
    }

    promises.push(deleteRustSdkStore(client, args.cryptoDatabasePrefix));

    await Promise.all(promises);
}
