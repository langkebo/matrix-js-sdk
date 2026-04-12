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
 * User Presence Manager - 用户在线状态管理
 *
 * 提供用户在线状态相关功能
 */

import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";

export interface IPresenceResponse {
    presence: string;
    last_active_ago?: number;
    status_msg?: string;
    currently_active?: boolean;
}

export interface ICachedPresence {
    presence: string;
    lastActiveAgo?: number;
    statusMsg?: string;
    currentlyActive?: boolean;
}

export interface UserPresenceManagerEvents {
    presence_updated: { userId: string; presence: IPresenceResponse };
    presence_subscribed: { userIds: string[] };
}

export class UserPresenceManager extends BaseManager<keyof UserPresenceManagerEvents, UserPresenceManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async getUserPresence(userId: string): Promise<IPresenceResponse> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        getUserPresence: (userId: string) => Promise<IPresenceResponse>;
                    }
                ).getUserPresence(userId),
            "getUserPresence",
        );
    }

    public async setPresence(presence: string, statusMsg?: string): Promise<{}> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        setPresence: (presence: string, statusMsg?: string) => Promise<{}>;
                    }
                ).setPresence(presence, statusMsg),
            "setPresence",
        );
    }

    public getCachedPresence(userId: string): ICachedPresence | null {
        return (
            this.client as unknown as {
                getCachedPresence: (userId: string) => ICachedPresence | null;
            }
        ).getCachedPresence(userId);
    }

    public isPresenceAvailable(): boolean {
        return (
            this.client as unknown as {
                isPresenceAvailable: () => boolean;
            }
        ).isPresenceAvailable();
    }

    public async subscribeToPresence(userIds: string[]): Promise<void> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        subscribeToPresence: (userIds: string[]) => Promise<void>;
                    }
                ).subscribeToPresence(userIds),
            "subscribeToPresence",
        );
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getUserPresenceManager(): UserPresenceManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getUserPresenceManager = function (): UserPresenceManager {
        return new UserPresenceManager(this);
    };
}

export default extendMatrixClient;
