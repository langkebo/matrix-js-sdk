/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may May obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * Stores Manager - 存储管理
 *
 * 提供存储相关功能
 */

import { MatrixClient } from "../client";
import { IStore } from "../store/index";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface StoresManagerEvents {
    store_initialized: void;
    store_cleared: void;
    value_stored: { key: string; value: unknown };
}

export class StoresManager extends BaseManager<keyof StoresManagerEvents, StoresManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public getStore(): IStore | undefined {
        return (this.client as unknown as { store?: IStore }).store;
    }

    public setStore(store: IStore): void {
        (this.client as unknown as { store?: IStore }).store = store;
    }

    public getCryptoStore(): unknown {
        return (this.client as unknown as { cryptoStore?: unknown }).cryptoStore;
    }

    public setCryptoStore(store: unknown): void {
        (this.client as unknown as { cryptoStore?: unknown }).cryptoStore = store;
    }

    public async storeValue(key: string, value: unknown): Promise<void> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        storeValue: (key: string, value: unknown) => Promise<void>;
                    }
                ).storeValue(key, value),
            "storeValue",
        );
    }

    public async getStoredValue(key: string): Promise<unknown> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        getStoredValue: (key: string) => Promise<unknown>;
                    }
                ).getStoredValue(key),
            "getStoredValue",
        );
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getStoresManager(): StoresManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getStoresManager = function (): StoresManager {
        return getOrCreateManager(this, "stores", () => new StoresManager(this));
    };
}

export default extendMatrixClient;
