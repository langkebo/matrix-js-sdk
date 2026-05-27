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
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";
import { ValidationError } from "../errors";

export interface UserManagerEvents {
    user_ignored: { userId: string };
    user_unignored: { userId: string };
    user_updated: { userId: string };
}

export class UserManager extends BaseManager<keyof UserManagerEvents, UserManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public getUserId(): string | null {
        return this.client.credentials.userId;
    }

    public getSafeUserId(): string {
        const userId = this.client.credentials.userId;
        if (!userId) {
            throw new ValidationError("User ID not set");
        }
        return userId;
    }

    public getUserIdLocalpart(): string | null {
        const userId = this.client.credentials.userId;
        if (!userId) return null;
        const colonIndex = userId.indexOf(":");
        if (colonIndex === -1) return userId;
        return userId.substring(0, colonIndex);
    }

    public getDomain(): string | null {
        const userId = this.client.credentials.userId;
        if (!userId) return null;
        const colonIndex = userId.indexOf(":");
        if (colonIndex === -1) return null;
        return userId.substring(colonIndex + 1);
    }

    public getUser(userId: string): User | null {
        return this.client.store.getUser(userId);
    }

    public getUsers(): User[] {
        return this.client.store.getUsers();
    }

    public getIgnoredUsers(): string[] {
        const event = this.client.store.getAccountData("m.ignored_user_list");
        if (!event) return [];
        const content = event.getContent();
        return Object.keys(content.ignored_users || {});
    }

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

    public isUserIgnored(userId: string): boolean {
        return this.getIgnoredUsers().includes(userId);
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getUserManager(): UserManager;
        getUser(userId: string): User | null;
        getUsers(): User[];
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getUserManager = function (): UserManager {
        return getOrCreateManager(this, "user", () => new UserManager(this));
    };

    MatrixClient.prototype.getUser = function (this: MatrixClient, userId: string): User | null {
        return this.getUserManager().getUser(userId);
    };

    MatrixClient.prototype.getUsers = function (this: MatrixClient): User[] {
        return this.getUserManager().getUsers();
    };
}

export default extendMatrixClient;
