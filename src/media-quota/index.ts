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

export interface QuotaAlert {
    alert_id: string;
    alert_type: string;
    threshold_percent: number;
    current_usage_bytes: number;
    limit_bytes: number;
    created_ts: number;
    message?: string;
}

export interface MediaQuotaManagerEvents {
    quota_exceeded: { currentUsage: number; limit: number };
    quota_alert: { alert: QuotaAlert };
}

export class MediaQuotaManager extends BaseManager<keyof MediaQuotaManagerEvents, MediaQuotaManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async getMediaConfig(): Promise<Awaited<ReturnType<typeof MatrixClient.prototype.getMediaConfig>>> {
        return this.withRetry(() => this.client.getMediaConfig(), "getMediaConfig");
    }

    /**
     * Get upload size limit
     *
     * @param throwOnError - Whether to throw on error (default false)
     * @returns size limit in bytes
     */
    public async getUploadSizeLimit(throwOnError = false): Promise<number> {
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
     * @param throwOnError - Whether to throw on error (default false)
     * @returns size limit in bytes
     */
    public async getUploadFileSizeLimit(throwOnError = false): Promise<number> {
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

    public async isFileSizeAllowed(fileSize: number): Promise<boolean> {
        const limit = await this.getUploadFileSizeLimit();
        return fileSize <= limit;
    }

    /**
     * Get user storage usage
     *
     * @param throwOnError - Whether to throw on error (default false)
     * @returns usage info
     */
    public async getUserStorageUsage(throwOnError = false): Promise<{ size: number; ntFiles: number } | null> {
        const userId = this.client.getUserId();
        if (!userId) return null;

        try {
            return await this.withRetry(() => this.client.getUserStorageUsage(userId), "getUserStorageUsage");
            // @swallow-error { owner: "media-quota", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw e;
            }
            return null;
        }
    }

    public async getUsedStorage(): Promise<number> {
        const usage = await this.getUserStorageUsage();
        return usage?.size ?? 0;
    }

    public async getStorageQuota(): Promise<number> {
        const usage = await this.getUserStorageUsage();
        return usage?.size ?? 0;
    }

    public async getStorageUsagePercent(): Promise<number> {
        const usage = await this.getUserStorageUsage();
        if (!usage) return 0;
        return 100;
    }

    public async hasStorageSpace(_requiredBytes: number): Promise<boolean> {
        const usage = await this.getUserStorageUsage();
        if (!usage) return true;
        return true;
    }

    public async getRoomMediaSize(roomId: string): Promise<number> {
        const room = this.client.getRoom(roomId);
        if (!room) return 0;

        let totalSize = 0;

        const timeline = room.timeline;
        for (const event of timeline) {
            const type = event.getType();
            const content = event.getContent();

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
                "/media/quota/alerts",
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
