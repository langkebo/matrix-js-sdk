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
 * Key Forwarding Manager - 密钥转发管理
 * 
 * 提供密钥转发相关功能
 */

import { MatrixClient } from "../client";

export class KeyForwardingManager {
    constructor(private client: MatrixClient) {}

    /**
     * Request key forwarding
     */
    public async requestKeyForwarding(roomId: string, eventId: string, userId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).requestKeyForwarding(roomId, eventId, userId);
    }

    /**
     * Forward key
     */
    public async forwardKey(roomId: string, eventId: string, userId: string, key: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).forwardKey(roomId, eventId, userId, key);
    }

    /**
     * Has forwarded key
     */
    public hasForwardedKey(roomId: string, eventId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).hasForwardedKey(roomId, eventId);
    }

    /**
     * Get forwarded keys
     */
    public getForwardedKeys(roomId: string): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getForwardedKeys(roomId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getKeyForwardingManager(): KeyForwardingManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getKeyForwardingManager = function (): KeyForwardingManager {
        return new KeyForwardingManager(this);
    };
}

export default extendMatrixClient;
