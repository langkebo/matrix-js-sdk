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
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { ValidationError } from "../errors";
import { validateUserId, validateRoomId } from "../common/validators";
import type { EventReportPathPattern } from "./__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
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
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
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
     *
     * @example
     * ```typescript
     * const report = await client.getEventReportManager().createReport({
     *     event_id: "$event:example.org",
     *     room_id: "!room:example.org",
     *     reason: "spam",
     * });
     * console.log(report.id, report.status);
     * ```
     */
    async createReport(body: CreateReportBody): Promise<ReportResponse> {
        this.requireNonEmptyString(body.event_id, "event_id");
        validateRoomId(body.room_id);
        if (body.reported_user_id) {
            validateUserId(body.reported_user_id);
        }
        return await this.withRetry(async () => {
            return await this.request<ReportResponse>({
                method: Method.Post,
                path: er("/event_reports"),
                body,
                prefix: AdminPrefix.V1,
            });
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
     *
     * @example
     * ```typescript
     * const reports = await client.getEventReportManager().listReports({ limit: 20, since_id: 100 });
     * console.log(`fetched ${reports.length} reports`);
     * ```
     */
    async listReports(params?: QueryParams): Promise<ReportResponse[]> {
        return await this.withRetry(async () => {
            return await this.request<ReportResponse[]>({
                method: Method.Get,
                path: er("/event_reports"),
                queryParams: this.buildQueryParams(params),
                prefix: AdminPrefix.V1,
            });
        }, "listReports");
    }

    /**
     * 获取举报总数
     * 对应 GET /_synapse/admin/v1/event_reports/count
     *
     * @example
     * ```typescript
     * const count = await client.getEventReportManager().getReportsCount();
     * console.log(`total reports: ${count.total_reports}`);
     * ```
     */
    async getReportsCount(): Promise<EventReportCountResponse> {
        return await this.withRetry(async () => {
            return await this.request<EventReportCountResponse>({
                method: Method.Get,
                path: er("/event_reports/count"),
                prefix: AdminPrefix.V1,
            });
        }, "getReportsCount");
    }

    /**
     * 获取举报详情
     * 对应 GET /_synapse/admin/v1/event_reports/{id}
     *
     * @example
     * ```typescript
     * const report = await client.getEventReportManager().getReport(42);
     * console.log(report.event_id, report.status, report.score);
     * ```
     */
    async getReport(id: number): Promise<ReportResponse> {
        this.requirePositiveInteger(id, "id");
        return await this.withRetry(async () => {
            return await this.request<ReportResponse>({
                method: Method.Get,
                path: er(`/event_reports/${id}`),
                prefix: AdminPrefix.V1,
            });
        }, "getReport");
    }

    /**
     * 按事件查询举报
     * 对应 GET /_synapse/admin/v1/event_reports/event/{event_id}
     *
     * @example
     * ```typescript
     * const reports = await client.getEventReportManager().getReportsByEvent("$event:example.org");
     * console.log(reports.map((r) => r.id));
     * ```
     */
    async getReportsByEvent(eventId: string): Promise<ReportResponse[]> {
        this.requireNonEmptyString(eventId, "eventId");
        return await this.withRetry(async () => {
            return await this.request<ReportResponse[]>({
                method: Method.Get,
                path: er(`/event_reports/event/${encodeURIComponent(eventId)}`),
                prefix: AdminPrefix.V1,
            });
        }, "getReportsByEvent");
    }

    /**
     * 按房间查询举报
     * 对应 GET /_synapse/admin/v1/event_reports/room/{room_id}
     *
     * @example
     * ```typescript
     * const reports = await client.getEventReportManager().getReportsByRoom("!room:example.org", {
     *     limit: 50,
     * });
     * console.log(reports.length);
     * ```
     */
    async getReportsByRoom(roomId: string, params?: QueryParams): Promise<ReportResponse[]> {
        validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.request<ReportResponse[]>({
                method: Method.Get,
                path: er(`/event_reports/room/${encodeURIComponent(roomId)}`),
                queryParams: this.buildQueryParams(params),
                prefix: AdminPrefix.V1,
            });
        }, "getReportsByRoom");
    }

    /**
     * 按举报人查询举报
     * 对应 GET /_synapse/admin/v1/event_reports/reporter/{reporter_user_id}
     *
     * @example
     * ```typescript
     * const reports = await client
     *     .getEventReportManager()
     *     .getReportsByReporter("@alice:example.org", { limit: 10 });
     * console.log(reports.length);
     * ```
     */
    async getReportsByReporter(reporterUserId: string, params?: QueryParams): Promise<ReportResponse[]> {
        validateUserId(reporterUserId);
        return await this.withRetry(async () => {
            return await this.request<ReportResponse[]>({
                method: Method.Get,
                path: er(`/event_reports/reporter/${encodeURIComponent(reporterUserId)}`),
                queryParams: this.buildQueryParams(params),
                prefix: AdminPrefix.V1,
            });
        }, "getReportsByReporter");
    }

    /**
     * 按状态查询举报
     * 对应 GET /_synapse/admin/v1/event_reports/status/{status}
     *
     * @example
     * ```typescript
     * const openReports = await client
     *     .getEventReportManager()
     *     .getReportsByStatus("open", { limit: 100 });
     * console.log(openReports.length);
     * ```
     */
    async getReportsByStatus(status: ReportStatus, params?: QueryParams): Promise<ReportResponse[]> {
        this.requireNonEmptyString(status, "status");
        return await this.withRetry(async () => {
            return await this.request<ReportResponse[]>({
                method: Method.Get,
                path: er(`/event_reports/status/${encodeURIComponent(status)}`),
                queryParams: this.buildQueryParams(params),
                prefix: AdminPrefix.V1,
            });
        }, "getReportsByStatus");
    }

    /**
     * 按状态获取举报计数
     * 对应 GET /_synapse/admin/v1/event_reports/status/{status}/count
     *
     * @example
     * ```typescript
     * const { status, count } = await client.getEventReportManager().getStatusCount("resolved");
     * console.log(`${status}: ${count}`);
     * ```
     */
    async getStatusCount(status: ReportStatus): Promise<StatusCountResponse> {
        this.requireNonEmptyString(status, "status");
        return await this.withRetry(async () => {
            return await this.request<StatusCountResponse>({
                method: Method.Get,
                path: er(`/event_reports/status/${encodeURIComponent(status)}/count`),
                prefix: AdminPrefix.V1,
            });
        }, "getStatusCount");
    }

    /**
     * 更新举报
     * 对应 PUT /_synapse/admin/v1/event_reports/{id}
     *
     * @example
     * ```typescript
     * const updated = await client
     *     .getEventReportManager()
     *     .updateReport(42, { status: "open", score: 5 });
     * console.log(updated.status, updated.score);
     * ```
     */
    async updateReport(id: number, body: UpdateReportBody): Promise<ReportResponse> {
        this.requirePositiveInteger(id, "id");
        return await this.withRetry(async () => {
            return await this.request<ReportResponse>({
                method: Method.Put,
                path: er(`/event_reports/${id}`),
                body,
                prefix: AdminPrefix.V1,
            });
        }, "updateReport");
    }

    /**
     * 解决举报
     * 对应 POST /_synapse/admin/v1/event_reports/{id}/resolve
     *
     * @example
     * ```typescript
     * const resolved = await client
     *     .getEventReportManager()
     *     .resolveReport(42, { resolution_reason: "confirmed spam" });
     * console.log(resolved.status);
     * ```
     */
    async resolveReport(id: number, body?: ResolveReportBody): Promise<ReportResponse> {
        this.requirePositiveInteger(id, "id");
        return await this.withRetry(async () => {
            return await this.request<ReportResponse>({
                method: Method.Post,
                path: er(`/event_reports/${id}/resolve`),
                body,
                prefix: AdminPrefix.V1,
            });
        }, "resolveReport");
    }

    /**
     * 驳回举报
     * 对应 POST /_synapse/admin/v1/event_reports/{id}/dismiss
     *
     * @example
     * ```typescript
     * const dismissed = await client
     *     .getEventReportManager()
     *     .dismissReport(42, { reason: "not a violation" });
     * console.log(dismissed.status);
     * ```
     */
    async dismissReport(id: number, body?: DismissReportBody): Promise<ReportResponse> {
        this.requirePositiveInteger(id, "id");
        return await this.withRetry(async () => {
            return await this.request<ReportResponse>({
                method: Method.Post,
                path: er(`/event_reports/${id}/dismiss`),
                body,
                prefix: AdminPrefix.V1,
            });
        }, "dismissReport");
    }

    /**
     * 升级举报
     * 对应 POST /_synapse/admin/v1/event_reports/{id}/escalate
     *
     * @example
     * ```typescript
     * const escalated = await client
     *     .getEventReportManager()
     *     .escalateReport(42, { reason: "needs senior review" });
     * console.log(escalated.status);
     * ```
     */
    async escalateReport(id: number, body?: EscalateReportBody): Promise<ReportResponse> {
        this.requirePositiveInteger(id, "id");
        return await this.withRetry(async () => {
            return await this.request<ReportResponse>({
                method: Method.Post,
                path: er(`/event_reports/${id}/escalate`),
                body,
                prefix: AdminPrefix.V1,
            });
        }, "escalateReport");
    }

    /**
     * 删除举报
     * 对应 DELETE /_synapse/admin/v1/event_reports/{id}
     *
     * @example
     * ```typescript
     * await client.getEventReportManager().deleteReport(42);
     * console.log("report deleted");
     * ```
     */
    async deleteReport(id: number): Promise<void> {
        this.requirePositiveInteger(id, "id");
        await this.withRetry(async () => {
            await this.request<void>({
                method: Method.Delete,
                path: er(`/event_reports/${id}`),
                prefix: AdminPrefix.V1,
            });
        }, "deleteReport");
    }

    /**
     * 获取举报统计
     * 对应 GET /_synapse/admin/v1/event_reports/stats
     *
     * @example
     * ```typescript
     * const stats = await client.getEventReportManager().getStats();
     * console.log(`open: ${stats.open}, resolved: ${stats.resolved}, total: ${stats.total}`);
     * ```
     */
    async getStats(): Promise<StatsResponse> {
        return await this.withRetry(async () => {
            return await this.request<StatsResponse>({
                method: Method.Get,
                path: er("/event_reports/stats"),
                prefix: AdminPrefix.V1,
            });
        }, "getStats");
    }

    /**
     * 查询用户频率限制状态
     * 对应 GET /_synapse/admin/v1/event_reports/rate_limit/{user_id}
     *
     * @example
     * ```typescript
     * const limit = await client.getEventReportManager().checkRateLimit("@alice:example.org");
     * if (!limit.is_allowed) {
     *     console.log(`blocked: ${limit.block_reason}`);
     * }
     * ```
     */
    async checkRateLimit(
        userId: string,
    ): Promise<{ is_allowed: boolean; remaining_reports: number; block_reason?: string }> {
        validateUserId(userId);
        return await this.withRetry(async () => {
            return await this.request<{
                is_allowed: boolean;
                remaining_reports: number;
                block_reason?: string;
            }>({
                method: Method.Get,
                path: er(`/event_reports/rate_limit/${encodeURIComponent(userId)}`),
                prefix: AdminPrefix.V1,
            });
        }, "checkRateLimit");
    }

    /**
     * 封禁用户举报频率
     * 对应 POST /_synapse/admin/v1/event_reports/rate_limit/{user_id}/block
     *
     * @example
     * ```typescript
     * const blockedUntil = Date.now() + 24 * 60 * 60 * 1000;
     * await client.getEventReportManager().blockUser("@alice:example.org", blockedUntil, "report flooding");
     * ```
     */
    async blockUser(userId: string, blockedUntil: number, reason: string): Promise<void> {
        validateUserId(userId);
        await this.withRetry(async () => {
            await this.request<void>({
                method: Method.Post,
                path: er(`/event_reports/rate_limit/${encodeURIComponent(userId)}/block`),
                body: { blocked_until: blockedUntil, reason },
                prefix: AdminPrefix.V1,
            });
        }, "blockUser");
    }

    /**
     * 解封用户举报频率
     * 对应 POST /_synapse/admin/v1/event_reports/rate_limit/{user_id}/unblock
     *
     * @example
     * ```typescript
     * await client.getEventReportManager().unblockUser("@alice:example.org");
     * console.log("user unblocked");
     * ```
     */
    async unblockUser(userId: string): Promise<void> {
        validateUserId(userId);
        await this.withRetry(async () => {
            await this.request<void>({
                method: Method.Post,
                path: er(`/event_reports/rate_limit/${encodeURIComponent(userId)}/unblock`),
                prefix: AdminPrefix.V1,
            });
        }, "unblockUser");
    }
}

/** @internal */
export function extendMatrixClient(): void {
    MatrixClient.prototype.getEventReportManager = function (): EventReportManager {
        registerManagerClass("eventReport", EventReportManager);
        return getOrCreateManager(this, "eventReport", () => new EventReportManager(this));
    };
}
