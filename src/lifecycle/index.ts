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

export class LifecycleManager {
    constructor(private client: MatrixClient) {}

    /**
     * Start client
     */
    public async startClient(): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).startClient();
    }

    /**
     * Stop client
     */
    public async stopClient(): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).stopClient();
    }

    /**
     * Is client running
     */
    public isClientRunning(): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).clientRunning;
    }

    /**
     * Exit
     */
    public async exit(code?: number): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).exit(code);
    }

    /**
     * Terminate
     */
    public terminate(): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).terminate();
    }

    /**
     * Reset
     */
    public async reset(): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).reset();
    }

    /**
     * Prepare
     */
    public async prepare(clientOptions?: any): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).prepare(clientOptions);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getLifecycleManager(): LifecycleManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getLifecycleManager = function (): LifecycleManager {
        return new LifecycleManager(this);
    };
}

export default extendMatrixClient;
