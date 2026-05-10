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
 * 对接后端: synapse-rust/src/web/routes/presence.rs
 * 后端提供:
 *   - PUT  /presence/{userId}/status     (设置用户在线状态)
 *   - GET  /presence/{userId}/status     (获取用户在线状态)
 *   - POST /presence/list                (订阅在线状态列表)
 */

import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { InvalidParamError } from "../common/errors";
import { encodeUri } from "../utils";

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

export type PresenceState = "online" | "offline" | "unavailable" | "busy";

export interface UserPresenceManagerEvents {
    presenceUpdated: (payload: { userId: string; presence: IPresenceResponse }) => void;
    presenceSubscribed: (payload: { userIds: string[] }) => void;
}

const VALID_PRESENCE_STATES: PresenceState[] = ["online", "offline", "unavailable", "busy"];

export class UserPresenceManager extends BaseManager<keyof UserPresenceManagerEvents, UserPresenceManagerEvents> {
    private presenceCache: Map<string, ICachedPresence> = new Map();

    constructor(client: MatrixClient) {
        super(client);
    }

    public async getUserPresence(userId: string): Promise<IPresenceResponse> {
        if (!userId) {
            throw new InvalidParamError("userId is required");
        }

        return this.withRetry(async () => {
            const path = encodeUri("/presence/$userId/status", { $userId: userId });
            const response = await this.client.http.authedRequest<IPresenceResponse>(
                Method.Get,
                path,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );

            this.presenceCache.set(userId, {
                presence: response.presence,
                lastActiveAgo: response.last_active_ago,
                statusMsg: response.status_msg,
                currentlyActive: response.currently_active,
            });

            this.emit("presenceUpdated", { userId, presence: response });
            return response;
        }, "getUserPresence");
    }

    public async setPresence(presence: PresenceState, statusMsg?: string): Promise<{}> {
        if (!presence) {
            throw new InvalidParamError("presence is required");
        }
        if (!VALID_PRESENCE_STATES.includes(presence)) {
            throw new InvalidParamError(`Invalid presence state. Valid values: ${VALID_PRESENCE_STATES.join(", ")}`);
        }

        return this.withRetry(async () => {
            const userId = this.client.getUserId();
            if (!userId) {
                throw new InvalidParamError("User is not logged in");
            }

            const path = encodeUri("/presence/$userId/status", { $userId: userId });
            const body: Record<string, unknown> = { presence };
            if (statusMsg !== undefined) {
                body.status_msg = statusMsg;
            }

            const response = await this.client.http.authedRequest<{}>(Method.Put, path, undefined, body, {
                prefix: ClientPrefix.V3,
            });

            this.presenceCache.set(userId, {
                presence,
                statusMsg,
            });

            return response;
        }, "setPresence");
    }

    public getCachedPresence(userId: string): ICachedPresence | null {
        return this.presenceCache.get(userId) ?? null;
    }

    public isPresenceAvailable(): boolean {
        return this.client.isGuest() === false;
    }

    public async subscribeToPresence(userIds: string[]): Promise<void> {
        if (!userIds || userIds.length === 0) {
            throw new InvalidParamError("userIds is required and must be non-empty");
        }

        return this.withRetry(async () => {
            await this.client.http.authedRequest<void>(
                Method.Post,
                "/presence/list",
                undefined,
                { user_ids: userIds },
                { prefix: ClientPrefix.V3 },
            );

            this.emit("presenceSubscribed", { userIds });
        }, "subscribeToPresence");
    }

    public clearPresenceCache(): void {
        this.presenceCache.clear();
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
