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
 * Secret Storage Manager - 密钥存储管理
 * 
 * 提供 secret storage 功能
 */

import { MatrixClient } from "../client";

export class SecretStorageManager {
    constructor(private client: MatrixClient) {}

    /**
     * Is secret storage enabled
     */
    public isSecretStorageReady(): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isSecretStorageReady();
    }

    /**
     * Get secret storage key
     */
    public async getSecretStorageKey(keyId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getSecretStorageKey(keyId);
    }

    /**
     * Store secret
     */
    public async storeSecret(name: string, secret: string, keys?: string[]): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).storeSecret(name, secret, keys);
    }

    /**
     * Get secret
     */
    public async getSecret(name: string): Promise<string | null> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getSecret(name);
    }

    /**
     * Check if secret exists
     */
    public async hasSecret(name: string): Promise<boolean> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).hasSecret(name);
    }

    /**
     * Get secret storage keys
     */
    public async getSecretStorageKeys(): Promise<Record<string, any>> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getSecretStorageKeys();
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getSecretStorageManager(): SecretStorageManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSecretStorageManager = function (): SecretStorageManager {
        return new SecretStorageManager(this);
    };
}

export default extendMatrixClient;
