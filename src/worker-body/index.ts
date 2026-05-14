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
import { BaseManager } from "../managers/base-manager";
import type { WorkerBodyPathPattern } from "./__generated__/route-table";
import { getOrCreateManager } from "../client-infra/manager-registry";

const WORKER_PREFIX = "/_synapse/worker";

type StripWorkerPrefix<P extends string> = P extends `/_synapse/worker${infer Rest}` ? Rest : never;

function wb<P extends StripWorkerPrefix<WorkerBodyPathPattern>>(path: P): P {
    return path;
}

export interface WorkerCommandResponse {
    command_id: string;
    target_worker_id: string;
    command_type: string;
    status: string;
    created_ts: number;
}

export interface HeartbeatRequest {
    status: string;
    load_stats?: Record<string, unknown>;
}

export class WorkerBodyManager extends BaseManager<string, Record<string, never>> {
    public constructor(client: MatrixClient) {
        super(client);
    }

    private request<T>(method: Method, path: string, queryParams?: Record<string, string>, body?: unknown): Promise<T> {
        return this.client.http.authedRequest(method, path, queryParams, body as Body | undefined, {
            prefix: WORKER_PREFIX,
        }) as Promise<T>;
    }

    /** POST /_synapse/worker/v1/workers/{worker_id}/heartbeat */
    async heartbeat(workerId: string, req: HeartbeatRequest): Promise<Record<string, unknown>> {
        if (!workerId) throw new ValidationError("workerId is required");
        return this.request(
            Method.Post,
            wb(`/v1/workers/${encodeURIComponent(workerId)}/heartbeat` as StripWorkerPrefix<WorkerBodyPathPattern>),
            undefined,
            req,
        );
    }

    /** POST /_synapse/worker/v1/workers/{worker_id}/connect */
    async connectWorker(workerId: string, address: string): Promise<Record<string, unknown>> {
        if (!workerId) throw new ValidationError("workerId is required");
        return this.request(
            Method.Post,
            wb(`/v1/workers/${encodeURIComponent(workerId)}/connect` as StripWorkerPrefix<WorkerBodyPathPattern>),
            undefined,
            { address },
        );
    }

    /** POST /_synapse/worker/v1/workers/{worker_id}/disconnect */
    async disconnectWorker(workerId: string): Promise<void> {
        if (!workerId) throw new ValidationError("workerId is required");
        await this.request(
            Method.Post,
            wb(`/v1/workers/${encodeURIComponent(workerId)}/disconnect` as StripWorkerPrefix<WorkerBodyPathPattern>),
        );
    }

    /** GET /_synapse/worker/v1/workers/{worker_id}/commands */
    async listPendingCommands(workerId: string, limit?: number): Promise<{ commands: WorkerCommandResponse[] }> {
        if (!workerId) throw new ValidationError("workerId is required");
        const q = limit !== undefined ? { limit: String(limit) } : undefined;
        return this.request(
            Method.Get,
            wb(`/v1/workers/${encodeURIComponent(workerId)}/commands` as StripWorkerPrefix<WorkerBodyPathPattern>),
            q,
        );
    }

    /** POST /_synapse/worker/v1/commands/{command_id}/complete */
    async completeCommand(commandId: string): Promise<void> {
        if (!commandId) throw new ValidationError("commandId is required");
        await this.request(
            Method.Post,
            wb(`/v1/commands/${encodeURIComponent(commandId)}/complete` as StripWorkerPrefix<WorkerBodyPathPattern>),
        );
    }

    /** POST /_synapse/worker/v1/commands/{command_id}/fail */
    async failCommand(commandId: string, error: string): Promise<void> {
        if (!commandId) throw new ValidationError("commandId is required");
        await this.request(
            Method.Post,
            wb(`/v1/commands/${encodeURIComponent(commandId)}/fail` as StripWorkerPrefix<WorkerBodyPathPattern>),
            undefined,
            { error },
        );
    }

    /** POST /_synapse/worker/v1/tasks/{task_id}/complete */
    async completeTask(taskId: string, result?: unknown): Promise<void> {
        if (!taskId) throw new ValidationError("taskId is required");
        await this.request(
            Method.Post,
            wb(`/v1/tasks/${encodeURIComponent(taskId)}/complete` as StripWorkerPrefix<WorkerBodyPathPattern>),
            undefined,
            { result },
        );
    }

    /** POST /_synapse/worker/v1/tasks/{task_id}/fail */
    async failTask(taskId: string, error: string): Promise<void> {
        if (!taskId) throw new ValidationError("taskId is required");
        await this.request(
            Method.Post,
            wb(`/v1/tasks/${encodeURIComponent(taskId)}/fail` as StripWorkerPrefix<WorkerBodyPathPattern>),
            undefined,
            { error },
        );
    }

    /** GET /_synapse/worker/v1/replication/{worker_id}/position */
    async getReplicationPosition(workerId: string, streamName: string): Promise<Record<string, unknown>> {
        if (!workerId) throw new ValidationError("workerId is required");
        return this.request(
            Method.Get,
            wb(`/v1/replication/${encodeURIComponent(workerId)}/position` as StripWorkerPrefix<WorkerBodyPathPattern>),
            { stream_name: streamName },
        );
    }

    /** PUT /_synapse/worker/v1/replication/{worker_id}/{stream_name} */
    async updateReplicationPosition(
        workerId: string,
        streamName: string,
        position: number,
    ): Promise<Record<string, unknown>> {
        if (!workerId || !streamName) {
            throw new ValidationError("workerId/streamName are required");
        }
        return this.request(
            Method.Put,
            wb(`/v1/replication/${encodeURIComponent(workerId)}/${encodeURIComponent(streamName)}` as StripWorkerPrefix<WorkerBodyPathPattern>),
            undefined,
            { stream_name: streamName, position },
        );
    }

    /** GET /_synapse/worker/v1/events */
    async getEvents(streamId?: number): Promise<Record<string, unknown>> {
        const q = streamId !== undefined ? { stream_id: String(streamId) } : undefined;
        return this.request(Method.Get, wb("/v1/events"), q);
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getWorkerBodyManager(): WorkerBodyManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getWorkerBodyManager = function (): WorkerBodyManager {
        return getOrCreateManager(this, "workerBody", () => new WorkerBodyManager(this));
    };
}
