/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
*/

/**
 * Worker Admin Manager - 后台 Worker 管理
 *
 * 对接 synapse-rust 的 `/_synapse/worker/v1/*` 端点族中需要管理员权限的部分
 * 文件: @synapse-rust/src/web/routes/worker.rs (admin router)
 *
 * ⚠️ URL 组装规则与 AdminManager 一致：prefix + path 二段拼接。
 * prefix 固定为 `/_synapse/worker`，path 以 `/v1/...` 起始。
 */

import { Method } from "../http-api/method";
import { type Body } from "../http-api/interface";
import { MatrixClient } from "../client";
import { ValidationError } from "../errors";
import { BaseManager } from "../managers/base-manager";
import type { WorkerAdminPath } from "./__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type { PathAssert, StripWorkerPrefix } from "../http-api/strip-prefix";

const WORKER_PREFIX = "/_synapse/worker";

export interface TaskMetadata {
    trace_id?: string;
    priority?: number;
    [key: string]: unknown;
}

function wa<const P extends string>(path: P & PathAssert<P, StripWorkerPrefix<WorkerAdminPath>>): P {
    return path;
}

export interface WorkerInfo {
    id: number;
    worker_id: string;
    worker_name: string;
    worker_type: string;
    host: string;
    port: number;
    status: string;
    last_heartbeat_ts: number | null;
    started_ts: number;
}

export interface WorkerCommand {
    command_id: string;
    target_worker_id: string;
    command_type: string;
    status: string;
    created_ts: number;
}

export interface WorkerTask {
    task_id: string;
    task_type: string;
    status: string;
    assigned_worker_id: string | null;
}

export interface WorkerConfig {
    thread_count?: number;
    cache_size_mb?: number;
    timeout_ms?: number;
    [key: string]: unknown;
}

export interface WorkerStatisticsEntry {
    id: number;
    worker_id: string;
    worker_name: string;
    worker_type: string;
    status: string;
    host: string;
    port: number;
    last_heartbeat_ts: number | null;
    started_ts: number;
    cpu_usage?: number | null;
    memory_usage?: number | null;
    active_connections?: number | null;
    requests_per_second?: number | null;
    average_latency_ms?: number | null;
    queue_depth?: number | null;
    pending_commands: number;
    active_tasks: number;
}

export interface WorkerTypeStatistics {
    worker_type: string;
    total_count: number;
    running_count: number;
    starting_count: number;
    stopping_count: number;
    stopped_count: number;
    avg_cpu_usage?: number | null;
    avg_memory_usage?: number | null;
    total_connections?: number | null;
}

export interface RegisterWorkerRequest {
    worker_id: string;
    worker_name: string;
    worker_type: string;
    host: string;
    port: number;
    config?: WorkerConfig;
    metadata?: TaskMetadata;
    version?: string;
}

export interface SendCommandRequest {
    command_type: string;
    command_data: unknown;
    priority?: number;
    max_retries?: number;
}

export interface SelectWorkerResponse {
    task_type: string;
    selected_worker: string | null;
}

export interface AssignTaskRequest {
    task_type: string;
    task_data: unknown;
    priority?: number;
    preferred_worker_id?: string;
}

