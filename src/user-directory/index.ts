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
 * User Directory Manager - 用户目录搜索 API 封装
 *
 * 提供用户目录搜索功能，支持按用户 ID 和显示名称模糊匹配
 * 对接后端: synapse-rust/src/web/routes/user_directory.rs
 * API 路径: /_matrix/client/v3/user_directory/search
 *
 * 使用方式:
 * ```typescript
 * const manager = client.getUserDirectoryManager();
 * // 搜索用户
 * const results = await manager.searchUserDirectory({ term: "alice" });
 * ```
 */
import { MatrixClient } from "../client";
import { User } from "../models/user";
import { Method } from "../http-api/method";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import type { AuthPathPattern } from "../auth/__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

type StripAuthPrefix<P extends string> = P extends `/_matrix/client/v3${infer Rest}`
    ? Rest
    : P extends `/_matrix/client/r0${infer Rest}`
      ? Rest
      : P extends `/_matrix/client/v1${infer Rest}`
        ? Rest
        : P;

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
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public async searchUserDirectory(term: string, limit?: number): Promise<IUserDirectorySearchResult> {
        return this.client.searchUserDirectory({ term, limit });
    }

    public async listUserDirectory(): Promise<IUserDirectoryListResult> {
        const path = ap("/user_directory/list");
        return this.withRetry(async () => {
            return await this.request<IUserDirectoryListResult>({
                method: Method.Post,
                path: path,
            });
        }, "listUserDirectory");
    }

    public async getProfile(userId: string): Promise<IUserProfile> {
        const path = ap(`/user_directory/profiles/${encodeURIComponent(userId)}` as StripAuthPrefix<AuthPathPattern>);
        return this.withRetry(async () => {
            return await this.request<IUserProfile>({
                method: Method.Get,
                path: path,
            });
        }, "getProfile");
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

export function extendMatrixClient(): void {
    MatrixClient.prototype.getUserDirectoryManager = function (): UserDirectoryManager {
        registerManagerClass("userDirectory", UserDirectoryManager);
        return getOrCreateManager(this, "userDirectory", () => new UserDirectoryManager(this));
    };
}
