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
 * Key Claim Manager - 密钥声明管理
 *
 * 提供密钥声明相关功能
 */

import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export type ClaimedKeys = Record<string, Record<string, string>>;

export interface KeyClaimManagerEvents {
    keys_claimed: { users: Record<string, string[]>; keys: ClaimedKeys };
    keys_cleared: void;
}

export class KeyClaimManager extends BaseManager<keyof KeyClaimManagerEvents, KeyClaimManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    /**
     * Claim keys
     */
    public async claimKeys(users: Record<string, string[]>): Promise<ClaimedKeys> {
        return (await this.withRetry(() => this.client.claimKeys(users), "claimKeys")) as ClaimedKeys;
    }

    /**
     * Get claimed keys
     */
    public getClaimedKeys(): ClaimedKeys {
        return this.client.claimedKeys || {};
    }

    /**
     * Has claimed key
     */
    public hasClaimedKey(userId: string, deviceId: string): boolean {
        const keys = this.client.claimedKeys || {};
        return !!keys[userId]?.[deviceId];
    }

    /**
     * Clear claimed keys
     */
    public clearClaimedKeys(): void {
        this.client.claimedKeys = {};
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getKeyClaimManager(): KeyClaimManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getKeyClaimManager = function (): KeyClaimManager {
        return getOrCreateManager(this, "keyClaim", () => new KeyClaimManager(this));
    };
}

export default extendMatrixClient;
