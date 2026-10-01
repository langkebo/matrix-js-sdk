/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Worker Manager - Worker 管理器封装
 *
 * 对接 synapse-rust 的 `/_synapse/worker/v1/*` 路由
 * 后端路由文件: synapse-rust/synapse-web/src/routes/worker.rs
 *
 * 仅 worker profile 启用（worker-enabled 端口）
 */

import { Method } from "../../http-api/method";
import type { Body } from "../../http-api/interface";
import { MatrixClient } from "../../client";
import { ValidationError } from "../../errors";
import { BaseManager, type ManagerOpts } from "../../managers/base-manager";
import { getOrCreateManager, registerManagerClass } from "../../client-infra/manager-registry";

const WORKER_PREFIX = "/_synapse/worker";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * Worker 类型枚举
 * 对应 synapse-rust 中的 WorkerType
 */
export type WorkerType =
    | "frontend"
    | "federation_reader"
    | "federation_sender"
    | "event_persister"
    | "event_cache"
    | "appservice"
    | "client_json"
    | "media_repository"
    | "search"
    | "sms"
    | "config"
    | "user_dir"
    | "key_manager"
    | "key_refresh"
    | "metrics"
    | "mscs"
    | "phonehome"
    | "presence"
    | "push"
    | "relay"
    | "s3"
    | "secrets_storage"
    | "snowflake"
    | "ssl"
    | "synchrotron"
    | "updater"
    | "wamp"
    | "webapp"
    | "webclient"
    | "openid"
    | "oidc"
    | "saml"
    | "metrics"
    | string; // Allow custom worker types

/**
 * Worker 基本信息
 */
export interface WorkerInfo {
    id: number;
    worker_id: string;
    worker_name: string;
    worker_type: string;
    instance_map_keys: string[];
    responsibility_domains: string[];
    owned_route_prefixes: string[];
    replication_streams: string[];
    capabilities: WorkerCapabilities;
    host: string;
    port: number;
    status: string;
    last_heartbeat_ts: number | null;
    started_ts: number;
}

/**
 * Worker 能力描述
 */
export interface WorkerCapabilities {
    can_persist_events?: boolean;
    can_forward_events?: boolean;
    can_respond_to_client?: boolean;
    can_receive_sync?: boolean;
    can_send_to_client?: boolean;
    [key: string]: boolean | undefined;
}

/**
 * Worker 注册请求
 */
export interface WorkerRegistration {
    worker_id: string;
    worker_name: string;
    worker_type: WorkerType;
    host: string;
    port: number;
    config?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    version?: string;
}

/**
 * 任务信息
 */
export interface Task {
    task_id: string;
    task_type: string;
    status: string;
    assigned_worker_id: string | null;
    priority?: number;
    created_ts?: number;
    data?: Record<string, unknown>;
}

/**
 * 拓扑信息
 */
export interface Topology {
    worker_enabled: boolean;
    instance_name: string;
    known_instances: string[];
    replication_enabled: boolean;
    replication_http_enabled: boolean;
    validation: TopologyValidation;
    stream_writers: StreamWriterOwner[];
    route_owner_expectations: RouteOwnerExpectation[];
}

/**
 * 拓扑验证结果
 */
export interface TopologyValidation {
    valid: boolean;
    errors?: string[];
    warnings?: string[];
}

/**
 * 流写入者所有者信息
 */
export interface StreamWriterOwner {
    stream_name: string;
    owners: string[];
}

/**
 * 路由所有者期望信息
 */
export interface RouteOwnerExpectation {
    probe: string;
    path: string;
    expected_owner: string;
}

/**
 * 统计信息
 */
export interface Statistics {
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

/**
 * 统计信息按类型分组
 */
export interface StatisticsByType {
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

/**
 * 命令请求
 */
export interface CommandRequest {
    command_type: string;
    command_data: Record<string, unknown>;
    priority?: number;
    max_retries?: number;
}

/**
 * 任务分配请求
 */
export interface TaskAssignment {
    task_type: string;
    task_data: Record<string, unknown>;
    priority?: number;
    preferred_worker_id?: string;
}

/**
 * 任务响应
 */
export interface TaskResponse {
    task_id: string;
    task_type: string;
    status: string;
    assigned_worker_id: string | null;
}

/**
 * 选择工作者响应
 */
export interface WorkerSelectResponse {
    task_type: string;
    selected_worker: string | null;
}

// ============================================================================
// WorkerManager 类
// ============================================================================

/**
 * WorkerManager - Worker 管理器
 *
 * 提供对 synapse-rust Worker API 的封装，支持 worker profile 的注册、查询、任务分配等操作。
 */
export class WorkerManager extends BaseManager<string, Record<string, never>> {
    public constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 发送请求的通用方法
     */
    private async doRequest<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, string>,
        body?: unknown,
    ): Promise<T> {
        return this.withRetry(async () => {
            return this.request({
                method,
                path: path as `/v1/${string}`,
                queryParams,
                body: body as Body | undefined,
                prefix: WORKER_PREFIX,
            }) as Promise<T>;
        }, "request");
    }

