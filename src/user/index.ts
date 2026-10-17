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
 * User Manager - 用户管理
 *
 * 提供用户信息获取、忽略用户等功能
 */

import { MatrixClient } from "../client";
import { User } from "../models/user";
import { type EmptyObject } from "../@types/common";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { ValidationError } from "../errors";

export interface UserManagerEvents {
    user_ignored: { userId: string };
    user_unignored: { userId: string };
    user_updated: { userId: string };
}

export class UserManager extends BaseManager<keyof UserManagerEvents, UserManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 获取当前登录用户的用户 ID
     *
     * @returns 用户 ID，未登录时返回 null
     * @example
     * ```typescript
     * const userId = client.getUserManager().getUserId();
     * console.log(userId);
     * ```
     */
    public getUserId(): string | null {
        return this.client.credentials.userId;
    }

    /**
     * 获取当前登录用户的用户 ID，未登录时抛出错误
     *
     * @returns 用户 ID
     * @throws {ValidationError} 未设置用户 ID 时
     * @example
     * ```typescript
     * const userId = client.getUserManager().getSafeUserId();
     * ```
     */
    public getSafeUserId(): string {
        const userId = this.client.credentials.userId;
        if (!userId) {
            throw new ValidationError("User ID not set");
        }
        return userId;
    }

    /**
     * 获取当前用户的本地部分（用户 ID 中 `:` 之前的部分）
     *
     * @returns 本地部分，未登录时返回 null
     * @example
     * ```typescript
     * const localpart = client.getUserManager().getUserIdLocalpart();
     * console.log(localpart);
     * ```
     */
    public getUserIdLocalpart(): string | null {
        const userId = this.client.credentials.userId;
        if (!userId) return null;
        const colonIndex = userId.indexOf(":");
        if (colonIndex === -1) return userId;
        return userId.substring(0, colonIndex);
    }

    /**
     * 获取当前用户的 homeserver 域名（用户 ID 中 `:` 之后的部分）
     *
     * @returns 域名，未登录或格式无效时返回 null
     * @example
     * ```typescript
     * const domain = client.getUserManager().getDomain();
     * console.log(domain);
     * ```
     */
    public getDomain(): string | null {
        const userId = this.client.credentials.userId;
        if (!userId) return null;
        const colonIndex = userId.indexOf(":");
        if (colonIndex === -1) return null;
        return userId.substring(colonIndex + 1);
    }

    /**
     * 从本地存储中获取指定用户
     *
     * @param userId - 用户 ID
     * @returns 用户对象，未找到时返回 null
     * @example
     * ```typescript
     * const user = client.getUserManager().getUser("@alice:example.org");
     * console.log(user?.userId);
     * ```
     */
    public getUser(userId: string): User | null {
        return this.client.store.getUser(userId);
    }

    /**
     * 获取本地存储中的全部用户
     *
     * @returns 用户数组
     * @example
     * ```typescript
     * const users = client.getUserManager().getUsers();
     * console.log(users.length);
     * ```
     */
    public getUsers(): User[] {
        return this.client.store.getUsers();
    }

    /**
     * 获取当前用户忽略的用户 ID 列表
     *
     * @returns 忽略的用户 ID 数组
     * @example
     * ```typescript
     * const ignored = client.getUserManager().getIgnoredUsers();
     * console.log(ignored);
     * ```
     */
    public getIgnoredUsers(): string[] {
        const event = this.client.store.getAccountData("m.ignored_user_list");
        if (!event) return [];
        const content = event.getContent();
        return Object.keys(content.ignored_users || {});
    }

    /**
     * 设置当前用户忽略的用户列表
     *
     * @param userIds - 要忽略的用户 ID 列表（会整体覆盖现有列表）
     * @returns 请求成功后返回空对象
     * @example
     * ```typescript
     * await client.getUserManager().setIgnoredUsers(["@spammer:example.org"]);
     * ```
     */
    public async setIgnoredUsers(userIds: string[]): Promise<EmptyObject> {
        const ignoredUsers: Record<string, Record<string, never>> = {};
        for (const userId of userIds) {
            ignoredUsers[userId] = {};
        }
        return this.withRetry(
            () => this.client.setAccountData("m.ignored_user_list", { ignored_users: ignoredUsers }),
            "setIgnoredUsers",
        );
    }

    /**
     * 判断指定用户是否被当前用户忽略
     *
     * @param userId - 用户 ID
     * @returns 是否被忽略
     * @example
     * ```typescript
     * const ignored = client.getUserManager().isUserIgnored("@spammer:example.org");
     * ```
     */
    public isUserIgnored(userId: string): boolean {
        return this.getIgnoredUsers().includes(userId);
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getUserManager = function (): UserManager {
        registerManagerClass("user", UserManager);
        return getOrCreateManager(this, "user", () => new UserManager(this));
    };

    MatrixClient.prototype.getUser = function (this: MatrixClient, userId: string): User | null {
        return this.getUserManager().getUser(userId);
    };

    MatrixClient.prototype.getUsers = function (this: MatrixClient): User[] {
        return this.getUserManager().getUsers();
    };
}
