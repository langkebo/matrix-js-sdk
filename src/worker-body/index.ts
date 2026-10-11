/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
*/

/**
 * Worker Body Manager - Worker 复制协议与心跳管理
 *
 * 对接 synapse-rust 的 `/_synapse/worker/v1/*` 端点族中不需要管理员权限的部分
 * 文件: @synapse-rust/src/web/routes/worker.rs (worker body router)
 *
 * ⚠️ URL 组装规则与 AdminManager 一致：prefix + path 二段拼接。
 * prefix 固定为 `/_synapse/worker`，path 以 `/v1/...` 起始。
 */

import { Method } from "../http-api/method";
import { type Body } from "../http-api/interface";
import { MatrixClient } from "../client";
import { ValidationError } from "../errors";
import { type IEvent } from "../models/event";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import type { WorkerBodyPath } from "./__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type { PathAssert, StripWorkerPrefix } from "../http-api/strip-prefix";

const WORKER_PREFIX = "/_synapse/worker";

function wb<const P extends string>(path: P & PathAssert<P, StripWorkerPrefix<WorkerBodyPath>>): P {
    return path;
}

export interface WorkerCommandResponse {
    command_id: string;
    target_worker_id: string;
    command_type: string;
    status: string;
    created_ts: number;
}

export interface WorkerLoadStats {
    cpu_usage?: number;
    memory_usage?: number;
    active_connections?: number;
    request_rate?: number;
    [key: string]: unknown;
}

export interface HeartbeatRequest {
    status: string;
    load_stats?: WorkerLoadStats;
}

export interface HeartbeatResponse {
    status: string;
    [key: string]: unknown;
}

export interface ConnectWorkerResponse {
    status: string;
    [key: string]: unknown;
}

export interface ReplicationPosition {
    worker_id: string;
    stream_name: string;
    position: number | null;
}

export interface WorkerEventsResponse {
    events: IEvent[];
    next_stream_id?: number;
    [key: string]: unknown;
}

