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
 * Server Time Manager - 服务器时间管理
 * 
 * 提供服务器时间同步功能
 */

import { MatrixClient } from "../client";

export class ServerTimeManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get server clock diff
     */
    public getServerClockDiff(): number {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).serverClockDiff || 0;
    }

    /**
     * Get local timestamp for server time
     */
    public getLocalTimestampForServerTime(serverTime: number): number {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getLocalTimestampForServerTime(serverTime);
    }

    /**
     * Get server timestamp
     */
    public getServerTimestamp(): number {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getServerTimestamp();
    }

    /**
     * Update server time info
     */
    public updateServerTimeInfo(serverTime: number, serverDate: string): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).updateServerTimeInfo(serverTime, serverDate);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getServerTimeManager(): ServerTimeManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getServerTimeManager = function (): ServerTimeManager {
        return new ServerTimeManager(this);
    };
}

export default extendMatrixClient;
