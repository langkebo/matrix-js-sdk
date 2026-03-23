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
 * VoIP Calls Manager - VoIP通话管理
 * 
 * 提供VoIP通话相关功能
 */

import { MatrixClient } from "../client";

export class VoIPCallsManager {
    constructor(private client: MatrixClient) {}

    /**
     * Create call
     */
    public createCall(roomId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).createCall(roomId);
    }

    /**
     * Set supports call transfer
     */
    public setSupportsCallTransfer(support: boolean): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).setSupportsCallTransfer(support);
    }

    /**
     * Get call
     */
    public getCall(roomId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getCall(roomId);
    }

    /**
     * Get all calls
     */
    public getAllCalls(): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getAllCalls();
    }

    /**
     * Get calls for room
     */
    public getCallsForRoom(roomId: string): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getCallsForRoom(roomId);
    }

    /**
     * Terminate all calls
     */
    public async terminateAllCalls(): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).terminateAllCalls();
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getVoIPCallsManager(): VoIPCallsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getVoIPCallsManager = function (): VoIPCallsManager {
        return new VoIPCallsManager(this);
    };
}

export default extendMatrixClient;
