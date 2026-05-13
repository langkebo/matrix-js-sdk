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
 * Server Capabilities Manager - 服务器能力管理
 *
 * 提供服务器能力相关功能
 */

import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface ServerCapabilities {
    [key: string]: unknown;
}

export interface ServerCapabilitiesManagerEvents {
    capabilities_updated: { capabilities: ServerCapabilities };
    server_version_updated: { version: string };
}

export class ServerCapabilitiesManager extends BaseManager<
    keyof ServerCapabilitiesManagerEvents,
    ServerCapabilitiesManagerEvents
> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async getServerCapabilities(): Promise<ServerCapabilities> {
        return this.withRetry(() => this.client.getServerCapabilities(), "getServerCapabilities");
    }

    public hasServerSupport(feature: string): boolean {
        return this.client.hasServerSupport(feature);
    }

    public async getServerVersion(): Promise<string> {
        return this.withRetry(() => this.client.getServerVersion(), "getServerVersion");
    }

    public supportsThreads(): boolean {
        return this.client.supportsThreads();
    }

    public supportsLocation(): boolean {
        return this.client.supportsLocation();
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getServerCapabilitiesManager(): ServerCapabilitiesManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getServerCapabilitiesManager = function (): ServerCapabilitiesManager {
        return getOrCreateManager(this, "serverCapabilities", () => new ServerCapabilitiesManager(this));
    };
}

export default extendMatrixClient;
