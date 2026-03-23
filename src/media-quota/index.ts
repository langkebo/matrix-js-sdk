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

export interface MediaQuota {
    upload_size_limit: number;
    upload_file_size_limit: number;
}

export interface StorageUsage {
    quota: number;
    used: number;
    limit: number;
}

/**
 * 媒体配额管理器
 * 对应后端服务: media_quota_service
 */
export class MediaQuotaManager {
    constructor(private client: MatrixClient) {}

    /**
     * 获取服务器的媒体配额设置
     * 对应 API: GET /media/config
     */
    public async getMediaConfig(): Promise<MediaQuota> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getMediaConfig();
    }

    /**
     * 获取上传大小限制
     */
    public async getUploadSizeLimit(): Promise<number> {
        try {
            const config = await this.getMediaConfig();
            return config.upload_size_limit;
        } catch {
            return 10 * 1024 * 1024; // 默认10MB
        }
    }

    /**
     * 获取文件上传大小限制
     */
    public async getUploadFileSizeLimit(): Promise<number> {
        try {
            const config = await this.getMediaConfig();
            return config.upload_file_size_limit;
        } catch {
            return 10 * 1024 * 1024; // 默认10MB
        }
    }

    /**
     * 检查文件大小是否超过限制
     */
    public async isFileSizeAllowed(fileSize: number): Promise<boolean> {
        const limit = await this.getUploadFileSizeLimit();
        return fileSize <= limit;
    }

    /**
     * 获取用户存储使用情况
     * 对应 API: GET /user/{user_id}/storage
     */
    public async getUserStorageUsage(): Promise<StorageUsage | null> {
        const userId = this.client.getUserId();
        if (!userId) return null;
        
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (this.client as any).getUserStorageUsage(userId);
        } catch {
            return null;
        }
    }

    /**
     * 获取用户已用存储空间
     */
    public async getUsedStorage(): Promise<number> {
        const usage = await this.getUserStorageUsage();
        return usage?.used ?? 0;
    }

    /**
     * 获取用户存储配额
     */
    public async getStorageQuota(): Promise<number> {
        const usage = await this.getUserStorageUsage();
        return usage?.quota ?? 0;
    }

    /**
     * 获取存储使用百分比
     */
    public async getStorageUsagePercent(): Promise<number> {
        const usage = await this.getUserStorageUsage();
        if (!usage || !usage.quota) return 0;
        return (usage.used / usage.quota) * 100;
    }

    /**
     * 检查存储空间是否充足
     */
    public async hasStorageSpace(requiredBytes: number): Promise<boolean> {
        const usage = await this.getUserStorageUsage();
        if (!usage) return true; // 无法确定时允许
        
        return (usage.used + requiredBytes) <= usage.limit;
    }

    /**
     * 获取房间媒体大小
     * 估算房间中所有媒体文件的大小
     */
    public async getRoomMediaSize(roomId: string): Promise<number> {
        const room = this.client.getRoom(roomId);
        if (!room) return 0;
        
        let totalSize = 0;
        
        // 遍历房间中的事件，统计媒体大小
        const timeline = room.timeline;
        for (const event of timeline) {
            const type = event.getType();
            const content = event.getContent();
            
            if (type === "m.room.message") {
                if (content.msgtype === "m.image" || 
                    content.msgtype === "m.video" ||
                    content.msgtype === "m.audio" ||
                    content.msgtype === "m.file") {
                    // 估算大小（如果有info字段）
                    if (content.info?.size) {
                        totalSize += content.info.size;
                    }
                }
            }
        }
        
        return totalSize;
    }
}

// Declare prototype extension
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