    // =========================================================================
    // Worker 管理方法
    // =========================================================================

    /**
     * 注册一个 Worker
     * POST /_synapse/worker/v1/register
     */
    async registerWorker(workerInfo: WorkerRegistration): Promise<WorkerInfo> {
        if (!workerInfo.worker_id) {
            throw new ValidationError("worker_id is required for registration");
        }
        if (!workerInfo.worker_type) {
            throw new ValidationError("worker_type is required for registration");
        }
        return this.doRequest<WorkerInfo>(Method.Post, "/v1/register", undefined, workerInfo);
    }

    /**
     * 列出所有 Workers
     * GET /_synapse/worker/v1/workers
     */
    async listWorkers(): Promise<WorkerInfo[]> {
        const result = await this.doRequest<{ workers: WorkerInfo[] }>(Method.Get, "/v1/workers");
        return result.workers || [];
    }

    /**
     * 获取指定 Worker 详情
     * GET /_synapse/worker/v1/workers/{worker_id}
     */
    async getWorker(workerId: string): Promise<WorkerInfo> {
        if (!workerId) {
            throw new ValidationError("workerId is required");
        }
        return this.doRequest<WorkerInfo>(
            Method.Get,
            `/v1/workers/${encodeURIComponent(workerId)}` as `/v1/workers/${string}`,
        );
    }

    /**
     * 注销指定 Worker
     * DELETE /_synapse/worker/v1/workers/{worker_id}
     */
    async unregisterWorker(workerId: string): Promise<void> {
        if (!workerId) {
            throw new ValidationError("workerId is required");
        }
        await this.doRequest(
            Method.Delete,
            `/v1/workers/${encodeURIComponent(workerId)}` as `/v1/workers/${string}`,
        );
    }

    // =========================================================================
    // 命令方法
    // =========================================================================

    /**
     * 发送命令给指定 Worker
     * POST /_synapse/worker/v1/workers/{worker_id}/commands
     */
    async sendCommand(workerId: string, command: CommandRequest): Promise<void> {
        if (!workerId) {
            throw new ValidationError("workerId is required");
        }
        if (!command.command_type) {
            throw new ValidationError("command_type is required");
        }
        await this.doRequest(
            Method.Post,
            `/v1/workers/${encodeURIComponent(workerId)}/commands` as `/v1/workers/${string}/commands`,
            undefined,
            command,
        );
    }

    // =========================================================================
    // 任务方法
    // =========================================================================

    /**
     * 列出所有待处理任务
     * GET /_synapse/worker/v1/tasks
     */
    async listTasks(): Promise<Task[]> {
        const result = await this.doRequest<{ tasks: Task[] }>(Method.Get, "/v1/tasks");
        return result.tasks || [];
    }

    /**
     * 分配一个任务
     * POST /_synapse/worker/v1/tasks
     */
    async assignTask(task: TaskAssignment): Promise<Task> {
        if (!task.task_type) {
            throw new ValidationError("task_type is required for task assignment");
        }
        return this.doRequest<Task>(Method.Post, "/v1/tasks", undefined, task);
    }

    /**
     * 为指定 Worker 领取下一个任务
     * POST /_synapse/worker/v1/tasks/claim/{worker_id}
     */
    async claimNextTask(workerId: string): Promise<Task> {
        if (!workerId) {
            throw new ValidationError("workerId is required");
        }
        return this.doRequest<Task>(
            Method.Post,
            `/v1/tasks/claim/${encodeURIComponent(workerId)}` as `/v1/tasks/claim/${string}`,
        );
    }

    // =========================================================================
    // 拓扑与统计方法
    // =========================================================================

    /**
     * 获取 Worker 拓扑信息
     * GET /_synapse/worker/v1/topology
     */
    async getTopology(): Promise<Topology> {
        return this.doRequest<Topology>(Method.Get, "/v1/topology");
    }

    /**
     * 获取 Worker 统计信息
     * GET /_synapse/worker/v1/statistics
     */
    async getStatistics(): Promise<Statistics[]> {
        return this.doRequest<Statistics[]>(Method.Get, "/v1/statistics");
    }
}

// ============================================================================
// 管理器注册
// ============================================================================

/**
 * 扩展 MatrixClient，添加 getWorkerManager 方法
 */
export function extendMatrixClient(): void {
    if (MatrixClient.prototype.hasOwnProperty("getWorkerManager")) return;

    MatrixClient.prototype.getWorkerManager = function (this: MatrixClient): WorkerManager {
        registerManagerClass("worker", WorkerManager);
        return getOrCreateManager(this, "worker", () => new WorkerManager(this));
    };
}