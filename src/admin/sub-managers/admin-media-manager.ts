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

import { Method } from "../../http-api/method";
import { ValidationError } from "../../errors";
import { AdminBaseManager, type AdminErrorCallback, type ManagerOpts } from "../admin-base-manager";
import { buildPaginationParams } from "../utils";
import type { MediaInfo, MediaQuotaResponse, MediaQuarantineChangesResponse } from "../types";
import { MatrixClient } from "../../client";

export class AdminMediaManager extends AdminBaseManager {
    constructor(client: MatrixClient, onError?: AdminErrorCallback, opts?: ManagerOpts) {
        super(client, onError, opts);
    }

    /**
     * 获取媒体列表
     *
     * @param fromOrLimit - 分页起点 (string) 或数量限制 (number)
     * @param limitOrFrom - 数量限制 (number) 或分页起点 (string)
     * @returns 媒体列表
     */
    async getMedia(
        fromOrLimit?: string | number,
        limitOrFrom?: number | string,
    ): Promise<{ media: MediaInfo[]; next_token?: string }> {
        let from: string | undefined;
        let limit: number | undefined;
        if (typeof fromOrLimit === "number") {
            limit = fromOrLimit;
            if (typeof limitOrFrom === "string") {
                from = limitOrFrom;
            }
        } else {
            from = fromOrLimit;
            if (typeof limitOrFrom === "number") {
                limit = limitOrFrom;
            }
        }
        const queryParams = buildPaginationParams(limit, from);
        const response = await this.adminRequest<{ media: MediaInfo[]; next_token?: string }>(Method.Get, "/media", queryParams);
        return { media: response.media || [], next_token: response.next_token };
    }

    /**
     * 获取媒体详情
     *
     * @param mediaId - 媒体 ID
     * @returns 媒体详情
     */
    async getMediaInfo(mediaId: string): Promise<MediaInfo> {
        if (!mediaId) {
            throw new ValidationError("Media ID is required");
        }
        return await this.adminRequest<MediaInfo>(Method.Get, `/media/${encodeURIComponent(mediaId)}`);
    }

    /**
     * 删除媒体
     *
     * @param mediaId - 媒体 ID
     */
    async deleteMedia(mediaId: string): Promise<void> {
        if (!mediaId) {
            throw new ValidationError("Media ID is required");
        }
        await this.adminRequest(Method.Delete, `/media/${encodeURIComponent(mediaId)}`);
    }

    /**
     * 获取媒体配额
     *
     * @returns 媒体配额信息
     */
    async getMediaQuota(): Promise<MediaQuotaResponse> {
        return await this.adminRequest(Method.Get, "/media/quota");
    }

    /**
     * 隔离媒体
     *
     * @param mediaId - 媒体 ID
     */
    async quarantineMedia(mediaId: string): Promise<void> {
        if (!mediaId) {
            throw new ValidationError("Media ID is required");
        }
        await this.adminRequest(Method.Post, `/media/${encodeURIComponent(mediaId)}/quarantine`);
    }

    /**
     * 取消隔离媒体
     *
     * @param mediaId - 媒体 ID
     */
    async unquarantineMedia(mediaId: string): Promise<void> {
        if (!mediaId) {
            throw new ValidationError("Media ID is required");
        }
        await this.adminRequest(Method.Post, `/media/${encodeURIComponent(mediaId)}/unquarantine`);
    }

    /**
     * 清除媒体缓存
     *
     * @param beforeTs - 清除此时间戳之前的媒体（必须为正整数）
     * @returns 删除的媒体数量
     */
    async purgeMediaCache(beforeTs?: number): Promise<{ deleted: number }> {
        if (beforeTs !== undefined) {
            if (!Number.isInteger(beforeTs) || beforeTs <= 0) {
                throw new ValidationError("beforeTs must be a positive integer");
            }
        }
        const body = beforeTs !== undefined ? { before_ts: beforeTs } : {};
        const result = await this.adminRequest<{ deleted?: number }>(Method.Post, "/purge_media_cache", {}, body);
        return { deleted: result.deleted ?? 0 };
    }

    /**
     * 获取媒体隔离变更历史
     *
     * 调用 `GET /_synapse/admin/v1/quarantine_media/{media_id}/changes` 端点，
     * 返回指定媒体的隔离（quarantine / unquarantine）变更记录列表。
     *
     * @param mediaId - 媒体 ID
     * @param options - 可选分页参数
     * @param options.from - 分页起点 token
     * @param options.limit - 返回条数上限
     * @returns 媒体隔离变更历史
     *
     * @example
     * ```typescript
     * const history = await adminManager.media.getMediaQuarantineChanges("abc123", {
     *     limit: 50,
     * });
     * console.log(history.changes);
     * ```
     *
     * @throws {ValidationError} 如果 mediaId 为空
     */
    async getMediaQuarantineChanges(
        mediaId: string,
        options?: { from?: string; limit?: number },
    ): Promise<MediaQuarantineChangesResponse> {
        if (!mediaId) {
            throw new ValidationError("Media ID is required");
        }
        const queryParams = buildPaginationParams(options?.limit, options?.from);
        const response = await this.adminRequest<MediaQuarantineChangesResponse>(
            Method.Get,
            `/quarantine_media/${encodeURIComponent(mediaId)}/changes`,
            queryParams,
        );
        return {
            media_id: response.media_id ?? mediaId,
            changes: response.changes ?? [],
            total: response.total,
            next_token: response.next_token,
        };
    }
}
