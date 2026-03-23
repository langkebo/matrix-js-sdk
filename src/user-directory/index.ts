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
 * User Directory Manager - 用户目录管理
 * 
 * 提供用户目录搜索相关功能
 */

import { MatrixClient } from "../client";

export class UserDirectoryManager {
    constructor(private client: MatrixClient) {}

    /**
     * Search user directory
     */
    public async searchUserDirectory(term: string, limit?: number): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).searchUserDirectory(term, limit);
    }

    /**
     * Get profile
     */
    public async getProfile(userId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getProfile(userId);
    }

    /**
     * Get user
     */
    public getUser(userId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getUser(userId);
    }

    /**
     * Get users
     */
    public getUsers(): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getUsers();
    }

    /**
     * Get user By display name
     */
    public getUserByDisplayName(displayName: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getUserByDisplayName(displayName);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getUserDirectoryManager(): UserDirectoryManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getUserDirectoryManager = function (): UserDirectoryManager {
        return new UserDirectoryManager(this);
    };
}

export default extendMatrixClient;
