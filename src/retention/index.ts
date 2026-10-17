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
import type { IContent } from "../models/event";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { InvalidParamError } from "../common/errors";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface RetentionPolicy {
    max_lifetime?: number;
    min_lifetime?: number;
    /** m.room.retention state event field (Matrix spec) */
    expire_on_clients?: boolean;
    /** Admin API field name (synapse-rust retention.rs) */
    is_expire_on_clients?: boolean;
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
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 获取服务器的默认消息保留策略。
     *
     * @returns 服务器保留策略
     *
     * @example
     * ```typescript
     * const policy = await client.getRetentionManager().getServerRetentionPolicy();
     * ```
     */
    public async getServerRetentionPolicy(): Promise<RetentionPolicy> {
        return await this.adminRequest<RetentionPolicy>(
            Method.Get,
            "/retention/policy",
            undefined,
            undefined,
            "getServerRetentionPolicy",
        );
    }

    /**
     * 设置服务器的默认消息保留策略。
     *
     * @param policy - 要设置的保留策略
     * @returns 服务端确认后的保留策略
     *
     * @example
     * ```typescript
     * const policy = await client.getRetentionManager().setServerRetentionPolicy({ max_lifetime: 604800000 });
     * ```
     */
    public async setServerRetentionPolicy(policy: RetentionPolicy): Promise<RetentionPolicy> {
        const response = await this.adminRequest<RetentionPolicy>(
            Method.Post,
            "/retention/policy",
            undefined,
            {
                max_lifetime: policy.max_lifetime ?? null,
                min_lifetime: policy.min_lifetime ?? null,
                is_expire_on_clients: policy.is_expire_on_clients ?? false,
            },
            "setServerRetentionPolicy",
        );
        this.emit("serverPolicyUpdated", { policy: response });
        return response;
    }

    /**
     * 获取指定房间的保留策略。
     *
     * @param roomId - 房间 ID
     * @returns 房间保留策略
     * @throws {InvalidParamError} 当 roomId 为空时抛出
     *
     * @example
     * ```typescript
     * const policy = await client.getRetentionManager().getRoomRetentionPolicy("!room:example.org");
     * ```
     */
    public async getRoomRetentionPolicy(roomId: string): Promise<RetentionPolicy & { room_id: string }> {
        if (!roomId) {
            throw new InvalidParamError("roomId is required");
        }

        return await this.adminRequest<RetentionPolicy & { room_id: string }>(
            Method.Get,
            `/retention/policy/${encodeURIComponent(roomId)}`,
            undefined,
            undefined,
            "getRoomRetentionPolicy",
        );
    }

    /**
     * 设置指定房间的保留策略。
     *
     * @param roomId - 房间 ID
     * @param policy - 要设置的保留策略
     * @returns 服务端确认后的房间保留策略
     * @throws {InvalidParamError} 当 roomId 为空时抛出
     *
     * @example
     * ```typescript
     * const policy = await client
     *     .getRetentionManager()
     *     .setRoomRetentionPolicy("!room:example.org", { max_lifetime: 604800000 });
     * ```
     */
    public async setRoomRetentionPolicy(
        roomId: string,
        policy: RetentionPolicy,
    ): Promise<RetentionPolicy & { room_id: string }> {
        if (!roomId) {
            throw new InvalidParamError("roomId is required");
        }

        const response = await this.adminRequest<RetentionPolicy & { room_id: string }>(
            Method.Post,
            `/retention/policy/${encodeURIComponent(roomId)}`,
            undefined,
            {
                max_lifetime: policy.max_lifetime ?? null,
                min_lifetime: policy.min_lifetime ?? null,
                is_expire_on_clients: policy.is_expire_on_clients ?? false,
            },
            "setRoomRetentionPolicy",
        );
        this.emit("retentionPolicyUpdated", { roomId, policy: response });
        return response;
    }

    /**
     * 触发保留策略的清理执行。
     *
     * @param roomId - 仅对指定房间执行，可选；不传则对全部房间执行
     * @returns 执行结果
     *
     * @example
     * ```typescript
     * const result = await client.getRetentionManager().runRetention();
     * ```
     */
    public async runRetention(roomId?: string): Promise<IRetentionRunResult> {
        const body: IContent = {};
        if (roomId) {
            body.room_id = roomId;
        }

        const response = await this.adminRequest<IRetentionRunResult>(
            Method.Post,
            "/retention/run",
            undefined,
            body,
            "runRetention",
        );
        this.emit("retentionRunCompleted", { result: response });
        return response;
    }

    /**
     * 获取保留策略的执行状态。
     *
     * @returns 保留状态信息
     *
     * @example
     * ```typescript
     * const status = await client.getRetentionManager().getRetentionStatus();
     * ```
     */
    public async getRetentionStatus(): Promise<IRetentionStatus> {
        return await this.adminRequest<IRetentionStatus>(
            Method.Get,
            "/retention/status",
            undefined,
            undefined,
            "getRetentionStatus",
        );
    }

    /**
     * 读取房间当前的保留状态（来自 `m.room.retention` 状态事件）。
     *
     * @param roomId - 房间 ID
     * @returns 房间保留状态；房间不存在或未配置时 enabled 为 false
     * @throws {InvalidParamError} 当 roomId 为空时抛出
     *
     * @example
     * ```typescript
     * const state = client.getRetentionManager().getRoomRetentionState("!room:example.org");
     * ```
     */
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

    /**
     * 获取所有已配置保留策略的房间的策略映射。
     *
     * @returns 房间 ID 到保留策略的映射
     *
     * @example
     * ```typescript
     * const policies = client.getRetentionManager().getAllRoomRetentionPolicies();
     * ```
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
     * 判断给定时间戳的消息是否仍在保留期内。
     *
     * @param roomId - 房间 ID
     * @param timestamp - 消息时间戳（毫秒）
     * @returns 在保留期内返回 true，否则返回 false
     * @throws {InvalidParamError} 当 roomId 为空时抛出
     *
     * @example
     * ```typescript
     * const within = client.getRetentionManager().isMessageWithinRetention("!room:example.org", Date.now());
     * ```
     */
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

    /**
     * 计算给定时间戳的消息剩余保留时长。
     *
     * @param roomId - 房间 ID
     * @param timestamp - 消息时间戳（毫秒）
     * @returns 剩余毫秒数；无保留策略时返回 null，已过期返回 0
     * @throws {InvalidParamError} 当 roomId 为空时抛出
     *
     * @example
     * ```typescript
     * const remaining = client.getRetentionManager().getMessageRemainingLifetime("!room:example.org", Date.now());
     * ```
     */
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
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRetentionManager = function (): RetentionManager {
        registerManagerClass("retention", RetentionManager);
        return getOrCreateManager(this, "retention", () => new RetentionManager(this));
    };
}
