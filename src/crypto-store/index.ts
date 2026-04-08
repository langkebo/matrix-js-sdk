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

export class CryptoStoreManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get crypto store
     */
    public getCryptoStore(): unknown {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).cryptoStore;
    }

    /**
     * Set crypto store
     */
    public setCryptoStore(store: unknown): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).cryptoStore = store;
    }

    /**
     * Delete crypto store
     */
    public async deleteCryptoStore(): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).deleteCryptoStore();
    }

    /**
     * Is crypto store ready
     */
    public isCryptoStoreReady(): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isCryptoStoreReady();
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getCryptoStoreManager(): CryptoStoreManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCryptoStoreManager = function (): CryptoStoreManager {
        return new CryptoStoreManager(this);
    };
}

export default extendMatrixClient;
