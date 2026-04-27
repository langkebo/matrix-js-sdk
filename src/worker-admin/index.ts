/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
*/

/**
 * Worker Admin Manager - 后台 Worker 管理
 *
 * 对接 synapse-rust 的 `/_synapse/worker/v1/*` 端点族
 * 文件: @synapse-rust/src/web/routes/worker.rs
 *
 * ⚠️ URL 组装规则与 AdminManager 一致：prefix + path 二段拼接。
 * prefix 固定为 `/_synapse/worker`，path 以 `/v1/...` 起始。
 */

import { Method } from "../http-api/method";
import { type Body } from "../http-api/interface";
import { MatrixClient } from "../client";
import { ValidationError } from "../errors";
import { BaseManager } from "../managers/base-manager";

const WORKER_PREFIX = "/_synapse/worker";

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

export interface RegisterWorkerRequest {
    worker_id: string;
    worker_name: string;
    worker_type: string;
    host: string;
    port: number;
    config?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    version?: string;
}

export interface HeartbeatRequest {
    status: string;
    load_stats?: Record<string, unknown>;
}

export interface SendCommandRequest {
    command_type: string;
    command_data: unknown;
    priority?: number;
    max_retries?: number;
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

    private request<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, string>,
        body?: unknown,
    ): Promise<T> {
        return this.client.http.authedRequest(
            method,
            path,
            queryParams ?? {},
            body as Body | undefined,
            { prefix: WORKER_PREFIX },
        ) as Promise<T>;
    }

    // ===== Workers =====

    /** POST /_synapse/worker/v1/register */
    async registerWorker(req: RegisterWorkerRequest): Promise<WorkerInfo> {
        if (!req.worker_id) throw new ValidationError("worker_id is required");
        return this.request(Method.Post, "/v1/register", undefined, req);
    }

    /** GET /_synapse/worker/v1/workers */
    async listWorkers(limit?: number): Promise<{ workers: WorkerInfo[]; total?: number }> {
        const q = limit !== undefined ? { limit: String(limit) } : undefined;
        return this.request(Method.Get, "/v1/workers", q);
    }

    /** GET /_synapse/worker/v1/workers/type/{worker_type} */
    async listWorkersByType(
        workerType: string,
        limit?: number,
    ): Promise<{ workers: WorkerInfo[] }> {
        if (!workerType) throw new ValidationError("workerType is required");
        const q = limit !== undefined ? { limit: String(limit) } : undefined;
        return this.request(
            Method.Get,
            `/v1/workers/type/${encodeURIComponent(workerType)}`,
            q,
        );
    }

    /** GET /_synapse/worker/v1/workers/{worker_id} */
    async getWorker(workerId: string): Promise<WorkerInfo> {
        if (!workerId) throw new ValidationError("workerId is required");
        return this.request(Method.Get, `/v1/workers/${encodeURIComponent(workerId)}`);
    }

    /** DELETE /_synapse/worker/v1/workers/{worker_id} */
    async unregisterWorker(workerId: string): Promise<void> {
        if (!workerId) throw new ValidationError("workerId is required");
        await this.request(Method.Delete, `/v1/workers/${encodeURIComponent(workerId)}`);
    }

    /** POST /_synapse/worker/v1/workers/{worker_id}/heartbeat */
    async heartbeat(workerId: string, req: HeartbeatRequest): Promise<Record<string, unknown>> {
        if (!workerId) throw new ValidationError("workerId is required");
        return this.request(
            Method.Post,
            `/v1/workers/${encodeURIComponent(workerId)}/heartbeat`,
            undefined,
            req,
        );
    }

    /** POST /_synapse/worker/v1/workers/{worker_id}/connect */
    async connectWorker(workerId: string, address: string): Promise<Record<string, unknown>> {
        if (!workerId) throw new ValidationError("workerId is required");
        return this.request(
            Method.Post,
            `/v1/workers/${encodeURIComponent(workerId)}/connect`,
            undefined,
            { address },
        );
    }

    /** POST /_synapse/worker/v1/workers/{worker_id}/disconnect */
    async disconnectWorker(workerId: string): Promise<void> {
        if (!workerId) throw new ValidationError("workerId is required");
        await this.request(
            Method.Post,
            `/v1/workers/${encodeURIComponent(workerId)}/disconnect`,
        );
    }

    // ===== Commands =====

    /** POST /_synapse/worker/v1/workers/{worker_id}/commands */
    async sendCommand(workerId: string, req: SendCommandRequest): Promise<WorkerCommand> {
        if (!workerId) throw new ValidationError("workerId is required");
        return this.request(
            Method.Post,
            `/v1/workers/${encodeURIComponent(workerId)}/commands`,
            undefined,
            req,
        );
    }

    /** GET /_synapse/worker/v1/workers/{worker_id}/commands */
    async listCommands(workerId: string, limit?: number): Promise<{ commands: WorkerCommand[] }> {
        if (!workerId) throw new ValidationError("workerId is required");
        const q = limit !== undefined ? { limit: String(limit) } : undefined;
        return this.request(
            Method.Get,
            `/v1/workers/${encodeURIComponent(workerId)}/commands`,
            q,
        );
    }

    /** POST /_synapse/worker/v1/commands/{command_id}/complete */
    async completeCommand(commandId: string): Promise<void> {
        if (!commandId) throw new ValidationError("commandId is required");
        await this.request(
            Method.Post,
            `/v1/commands/${encodeURIComponent(commandId)}/complete`,
        );
    }

    /** POST /_synapse/worker/v1/commands/{command_id}/fail */
    async failCommand(commandId: string, error: string): Promise<void> {
        if (!commandId) throw new ValidationError("commandId is required");
        await this.request(
            Method.Post,
            `/v1/commands/${encodeURIComponent(commandId)}/fail`,
            undefined,
            { error },
        );
    }

    // ===== Tasks =====

    /** POST /_synapse/worker/v1/tasks */
    async assignTask(req: AssignTaskRequest): Promise<WorkerTask> {
        return this.request(Method.Post, "/v1/tasks", undefined, req);
    }

    /** GET /_synapse/worker/v1/tasks */
    async getPendingTasks(limit?: number): Promise<{ tasks: WorkerTask[] }> {
        const q = limit !== undefined ? { limit: String(limit) } : undefined;
        return this.request(Method.Get, "/v1/tasks", q);
    }

    /** POST /_synapse/worker/v1/tasks/claim/{worker_id} */
    async claimTask(workerId: string): Promise<WorkerTask | null> {
        if (!workerId) throw new ValidationError("workerId is required");
        return this.request(Method.Post, `/v1/tasks/claim/${encodeURIComponent(workerId)}`);
    }

    /** POST /_synapse/worker/v1/tasks/{task_id}/claim/{worker_id} */
    async claimSpecificTask(taskId: string, workerId: string): Promise<WorkerTask> {
        if (!taskId || !workerId) throw new ValidationError("taskId/workerId are required");
        return this.request(
            Method.Post,
            `/v1/tasks/${encodeURIComponent(taskId)}/claim/${encodeURIComponent(workerId)}`,
        );
    }

    /** POST /_synapse/worker/v1/tasks/{task_id}/complete */
    async completeTask(taskId: string, result?: unknown): Promise<void> {
        if (!taskId) throw new ValidationError("taskId is required");
        await this.request(
            Method.Post,
            `/v1/tasks/${encodeURIComponent(taskId)}/complete`,
            undefined,
            { result },
        );
    }

    /** POST /_synapse/worker/v1/tasks/{task_id}/fail */
    async failTask(taskId: string, error: string): Promise<void> {
        if (!taskId) throw new ValidationError("taskId is required");
        await this.request(
            Method.Post,
            `/v1/tasks/${encodeURIComponent(taskId)}/fail`,
            undefined,
            { error },
        );
    }

    // ===== Statistics / Routing =====

    /** GET /_synapse/worker/v1/statistics */
    async getStatistics(): Promise<Record<string, unknown>> {
        return this.request(Method.Get, "/v1/statistics");
    }

    /** GET /_synapse/worker/v1/statistics/types */
    async getStatisticsByType(): Promise<Record<string, unknown>> {
        return this.request(Method.Get, "/v1/statistics/types");
    }

    /** GET /_synapse/worker/v1/select/{task_type} */
    async selectWorker(taskType: string): Promise<WorkerInfo | null> {
        if (!taskType) throw new ValidationError("taskType is required");
        return this.request(Method.Get, `/v1/select/${encodeURIComponent(taskType)}`);
    }

    // ===== Replication / Events =====

    /** GET /_synapse/worker/v1/replication/{worker_id}/position?stream_name=... */
    async getReplicationPosition(workerId: string, streamName: string): Promise<Record<string, unknown>> {
        if (!workerId) throw new ValidationError("workerId is required");
        return this.request(
            Method.Get,
            `/v1/replication/${encodeURIComponent(workerId)}/position`,
            { stream_name: streamName },
        );
    }

    /** GET /_synapse/worker/v1/replication/{worker_id}/{stream_name}?stream_id=... */
    async getReplicationStream(
        workerId: string,
        streamName: string,
        streamId?: number,
    ): Promise<Record<string, unknown>> {
        if (!workerId || !streamName) {
            throw new ValidationError("workerId/streamName are required");
        }
        const q: Record<string, string> = {};
        if (streamId !== undefined) q.stream_id = String(streamId);
        return this.request(
            Method.Get,
            `/v1/replication/${encodeURIComponent(workerId)}/${encodeURIComponent(streamName)}`,
            q,
        );
    }

    /** GET /_synapse/worker/v1/events?limit=... */
    async getEvents(limit?: number): Promise<Record<string, unknown>> {
        const q = limit !== undefined ? { limit: String(limit) } : undefined;
        return this.request(Method.Get, "/v1/events", q);
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getWorkerAdminManager(): WorkerAdminManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getWorkerAdminManager = function (): WorkerAdminManager {
        return new WorkerAdminManager(this);
    };
}

export default extendMatrixClient;