export class WorkerBodyManager extends BaseManager<string, Record<string, never>> {
    public constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    private doRequest<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, string>,
        body?: unknown,
    ): Promise<T> {
        return this.withRetry(async () => {
            return this.request({
                method: method,
                path: path,
                queryParams: queryParams,
                body: body as Body | undefined,
                prefix: WORKER_PREFIX,
            }) as Promise<T>;
        }, "request");
    }

    /**
     * 上报 Worker 心跳。
     * POST /_synapse/worker/v1/workers/{worker_id}/heartbeat
     *
     * @param workerId - Worker ID，必填
     * @param req - 心跳请求，包含状态与负载信息
     * @returns 心跳响应
     * @throws {ValidationError} 当 `workerId` 为空时抛出
     * @example
     * ```typescript
     * const res = await client.getWorkerBodyManager().heartbeat("worker-1", {
     *     status: "up",
     *     load_stats: { cpu_usage: 0.2 },
     * });
     * ```
     */
    async heartbeat(workerId: string, req: HeartbeatRequest): Promise<HeartbeatResponse> {
        if (!workerId) throw new ValidationError("workerId is required");
        return this.doRequest(Method.Post, wb(`/v1/workers/${encodeURIComponent(workerId)}/heartbeat`), undefined, req);
    }

    /**
     * 建立 Worker 连接。
     * POST /_synapse/worker/v1/workers/{worker_id}/connect
     *
     * @param workerId - Worker ID，必填
     * @param address - 连接地址
     * @returns 连接响应
     * @throws {ValidationError} 当 `workerId` 为空时抛出
     * @example
     * ```typescript
     * const res = await client.getWorkerBodyManager().connectWorker("worker-1", "127.0.0.1:8008");
     * ```
     */
    async connectWorker(workerId: string, address: string): Promise<ConnectWorkerResponse> {
        if (!workerId) throw new ValidationError("workerId is required");
        return this.doRequest(Method.Post, wb(`/v1/workers/${encodeURIComponent(workerId)}/connect`), undefined, {
            address,
        });
    }

    /**
     * 断开 Worker 连接。
     * POST /_synapse/worker/v1/workers/{worker_id}/disconnect
     *
     * @param workerId - Worker ID，必填
     * @returns 无返回值
     * @throws {ValidationError} 当 `workerId` 为空时抛出
     * @example
     * ```typescript
     * await client.getWorkerBodyManager().disconnectWorker("worker-1");
     * ```
     */
    async disconnectWorker(workerId: string): Promise<void> {
        if (!workerId) throw new ValidationError("workerId is required");
        await this.doRequest(Method.Post, wb(`/v1/workers/${encodeURIComponent(workerId)}/disconnect`));
    }

    /**
     * 列出指定 Worker 的待处理命令。
     * GET /_synapse/worker/v1/workers/{worker_id}/commands
     *
     * @param workerId - Worker ID，必填
     * @param limit - 可选，返回数量上限
     * @returns 待处理命令列表
     * @throws {ValidationError} 当 `workerId` 为空时抛出
     * @example
     * ```typescript
     * const { commands } = await client.getWorkerBodyManager().listPendingCommands("worker-1", 20);
     * ```
     */
    async listPendingCommands(workerId: string, limit?: number): Promise<{ commands: WorkerCommandResponse[] }> {
        if (!workerId) throw new ValidationError("workerId is required");
        const q = limit !== undefined ? { limit: String(limit) } : undefined;
        return this.doRequest(Method.Get, wb(`/v1/workers/${encodeURIComponent(workerId)}/commands`), q);
    }

    /**
     * 将命令标记为完成。
     * POST /_synapse/worker/v1/commands/{command_id}/complete
     *
     * @param commandId - 命令 ID，必填
     * @returns 无返回值
     * @throws {ValidationError} 当 `commandId` 为空时抛出
     * @example
     * ```typescript
     * await client.getWorkerBodyManager().completeCommand("command-1");
     * ```
     */
    async completeCommand(commandId: string): Promise<void> {
        if (!commandId) throw new ValidationError("commandId is required");
        await this.doRequest(Method.Post, wb(`/v1/commands/${encodeURIComponent(commandId)}/complete`));
    }

    /**
     * 将命令标记为失败。
     * POST /_synapse/worker/v1/commands/{command_id}/fail
     *
     * @param commandId - 命令 ID，必填
     * @param error - 失败原因
     * @returns 无返回值
     * @throws {ValidationError} 当 `commandId` 为空时抛出
     * @example
     * ```typescript
     * await client.getWorkerBodyManager().failCommand("command-1", "unexpected error");
     * ```
     */
    async failCommand(commandId: string, error: string): Promise<void> {
        if (!commandId) throw new ValidationError("commandId is required");
        await this.doRequest(Method.Post, wb(`/v1/commands/${encodeURIComponent(commandId)}/fail`), undefined, {
            error,
        });
    }

    /**
     * 将任务标记为完成。
     * POST /_synapse/worker/v1/tasks/{task_id}/complete
     *
     * @param taskId - 任务 ID，必填
     * @param result - 可选，任务结果
     * @returns 无返回值
     * @throws {ValidationError} 当 `taskId` 为空时抛出
     * @example
     * ```typescript
     * await client.getWorkerBodyManager().completeTask("task-1", { ok: true });
     * ```
     */
    async completeTask(taskId: string, result?: unknown): Promise<void> {
        if (!taskId) throw new ValidationError("taskId is required");
        await this.doRequest(Method.Post, wb(`/v1/tasks/${encodeURIComponent(taskId)}/complete`), undefined, {
            result,
        });
    }

    /**
     * 将任务标记为失败。
     * POST /_synapse/worker/v1/tasks/{task_id}/fail
     *
     * @param taskId - 任务 ID，必填
     * @param error - 失败原因
     * @returns 无返回值
     * @throws {ValidationError} 当 `taskId` 为空时抛出
     * @example
     * ```typescript
     * await client.getWorkerBodyManager().failTask("task-1", "unexpected error");
     * ```
     */
    async failTask(taskId: string, error: string): Promise<void> {
        if (!taskId) throw new ValidationError("taskId is required");
        await this.doRequest(Method.Post, wb(`/v1/tasks/${encodeURIComponent(taskId)}/fail`), undefined, { error });
    }

    /**
     * 获取指定 Worker 的复制位置。
     * GET /_synapse/worker/v1/replication/{worker_id}/position
     *
     * @param workerId - Worker ID，必填
     * @param streamName - 流名称
     * @returns 复制位置
     * @throws {ValidationError} 当 `workerId` 为空时抛出
     * @example
     * ```typescript
     * const pos = await client.getWorkerBodyManager().getReplicationPosition("worker-1", "events");
     * ```
     */
    async getReplicationPosition(workerId: string, streamName: string): Promise<ReplicationPosition> {
        if (!workerId) throw new ValidationError("workerId is required");
        return this.doRequest(Method.Get, wb(`/v1/replication/${encodeURIComponent(workerId)}/position`), {
            stream_name: streamName,
        });
    }

    /**
     * 更新指定 Worker 的复制位置。
     * PUT /_synapse/worker/v1/replication/{worker_id}/{stream_name}
     *
     * @param workerId - Worker ID，必填
     * @param streamName - 流名称，必填
     * @param position - 新的复制位置
     * @returns 更新后的复制位置
     * @throws {ValidationError} 当 `workerId` 或 `streamName` 为空时抛出
     * @example
     * ```typescript
     * const pos = await client.getWorkerBodyManager().updateReplicationPosition("worker-1", "events", 42);
     * ```
     */
    async updateReplicationPosition(
        workerId: string,
        streamName: string,
        position: number,
    ): Promise<ReplicationPosition> {
        if (!workerId || !streamName) {
            throw new ValidationError("workerId/streamName are required");
        }
        return this.doRequest(
            Method.Put,
            wb(`/v1/replication/${encodeURIComponent(workerId)}/${encodeURIComponent(streamName)}`),
            undefined,
            { stream_name: streamName, position },
        );
    }

    /**
     * 拉取事件。
     * GET /_synapse/worker/v1/events
     *
     * @param streamId - 可选，起始 stream ID
     * @returns 事件响应
     * @example
     * ```typescript
     * const { events } = await client.getWorkerBodyManager().getEvents(100);
     * ```
     */
    async getEvents(streamId?: number): Promise<WorkerEventsResponse> {
        const q = streamId !== undefined ? { stream_id: String(streamId) } : undefined;
        return this.doRequest(Method.Get, wb("/v1/events"), q);
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getWorkerBodyManager = function (): WorkerBodyManager {
        registerManagerClass("workerBody", WorkerBodyManager);
        return getOrCreateManager(this, "workerBody", () => new WorkerBodyManager(this));
    };
}
