/**
 * Event Report Manager - 事件举报管理
 *
 * 提供事件举报的创建、查询、处理（解决、忽略、升级）、删除及统计功能。
 * 对应后端: synapse-rust/src/web/routes/event_report.rs
 *
 * 遵循 D7 契约驱动开发标准，按最新 ledger 绑定调用路径。
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/method";
import { AdminPrefix } from "../http-api/prefix";
import { type Body } from "../http-api/interface";
import { BaseManager } from "../managers/base-manager";
import { ValidationError } from "../errors";
import { validateUserId, validateRoomId } from "../common/validators";
import type { EventReportPathPattern } from "./__generated__/route-table";
import { getOrCreateManager } from "../client-infra/manager-registry";
import type { IContent } from "../models/event";

type StripAdminPrefix<P extends string> = P extends `/_synapse/admin/v1${infer Rest}` ? Rest : never;
type EventReportAdminPathPattern = StripAdminPrefix<EventReportPathPattern>;

function er<P extends EventReportAdminPathPattern>(path: P): P {
    return path;
}

export type ReportStatus = "open" | "resolved" | "dismissed" | "escalated" | string;

export interface CreateReportBody {
    event_id: string;
    room_id: string;
    reported_user_id?: string;
    event_json?: IContent;
    reason?: string;
    description?: string;
    score?: number;
}

export interface UpdateReportBody {
    status?: ReportStatus;
    score?: number;
}

export interface ReportResponse {
    id: number;
    event_id: string;
    room_id: string;
    reporter_user_id: string;
    reported_user_id?: string;
    reason?: string;
    description?: string;
    status: ReportStatus;
    score: number;
    received_ts: number;
    resolved_ts?: number;
    resolved_by?: string;
    resolution_reason?: string;
    canonical_alias?: string;
    event_json?: IContent;
    sender?: string;
}

export interface ResolveReportBody {
    resolution_reason?: string;
}

export interface DismissReportBody {
    reason?: string;
}

export interface EscalateReportBody {
    reason?: string;
}

export interface RateLimitResponse {
    blocked: boolean;
    user_id: string;
    reason?: string;
    blocked_at?: number;
}

export interface QueryParams {
    limit?: number;
    since_score?: number;
    since_ts?: number;
    since_id?: number;
}

export interface StatsResponse {
    total: number;
    open: number;
    resolved: number;
    dismissed: number;
    escalated: number;
}

export interface StatusCountResponse {
    status: string;
    count: number;
}

export interface EventReportCountResponse {
    total_reports?: number;
    status?: string;
    count?: number;
}

/**
 * EventReportManager 处理事件举报流程。
 * 对应后端 `event_report.rs` 中的所有 Admin REST 端点。
 */
export class EventReportManager extends BaseManager {
    constructor(client: MatrixClient) {
        super(client);
    }

    private buildQueryParams(params?: QueryParams): Record<string, string | number> | undefined {
        if (!params) return undefined;
        if (params.limit !== undefined) this.requirePositiveInteger(params.limit, "limit");
        if (params.since_id !== undefined) this.requirePositiveInteger(params.since_id, "since_id");
        if (params.since_ts !== undefined && (!Number.isInteger(params.since_ts) || params.since_ts < 0)) {
            throw new ValidationError("since_ts must be a non-negative integer");
        }
        if (params.since_score !== undefined && !Number.isInteger(params.since_score)) {
            throw new ValidationError("since_score must be an integer");
        }

        const query: Record<string, string | number> = {};
        if (params.limit !== undefined) query.limit = params.limit;
        if (params.since_score !== undefined) query.since_score = params.since_score;
        if (params.since_ts !== undefined) query.since_ts = params.since_ts;
        if (params.since_id !== undefined) query.since_id = params.since_id;
        return Object.keys(query).length > 0 ? query : undefined;
    }

