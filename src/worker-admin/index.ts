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
import type { WorkerAdminPathPattern } from "./__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

const WORKER_PREFIX = "/_synapse/worker";

export interface TaskMetadata {
    trace_id?: string;
    priority?: number;
    [key: string]: unknown;
}

type StripWorkerPrefix<P extends string> = P extends `/_synapse/worker${infer Rest}` ? Rest : never;

function wa<P extends StripWorkerPrefix<WorkerAdminPathPattern>>(path: P): P {
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

    private doRequest<T>(method: Method, path: string, queryParams?: Record<string, string>, body?: unknown): Promise<T> {
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

    /** POST /_synapse/worker/v1/register */
    async registerWorker(req: RegisterWorkerRequest): Promise<WorkerInfo> {
        if (!req.worker_id) throw new ValidationError("worker_id is required");
        return this.doRequest(Method.Post, wa("/v1/register"), undefined, req);
    }

    /** GET /_synapse/worker/v1/workers */
    async listWorkers(limit?: number): Promise<{ workers: WorkerInfo[]; total?: number }> {
        const q = limit !== undefined ? { limit: String(limit) } : undefined;
        return this.doRequest(Method.Get, wa("/v1/workers"), q);
    }

    /** GET /_synapse/worker/v1/workers/type/{worker_type} */
    async listWorkersByType(workerType: string, limit?: number): Promise<{ workers: WorkerInfo[] }> {
        if (!workerType) throw new ValidationError("workerType is required");
        const q = limit !== undefined ? { limit: String(limit) } : undefined;
        return this.doRequest(Method.Get, wa(`/v1/workers/type/${encodeURIComponent(workerType)}` as StripWorkerPrefix<WorkerAdminPathPattern>), q);
    }

    /** GET /_synapse/worker/v1/workers/{worker_id} */
    async getWorker(workerId: string): Promise<WorkerInfo> {
        if (!workerId) throw new ValidationError("workerId is required");
        return this.doRequest(Method.Get, wa(`/v1/workers/${encodeURIComponent(workerId)}` as StripWorkerPrefix<WorkerAdminPathPattern>));
    }

    /** DELETE /_synapse/worker/v1/workers/{worker_id} */
    async unregisterWorker(workerId: string): Promise<void> {
        if (!workerId) throw new ValidationError("workerId is required");
        await this.doRequest(Method.Delete, wa(`/v1/workers/${encodeURIComponent(workerId)}` as StripWorkerPrefix<WorkerAdminPathPattern>));
    }

    // ===== Commands =====

    /** POST /_synapse/worker/v1/workers/{worker_id}/commands */
    async sendCommand(workerId: string, req: SendCommandRequest): Promise<WorkerCommand> {
        if (!workerId) throw new ValidationError("workerId is required");
        return this.doRequest(Method.Post, wa(`/v1/workers/${encodeURIComponent(workerId)}/commands` as StripWorkerPrefix<WorkerAdminPathPattern>), undefined, req);
    }

    // ===== Tasks =====

    /** POST /_synapse/worker/v1/tasks */
    async assignTask(req: AssignTaskRequest): Promise<WorkerTask> {
        return this.doRequest(Method.Post, wa("/v1/tasks"), undefined, req);
    }

    /** GET /_synapse/worker/v1/tasks */
    async getPendingTasks(limit?: number): Promise<{ tasks: WorkerTask[] }> {
        const q = limit !== undefined ? { limit: String(limit) } : undefined;
        return this.doRequest(Method.Get, wa("/v1/tasks"), q);
    }

    /** POST /_synapse/worker/v1/tasks/claim/{worker_id} */
    async claimTask(workerId: string): Promise<WorkerTask | null> {
        if (!workerId) throw new ValidationError("workerId is required");
        return this.doRequest(Method.Post, wa(`/v1/tasks/claim/${encodeURIComponent(workerId)}` as StripWorkerPrefix<WorkerAdminPathPattern>));
    }

    /** POST /_synapse/worker/v1/tasks/{task_id}/claim/{worker_id} */
    async claimSpecificTask(taskId: string, workerId: string): Promise<WorkerTask> {
        if (!taskId || !workerId) throw new ValidationError("taskId/workerId are required");
        return this.doRequest(
            Method.Post,
            wa(`/v1/tasks/${encodeURIComponent(taskId)}/claim/${encodeURIComponent(workerId)}` as StripWorkerPrefix<WorkerAdminPathPattern>),
        );
    }

    // ===== Statistics / Routing =====

    /** GET /_synapse/worker/v1/statistics */
    async getStatistics(): Promise<WorkerStatisticsEntry[]> {
        return this.doRequest(Method.Get, wa("/v1/statistics"));
    }

    /** GET /_synapse/worker/v1/statistics/types */
    async getStatisticsByType(): Promise<WorkerTypeStatistics[]> {
        return this.doRequest(Method.Get, wa("/v1/statistics/types"));
    }

    /** GET /_synapse/worker/v1/select/{task_type} */
    async selectWorker(taskType: string): Promise<SelectWorkerResponse> {
        if (!taskType) throw new ValidationError("taskType is required");
        return this.doRequest(Method.Get, wa(`/v1/select/${encodeURIComponent(taskType)}` as StripWorkerPrefix<WorkerAdminPathPattern>));
    }
}


export function extendMatrixClient(): void {
    MatrixClient.prototype.getWorkerAdminManager = function (): WorkerAdminManager {
        registerManagerClass("workerAdmin", WorkerAdminManager);
    return getOrCreateManager(this, "workerAdmin", () => new WorkerAdminManager(this));
    };
}
