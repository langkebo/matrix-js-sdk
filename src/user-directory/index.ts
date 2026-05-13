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
import { BaseManager } from "../managers/base-manager";
import type { AuthPathPattern } from "../auth/__generated__/route-table.ts";
import { getOrCreateManager } from "../client-infra/manager-registry";

type StripAuthPrefix<P extends string> =
    P extends `/_matrix/client/v3${infer Rest}` ? Rest :
    P extends `/_matrix/client/r0${infer Rest}` ? Rest :
    P extends `/_matrix/client/v1${infer Rest}` ? Rest :
    P;

function ap<P extends StripAuthPrefix<AuthPathPattern>>(path: P): P {
    return path;
}

export interface IUserDirectorySearchResult {
    results: Array<{
        user_id: string;
        display_name?: string;
        avatar_url?: string;
    }>;
    limited?: boolean;
}

export interface IUserDirectoryListResult {
    users: Array<{
        user_id: string;
        display_name?: string;
        avatar_url?: string;
    }>;
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

    public async listUserDirectory(): Promise<IUserDirectoryListResult> {
        const path = ap("/user_directory/list");
        return this.client.http.request<IUserDirectoryListResult>(Method.Post, path);
    }

    public async getProfile(userId: string): Promise<IUserProfile> {
        // Note: this always hits the /user_directory/profiles endpoint,
        // which returns an IUserProfile with user_id, display_name, and avatar_url.
        // It's meant for public directory lookup, not for private profile details.
        const path = ap(`/user_directory/profiles/${encodeURIComponent(userId)}` as StripAuthPrefix<AuthPathPattern>);
        return this.client.http.request<IUserProfile>(Method.Get, path);
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
        return getOrCreateManager(this, "userDirectory", () => new UserDirectoryManager(this));
    };
}

export default extendMatrixClient;
