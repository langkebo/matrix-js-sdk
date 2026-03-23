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
 * Crypto Algorithms Manager - 加密算法管理
 * 
 * 提供加密算法相关功能
 */

import { MatrixClient } from "../client";

export class CryptoAlgorithmsManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get crypto algorithm
     */
    public getCryptoAlgorithm(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getCryptoAlgorithm();
    }

    /**
     * Set crypto algorithm
     */
    public setCryptoAlgorithm(algorithm: any): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).setCryptoAlgorithm(algorithm);
    }

    /**
     * Has crypto
     */
    public hasCrypto(): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).hasCrypto();
    }

    /**
     * Init crypto
     */
    public async initCrypto(): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).initCrypto();
    }

    /**
     * Stop crypto
     */
    public async stopCrypto(): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).stopCrypto();
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getCryptoAlgorithmsManager(): CryptoAlgorithmsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCryptoAlgorithmsManager = function (): CryptoAlgorithmsManager {
        return new CryptoAlgorithmsManager(this);
    };
}

export default extendMatrixClient;
