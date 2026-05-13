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
 * Media Quota Manager - 媒体配额管理
 *
 * 提供媒体存储配额相关功能
 * 对应后端: media_quota_service
 */

import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";
import { Method } from "../http-api/method.ts";
import { MediaPrefix } from "../http-api/prefix.ts";
import { AdminValidators } from "../admin/validators";
import { ValidationError } from "../errors";
import { logger } from "../logger";

export interface MediaQuotaConfig {
    "m.upload.size"?: number;
}

export interface MediaQuota {
    upload_size_limit: number;
    upload_file_size_limit: number;
}

export interface StorageUsage {
    quota: number;
    used: number;
    limit: number;
}

export interface QuotaCheckResponse {
    limit: number;
    used: number;
    remaining: number;
    rule?: string;
}

export interface QuotaStatsResponse {
    user_id: string;
    storage_bytes: number;
    media_count: number;
    limit_bytes: number;
    statistics?: Record<string, unknown>;
}

export interface QuotaAlert {
    alert_id: string;
    alert_type: string;
    threshold_percent: number;
    current_usage_bytes: number;
    quota_limit_bytes?: number;
    created_ts: number;
    message?: string;
    is_read?: boolean;
}

export interface MediaQuotaManagerEvents {
    quota_exceeded: { currentUsage: number; limit: number };
    quota_alert: { alert: QuotaAlert };
}