export class WorkerAdminManager extends BaseManager<string, Record<string, never>> {
    public constructor(client: MatrixClient) {
        super(client);
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

    // ===== Workers =====

    /**
     * 注册一个新的 Worker。
     * POST /_synapse/worker/v1/register
     *
     * @param req - Worker 注册请求，`worker_id` 必填
     * @returns 注册后的 Worker 信息
     * @throws {ValidationError} 当 `req.worker_id` 为空时抛出
     * @example
     * ```typescript
     * const info = await client.getWorkerAdminManager().registerWorker({
     *     worker_id: "worker-1",
     *     worker_name: "worker-1",
     *     worker_type: "federation_sender",
     *     host: "127.0.0.1",
     *     port: 8008,
     * });
     * ```
     */
    async registerWorker(req: RegisterWorkerRequest): Promise<WorkerInfo> {
        if (!req.worker_id) throw new ValidationError("worker_id is required");
        return this.doRequest(Method.Post, wa("/v1/register"), undefined, req);
    }

    /**
     * 列出所有已注册的 Worker。
     * GET /_synapse/worker/v1/workers
     *
     * @param limit - 可选，返回数量上限
     * @returns Worker 列表及总数
     * @example
     * ```typescript
     * const { workers } = await client.getWorkerAdminManager().listWorkers(50);
     * ```
     */
    async listWorkers(limit?: number): Promise<{ workers: WorkerInfo[]; total?: number }> {
        const q = limit !== undefined ? { limit: String(limit) } : undefined;
        return this.doRequest(Method.Get, wa("/v1/workers"), q);
    }

    /**
     * 按 Worker 类型列出 Worker。
     * GET /_synapse/worker/v1/workers/type/{worker_type}
     *
     * @param workerType - Worker 类型，必填
     * @param limit - 可选，返回数量上限
     * @returns 指定类型的 Worker 列表
     * @throws {ValidationError} 当 `workerType` 为空时抛出
     * @example
     * ```typescript
     * const { workers } = await client.getWorkerAdminManager().listWorkersByType("federation_sender");
     * ```
     */
    async listWorkersByType(workerType: string, limit?: number): Promise<{ workers: WorkerInfo[] }> {
        if (!workerType) throw new ValidationError("workerType is required");
        const q = limit !== undefined ? { limit: String(limit) } : undefined;
        return this.doRequest(Method.Get, wa(`/v1/workers/type/${encodeURIComponent(workerType)}`), q);
    }

    /**
     * 获取指定 Worker 的详情。
     * GET /_synapse/worker/v1/workers/{worker_id}
     *
     * @param workerId - Worker ID，必填
     * @returns Worker 详情
     * @throws {ValidationError} 当 `workerId` 为空时抛出
     * @example
     * ```typescript
     * const worker = await client.getWorkerAdminManager().getWorker("worker-1");
     * ```
     */
    async getWorker(workerId: string): Promise<WorkerInfo> {
        if (!workerId) throw new ValidationError("workerId is required");
        return this.doRequest(Method.Get, wa(`/v1/workers/${encodeURIComponent(workerId)}`));
    }

    /**
     * 注销指定 Worker。
     * DELETE /_synapse/worker/v1/workers/{worker_id}
     *
     * @param workerId - Worker ID，必填
     * @returns 无返回值
     * @throws {ValidationError} 当 `workerId` 为空时抛出
     * @example
     * ```typescript
     * await client.getWorkerAdminManager().unregisterWorker("worker-1");
     * ```
     */
    async unregisterWorker(workerId: string): Promise<void> {
        if (!workerId) throw new ValidationError("workerId is required");
        await this.doRequest(Method.Delete, wa(`/v1/workers/${encodeURIComponent(workerId)}`));
    }

    // ===== Commands =====

    /**
     * 向指定 Worker 发送命令。
     * POST /_synapse/worker/v1/workers/{worker_id}/commands
     *
     * @param workerId - 目标 Worker ID，必填
     * @param req - 命令请求
     * @returns 创建后的命令
     * @throws {ValidationError} 当 `workerId` 为空时抛出
     * @example
     * ```typescript
     * const command = await client.getWorkerAdminManager().sendCommand("worker-1", {
     *     command_type: "reload",
     *     command_data: {},
     * });
     * ```
     */
    async sendCommand(workerId: string, req: SendCommandRequest): Promise<WorkerCommand> {
        if (!workerId) throw new ValidationError("workerId is required");
        return this.doRequest(Method.Post, wa(`/v1/workers/${encodeURIComponent(workerId)}/commands`), undefined, req);
    }

    // ===== Tasks =====

    /**
     * 分配一个任务。
     * POST /_synapse/worker/v1/tasks
     *
     * @param req - 任务分配请求
     * @returns 创建后的任务
     * @example
     * ```typescript
     * const task = await client.getWorkerAdminManager().assignTask({
     *     task_type: "send_email",
     *     task_data: {},
     * });
     * ```
     */
    async assignTask(req: AssignTaskRequest): Promise<WorkerTask> {
        return this.doRequest(Method.Post, wa("/v1/tasks"), undefined, req);
    }

    /**
     * 列出待处理的任务。
     * GET /_synapse/worker/v1/tasks
     *
     * @param limit - 可选，返回数量上限
     * @returns 待处理任务列表
     * @example
     * ```typescript
     * const { tasks } = await client.getWorkerAdminManager().getPendingTasks(20);
     * ```
     */
    async getPendingTasks(limit?: number): Promise<{ tasks: WorkerTask[] }> {
        const q = limit !== undefined ? { limit: String(limit) } : undefined;
        return this.doRequest(Method.Get, wa("/v1/tasks"), q);
    }

    /**
     * 为指定 Worker 领取下一个任务。
     * POST /_synapse/worker/v1/tasks/claim/{worker_id}
     *
     * @param workerId - Worker ID，必填
     * @returns 领取到的任务，无可用任务时返回 `null`
     * @throws {ValidationError} 当 `workerId` 为空时抛出
     * @example
     * ```typescript
     * const task = await client.getWorkerAdminManager().claimTask("worker-1");
     * ```
     */
    async claimTask(workerId: string): Promise<WorkerTask | null> {
        if (!workerId) throw new ValidationError("workerId is required");
        return this.doRequest(Method.Post, wa(`/v1/tasks/claim/${encodeURIComponent(workerId)}`));
    }

    /**
     * 为指定 Worker 领取指定任务。
     * POST /_synapse/worker/v1/tasks/{task_id}/claim/{worker_id}
     *
     * @param taskId - 任务 ID，必填
     * @param workerId - Worker ID，必填
     * @returns 领取到的任务
     * @throws {ValidationError} 当 `taskId` 或 `workerId` 为空时抛出
     * @example
     * ```typescript
     * const task = await client.getWorkerAdminManager().claimSpecificTask("task-1", "worker-1");
     * ```
     */
    async claimSpecificTask(taskId: string, workerId: string): Promise<WorkerTask> {
        if (!taskId || !workerId) throw new ValidationError("taskId/workerId are required");
        return this.doRequest(
            Method.Post,
            wa(`/v1/tasks/${encodeURIComponent(taskId)}/claim/${encodeURIComponent(workerId)}`),
        );
    }

    // ===== Statistics / Routing =====

    /**
     * 获取所有 Worker 的统计信息。
     * GET /_synapse/worker/v1/statistics
     *
     * @returns Worker 统计条目列表
     * @example
     * ```typescript
     * const stats = await client.getWorkerAdminManager().getStatistics();
     * ```
     */
    async getStatistics(): Promise<WorkerStatisticsEntry[]> {
        return this.doRequest(Method.Get, wa("/v1/statistics"));
    }

    /**
     * 按类型获取 Worker 统计信息。
     * GET /_synapse/worker/v1/statistics/types
     *
     * @returns 按类型分组的统计信息列表
     * @example
     * ```typescript
     * const stats = await client.getWorkerAdminManager().getStatisticsByType();
     * ```
     */
    async getStatisticsByType(): Promise<WorkerTypeStatistics[]> {
        return this.doRequest(Method.Get, wa("/v1/statistics/types"));
    }

    /**
     * 为给定任务类型选择 Worker。
     * GET /_synapse/worker/v1/select/{task_type}
     *
     * @param taskType - 任务类型，必填
     * @returns 选择结果
     * @throws {ValidationError} 当 `taskType` 为空时抛出
     * @example
     * ```typescript
     * const { selected_worker } = await client.getWorkerAdminManager().selectWorker("send_email");
     * ```
     */
    async selectWorker(taskType: string): Promise<SelectWorkerResponse> {
        if (!taskType) throw new ValidationError("taskType is required");
        return this.doRequest(Method.Get, wa(`/v1/select/${encodeURIComponent(taskType)}`));
    }

    // ===== Topology =====

    /**
     * 获取 Worker 拓扑信息。
     * GET /_synapse/worker/v1/topology
     *
     * @returns 拓扑信息
     * @example
     * ```typescript
     * const topology = await client.getWorkerAdminManager().getTopology();
     * ```
     */
    async getTopology(): Promise<Record<string, unknown>> {
        return this.doRequest(Method.Get, wa("/v1/topology"));
    }

    /**
     * 校验 Worker 拓扑。
     * GET /_synapse/worker/v1/topology/validate
     *
     * @returns 校验结果
     * @example
     * ```typescript
     * const { valid } = await client.getWorkerAdminManager().validateTopology();
     * ```
     */
    async validateTopology(): Promise<{ valid: boolean; errors?: string[] }> {
        return this.doRequest(Method.Get, wa("/v1/topology/validate"));
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getWorkerAdminManager = function (): WorkerAdminManager {
        registerManagerClass("workerAdmin", WorkerAdminManager);
        return getOrCreateManager(this, "workerAdmin", () => new WorkerAdminManager(this));
    };
}
