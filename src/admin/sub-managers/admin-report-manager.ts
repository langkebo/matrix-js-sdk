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
 * Admin Report Manager - 举报管理
 *
 * 对应后端 `synapse-web/src/routes/admin/report.rs`：
 * - GET    /_synapse/admin/v1/reports                         - 列出所有举报
 * - GET    /_synapse/admin/v1/reports/{report_id}             - 获取举报详情
 * - DELETE /_synapse/admin/v1/reports/{report_id}             - 删除举报
 * - GET    /_synapse/admin/v1/rooms/{room_id}/reports         - 获取房间举报列表
 * - GET    /_synapse/admin/v1/rooms/{room_id}/reports/{id}    - 获取房间举报详情
 * - DELETE /_synapse/admin/v1/rooms/{room_id}/reports/{id}    - 删除房间举报
 */

import { Method } from "../../http-api/method";
import { AdminBaseManager, type AdminErrorCallback, type ManagerOpts } from "../admin-base-manager";
import { MatrixClient } from "../../client";

/**
 * 事件举报
 */
export interface EventReport {
    /** 举报 ID */
    id: number;
    /** 房间 ID */
    room_id: string;
    /** 事件 ID */
    event_id: string;
    /** 举报者用户 ID */
    user_id: string;
    /** 被举报用户 ID */
    reported_user_id: string | null;
    /** 举报原因 */
    reason: string | null;
    /** 事件内容描述 */
    content: string | null;
    /** 举报状态 */
    status: string;
    /** 评分（-100 ~ 100） */
    score: number | null;
    /** 接收时间戳（毫秒） */
    received_ts: number;
}

/**
 * 举报列表响应
 */
export interface ReportsListResponse {
    /** 举报列表 */
    reports: EventReport[];
    /** 总数 */
    total: number;
}

/**
 * 举报分页选项
 */
export interface ReportPaginationOptions {
    /** 每页限制 */
    limit?: number;
    /** 自从分数（用于游标分页） */
    since_score?: number;
    /** 自从时间戳 */
    since_ts?: number;
    /** 自从 ID */
    since_id?: number;
}

/**
 * Admin Report Manager
 *
 * 提供事件举报管理功能，包括列表、详情和删除。
 */
export class AdminReportManager extends AdminBaseManager {
    constructor(client: MatrixClient, onError?: AdminErrorCallback, opts?: ManagerOpts) {
        super(client, onError, opts);
    }

    /**
     * 获取所有举报列表
     *
     * @param options - 分页选项
     * @returns 举报列表
     *
     * @example
     * ```typescript
     * const result = await adminManager.reports.listAll({ limit: 50 });
     * console.log(result.reports.length, 'reports');
     * ```
     */
    async listAll(options?: ReportPaginationOptions): Promise<ReportsListResponse> {
        // 转换为查询参数 Record
        const params: Record<string, string> = {};
        if (options?.limit !== undefined) params.limit = String(options.limit);
        if (options?.since_score !== undefined) params.since_score = String(options.since_score);
        if (options?.since_ts !== undefined) params.since_ts = String(options.since_ts);
        if (options?.since_id !== undefined) params.since_id = String(options.since_id);

        return await this.adminRequest<ReportsListResponse>(
            Method.Get,
            "/reports",
            Object.keys(params).length > 0 ? params : undefined,
            undefined,
            "reports.listAll",
        );
    }

    /**
     * 获取单个举报详情
     *
     * @param reportId - 举报 ID
     * @returns 举报详情
     *
     * @throws NotFoundError 如果举报不存在
     */
    async get(reportId: number): Promise<EventReport> {
        return await this.adminRequest<EventReport>(
            Method.Get,
            `/reports/${reportId}`,
            undefined,
            undefined,
            "reports.get",
        );
    }

    /**
     * 删除举报
     *
     * @param reportId - 举报 ID
     *
     * @throws NotFoundError 如果举报不存在
     */
    async delete(reportId: number): Promise<void> {
        await this.adminRequest<void>(Method.Delete, `/reports/${reportId}`, undefined, undefined, "reports.delete");
    }

    /**
     * 获取房间的举报列表
     *
     * @param roomId - 房间 ID
     * @param options - 分页选项
     * @returns 举报列表
     *
     * @throws NotFoundError 如果房间不存在
     */
    async getByRoom(roomId: string, options?: ReportPaginationOptions): Promise<ReportsListResponse> {
        // 转换为查询参数 Record
        const params: Record<string, string> = {};
        if (options?.limit !== undefined) params.limit = String(options.limit);
        if (options?.since_score !== undefined) params.since_score = String(options.since_score);
        if (options?.since_ts !== undefined) params.since_ts = String(options.since_ts);
        if (options?.since_id !== undefined) params.since_id = String(options.since_id);

        return await this.adminRequest<ReportsListResponse>(
            Method.Get,
            `/rooms/${encodeURIComponent(roomId)}/reports`,
            Object.keys(params).length > 0 ? params : undefined,
            undefined,
            "reports.getByRoom",
        );
    }

    /**
     * 获取房间内的单个举报详情
     *
     * @param roomId - 房间 ID
     * @param reportId - 举报 ID
     * @returns 举报详情
     *
     * @throws NotFoundError 如果举报或房间不存在
     */
    async getRoomReport(roomId: string, reportId: number): Promise<EventReport> {
        return await this.adminRequest<EventReport>(
            Method.Get,
            `/rooms/${encodeURIComponent(roomId)}/reports/${reportId}`,
            undefined,
            undefined,
            "reports.getRoomReport",
        );
    }

    /**
     * 删除房间的举报
     *
     * @param roomId - 房间 ID
     * @param reportId - 举报 ID
     *
     * @throws NotFoundError 如果举报或房间不存在
     */
    async deleteRoomReport(roomId: string, reportId: number): Promise<void> {
        await this.adminRequest<void>(
            Method.Delete,
            `/rooms/${encodeURIComponent(roomId)}/reports/${reportId}`,
            undefined,
            undefined,
            "reports.deleteRoomReport",
        );
    }
}
