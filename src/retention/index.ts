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

export interface RetentionPolicy {
    min_lifetime?: number;
    max_lifetime?: number;
}

export interface RetentionState {
    enabled?: boolean;
    policy?: RetentionPolicy;
}

/**
 * 消息保留策略管理器
 * 对应后端服务: retention_service
 */
export class RetentionManager {
    constructor(private client: MatrixClient) {}

    /**
     * 获取房间的保留策略
     * 对应 API: GET /rooms/{room_id}/ Retention
     */
    public async getRoomRetention(roomId: string): Promise<RetentionPolicy | null> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomRetention(roomId);
    }

    /**
     * 设置房间的保留策略
     * 对应 API: PUT /rooms/{room_id}/ Retention
     */
    public async setRoomRetention(roomId: string, policy: RetentionPolicy): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).setRoomRetention(roomId, policy);
    }

    /**
     * 获取服务器的默认保留策略
     * 对应 API: GET / Retention
     */
    public async getServerRetention(): Promise<RetentionPolicy | null> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getServerRetention();
    }

    /**
     * 获取房间的保留状态
     */
    public getRoomRetentionState(roomId: string): RetentionState {
        const room = this.client.getRoom(roomId);
        if (!room) {
            return { enabled: false };
        }
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const retentionState = (room.currentState as any).getStateEvents("m.room.retention");
        if (retentionState && retentionState.getContent()) {
            return {
                enabled: true,
                policy: retentionState.getContent() as RetentionPolicy
            };
        }
        
        return { enabled: false };
    }

    /**
     * 获取所有房间的保留策略
     */
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

    /**
     * 检查消息是否在保留期内
     */
    public isMessageWithinRetention(roomId: string, timestamp: number): boolean {
        const state = this.getRoomRetentionState(roomId);
        
        if (!state.enabled || !state.policy || !state.policy.max_lifetime) {
            return true; // 没有保留策略，默认保留
        }
        
        const age = Date.now() - timestamp;
        return age < state.policy.max_lifetime;
    }

    /**
     * 获取消息剩余保留时间（毫秒）
     */
    public getMessageRemainingLifetime(roomId: string, timestamp: number): number | null {
        const state = this.getRoomRetentionState(roomId);
        
        if (!state.enabled || !state.policy || !state.policy.max_lifetime) {
            return null; // 无保留策略，永久保留
        }
        
        const age = Date.now() - timestamp;
        const remaining = state.policy.max_lifetime - age;
        
        return remaining > 0 ? remaining : 0;
    }
}

// Declare prototype extension
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
