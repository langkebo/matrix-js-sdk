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
 * 对接后端: synapse-rust/src/web/routes/admin/retention.rs
 * 后端提供 (Admin API):
 *   GET  /_synapse/admin/v1/retention/policy              (获取服务器保留策略)
 *   POST /_synapse/admin/v1/retention/policy              (设置服务器保留策略)
 *   GET  /_synapse/admin/v1/retention/policy/{room_id}    (获取房间保留策略)
 *   POST /_synapse/admin/v1/retention/policy/{room_id}    (设置房间保留策略)
 *   POST /_synapse/admin/v1/retention/run                 (执行保留清理)
 *   GET  /_synapse/admin/v1/retention/status              (获取保留状态)
 *
 * 客户端 API (通过 m.room.retention 状态事件):
 *   房间保留策略通过 m.room.retention 状态事件读取
 */

import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { InvalidParamError } from "../common/errors";

export interface RetentionPolicy {
    max_lifetime?: number;
    min_lifetime?: number;
    expire_on_clients?: boolean;
}

export interface RetentionState {
    enabled: boolean;
    policy?: RetentionPolicy;
}

export interface IRetentionRunResult {
    started: boolean;
    room_id?: string;
    scope?: string;
    events_deleted?: number;
    status?: string;
    completed_ts?: number | null;
}

export interface IRetentionStatus {
    server_policy_enabled: boolean;
    rooms_with_custom_policy: number;
    lifecycle_cleanup_enabled: boolean;
    cleanup_batch_size: number;
    audit_retention_days: number;
    queue_retention_days: number;
    last_run: {
        started_ts: number;
        completed_ts: number | null;
        duration_ms: number | null;
        expired_events_deleted: number;
        expired_beacons_deleted: number;
        expired_uploads_deleted: number;
        expired_audit_events_deleted: number;
        cleanup_queue_items_processed: number;
        cleanup_queue_rows_pruned: number;
        failed_tasks: number;
    } | null;
}

export interface RetentionManagerEvents {
    retentionPolicyUpdated: (data: { roomId: string; policy: RetentionPolicy }) => void;
    serverPolicyUpdated: (data: { policy: RetentionPolicy }) => void;
    retentionRunCompleted: (data: { result: IRetentionRunResult }) => void;
    messageExpired: (data: { roomId: string; eventId: string }) => void;
}

export class RetentionManager extends BaseManager<keyof RetentionManagerEvents, RetentionManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async getServerRetentionPolicy(): Promise<RetentionPolicy> {
        return this.withRetry(async () => {
            const response = await this.adminRequest<RetentionPolicy>(Method.Get, "/retention/policy");
            return response;
        }, "getServerRetentionPolicy");
    }

    public async setServerRetentionPolicy(policy: RetentionPolicy): Promise<RetentionPolicy> {
        return this.withRetry(async () => {
            const response = await this.adminRequest<RetentionPolicy>(Method.Post, "/retention/policy", undefined, {
                max_lifetime: policy.max_lifetime ?? null,
                min_lifetime: policy.min_lifetime ?? null,
                expire_on_clients: policy.expire_on_clients ?? false,
            });
            this.emit("serverPolicyUpdated", { policy: response });
            return response;
        }, "setServerRetentionPolicy");
    }

    public async getRoomRetentionPolicy(roomId: string): Promise<RetentionPolicy & { room_id: string }> {
        if (!roomId) {
            throw new InvalidParamError("roomId is required");
        }

        return this.withRetry(async () => {
            const response = await this.adminRequest<RetentionPolicy & { room_id: string }>(
                Method.Get,
                `/retention/policy/${encodeURIComponent(roomId)}`,
            );
            return response;
        }, "getRoomRetentionPolicy");
    }

    public async setRoomRetentionPolicy(
        roomId: string,
        policy: RetentionPolicy,
    ): Promise<RetentionPolicy & { room_id: string }> {
        if (!roomId) {
            throw new InvalidParamError("roomId is required");
        }

        return this.withRetry(async () => {
            const response = await this.adminRequest<RetentionPolicy & { room_id: string }>(
                Method.Post,
                `/retention/policy/${encodeURIComponent(roomId)}`,
                undefined,
                {
                    max_lifetime: policy.max_lifetime ?? null,
                    min_lifetime: policy.min_lifetime ?? null,
                    expire_on_clients: policy.expire_on_clients ?? false,
                },
            );
            this.emit("retentionPolicyUpdated", { roomId, policy: response });
            return response;
        }, "setRoomRetentionPolicy");
    }

    public async runRetention(roomId?: string): Promise<IRetentionRunResult> {
        return this.withRetry(async () => {
            const body: Record<string, unknown> = {};
            if (roomId) {
                body.room_id = roomId;
            }

            const response = await this.adminRequest<IRetentionRunResult>(
                Method.Post,
                "/retention/run",
                undefined,
                body,
            );
            this.emit("retentionRunCompleted", { result: response });
            return response;
        }, "runRetention");
    }

    public async getRetentionStatus(): Promise<IRetentionStatus> {
        return this.withRetry(
            () => this.adminRequest<IRetentionStatus>(Method.Get, "/retention/status"),
            "getRetentionStatus",
        );
    }

    public getRoomRetentionState(roomId: string): RetentionState {
        if (!roomId) {
            throw new InvalidParamError("roomId is required");
        }

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
        if (!roomId) {
            throw new InvalidParamError("roomId is required");
        }

        const state = this.getRoomRetentionState(roomId);

        if (!state.enabled || !state.policy || !state.policy.max_lifetime) {
            return true;
        }

        const age = Date.now() - timestamp;
        return age < state.policy.max_lifetime;
    }

    public getMessageRemainingLifetime(roomId: string, timestamp: number): number | null {
        if (!roomId) {
            throw new InvalidParamError("roomId is required");
        }

        const state = this.getRoomRetentionState(roomId);

        if (!state.enabled || !state.policy || !state.policy.max_lifetime) {
            return null;
        }

        const age = Date.now() - timestamp;
        const remaining = state.policy.max_lifetime - age;

        return remaining > 0 ? remaining : 0;
    }

    private async adminRequest<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, unknown>,
        body?: Record<string, unknown>,
    ): Promise<T> {
        return this.client.http.authedRequest<T>(
            method,
            `/_synapse/admin/v1${path}`,
            queryParams as Record<string, string> | undefined,
            body,
            { prefix: "" },
        );
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
