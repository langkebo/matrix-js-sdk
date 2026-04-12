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

export type SecretStorageKeyResult = [string, string] | null;

export type SecretStorageKeys = Record<string, string>;

export interface SecretStorageManagerEvents {
    secret_stored: { name: string };
    secret_retrieved: { name: string };
    storage_ready: void;
}

export class SecretStorageManager extends BaseManager<keyof SecretStorageManagerEvents, SecretStorageManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    /**
     * Is secret storage enabled
     */
    public isSecretStorageReady(): boolean {
        return this.client.isSecretStorageReady();
    }

    /**
     * Get secret storage key
     */
    public async getSecretStorageKey(keyId: string): Promise<SecretStorageKeyResult> {
        return this.withRetry(() => this.client.getSecretStorageKey(keyId), "getSecretStorageKey");
    }

    /**
     * Store secret
     */
    public async storeSecret(name: string, secret: string, keys?: string[]): Promise<void> {
        return this.withRetry(() => this.client.storeSecret(name, secret, keys ?? []), "storeSecret");
    }

    /**
     * Get secret
     */
    public async getSecret(name: string): Promise<string | null> {
        return this.withRetry(() => this.client.getSecret(name), "getSecret");
    }

    /**
     * Check if secret exists
     */
    public async hasSecret(name: string): Promise<boolean> {
        return this.client.hasSecret(name);
    }

    /**
     * Get secret storage keys
     */
    public async getSecretStorageKeys(): Promise<SecretStorageKeys> {
        return this.withRetry(() => this.client.getSecretStorageKeys(), "getSecretStorageKeys");
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
