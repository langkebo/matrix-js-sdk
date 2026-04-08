/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You May obtain a copy of the License at

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

export interface IServerCapabilities {
    capabilities: {
        [key: string]: {
            enabled?: boolean;
            available?: boolean;
            [key: string]: unknown;
        };
    };
}

export class CapabilitiesManager {
    constructor(private client: MatrixClient) {}

    public async getCapabilities(): Promise<IServerCapabilities | undefined> {
        return (this.client as unknown as {
            serverCapabilitiesService?: {
                getCachedCapabilities: () => IServerCapabilities | undefined;
                fetchCapabilities: () => Promise<IServerCapabilities>;
            };
        }).serverCapabilitiesService?.getCachedCapabilities() || 
        (this.client as unknown as {
            serverCapabilitiesService?: {
                fetchCapabilities: () => Promise<IServerCapabilities>;
            };
        }).serverCapabilitiesService?.fetchCapabilities();
    }

    public getCachedCapabilities(): IServerCapabilities | undefined {
        return (this.client as unknown as {
            serverCapabilitiesService?: {
                getCachedCapabilities: () => IServerCapabilities | undefined;
            };
        }).serverCapabilitiesService?.getCachedCapabilities();
    }

    public async fetchCapabilities(): Promise<IServerCapabilities | undefined> {
        const service = (this.client as unknown as {
            serverCapabilitiesService?: {
                fetchCapabilities: () => Promise<IServerCapabilities>;
            };
        }).serverCapabilitiesService;
        return service?.fetchCapabilities();
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
