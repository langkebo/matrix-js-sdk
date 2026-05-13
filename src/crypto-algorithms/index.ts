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
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export type CryptoAlgorithm = string;

export interface CryptoAlgorithmsManagerEvents {
    crypto_initialized: void;
    crypto_stopped: void;
    algorithm_changed: { algorithm: CryptoAlgorithm };
}

export class CryptoAlgorithmsManager extends BaseManager<
    keyof CryptoAlgorithmsManagerEvents,
    CryptoAlgorithmsManagerEvents
> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public getCryptoAlgorithm(): CryptoAlgorithm | undefined {
        return this.client.getCryptoAlgorithm() as CryptoAlgorithm | undefined;
    }

    public setCryptoAlgorithm(algorithm: CryptoAlgorithm): void {
        this.client.setCryptoAlgorithm(algorithm);
    }

    public hasCrypto(): boolean {
        return this.client.hasCrypto();
    }

    public async initCrypto(): Promise<void> {
        return this.withRetry(async () => {
            await this.client.initCrypto();
        }, "initCrypto");
    }

    public async stopCrypto(): Promise<void> {
        await this.client.stopCrypto();
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getCryptoAlgorithmsManager(): CryptoAlgorithmsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCryptoAlgorithmsManager = function (): CryptoAlgorithmsManager {
        return getOrCreateManager(this, "cryptoAlgorithms", () => new CryptoAlgorithmsManager(this));
    };
}

export default extendMatrixClient;
