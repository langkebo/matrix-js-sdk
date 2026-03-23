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
 * OTR Manager - OTR加密管理
 * 
 * 提供OTR(Off-The-Record)加密相关功能
 */

import { MatrixClient } from "../client";

export class OtrManager {
    constructor(private client: MatrixClient) {}

    /**
     * Begin OTR
     */
    public async beginOTR(userId: string, roomId?: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).beginOTR(userId, roomId);
    }

    /**
     * End OTR
     */
    public async endOTR(userId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).endOTR(userId);
    }

    /**
     * Send OTR message
     */
    public async sendOTRMessage(userId: string, message: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).sendOTRMessage(userId, message);
    }

    /**
     * Is OTR enabled
     */
    public isOTREnabled(): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isOTREnabled();
    }

    /**
     * Set OTR enabled
     */
    public setOTREnabled(enabled: boolean): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).setOTREnabled(enabled);
    }

    /**
     * Get OTR session
     */
    public getOTRSession(userId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getOTRSession(userId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getOtrManager(): OtrManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getOtrManager = function (): OtrManager {
        return new OtrManager(this);
    };
}

export default extendMatrixClient;
