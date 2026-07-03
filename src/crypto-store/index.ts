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
 * Crypto Store Manager - 加密存储管理
 *
 * 提供加密存储相关功能
 */

import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface CryptoStoreInfo {
    type: string;
    exists: boolean;
}

export interface CryptoStoreManagerEvents {
    store_created: void;
    store_deleted: void;
    store_ready: void;
}

export class CryptoStoreManager extends BaseManager<keyof CryptoStoreManagerEvents, CryptoStoreManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public getCryptoStore(): unknown {
        return this.client.cryptoStore;
    }

    public setCryptoStore(store: unknown): void {
        this.client.cryptoStore = store;
    }

    public async deleteCryptoStore(): Promise<void> {
        return this.withRetry(() => this.client.deleteCryptoStore(), "deleteCryptoStore");
    }

    public isCryptoStoreReady(): boolean {
        return this.client.isCryptoStoreReady();
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCryptoStoreManager = function (): CryptoStoreManager {
        registerManagerClass("cryptoStore", CryptoStoreManager);
        return getOrCreateManager(this, "cryptoStore", () => new CryptoStoreManager(this));
    };
}

export default extendMatrixClient;
