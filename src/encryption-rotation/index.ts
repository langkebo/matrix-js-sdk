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
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface EncryptionRotationManagerEvents {
    keys_rotated: void;
    rotation_needed: void;
    rotation_period_changed: { period: number };
}

export class EncryptionRotationManager extends BaseManager<
    keyof EncryptionRotationManagerEvents,
    EncryptionRotationManagerEvents
> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async rotateEncryptionKeys(): Promise<void> {
        return this.withRetry(() => this.client.rotateEncryptionKeys(), "rotateEncryptionKeys");
    }

    public isRotationNeeded(): boolean {
        return this.client.isRotationNeeded();
    }

    public getRotationPeriod(): number {
        return this.client.getRotationPeriod();
    }

    public setRotationPeriod(period: number): void {
        this.client.setRotationPeriod(period);
    }

    public getLastRotationTime(): number {
        return this.client.getLastRotationTime();
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getEncryptionRotationManager(): EncryptionRotationManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getEncryptionRotationManager = function (): EncryptionRotationManager {
        return getOrCreateManager(this, "encryptionRotation", () => new EncryptionRotationManager(this));
    };
}

export default extendMatrixClient;