export class MediaQuotaManager extends BaseManager<keyof MediaQuotaManagerEvents, MediaQuotaManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async getMediaConfig(
        useAuthenticatedMedia = false,
    ): Promise<Awaited<ReturnType<typeof MatrixClient.prototype.getMediaConfig>>> {
        return this.withRetry(() => this.client.getMediaConfig(useAuthenticatedMedia), "getMediaConfig");
    }

    public async checkQuota(): Promise<QuotaCheckResponse> {
        return this.withRetry(
            () =>
                this.client.http.authedRequest<QuotaCheckResponse>(Method.Get, "/quota/check", undefined, undefined, {
                    prefix: MediaPrefix.V1,
                }),
            "checkQuota",
        );
    }

    public async getQuotaStats(): Promise<QuotaStatsResponse> {
        return this.withRetry(
            () =>
                this.client.http.authedRequest<QuotaStatsResponse>(Method.Get, "/quota/stats", undefined, undefined, {
                    prefix: MediaPrefix.V1,
                }),
            "getQuotaStats",
        );
    }

    /**
     * Get upload size limit
     *
     * @param throwOnError - Whether to throw on error (default true, pass false to use fallback)
     * @returns size limit in bytes
     */
    public async getUploadSizeLimit(throwOnError = true): Promise<number> {
        try {
            const config = await this.getMediaConfig();
            return (config["m.upload.size"] as number | undefined) ?? 10 * 1024 * 1024;
            // @swallow-error { owner: "media-quota", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            return 10 * 1024 * 1024;
        }
    }

    /**
     * Get upload file size limit
     *
     * @param throwOnError - Whether to throw on error (default true, pass false to use fallback)
     * @returns size limit in bytes
     */
    public async getUploadFileSizeLimit(throwOnError = true): Promise<number> {
        try {
            const config = await this.getMediaConfig();
            return (config["m.upload.size"] as number | undefined) ?? 10 * 1024 * 1024;
            // @swallow-error { owner: "media-quota", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            return 10 * 1024 * 1024;
        }
    }

    /**
     * 检查文件大小是否允许上传
     *
     * @param fileSize - 文件大小（字节）
     * @returns 是否允许上传
     *
     * @example
     * ```typescript
     * // 检查文件是否可以上传
     * const file = document.querySelector('input[type="file"]').files[0];
     * const allowed = await mediaQuotaManager.isFileSizeAllowed(file.size);
     * if (allowed) {
     *     await mediaManager.uploadContent(file);
     * } else {
     *     console.error("File too large");
     * }
     * ```
     *
     * @throws {ValidationError} 如果文件大小为负数
     */
    public async isFileSizeAllowed(fileSize: number): Promise<boolean> {
        if (fileSize < 0) {
            throw new ValidationError("File size must be non-negative");
        }
        const limit = await this.getUploadFileSizeLimit(false);
        return fileSize <= limit;
    }

    /**
     * 获取用户存储使用情况
     *
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 使用情况信息
     *
     * @example
     * ```typescript
     * // 获取存储使用情况
     * const usage = await mediaQuotaManager.getUserStorageUsage();
     * if (usage) {
     *     console.log(`Used: ${usage.size} bytes`);
     *     console.log(`Files: ${usage.ntFiles}`);
     * }
     *
     * // 不抛出错误
     * const usage = await mediaQuotaManager.getUserStorageUsage(false);
     * if (!usage) {
     *     console.log("Failed to get usage info");
     * }
     * ```
     *
     * @throws {AuthError} 如果用户未登录
     * @throws {ApiError} 如果 API 调用失败且 throwOnError 为 true
     */
    public async getUserStorageUsage(throwOnError = true): Promise<{ size: number; ntFiles: number } | null> {
        const userId = this.client.getUserId();
        if (!userId) return null;

        try {
            const stats = await this.getQuotaStats();
            return {
                size: stats.storage_bytes ?? 0,
                ntFiles: stats.media_count ?? 0,
            };
            // @swallow-error { owner: "media-quota", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            return null;
        }
    }

    public async getUsedStorage(): Promise<number> {
        const usage = await this.getUserStorageUsage(false);
        return usage?.size ?? 0;
    }

    public async getStorageQuota(): Promise<number> {
        try {
            const stats = await this.getQuotaStats();
            return stats.limit_bytes ?? 0;
        } catch (e) {
            logger.debug("MediaQuotaManager.getStorageQuota failed, returning 0", e);
            return 0;
        }
    }

    public async getStorageUsagePercent(): Promise<number> {
        try {
            const quota = await this.checkQuota();
            if (!quota.limit) return 0;
            return (quota.used / quota.limit) * 100;
        } catch (e) {
            logger.debug("MediaQuotaManager.getStorageUsagePercent failed, returning 0", e);
            return 0;
        }
    }

    /**
     * 检查是否有足够的存储空间
     *
     * @param requiredBytes - 需要的字节数
     * @returns 是否有足够空间
     *
     * @example
     * ```typescript
     * // 上传前检查空间
     * const file = document.querySelector('input[type="file"]').files[0];
     * const hasSpace = await mediaQuotaManager.hasStorageSpace(file.size);
     * if (hasSpace) {
     *     await mediaManager.uploadContent(file);
     * } else {
     *     alert("Storage quota exceeded");
     * }
     *
     * // 检查是否有 10MB 空间
     * const hasSpace = await mediaQuotaManager.hasStorageSpace(10 * 1024 * 1024);
     * ```
     *
     * @throws {ValidationError} 如果需要的字节数为负数
     */
    public async hasStorageSpace(requiredBytes: number): Promise<boolean> {
        if (requiredBytes < 0) {
            throw new ValidationError("Required bytes must be non-negative");
        }
        try {
            const quota = await this.checkQuota();
            return quota.remaining >= requiredBytes;
        } catch (e) {
            logger.debug("MediaQuotaManager.hasStorageSpace failed, assuming space available", e);
            return true;
        }
    }

    /**
     * 获取房间媒体文件总大小
     *
     * @param roomId - 房间 ID（格式：!localpart:homeserver）
     * @returns 媒体文件总大小（字节）
     *
     * @example
     * ```typescript
     * // 获取房间媒体大小
     * const size = await mediaQuotaManager.getRoomMediaSize("!abc:example.com");
     * console.log(`Room media size: ${(size / 1024 / 1024).toFixed(2)} MB`);
     *
     * // 检查房间媒体占用
     * const rooms = client.getRooms();
     * for (const room of rooms) {
     *     const size = await mediaQuotaManager.getRoomMediaSize(room.roomId);
     *     if (size > 100 * 1024 * 1024) {
     *         console.log(`${room.name} uses ${size} bytes`);
     *     }
     * }
     * ```
     *
     * @throws {ValidationError} 如果房间 ID 格式无效
     */
    public async getRoomMediaSize(roomId: string): Promise<number> {
        AdminValidators.validateRoomId(roomId);
        const room = this.client.getRoom(roomId);
        if (!room) return 0;

        let totalSize = 0;

        const timeline = room.timeline;
        for (const event of timeline) {
            const type = event.getType();
            const content = event.getContent<{ msgtype?: string; info?: { size?: number } }>();

            if (type === "m.room.message") {
                if (
                    content.msgtype === "m.image" ||
                    content.msgtype === "m.video" ||
                    content.msgtype === "m.audio" ||
                    content.msgtype === "m.file"
                ) {
                    if (content.info?.size) {
                        totalSize += content.info.size;
                    }
                }
            }
        }

        return totalSize;
    }

    public async getQuotaAlerts(): Promise<QuotaAlert[]> {
        return this.withRetry(async () => {
            const response = await this.client.http.authedRequest<{ alerts: QuotaAlert[] }>(
                Method.Get,
                "/quota/alerts",
                undefined,
                undefined,
                { prefix: MediaPrefix.V1 },
            );
            return response.alerts || [];
        }, "getQuotaAlerts");
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getMediaQuotaManager(): MediaQuotaManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getMediaQuotaManager = function (): MediaQuotaManager {
        return new MediaQuotaManager(this);
    };
}

export default extendMatrixClient;
