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
 * Cross Signing Manager - 交叉签名管理
 * 
 * 提供 cross-signing 功能
 */

import { MatrixClient } from "../client";

export class CrossSigningManager {
    constructor(private client: MatrixClient) {}

    /**
     * Check cross signing status
     */
    public async checkCrossSigningStatus(): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).checkCrossSigningStatus();
    }

    /**
     * Get cross signing keys
     */
    public async getCrossSigningKeys(): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getCrossSigningKeys();
    }

    /**
     * Is cross signing ready
     */
    public isCrossSigningReady(): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isCrossSigningReady();
    }

    /**
     * Get user cross signing keys
     */
    public async getUserCrossSigningKeys(userId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getUserCrossSigningKeys(userId);
    }

    /**
     * Check and trust cross signing
     */
    public async checkAndTrustCrossSigning(): Promise<boolean> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).checkAndTrustCrossSigning();
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getCrossSigningManager(): CrossSigningManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCrossSigningManager = function (): CrossSigningManager {
        return new CrossSigningManager(this);
    };
}

export default extendMatrixClient;
