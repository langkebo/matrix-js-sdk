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
import { BaseManager } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export type SecretStorageKeyResult = [string, string] | null;

export type SecretStorageKeys = Record<string, string>;

export interface SecretStorageManagerEvents {
    secret_stored: (data: { name: string }) => void;
    secret_retrieved: (data: { name: string }) => void;
    storage_ready: () => void;
}

export class SecretStorageManager extends BaseManager<keyof SecretStorageManagerEvents, SecretStorageManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    /**
     * Is secret storage enabled
     */
    public async isSecretStorageReady(): Promise<boolean> {
        const crypto = this.client.getCrypto();
        if (!crypto) return false;
        return crypto.isSecretStorageReady();
    }

    /**
     * Get secret storage key
     */
    public async getSecretStorageKey(keyId: string): Promise<SecretStorageKeyResult> {
        return this.withRetry(async () => {
            const keyTuple = await this.client.secretStorage.getKey(keyId);
            if (!keyTuple) return null;
            const [id, keyInfo] = keyTuple;
            // Return the key ID and algorithm name as the string representation
            return [id, keyInfo.algorithm];
        }, "getSecretStorageKey");
    }

    /**
     * Store secret
     */
    public async storeSecret(name: string, secret: string, keys?: string[]): Promise<void> {
        return this.withRetry(async () => {
            await this.client.secretStorage.store(name, secret, keys ?? null);
            this.emit("secret_stored", { name });
        }, "storeSecret");
    }

    /**
     * Get secret
     */
    public async getSecret(name: string): Promise<string | null> {
        return this.withRetry(async () => {
            const result = await this.client.secretStorage.get(name);
            this.emit("secret_retrieved", { name });
            return result ?? null;
        }, "getSecret");
    }

    /**
     * Check if secret exists
     */
    public async hasSecret(name: string): Promise<boolean> {
        const stored = await this.client.secretStorage.isStored(name as "m.cross_signing.master");
        return stored !== null;
    }

    /**
     * Get secret storage keys
     */
    public async getSecretStorageKeys(): Promise<SecretStorageKeys> {
        return this.withRetry(async () => {
            const defaultKeyId = await this.client.secretStorage.getDefaultKeyId();
            const result: SecretStorageKeys = {};
            if (defaultKeyId) {
                const keyTuple = await this.client.secretStorage.getKey(defaultKeyId);
                if (keyTuple) {
                    const [id, keyInfo] = keyTuple;
                    result[id] = keyInfo.algorithm;
                }
            }
            return result;
        }, "getSecretStorageKeys");
    }
}

// Declare prototype extension

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSecretStorageManager = function (): SecretStorageManager {
        registerManagerClass("secretStorage", SecretStorageManager);
    return getOrCreateManager(this, "secretStorage", () => new SecretStorageManager(this));
    };
}

export default extendMatrixClient;
