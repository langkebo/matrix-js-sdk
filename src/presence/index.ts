import { logger } from "../logger"
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
 * Presence Manager - 在线状态管理
 * 
 * 提供用户在线状态的设置、查询、订阅功能
 */

import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";

export enum PresenceEvent {
    PresenceUpdated = "PresenceUpdated",
    PresenceListUpdated = "PresenceListUpdated",
    PresenceError = "PresenceError",
}

export type PresenceState = "online" | "offline" | "unavailable" | "busy";

export interface IPresenceState {
    presence: PresenceState;
    status_msg?: string;
    last_active_ago?: number;
    currently_active?: boolean;
}

export interface IPresenceEvent {
    user_id: string;
    presence: PresenceState;
    status_msg?: string;
    last_active_ago?: number;
    currently_active?: boolean;
}

export interface IPresenceList {
    presence: string[];
    presence_list: IPresenceEvent[];
}

interface PresenceManagerEventMap {
    [PresenceEvent.PresenceUpdated]: (userId: string, presence: IPresenceState) => void;
    [PresenceEvent.PresenceListUpdated]: (presences: IPresenceEvent[]) => void;
    [PresenceEvent.PresenceError]: (error: Error) => void;
}

export class PresenceManager extends TypedEventEmitter<PresenceEvent, PresenceManagerEventMap> {
    private client: any;
    private presenceCache: Map<string, IPresenceState> = new Map();
    private subscribedUsers: Set<string> = new Set();
    private initialized: boolean = false;

    constructor(client: any) {
        super();
        this.client = client;
    }

    async setPresence(presence: PresenceState, statusMsg?: string): Promise<void> {
        if (!presence) {
            throw new Error("Presence state is required");
        }

        const validStates: PresenceState[] = ["online", "offline", "unavailable", "busy"];
        if (!validStates.includes(presence)) {
            throw new Error(`Invalid presence state: ${presence}`);
        }

        try {
            const userId = this.client.getUserId();
            const body: any = {
                presence,
            };

            if (statusMsg !== undefined) {
                body.status_msg = statusMsg;
            }

            await this.client.http.authedRequest(
                Method.Put,
                `/_matrix/client/v3/presence/${encodeURIComponent(userId)}/status`,
                undefined,
                body,
                { prefix: ClientPrefix.V3 }
            );

            const state: IPresenceState = {
                presence,
                status_msg: statusMsg,
            };
            this.presenceCache.set(userId, state);
            this.emit(PresenceEvent.PresenceUpdated, userId, state);
        } catch (error) {
            this.emit(PresenceEvent.PresenceError, error as Error);
            throw error;
        }
    }

    async getPresence(userId: string): Promise<IPresenceState | null> {
        if (!userId) {
            throw new Error("User ID is required");
        }

        if (this.presenceCache.has(userId)) {
            return this.presenceCache.get(userId) || null;
        }

        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                `/_matrix/client/v3/presence/${encodeURIComponent(userId)}/status`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );

            const state: IPresenceState = {
                presence: response.presence,
                status_msg: response.status_msg,
                last_active_ago: response.last_active_ago,
                currently_active: response.currently_active,
            };

            this.presenceCache.set(userId, state);
            
            return state;
        } catch (e) {
            logger.warn('PresenceManager.getPresence failed:', e);
            return null;
        }
    }

    async getPresences(userIds: string[]): Promise<Map<string, IPresenceState>> {
        const result = new Map<string, IPresenceState>();

        for (const userId of userIds) {
            const presence = await this.getPresence(userId);
            if (presence) {
                result.set(userId, presence);
            }
        }

        return result;
    }

    async subscribeToPresence(userIds: string[]): Promise<void> {
        if (!userIds || userIds.length === 0) {
            throw new Error("User IDs are required");
        }

        try {
            await this.client.http.authedRequest(
                Method.Post,
                "/_matrix/client/v3/presence/list",
                undefined,
                { user_ids: userIds },
                { prefix: ClientPrefix.V3 }
            );

            userIds.forEach(userId => this.subscribedUsers.add(userId));
        } catch (error) {
            this.emit(PresenceEvent.PresenceError, error as Error);
            throw error;
        }
    }

    async unsubscribeFromPresence(userIds: string[]): Promise<void> {
        if (!userIds || userIds.length === 0) {
            throw new Error("User IDs are required");
        }

        try {
            const remainingUsers = Array.from(this.subscribedUsers).filter(
                u => !userIds.includes(u)
            );

            await this.client.http.authedRequest(
                Method.Post,
                "/_matrix/client/v3/presence/list",
                undefined,
                { user_ids: remainingUsers },
                { prefix: ClientPrefix.V3 }
            );

            userIds.forEach(userId => this.subscribedUsers.delete(userId));
        } catch (error) {
            this.emit(PresenceEvent.PresenceError, error as Error);
            throw error;
        }
    }

    async getSubscribedPresence(): Promise<IPresenceEvent[]> {
        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                "/_matrix/client/v3/presence/list",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );

            const events: IPresenceEvent[] = response || [];
            
            events.forEach(event => {
                const state: IPresenceState = {
                    presence: event.presence,
                    status_msg: event.status_msg,
                    last_active_ago: event.last_active_ago,
                    currently_active: event.currently_active,
                };
                this.presenceCache.set(event.user_id, state);
            });

            this.emit(PresenceEvent.PresenceListUpdated, events);
            
            return events;
        } catch (e) {
            logger.warn('PresenceManager.getSubscribedPresence failed:', e);
            return [];
        }
    }

    async setOnline(statusMsg?: string): Promise<void> {
        await this.setPresence("online", statusMsg);
    }

    async setOffline(statusMsg?: string): Promise<void> {
        await this.setPresence("offline", statusMsg);
    }

    async setUnavailable(statusMsg?: string): Promise<void> {
        await this.setPresence("unavailable", statusMsg);
    }

    async setBusy(statusMsg?: string): Promise<void> {
        await this.setPresence("busy", statusMsg);
    }

    async clearStatusMessage(): Promise<void> {
        const currentPresence = await this.getPresence(this.client.getUserId());
        if (currentPresence) {
            await this.setPresence(currentPresence.presence);
        }
    }

    updatePresenceFromSync(event: IPresenceEvent): void {
        const state: IPresenceState = {
            presence: event.presence,
            status_msg: event.status_msg,
            last_active_ago: event.last_active_ago,
            currently_active: event.currently_active,
        };

        this.presenceCache.set(event.user_id, state);
        this.emit(PresenceEvent.PresenceUpdated, event.user_id, state);
    }

    getCachedPresence(userId: string): IPresenceState | null {
        return this.presenceCache.get(userId) || null;
    }

    getCachedPresences(): Map<string, IPresenceState> {
        return new Map(this.presenceCache);
    }

    getSubscribedUsers(): string[] {
        return Array.from(this.subscribedUsers);
    }

    isSubscribed(userId: string): boolean {
        return this.subscribedUsers.has(userId);
    }

    async start(): Promise<void> {
        if (this.initialized) return;

        try {
            await this.getPresence(this.client.getUserId());
            this.initialized = true;
        } catch (e) {
            logger.warn('PresenceManager.start failed:', e);
        }
    }

    stop(): void {
        this.presenceCache.clear();
        this.subscribedUsers.clear();
        this.initialized = false;
    }
}
