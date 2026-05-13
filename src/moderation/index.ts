/**
 * Moderation Manager - 审核管理
 *
 * 提供房间与事件的举报、分值更新及扫描器信息查询功能。
 * 对应后端: synapse-rust/src/web/routes/moderation.rs
 *
 * 遵循 D7 契约驱动开发标准，100% 覆盖后端端点并保持类型对齐。
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface ReportEventBody {
    reason?: string;
    score?: number;
}

export interface UpdateScoreBody {
    score: number;
}

export interface ScannerInfo {
    enabled: boolean;
    version: string;
    supported_algorithms: string[];
}

/**
 * ModerationManager 处理内容审核与举报流程。
 * 对应后端 `moderation.rs` 中的所有 REST 端点。
 */
export class ModerationManager extends BaseManager {
    constructor(client: MatrixClient) {
        super(client);
    }

    /**
     * 举报事件
     * 对应 POST /_matrix/client/v3/rooms/{room_id}/report/{event_id}
     */
    async reportEvent(roomId: string, eventId: string, body: ReportEventBody): Promise<void> {
        const path = `/rooms/${encodeURIComponent(roomId)}/report/${encodeURIComponent(eventId)}`;
        try {
            await this.withRetry(async () => {
                await this.client.http.authedRequest<void>(Method.Post, path, undefined, body, {
                    prefix: ClientPrefix.V3,
                });
            }, "reportEvent");
        } catch (error) {
            throw this.normalizeError(error, "reportEvent");
        }
    }

    /**
     * 举报房间
     * 对应 POST /_matrix/client/v3/rooms/{room_id}/report
     */
    async reportRoom(roomId: string, body: ReportEventBody): Promise<void> {
        const path = `/rooms/${encodeURIComponent(roomId)}/report`;
        try {
            await this.withRetry(async () => {
                await this.client.http.authedRequest<void>(Method.Post, path, undefined, body, {
                    prefix: ClientPrefix.V3,
                });
            }, "reportRoom");
        } catch (error) {
            throw this.normalizeError(error, "reportRoom");
        }
    }

    /**
     * 更新举报分值
     * 对应 PUT /_matrix/client/v3/rooms/{room_id}/report/{event_id}/score
     */
    async updateReportScore(roomId: string, eventId: string, score: number): Promise<void> {
        const path = `/rooms/${encodeURIComponent(roomId)}/report/${encodeURIComponent(eventId)}/score`;
        try {
            await this.withRetry(async () => {
                await this.client.http.authedRequest<void>(
                    Method.Put,
                    path,
                    undefined,
                    { score },
                    { prefix: ClientPrefix.V3 },
                );
            }, "updateReportScore");
        } catch (error) {
            throw this.normalizeError(error, "updateReportScore");
        }
    }

    /**
     * 获取扫描器信息
     * 对应 GET /_matrix/client/v1/rooms/{room_id}/report/{event_id}/scanner_info
     */
    async getScannerInfo(roomId: string, eventId: string): Promise<ScannerInfo> {
        const path = `/rooms/${encodeURIComponent(roomId)}/report/${encodeURIComponent(eventId)}/scanner_info`;
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<ScannerInfo>(Method.Get, path, undefined, undefined, {
                    prefix: ClientPrefix.V1,
                });
            }, "getScannerInfo");
        } catch (error) {
            throw this.normalizeError(error, "getScannerInfo");
        }
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getModerationManager(): ModerationManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getModerationManager = function (): ModerationManager {
        return getOrCreateManager(this, "moderation", () => new ModerationManager(this));
    };
}

export default extendMatrixClient;
