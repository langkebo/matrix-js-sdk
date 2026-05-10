/**
 * Event Report Manager - 事件举报管理
 *
 * 提供事件举报的创建、查询、处理（解决、忽略、升级）、删除及统计功能。
 * 对应后端: synapse-rust/src/web/routes/event_report.rs
 *
 * 遵循 D7 契约驱动开发标准，100% 覆盖后端端点并保持类型对齐。
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/method";
import { AdminPrefix } from "../http-api/prefix";
import { BaseManager } from "../managers/base-manager";

export interface CreateReportBody {
    event_id: string;
    room_id: string;
    reported_user_id?: string;
    event_json?: any;
    reason?: string;
    description?: string;
    score?: number;
}

export interface UpdateReportBody {
    status?: string;
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
    status: string;
    score: number;
    received_ts: number;
    resolved_ts?: number;
    resolved_by?: string;
    resolution_reason?: string;
}

export interface ReportHistoryResponse {
    id: number;
    report_id: number;
    action: string;
    actor_user_id?: string;
    old_status?: string;
    new_status?: string;
    reason?: string;
    created_ts: number;
}

export interface StatsResponse {
    id: number;
    date: string;
    total_reports: number;
    open_reports: number;
    resolved_reports: number;
    dismissed_reports: number;
    avg_resolution_time_hours?: number;
    avg_resolution_time_ms?: number;
    created_ts: number;
    updated_ts: number;
}

export interface QueryParams {
    limit?: number;
    offset?: number;
    [key: string]: any;
}

/**
 * EventReportManager 处理事件举报流程。
 * 对应后端 `event_report.rs` 中的所有 Admin REST 端点。
 */
export class EventReportManager extends BaseManager {
    constructor(client: MatrixClient) {
        super(client);
    }

