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
 * Stores Manager - 存储管理
 * 
 * 提供存储相关功能
 */

import { MatrixClient } from "../client";

export class StoresManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get store
     */
    public getStore(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).store;
    }

    /**
     * Set store
     */
    public setStore(store: any): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).store = store;
    }

    /**
     * Get crypto store
     */
    public getCryptoStore(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).cryptoStore;
    }

    /**
     * Set crypto store
     */
    public setCryptoStore(store: any): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).cryptoStore = store;
    }

    /**
     * Store value
     */
    public async storeValue(key: string, value: any): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).storeValue(key, value);
    }

    /**
     * Get stored value
     */
    public async getStoredValue(key: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getStoredValue(key);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getStoresManager(): StoresManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getStoresManager = function (): StoresManager {
        return new StoresManager(this);
    };
}

export default extendMatrixClient;
