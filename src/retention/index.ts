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
 * Retention Manager - 消息保留策略管理
 *
 * 提供消息保留策略相关功能
 * 对应后端: retention_service
 */

import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";

export interface RetentionPolicy {
    min_lifetime?: number;
    max_lifetime?: number;
}

export interface RetentionState {
    enabled?: boolean;
    policy?: RetentionPolicy;
}

export interface RetentionManagerEvents {
    retention_policy_updated: { roomId: string; policy: RetentionPolicy };
    message_expired: { roomId: string; eventId: string };
}

export class RetentionManager extends BaseManager<keyof RetentionManagerEvents, RetentionManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async getRoomRetention(roomId: string): Promise<RetentionPolicy | null> {
        const result = await this.client.getRoomRetention(roomId);
        return result as RetentionPolicy | null;
    }

    public async setRoomRetention(roomId: string, policy: RetentionPolicy): Promise<void> {
        await this.client.setRoomRetention(roomId, policy as Record<string, unknown>);
    }

    public async getServerRetention(): Promise<RetentionPolicy | null> {
        const result = await this.client.getServerRetention();
        return result as RetentionPolicy | null;
    }

    public getRoomRetentionState(roomId: string): RetentionState {
        const room = this.client.getRoom(roomId);
        if (!room) {
            return { enabled: false };
        }

        const retentionState = room.currentState.getStateEvents("m.room.retention", "");
        if (retentionState && retentionState.getContent()) {
            return {
                enabled: true,
                policy: retentionState.getContent() as RetentionPolicy,
            };
        }

        return { enabled: false };
    }

    public getAllRoomRetentionPolicies(): Record<string, RetentionPolicy> {
        const rooms = this.client.getRooms();
        const policies: Record<string, RetentionPolicy> = {};

        for (const room of rooms) {
            const state = this.getRoomRetentionState(room.roomId);
            if (state.enabled && state.policy) {
                policies[room.roomId] = state.policy;
            }
        }

        return policies;
    }

    public isMessageWithinRetention(roomId: string, timestamp: number): boolean {
        const state = this.getRoomRetentionState(roomId);

        if (!state.enabled || !state.policy || !state.policy.max_lifetime) {
            return true;
        }

        const age = Date.now() - timestamp;
        return age < state.policy.max_lifetime;
    }

    public getMessageRemainingLifetime(roomId: string, timestamp: number): number | null {
        const state = this.getRoomRetentionState(roomId);

        if (!state.enabled || !state.policy || !state.policy.max_lifetime) {
            return null;
        }

        const age = Date.now() - timestamp;
        const remaining = state.policy.max_lifetime - age;

        return remaining > 0 ? remaining : 0;
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getRetentionManager(): RetentionManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRetentionManager = function (): RetentionManager {
        return new RetentionManager(this);
    };
}

export default extendMatrixClient;
