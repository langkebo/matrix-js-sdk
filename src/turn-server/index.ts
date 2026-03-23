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
 * Turn Server Manager - TURN服务器管理
 * 
 * 提供TURN服务器信息获取功能
 */

import { MatrixClient } from "../client";

export class TurnServerManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get turn servers
     */
    public async getTurnServers(): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getTurnServers();
    }

    /**
     * Get turn server URIs
     */
    public async getTurnServerURIs(): Promise<string[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getTurnServerURIs();
    }

    /**
     * Check if turn server needs refresh
     */
    public getTurnServerExpiry(): number {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).turnServersExpiry || 0;
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getTurnServerManager(): TurnServerManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getTurnServerManager = function (): TurnServerManager {
        return new TurnServerManager(this);
    };
}

export default extendMatrixClient;
