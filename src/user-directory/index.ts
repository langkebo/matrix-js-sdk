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
import type { AuthPath } from "../auth/__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type { PathAssert, StripAuthPrefix } from "../http-api/strip-prefix";

function ap<const P extends string>(path: P & PathAssert<P, StripAuthPrefix<AuthPath>>): P {
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

export interface IUserDirectoryListPaginatedResult {
    users: Array<{
        user_id: string;
        display_name?: string;
        avatar_url?: string;
    }>;
    next_batch?: string;
}

export interface IUserProfile {
    avatar_url?: string;
    displayname?: string;
}

export class UserDirectoryManager extends BaseManager {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 按关键词搜索用户目录。
     *
     * @param term - 搜索关键词
     * @param limit - 返回结果上限，可选
     * @returns 匹配到的用户列表
     *
     * @example
     * ```typescript
     * const result = await client.getUserDirectoryManager().searchUserDirectory("alice", 10);
     * ```
     */
    public async searchUserDirectory(term: string, limit?: number): Promise<IUserDirectorySearchResult> {
        return this.client.searchUserDirectory({ term, limit });
    }

    /**
     * 列出用户目录中的全部用户。
     *
     * @returns 用户列表
     *
     * @example
     * ```typescript
     * const result = await client.getUserDirectoryManager().listUserDirectory();
     * ```
     */
    public async listUserDirectory(): Promise<IUserDirectoryListResult> {
        const path = ap("/user_directory/list");
        return this.withRetry(async () => {
            return await this.request<IUserDirectoryListResult>({
                method: Method.Post,
                path: path,
            });
        }, "listUserDirectory");
    }

    /**
     * 分页列出用户目录中的用户。
     *
     * @param limit - 每页返回数量，可选
     * @param since - 分页游标，可选
     * @returns 分页后的用户列表及下一页游标
     *
     * @example
     * ```typescript
     * const page = await client.getUserDirectoryManager().listUserDirectoryPaginated(20, "next-cursor");
     * ```
     */
    public async listUserDirectoryPaginated(
        limit?: number,
        since?: string,
    ): Promise<IUserDirectoryListPaginatedResult> {
        const path = ap("/user_directory/list");
        const body: { limit?: number; since?: string } = {};
        if (limit !== undefined) body.limit = limit;
        if (since !== undefined) body.since = since;
        return this.withRetry(async () => {
            const response = await this.request<{
                results?: Array<{ user_id: string; display_name?: string; avatar_url?: string }>;
                users?: Array<{ user_id: string; display_name?: string; avatar_url?: string }>;
                next_batch?: string;
            }>({
                method: Method.Post,
                path: path,
                body,
            });
            // 后端可能返回 results 或 users，统一为 users
            return {
                users: response.users ?? response.results ?? [],
                next_batch: response.next_batch,
            };
        }, "listUserDirectoryPaginated");
    }

    /**
     * 获取指定用户的资料。
     *
     * @param userId - 用户 ID
     * @returns 用户资料
     *
     * @example
     * ```typescript
     * const profile = await client.getUserDirectoryManager().getProfile("@alice:example.org");
     * ```
     */
    public async getProfile(userId: string): Promise<IUserProfile> {
        const path = ap(`/user_directory/profiles/${encodeURIComponent(userId)}`);
        return this.withRetry(async () => {
            return await this.request<IUserProfile>({
                method: Method.Get,
                path: path,
            });
        }, "getProfile");
    }

    /**
     * 从本地商店获取指定用户。
     *
     * @param userId - 用户 ID
     * @returns 对应的 User；不存在时返回 null
     *
     * @example
     * ```typescript
     * const user = client.getUserDirectoryManager().getUser("@alice:example.org");
     * ```
     */
    public getUser(userId: string): User | null {
        return this.client.getUser(userId);
    }

    /**
     * 获取本地商店中的全部用户。
     *
     * @returns 用户列表
     *
     * @example
     * ```typescript
     * const users = client.getUserDirectoryManager().getUsers();
     * ```
     */
    public getUsers(): User[] {
        return this.client.getUsers();
    }

    /**
     * 按显示名称查找用户。
     *
     * @param displayName - 用户显示名称
     * @returns 匹配到的 User；不存在时返回 undefined
     *
     * @example
     * ```typescript
     * const user = client.getUserDirectoryManager().getUserByDisplayName("Alice");
     * ```
     */
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