    /**
     * 创建举报
     * 对应 POST /_synapse/admin/v1/event_reports
     */
    async createReport(body: CreateReportBody): Promise<ReportResponse> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<ReportResponse>(
                    Method.Post,
                    "/event_reports",
                    undefined,
                    body,
                    { prefix: AdminPrefix.V1 },
                );
            }, "createReport");
        } catch (error) {
            throw this.normalizeError(error, "createReport");
        }
    }

    /**
     * 获取所有举报
     * 对应 GET /_synapse/admin/v1/event_reports
     */
    async getAllReports(params?: QueryParams): Promise<ReportResponse[]> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<ReportResponse[]>(
                    Method.Get,
                    "/event_reports",
                    params,
                    undefined,
                    { prefix: AdminPrefix.V1 },
                );
            }, "getAllReports");
        } catch (error) {
            throw this.normalizeError(error, "getAllReports");
        }
    }

    /**
     * 获取举报详情
     * 对应 GET /_synapse/admin/v1/event_reports/{id}
     */
    async getReport(id: number): Promise<ReportResponse> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<ReportResponse>(
                    Method.Get,
                    `/event_reports/${id}`,
                    undefined,
                    undefined,
                    { prefix: AdminPrefix.V1 },
                );
            }, "getReport");
        } catch (error) {
            throw this.normalizeError(error, "getReport");
        }
    }

    /**
     * 更新举报状态或分值
     * 对应 PUT /_synapse/admin/v1/event_reports/{id}
     */
    async updateReport(id: number, body: UpdateReportBody): Promise<ReportResponse> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<ReportResponse>(
                    Method.Put,
                    `/event_reports/${id}`,
                    undefined,
                    body,
                    { prefix: AdminPrefix.V1 },
                );
            }, "updateReport");
        } catch (error) {
            throw this.normalizeError(error, "updateReport");
        }
    }

    /**
     * 解决举报
     * 对应 POST /_synapse/admin/v1/event_reports/{id}/resolve
     */
    async resolveReport(id: number, reason: string): Promise<ReportResponse> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<ReportResponse>(
                    Method.Post,
                    `/event_reports/${id}/resolve`,
                    undefined,
                    { reason },
                    { prefix: AdminPrefix.V1 },
                );
            }, "resolveReport");
        } catch (error) {
            throw this.normalizeError(error, "resolveReport");
        }
    }

    /**
     * 忽略/驳回举报
     * 对应 POST /_synapse/admin/v1/event_reports/{id}/dismiss
     */
    async dismissReport(id: number, reason: string): Promise<ReportResponse> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<ReportResponse>(
                    Method.Post,
                    `/event_reports/${id}/dismiss`,
                    undefined,
                    { reason },
                    { prefix: AdminPrefix.V1 },
                );
            }, "dismissReport");
        } catch (error) {
            throw this.normalizeError(error, "dismissReport");
        }
    }

    /**
     * 升级举报（转交给更高级别管理员）
     * 对应 POST /_synapse/admin/v1/event_reports/{id}/escalate
     */
    async escalateReport(id: number): Promise<ReportResponse> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<ReportResponse>(
                    Method.Post,
                    `/event_reports/${id}/escalate`,
                    undefined,
                    undefined,
                    { prefix: AdminPrefix.V1 },
                );
            }, "escalateReport");
        } catch (error) {
            throw this.normalizeError(error, "escalateReport");
        }
    }

    /**
     * 删除举报
     * 对应 DELETE /_synapse/admin/v1/event_reports/{id}
     */
    async deleteReport(id: number): Promise<void> {
        try {
            await this.withRetry(async () => {
                await this.client.http.authedRequest<void>(
                    Method.Delete,
                    `/event_reports/${id}`,
                    undefined,
                    undefined,
                    { prefix: AdminPrefix.V1 },
                );
            }, "deleteReport");
        } catch (error) {
            throw this.normalizeError(error, "deleteReport");
        }
    }

    /**
     * 获取举报历史
     * 对应 GET /_synapse/admin/v1/event_reports/{id}/history
     */
    async getReportHistory(id: number): Promise<ReportHistoryResponse[]> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<ReportHistoryResponse[]>(
                    Method.Get,
                    `/event_reports/${id}/history`,
                    undefined,
                    undefined,
                    { prefix: AdminPrefix.V1 },
                );
            }, "getReportHistory");
        } catch (error) {
            throw this.normalizeError(error, "getReportHistory");
        }
    }

    /**
     * 获取举报统计
     * 对应 GET /_synapse/admin/v1/event_reports/stats
     */
    async getStats(params?: QueryParams): Promise<StatsResponse[]> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<StatsResponse[]>(
                    Method.Get,
                    "/event_reports/stats",
                    params,
                    undefined,
                    { prefix: AdminPrefix.V1 },
                );
            }, "getStats");
        } catch (error) {
            throw this.normalizeError(error, "getStats");
        }
    }

    /**
     * 封禁用户举报功能
     * 对应 POST /_synapse/admin/v1/event_reports/rate_limit/{user_id}/block
     */
    async blockUser(userId: string, blockedUntil: number, reason: string): Promise<void> {
        try {
            await this.withRetry(async () => {
                await this.client.http.authedRequest<void>(
                    Method.Post,
                    `/event_reports/rate_limit/${encodeURIComponent(userId)}/block`,
                    undefined,
                    { blocked_until: blockedUntil, reason },
                    { prefix: AdminPrefix.V1 },
                );
            }, "blockUser");
        } catch (error) {
            throw this.normalizeError(error, "blockUser");
        }
    }

    /**
     * 解封用户举报功能
     * 对应 POST /_synapse/admin/v1/event_reports/rate_limit/{user_id}/unblock
     */
    async unblockUser(userId: string): Promise<void> {
        try {
            await this.withRetry(async () => {
                await this.client.http.authedRequest<void>(
                    Method.Post,
                    `/event_reports/rate_limit/${encodeURIComponent(userId)}/unblock`,
                    undefined,
                    undefined,
                    { prefix: AdminPrefix.V1 },
                );
            }, "unblockUser");
        } catch (error) {
            throw this.normalizeError(error, "unblockUser");
        }
    }

    /**
     * 检查用户举报频率限制状态
     * 对应 GET /_synapse/admin/v1/event_reports/rate_limit/{user_id}
     */
    async checkRateLimit(
        userId: string,
    ): Promise<{ is_allowed: boolean; remaining_reports: number; block_reason?: string }> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<any>(
                    Method.Get,
                    `/event_reports/rate_limit/${encodeURIComponent(userId)}`,
                    undefined,
                    undefined,
                    { prefix: AdminPrefix.V1 },
                );
            }, "checkRateLimit");
        } catch (error) {
            throw this.normalizeError(error, "checkRateLimit");
        }
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getEventReportManager(): EventReportManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getEventReportManager = function (): EventReportManager {
        return new EventReportManager(this);
    };
}

export default extendMatrixClient;
