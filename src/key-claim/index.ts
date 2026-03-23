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

export class KeyClaimManager {
    constructor(private client: MatrixClient) {}

    /**
     * Claim keys
     */
    public async claimKeys(users: Record<string, string[]>): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).claimKeys(users);
    }

    /**
     * Get claimed keys
     */
    public getClaimedKeys(): Record<string, any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).claimedKeys || {};
    }

    /**
     * Has claimed key
     */
    public hasClaimedKey(userId: string, deviceId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const keys = (this.client as any).claimedKeys || {};
        return !!keys[userId]?.[deviceId];
    }

    /**
     * Clear claimed keys
     */
    public clearClaimedKeys(): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).claimedKeys = {};
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
        return new KeyClaimManager(this);
    };
}

export default extendMatrixClient;
