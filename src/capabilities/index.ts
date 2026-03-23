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
 * Capabilities Manager - 能力查询
 * 
 * 提供服务器能力查询功能
 */

import { MatrixClient } from "../client";

export class CapabilitiesManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get capabilities (cached)
     */
    public async getCapabilities(): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).serverCapabilitiesService?.getCachedCapabilities() || 
               // eslint-disable-next-line @typescript-eslint/no-explicit-any
               (this.client as any).serverCapabilitiesService?.fetchCapabilities();
    }

    /**
     * Get cached capabilities
     */
    public getCachedCapabilities(): any | undefined {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).serverCapabilitiesService?.getCachedCapabilities();
    }

    /**
     * Fetch capabilities from server
     */
    public fetchCapabilities(): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).serverCapabilitiesService?.fetchCapabilities();
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getCapabilitiesManager(): CapabilitiesManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCapabilitiesManager = function (): CapabilitiesManager {
        return new CapabilitiesManager(this);
    };
}

export default extendMatrixClient;
