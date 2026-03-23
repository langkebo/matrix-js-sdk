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
 * Key Verification Manager - 密钥验证管理
 * 
 * 提供密钥验证功能
 */

import { MatrixClient } from "../client";

export class KeyVerificationManager {
    constructor(private client: MatrixClient) {}

    /**
     * Request verification
     */
    public async requestVerification(userId: string, methods?: string[]): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).requestVerification(userId, methods);
    }

    /**
     * Request room key verification
     */
    public async requestRoomKeyVerification(roomId: string, userId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).requestRoomKeyVerification(roomId, userId);
    }

    /**
     * Begin key verification
     */
    public async beginKeyVerification(method: string, targetUserId: string, targetDeviceId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).beginKeyVerification(method, targetUserId, targetDeviceId);
    }

    /**
     * Complete key verification
     */
    public async completeKeyVerification(txnId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).completeKeyVerification(txnId);
    }

    /**
     * Cancel key verification
     */
    public async cancelKeyVerification(txnId: string, reason?: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).cancelKeyVerification(txnId, reason);
    }

    /**
     * Get verification requests
     */
    public getVerificationRequests(userId: string): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getVerificationRequests(userId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getKeyVerificationManager(): KeyVerificationManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getKeyVerificationManager = function (): KeyVerificationManager {
        return new KeyVerificationManager(this);
    };
}

export default extendMatrixClient;