    /**
     * 创建举报
     * 对应 POST /_synapse/admin/v1/event_reports
     */
    async createReport(body: CreateReportBody): Promise<ReportResponse> {
        this.requireNonEmptyString(body.event_id, "event_id");
        validateRoomId(body.room_id);
        if (body.reported_user_id) {
            validateUserId(body.reported_user_id);
        }
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<ReportResponse>(
                Method.Post,
                er("/event_reports"),
                undefined,
                body as Body,
                { prefix: AdminPrefix.V1 },
            );
        }, "createReport");
    }

    /**
     * 获取所有举报
     * 对应 GET /_synapse/admin/v1/event_reports
     */
    async getAllReports(params?: QueryParams): Promise<ReportResponse[]> {
        return this.listReports(params);
    }

    /**
     * 列出举报
     * 对应 GET /_synapse/admin/v1/event_reports
     */
    async listReports(params?: QueryParams): Promise<ReportResponse[]> {
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<ReportResponse[]>(
                Method.Get,
                er("/event_reports"),
                this.buildQueryParams(params),
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        }, "listReports");
    }

    /**
     * 获取举报总数
     * 对应 GET /_synapse/admin/v1/event_reports/count
     */
    async getReportsCount(): Promise<EventReportCountResponse> {
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<EventReportCountResponse>(
                Method.Get,
                er("/event_reports/count"),
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        }, "getReportsCount");
    }

    /**
     * 获取举报详情
     * 对应 GET /_synapse/admin/v1/event_reports/{id}
     */
    async getReport(id: number): Promise<ReportResponse> {
        this.requirePositiveInteger(id, "id");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<ReportResponse>(
                Method.Get,
                er(`/event_reports/${id}`),
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        }, "getReport");
    }

    /**
     * 按事件查询举报
     * 对应 GET /_synapse/admin/v1/event_reports/event/{event_id}
     */
    async getReportsByEvent(eventId: string): Promise<ReportResponse[]> {
        this.requireNonEmptyString(eventId, "eventId");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<ReportResponse[]>(
                Method.Get,
                er(`/event_reports/event/${encodeURIComponent(eventId)}`),
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        }, "getReportsByEvent");
    }

    /**
     * 按房间查询举报
     * 对应 GET /_synapse/admin/v1/event_reports/room/{room_id}
     */
    async getReportsByRoom(roomId: string, params?: QueryParams): Promise<ReportResponse[]> {
        validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<ReportResponse[]>(
                Method.Get,
                er(`/event_reports/room/${encodeURIComponent(roomId)}`),
                this.buildQueryParams(params),
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        }, "getReportsByRoom");
    }

    /**
     * 按举报人查询举报
     * 对应 GET /_synapse/admin/v1/event_reports/reporter/{reporter_user_id}
     */
    async getReportsByReporter(
        reporterUserId: string,
        params?: QueryParams,
    ): Promise<ReportResponse[]> {
        validateUserId(reporterUserId);
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<ReportResponse[]>(
                Method.Get,
                er(`/event_reports/reporter/${encodeURIComponent(reporterUserId)}`),
                this.buildQueryParams(params),
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        }, "getReportsByReporter");
    }

    /**
     * 按状态查询举报
     * 对应 GET /_synapse/admin/v1/event_reports/status/{status}
     */
    async getReportsByStatus(
        status: ReportStatus,
        params?: QueryParams,
    ): Promise<ReportResponse[]> {
        this.requireNonEmptyString(status, "status");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<ReportResponse[]>(
                Method.Get,
                er(`/event_reports/status/${encodeURIComponent(status)}`),
                this.buildQueryParams(params),
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        }, "getReportsByStatus");
    }

    /**
     * 按状态获取举报计数
     * 对应 GET /_synapse/admin/v1/event_reports/status/{status}/count
     */
    async getStatusCount(status: ReportStatus): Promise<StatusCountResponse> {
        this.requireNonEmptyString(status, "status");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<StatusCountResponse>(
                Method.Get,
                er(`/event_reports/status/${encodeURIComponent(status)}/count`),
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        }, "getStatusCount");
    }

    /**
     * 更新举报
     * 对应 PUT /_synapse/admin/v1/event_reports/{id}
     */
    async updateReport(id: number, body: UpdateReportBody): Promise<ReportResponse> {
        this.requirePositiveInteger(id, "id");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<ReportResponse>(
                Method.Put,
                er(`/event_reports/${id}`),
                undefined,
                body as Body,
                { prefix: AdminPrefix.V1 },
            );
        }, "updateReport");
    }

    /**
     * 解决举报
     * 对应 POST /_synapse/admin/v1/event_reports/{id}/resolve
     */
    async resolveReport(id: number, body?: ResolveReportBody): Promise<ReportResponse> {
        this.requirePositiveInteger(id, "id");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<ReportResponse>(
                Method.Post,
                er(`/event_reports/${id}/resolve`),
                undefined,
                body as Body,
                { prefix: AdminPrefix.V1 },
            );
        }, "resolveReport");
    }

    /**
     * 驳回举报
     * 对应 POST /_synapse/admin/v1/event_reports/{id}/dismiss
     */
    async dismissReport(id: number, body?: DismissReportBody): Promise<ReportResponse> {
        this.requirePositiveInteger(id, "id");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<ReportResponse>(
                Method.Post,
                er(`/event_reports/${id}/dismiss`),
                undefined,
                body as Body,
                { prefix: AdminPrefix.V1 },
            );
        }, "dismissReport");
    }

    /**
     * 升级举报
     * 对应 POST /_synapse/admin/v1/event_reports/{id}/escalate
     */
    async escalateReport(id: number, body?: EscalateReportBody): Promise<ReportResponse> {
        this.requirePositiveInteger(id, "id");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<ReportResponse>(
                Method.Post,
                er(`/event_reports/${id}/escalate`),
                undefined,
                body as Body,
                { prefix: AdminPrefix.V1 },
            );
        }, "escalateReport");
    }

    /**
     * 删除举报
     * 对应 DELETE /_synapse/admin/v1/event_reports/{id}
     */
    async deleteReport(id: number): Promise<void> {
        this.requirePositiveInteger(id, "id");
        await this.withRetry(async () => {
            await this.client.http.authedRequest<void>(
                Method.Delete,
                er(`/event_reports/${id}`),
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        }, "deleteReport");
    }

    /**
     * 获取举报历史
     * 对应 GET /_synapse/admin/v1/event_reports/{id}/history
     */
    async getReportHistory(id: number): Promise<ReportResponse[]> {
        this.requirePositiveInteger(id, "id");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<ReportResponse[]>(
                Method.Get,
                er(`/event_reports/${id}/history`),
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        }, "getReportHistory");
    }

    /**
     * 获取举报统计
     * 对应 GET /_synapse/admin/v1/event_reports/stats
     */
    async getStats(): Promise<StatsResponse> {
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<StatsResponse>(
                Method.Get,
                er("/event_reports/stats"),
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        }, "getStats");
    }

    /**
     * 查询用户频率限制状态
     * 对应 GET /_synapse/admin/v1/event_reports/rate_limit/{user_id}
     */
    async checkRateLimit(
        userId: string,
    ): Promise<{ is_allowed: boolean; remaining_reports: number; block_reason?: string }> {
        validateUserId(userId);
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<{
                is_allowed: boolean;
                remaining_reports: number;
                block_reason?: string;
            }>(
                Method.Get,
                er(`/event_reports/rate_limit/${encodeURIComponent(userId)}`),
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        }, "checkRateLimit");
    }

    /**
     * 封禁用户举报频率
     * 对应 POST /_synapse/admin/v1/event_reports/rate_limit/{user_id}/block
     */
    async blockUser(userId: string, blockedUntil: number, reason: string): Promise<void> {
        validateUserId(userId);
        await this.withRetry(async () => {
            await this.client.http.authedRequest<void>(
                Method.Post,
                er(`/event_reports/rate_limit/${encodeURIComponent(userId)}/block`),
                undefined,
                { blocked_until: blockedUntil, reason } as Body,
                { prefix: AdminPrefix.V1 },
            );
        }, "blockUser");
    }

    /**
     * 解封用户举报频率
     * 对应 POST /_synapse/admin/v1/event_reports/rate_limit/{user_id}/unblock
     */
    async unblockUser(userId: string): Promise<void> {
        validateUserId(userId);
        await this.withRetry(async () => {
            await this.client.http.authedRequest<void>(
                Method.Post,
                er(`/event_reports/rate_limit/${encodeURIComponent(userId)}/unblock`),
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );
        }, "unblockUser");
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getEventReportManager(): EventReportManager;
    }
}

/** @internal */
export function extendMatrixClient(): void {
    MatrixClient.prototype.getEventReportManager = function (): EventReportManager {
        return getOrCreateManager(this, "eventReport", () => new EventReportManager(this));
    };
}