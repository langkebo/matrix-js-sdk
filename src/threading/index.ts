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
 * Threading Manager - 线程管理
 * 
 * 提供线程相关功能
 */

import { MatrixClient } from "../client";

export class ThreadingManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get thread
     */
    public getThread(threadId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getThread(threadId);
    }

    /**
     * Get thread list
     */
    public getThreadList(): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getThreadList();
    }

    /**
     * Get threads
     */
    public getThreads(): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getThreads();
    }

    /**
     * Has thread
     */
    public hasThread(threadId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).hasThread(threadId);
    }

    /**
     * Create thread
     */
    public async createThread(roomId: string, eventId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).createThread(roomId, eventId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getThreadingManager(): ThreadingManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getThreadingManager = function (): ThreadingManager {
        return new ThreadingManager(this);
    };
}

export default extendMatrixClient;
