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
 * Encryption Rotation Manager - 加密轮换管理
 * 
 * 提供加密密钥轮换相关功能
 */

import { MatrixClient } from "../client";

export class EncryptionRotationManager {
    constructor(private client: MatrixClient) {}

    /**
     * Rotate encryption keys
     */
    public async rotateEncryptionKeys(): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).rotateEncryptionKeys();
    }

    /**
     * Is rotation needed
     */
    public isRotationNeeded(): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isRotationNeeded();
    }

    /**
     * Get rotation period
     */
    public getRotationPeriod(): number {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRotationPeriod();
    }

    /**
     * Set rotation period
     */
    public setRotationPeriod(period: number): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).setRotationPeriod(period);
    }

    /**
     * Get last rotation time
     */
    public getLastRotationTime(): number {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getLastRotationTime();
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getEncryptionRotationManager(): EncryptionRotationManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getEncryptionRotationManager = function (): EncryptionRotationManager {
        return new EncryptionRotationManager(this);
    };
}

export default extendMatrixClient;
