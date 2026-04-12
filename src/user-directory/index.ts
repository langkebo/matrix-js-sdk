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

import { MatrixClient } from "../client";
import { User } from "../models/user";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { BaseManager } from "../managers/base-manager";

export interface IUserDirectorySearchResult {
    results: Array<{
        user_id: string;
        display_name?: string;
        avatar_url?: string;
    }>;
    limited?: boolean;
}

export interface IUserProfile {
    avatar_url?: string;
    displayname?: string;
}

export class UserDirectoryManager extends BaseManager {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async searchUserDirectory(term: string, limit?: number): Promise<IUserDirectorySearchResult> {
        return this.client.searchUserDirectory({ term, limit });
    }

    public async getProfile(userId: string): Promise<IUserProfile> {
        if (this.client.getProfileManager) {
            return this.client.getProfileManager().getProfileInfo(userId) as Promise<IUserProfile>;
        }
        return this.client.http.authedRequest<IUserProfile>(
            Method.Get,
            `/profile/${encodeURIComponent(userId)}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    }

    public getUser(userId: string): User | null {
        return this.client.getUser(userId);
    }

    public getUsers(): User[] {
        return this.client.getUsers();
    }

    public getUserByDisplayName(displayName: string): User | undefined {
        const users = this.client.getUsers();
        return users.find((u) => u.displayName === displayName);
    }
}

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
