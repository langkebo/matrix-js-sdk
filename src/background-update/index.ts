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
 * Background Update Manager - 数据库后台更新任务管理 API 封装
 *
 * 提供数据库后台更新任务的查询、启用/禁用、手动触发等功能
 * 对接后端: synapse-rust/src/web/routes/background_update.rs
 * API 前缀: /_synapse/admin/v1/background_updates
 *
 * 使用方式:
 * ```typescript
 * const manager = client.getBackgroundUpdateManager();
 * // 列出所有后台更新任务
 * const updates = await manager.listUpdates();
 * // 启用特定更新任务
 * await manager.enableUpdate("populate_stats_process_rooms");
 * ```
 */
import { MatrixClient } from "../client";
import { ValidationError } from "../errors";
import type { Body } from "../http-api/interface";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { AdminPrefix } from "../http-api/prefix";
import type { BackgroundUpdatePath } from "./__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type { PathAssert, StripAdminV1 } from "../http-api/strip-prefix";

function bu<const P extends string>(path: P & PathAssert<P, StripAdminV1<BackgroundUpdatePath>>): P {
    return path;
}

export interface BackgroundUpdateRecord {
    job_name: string;
    job_type: string;
    description?: string | null;
    table_name?: string | null;
    status: string;
    progress: Record<string, unknown> | number | null; // Dynamic: progress shape varies by job type
    total_items: number;
    processed_items: number;
    created_ts: number;
    started_ts?: number | null;
    completed_ts?: number | null;
    error_message?: string | null;
    retry_count: number;
}

export interface BackgroundUpdateHistoryRecord {
    id: number;
    job_name: string;
    execution_start_ts: number;
    execution_end_ts?: number | null;
    status: string;
    items_processed: number;
    error_message?: string | null;
}

export interface BackgroundUpdateStatsRecord {
    id: number;
    job_name: string;
    total_updates: number;
    completed_updates: number;
    failed_updates: number;
    last_run_ts?: number | null;
    next_run_ts?: number | null;
    average_duration_ms: number;
    created_ts: number;
    updated_ts: number;
}

export interface BackgroundUpdateStatusResponse {
    pending_count: number;
    running_count: number;
    completed_count: number;
    failed_count: number;
    total_count: number;
    current_update?: BackgroundUpdateRecord | null;
}

export interface BackgroundUpdateQuery {
    limit?: number;
    from?: string;
}

export interface BackgroundUpdateMetadata {
    trace_id?: string;
    span_id?: string;
    [key: string]: unknown;
}

export interface CreateBackgroundUpdateBody {
    job_name: string;
    job_type: string;
    description?: string;
    table_name?: string;
    column_name?: string;
    total_items?: number;
    batch_size?: number;
    sleep_ms?: number;
    depends_on?: string[];
    metadata?: BackgroundUpdateMetadata;
}

export interface UpdateProgressBody {
    items_processed: number;
    total_items?: number;
}

export interface FailBackgroundUpdateBody {
    error_message: string;
}

