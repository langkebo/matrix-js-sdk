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
import { BaseManager } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { AdminPrefix } from "../http-api/prefix";
import type { BackgroundUpdatePathPattern } from "./__generated__/route-table";
import { getOrCreateManager } from "../client-infra/manager-registry";

type StripAdminV1<P extends string> = P extends `/_synapse/admin/v1${infer Rest}` ? Rest : never;

function bu<P extends StripAdminV1<BackgroundUpdatePathPattern>>(path: P): P {
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
    public constructor(client: MatrixClient) {
        super(client);
    }

    private doRequest<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, string>,
        body?: unknown,
    ): Promise<T> {
        return this.client.http.authedRequest<T>(method, path, queryParams, body as Body | undefined, {
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

    public async listBackgroundUpdates(
        query?: BackgroundUpdateQuery,
    ): Promise<{ updates: BackgroundUpdateRecord[]; next_batch?: string | null }> {
        return this.doRequest(Method.Get, bu("/background_updates"), this.buildQuery(query));
    }

    public async createBackgroundUpdate(body: CreateBackgroundUpdateBody): Promise<BackgroundUpdateRecord> {
        if (!body.job_name) {
            throw new ValidationError("job_name is required");
        }
        if (!body.job_type) {
            throw new ValidationError("job_type is required");
        }
        return this.doRequest(Method.Post, bu("/background_updates"), undefined, body);
    }

    public async cleanupLocks(): Promise<{ cleaned_count: number }> {
        return this.doRequest(Method.Post, bu("/background_updates/cleanup_locks"));
    }

    public async getUpdateCount(): Promise<{ total_updates: number }> {
        return this.doRequest(Method.Get, bu("/background_updates/count"));
    }

    public async getNextPendingUpdate(): Promise<BackgroundUpdateRecord | null> {
        return this.doRequest(Method.Get, bu("/background_updates/next"));
    }

    public async listPendingUpdates(): Promise<BackgroundUpdateRecord[]> {
        return this.doRequest(Method.Get, bu("/background_updates/pending"));
    }

    public async retryFailedUpdates(): Promise<{ retried_count: number }> {
        return this.doRequest(Method.Post, bu("/background_updates/retry_failed"));
    }

    public async listRunningUpdates(): Promise<BackgroundUpdateRecord[]> {
        return this.doRequest(Method.Get, bu("/background_updates/running"));
    }

    public async getStats(days?: number): Promise<BackgroundUpdateStatsRecord[]> {
        const query = days !== undefined ? { limit: String(days) } : undefined;
        return this.doRequest(Method.Get, bu("/background_updates/stats"), query);
    }

    public async getStatus(): Promise<BackgroundUpdateStatusResponse> {
        return this.doRequest(Method.Get, bu("/background_updates/status"));
    }

    public async countByStatus(status: string): Promise<{ status: string; count: number }> {
        if (!status) {
            throw new ValidationError("status is required");
        }
        return this.doRequest(
            Method.Get,
            bu(`/background_updates/status/${encodeURIComponent(status)}/count` as StripAdminV1<BackgroundUpdatePathPattern>),
        );
    }

    public async getUpdate(jobName: string): Promise<BackgroundUpdateRecord> {
        return this.doRequest(Method.Get, bu(`/background_updates/${this.encodeJobName(jobName)}` as StripAdminV1<BackgroundUpdatePathPattern>));
    }

    public async deleteUpdate(jobName: string): Promise<void> {
        await this.doRequest(Method.Delete, bu(`/background_updates/${this.encodeJobName(jobName)}` as StripAdminV1<BackgroundUpdatePathPattern>));
    }

    public async startUpdate(jobName: string): Promise<BackgroundUpdateRecord> {
        return this.doRequest(
            Method.Post,
            bu(`/background_updates/${this.encodeJobName(jobName)}/start` as StripAdminV1<BackgroundUpdatePathPattern>),
        );
    }

    public async updateProgress(
        jobName: string,
        body: UpdateProgressBody,
    ): Promise<BackgroundUpdateRecord> {
        if (body.items_processed === undefined) {
            throw new ValidationError("items_processed is required");
        }
        return this.doRequest(
            Method.Post,
            bu(`/background_updates/${this.encodeJobName(jobName)}/progress` as StripAdminV1<BackgroundUpdatePathPattern>),
            undefined,
            body,
        );
    }

    public async completeUpdate(jobName: string): Promise<BackgroundUpdateRecord> {
        return this.doRequest(
            Method.Post,
            bu(`/background_updates/${this.encodeJobName(jobName)}/complete` as StripAdminV1<BackgroundUpdatePathPattern>),
        );
    }

    public async failUpdate(
        jobName: string,
        body: FailBackgroundUpdateBody,
    ): Promise<BackgroundUpdateRecord> {
        if (!body.error_message) {
            throw new ValidationError("error_message is required");
        }
        return this.doRequest(
            Method.Post,
            bu(`/background_updates/${this.encodeJobName(jobName)}/fail` as StripAdminV1<BackgroundUpdatePathPattern>),
            undefined,
            body,
        );
    }

    public async cancelUpdate(jobName: string): Promise<BackgroundUpdateRecord> {
        return this.doRequest(
            Method.Post,
            bu(`/background_updates/${this.encodeJobName(jobName)}/cancel` as StripAdminV1<BackgroundUpdatePathPattern>),
        );
    }

    public async getHistory(
        jobName: string,
        query?: Pick<BackgroundUpdateQuery, "limit">,
    ): Promise<BackgroundUpdateHistoryRecord[]> {
        const queryParams = query?.limit !== undefined ? { limit: String(query.limit) } : undefined;
        return this.doRequest(
            Method.Get,
            bu(`/background_updates/${this.encodeJobName(jobName)}/history` as StripAdminV1<BackgroundUpdatePathPattern>),
            queryParams,
        );
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getBackgroundUpdateManager(): BackgroundUpdateManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getBackgroundUpdateManager = function (): BackgroundUpdateManager {
        return getOrCreateManager(this, "backgroundUpdate", () => new BackgroundUpdateManager(this));
    };
}

export default extendMatrixClient;
