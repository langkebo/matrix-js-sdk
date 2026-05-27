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
 * Lifecycle Manager - 生命周期管理
 *
 * 提供客户端生命周期相关功能
 */

import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface IClientOptions {
    baseUrl?: string;
    idBaseUrl?: string;
    accessToken?: string;
    userId?: string;
    deviceId?: string;
    sessionStore?: unknown;
    store?: unknown;
    scheduler?: unknown;
    cryptoStore?: unknown;
    verificationMethods?: string[];
}

export interface LifecycleManagerEvents {
    client_started: void;
    client_stopped: void;
    client_reset: void;
    client_terminated: void;
}

export class LifecycleManager extends BaseManager<keyof LifecycleManagerEvents, LifecycleManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async startClient(): Promise<void> {
        return this.withRetry(() => this.client.startClient(), "startClient");
    }

    public async stopClient(): Promise<void> {
        await this.client.stopClient();
    }

    public isClientRunning(): boolean {
        return this.client.clientRunning ?? false;
    }

    public async exit(code?: number): Promise<void> {
        await this.client.exit(code);
    }

    public terminate(): void {
        this.client.terminate();
    }

    public async reset(): Promise<void> {
        await this.client.reset();
    }

    public async prepare(clientOptions?: IClientOptions): Promise<void> {
        await this.client.prepare(clientOptions);
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getLifecycleManager(): LifecycleManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getLifecycleManager = function (): LifecycleManager {
        return getOrCreateManager(this, "lifecycle", () => new LifecycleManager(this));
    };
}

export default extendMatrixClient;