export class BackgroundUpdateManager extends BaseManager<string, Record<string, never>> {
    public constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    private doRequest<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, string>,
        body?: unknown,
    ): Promise<T> {
        return this.request<T>({
            method: method,
            path: path,
            queryParams: queryParams,
            body: body as Body | undefined,
            prefix: AdminPrefix.V1,
        });
    }

    private encodeJobName(jobName: string): string {
        if (!jobName) {
            throw new ValidationError("jobName is required");
        }
        return encodeURIComponent(jobName);
    }

    private buildQuery(query?: BackgroundUpdateQuery): Record<string, string> | undefined {
        const queryParams: Record<string, string> = {};
        if (query?.limit !== undefined) {
            queryParams.limit = String(query.limit);
        }
        if (query?.from) {
            queryParams.from = query.from;
        }
        return Object.keys(queryParams).length > 0 ? queryParams : undefined;
    }

    /**
     * 分页列出后台更新任务。
     *
     * @param query - 可选查询参数（分页游标与条数上限）
     * @returns 更新任务列表与下一页游标
     * @example
     * const page = await client.getBackgroundUpdateManager().listBackgroundUpdates({ limit: 20 });
     */
    public async listBackgroundUpdates(
        query?: BackgroundUpdateQuery,
    ): Promise<{ updates: BackgroundUpdateRecord[]; next_batch?: string | null }> {
        return this.doRequest(Method.Get, bu("/background_updates"), this.buildQuery(query));
    }

    /**
     * 创建一个后台更新任务。
     *
     * @param body - 任务定义（`job_name` 与 `job_type` 必填）
     * @returns 新建的更新任务
     * @throws {ValidationError} 当 `job_name` 或 `job_type` 缺失时
     * @example
     * const job = await client.getBackgroundUpdateManager().createBackgroundUpdate({
     *     job_name: "rebuild_index",
     *     job_type: "index",
     * });
     */
    public async createBackgroundUpdate(body: CreateBackgroundUpdateBody): Promise<BackgroundUpdateRecord> {
        if (!body.job_name) {
            throw new ValidationError("job_name is required");
        }
        if (!body.job_type) {
            throw new ValidationError("job_type is required");
        }
        return this.doRequest(Method.Post, bu("/background_updates"), undefined, body);
    }

    /**
     * 清理陈旧的更新任务锁。
     *
     * @returns 被清理的锁数量
     * @example
     * const { cleaned_count } = await client.getBackgroundUpdateManager().cleanupLocks();
     */
    public async cleanupLocks(): Promise<{ cleaned_count: number }> {
        return this.doRequest(Method.Post, bu("/background_updates/cleanup_locks"));
    }

    /**
     * 获取后台更新任务总数。
     *
     * @returns 任务总数
     * @example
     * const { total_updates } = await client.getBackgroundUpdateManager().getUpdateCount();
     */
    public async getUpdateCount(): Promise<{ total_updates: number }> {
        return this.doRequest(Method.Get, bu("/background_updates/count"));
    }

    /**
     * 获取下一个待执行的更新任务。
     *
     * @returns 待执行任务；无待执行任务时为 `null`
     * @example
     * const next = await client.getBackgroundUpdateManager().getNextPendingUpdate();
     */
    public async getNextPendingUpdate(): Promise<BackgroundUpdateRecord | null> {
        return this.doRequest(Method.Get, bu("/background_updates/next"));
    }

    /**
     * 列出全部待执行的更新任务。
     *
     * @returns 待执行任务列表
     * @example
     * const pending = await client.getBackgroundUpdateManager().listPendingUpdates();
     */
    public async listPendingUpdates(): Promise<BackgroundUpdateRecord[]> {
        return this.doRequest(Method.Get, bu("/background_updates/pending"));
    }

    /**
     * 重试全部失败的更新任务。
     *
     * @returns 被重新排队的任务数量
     * @example
     * const { retried_count } = await client.getBackgroundUpdateManager().retryFailedUpdates();
     */
    public async retryFailedUpdates(): Promise<{ retried_count: number }> {
        return this.doRequest(Method.Post, bu("/background_updates/retry_failed"));
    }

    /**
     * 列出正在执行的更新任务。
     *
     * @returns 执行中的任务列表
     * @example
     * const running = await client.getBackgroundUpdateManager().listRunningUpdates();
     */
    public async listRunningUpdates(): Promise<BackgroundUpdateRecord[]> {
        return this.doRequest(Method.Get, bu("/background_updates/running"));
    }

    /**
     * 获取更新任务的统计信息。
     *
     * @param days - 可选统计天数（映射为查询条数）
     * @returns 统计记录列表
     * @example
     * const stats = await client.getBackgroundUpdateManager().getStats(7);
     */
    public async getStats(days?: number): Promise<BackgroundUpdateStatsRecord[]> {
        const query = days !== undefined ? { limit: String(days) } : undefined;
        return this.doRequest(Method.Get, bu("/background_updates/stats"), query);
    }

    /**
     * 获取后台更新子系统的整体状态。
     *
     * @returns 状态响应
     * @example
     * const status = await client.getBackgroundUpdateManager().getStatus();
     */
    public async getStatus(): Promise<BackgroundUpdateStatusResponse> {
        return this.doRequest(Method.Get, bu("/background_updates/status"));
    }

    /**
     * 按状态统计更新任务数量。
     *
     * @param status - 任务状态
     * @returns 状态与对应数量
     * @throws {ValidationError} 当 status 为空时
     * @example
     * const { count } = await client.getBackgroundUpdateManager().countByStatus("failed");
     */
    public async countByStatus(status: string): Promise<{ status: string; count: number }> {
        if (!status) {
            throw new ValidationError("status is required");
        }
        return this.doRequest(Method.Get, bu(`/background_updates/status/${encodeURIComponent(status)}/count`));
    }

    /**
     * 按任务名获取单个更新任务。
     *
     * @param jobName - 任务名
     * @returns 更新任务
     * @throws {ValidationError} 当 jobName 为空时
     * @example
     * const job = await client.getBackgroundUpdateManager().getUpdate("rebuild_index");
     */
    public async getUpdate(jobName: string): Promise<BackgroundUpdateRecord> {
        return this.doRequest(Method.Get, bu(`/background_updates/${this.encodeJobName(jobName)}`));
    }

    /**
     * 删除指定更新任务。
     *
     * @param jobName - 任务名
     * @throws {ValidationError} 当 jobName 为空时
     * @example
     * await client.getBackgroundUpdateManager().deleteUpdate("rebuild_index");
     */
    public async deleteUpdate(jobName: string): Promise<void> {
        await this.doRequest(Method.Delete, bu(`/background_updates/${this.encodeJobName(jobName)}`));
    }

    /**
     * 将指定更新任务置为执行中。
     *
     * @param jobName - 任务名
     * @returns 更新后的任务
     * @throws {ValidationError} 当 jobName 为空时
     * @example
     * const job = await client.getBackgroundUpdateManager().startUpdate("rebuild_index");
     */
    public async startUpdate(jobName: string): Promise<BackgroundUpdateRecord> {
        return this.doRequest(Method.Post, bu(`/background_updates/${this.encodeJobName(jobName)}/start`));
    }

    /**
     * 上报更新任务的执行进度。
     *
     * @param jobName - 任务名
     * @param body - 进度数据（`items_processed` 必填）
     * @returns 更新后的任务
     * @throws {ValidationError} 当 `items_processed` 缺失或 jobName 为空时
     * @example
     * await client
     *     .getBackgroundUpdateManager()
     *     .updateProgress("rebuild_index", { items_processed: 100 });
     */
    public async updateProgress(jobName: string, body: UpdateProgressBody): Promise<BackgroundUpdateRecord> {
        if (body.items_processed === undefined) {
            throw new ValidationError("items_processed is required");
        }
        return this.doRequest(
            Method.Post,
            bu(`/background_updates/${this.encodeJobName(jobName)}/progress`),
            undefined,
            body,
        );
    }

    /**
     * 将更新任务标记为已完成。
     *
     * @param jobName - 任务名
     * @returns 更新后的任务
     * @throws {ValidationError} 当 jobName 为空时
     * @example
     * const job = await client.getBackgroundUpdateManager().completeUpdate("rebuild_index");
     */
    public async completeUpdate(jobName: string): Promise<BackgroundUpdateRecord> {
        return this.doRequest(Method.Post, bu(`/background_updates/${this.encodeJobName(jobName)}/complete`));
    }

    /**
     * 将更新任务标记为失败。
     *
     * @param jobName - 任务名
     * @param body - 失败信息（`error_message` 必填）
     * @returns 更新后的任务
     * @throws {ValidationError} 当 `error_message` 缺失或 jobName 为空时
     * @example
     * await client
     *     .getBackgroundUpdateManager()
     *     .failUpdate("rebuild_index", { error_message: "timeout" });
     */
    public async failUpdate(jobName: string, body: FailBackgroundUpdateBody): Promise<BackgroundUpdateRecord> {
        if (!body.error_message) {
            throw new ValidationError("error_message is required");
        }
        return this.doRequest(
            Method.Post,
            bu(`/background_updates/${this.encodeJobName(jobName)}/fail`),
            undefined,
            body,
        );
    }

    /**
     * 取消更新任务。
     *
     * @param jobName - 任务名
     * @returns 更新后的任务
     * @throws {ValidationError} 当 jobName 为空时
     * @example
     * const job = await client.getBackgroundUpdateManager().cancelUpdate("rebuild_index");
     */
    public async cancelUpdate(jobName: string): Promise<BackgroundUpdateRecord> {
        return this.doRequest(Method.Post, bu(`/background_updates/${this.encodeJobName(jobName)}/cancel`));
    }

    /**
     * 获取指定更新任务的历史记录。
     *
     * @param jobName - 任务名
     * @param query - 可选条数限制
     * @returns 历史记录列表
     * @throws {ValidationError} 当 jobName 为空时
     * @example
     * const history = await client.getBackgroundUpdateManager().getHistory("rebuild_index", { limit: 20 });
     */
    public async getHistory(
        jobName: string,
        query?: Pick<BackgroundUpdateQuery, "limit">,
    ): Promise<BackgroundUpdateHistoryRecord[]> {
        const queryParams = query?.limit !== undefined ? { limit: String(query.limit) } : undefined;
        return this.doRequest(
            Method.Get,
            bu(`/background_updates/${this.encodeJobName(jobName)}/history`),
            queryParams,
        );
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getBackgroundUpdateManager = function (): BackgroundUpdateManager {
        registerManagerClass("backgroundUpdate", BackgroundUpdateManager);
        return getOrCreateManager(this, "backgroundUpdate", () => new BackgroundUpdateManager(this));
    };
}
