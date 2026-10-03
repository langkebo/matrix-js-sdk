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
 * Admin Notification Manager - 服务器通知管理
 *
 * 对应后端 `synapse-web/src/routes/admin/notification.rs`（需要 `server-notifications` feature）：
 * - GET    /_synapse/admin/v1/notifications       - 列出通知
 * - GET    /_synapse/admin/v1/notifications/{id}  - 获取通知详情
 * - POST   /_synapse/admin/v1/notifications       - 创建通知
 * - PUT    /_synapse/admin/v1/notifications/{id}  - 更新通知
 * - DELETE /_synapse/admin/v1/notifications/{id}  - 删除通知
 * - DELETE /_synapse/admin/v1/notifications/deactivate  - 禁用通知发送
 */

import { Method } from "../../http-api/method";
import { AdminBaseManager, type AdminErrorCallback, type ManagerOpts } from "../admin-base-manager";
import { MatrixClient } from "../../client";

/**
 * 服务器通知
 */
export interface ServerNotification {
    /** 通知 ID */
    id: number;
    /** 消息内容 */
    message: string;
    /** 是否重要 */
    important: boolean;
    /** 发送时间戳（毫秒） */
    sent_ts: number | null;
    /** 创建时间戳（毫秒） */
    created_ts: number;
    /** 是否已过期 */
    expired: boolean;
}

/**
 * 通知列表响应
 */
export interface NotificationsListResponse {
    /** 通知列表 */
    notifications: ServerNotification[];
    /** 下一个游标（用于分页） */
    next_token?: string;
    /** 总数 */
    total: number;
}

/**
 * 创建通知请求载荷
 */
export interface CreateNotificationRequest {
    /** 消息内容 */
    message: string;
    /** 是否重要 */
    important?: boolean;
}

/**
 * 更新通知请求载荷
 */
export interface UpdateNotificationRequest {
    /** 消息内容，可选 */
    message?: string;
    /** 是否重要，可选 */
    important?: boolean;
}

/**
 * 通知分页选项
 */
export interface NotificationPaginationOptions {
    /** 每页限制 */
    limit?: number;
    /** 游标（格式：sent_ts|id） */
    from?: string;
}

/**
 * Admin Notification Manager
 *
 * 提供服务器通知管理功能，包括列表、创建、更新、删除和禁用通知。
 */
export class AdminNotificationManager extends AdminBaseManager {
    constructor(client: MatrixClient, onError?: AdminErrorCallback, opts?: ManagerOpts) {
        super(client, onError, opts);
    }

    /**
     * 获取通知列表（支持分页）
     *
     * @example
     * ```typescript
     * const result = await adminManager.notifications.list({ limit: 10 });
     * console.log(result.notifications.length, 'notifications');
     * ```
     */
    async list(options?: NotificationPaginationOptions): Promise<NotificationsListResponse> {
        // 转换为查询参数 Record
        const params: Record<string, string> = {};
        if (options?.limit !== undefined) params.limit = String(options.limit);
        if (options?.from !== undefined) params.from = options.from;

        return await this.adminRequest<NotificationsListResponse>(
            Method.Get,
            "/notifications",
            Object.keys(params).length > 0 ? params : undefined,
            undefined,
            "notifications.list",
        );
    }

    /**
     * 获取单个通知
     *
     * @param notificationId - 通知 ID
     * @returns 通知详情
     *
     * @throws NotFoundError 如果通知不存在
     */
    async get(notificationId: number): Promise<ServerNotification> {
        return await this.adminRequest<{ notification: ServerNotification }>(
            Method.Get,
            `/notifications/${notificationId}`,
            undefined,
            undefined,
            "notifications.get",
        ).then((res) => res.notification);
    }

    /**
     * 创建新通知
     *
     * @param payload - 通知内容
     * @returns 创建的通知
     *
     * @example
     * ```typescript
     * const notif = await adminManager.notifications.create({
     *     message: "System maintenance at 2AM",
     *     important: true
     * });
     * ```
     */
    async create(payload: CreateNotificationRequest): Promise<ServerNotification> {
        return await this.adminRequest<{ notification: ServerNotification }>(
            Method.Post,
            "/notifications",
            undefined,
            payload,
            "notifications.create",
        ).then((res) => res.notification);
    }

    /**
     * 更新通知
     *
     * @param notificationId - 通知 ID
     * @param payload - 更新内容
     * @returns 更新后的通知
     *
     * @throws NotFoundError 如果通知不存在
     */
    async update(notificationId: number, payload: UpdateNotificationRequest): Promise<ServerNotification> {
        return await this.adminRequest<{ notification: ServerNotification }>(
            Method.Put,
            `/notifications/${notificationId}`,
            undefined,
            payload,
            "notifications.update",
        ).then((res) => res.notification);
    }

    /**
     * 删除通知
     *
     * @param notificationId - 通知 ID
     *
     * @throws NotFoundError 如果通知不存在
     */
    async delete(notificationId: number): Promise<void> {
        await this.adminRequest<void>(
            Method.Delete,
            `/notifications/${notificationId}`,
            undefined,
            undefined,
            "notifications.delete",
        );
    }

    /**
     * 禁用通知发送
     *
     * 停用所有通知的发送功能。
     */
    async deactivate(): Promise<void> {
        await this.adminRequest<void>(
            Method.Delete,
            "/notifications/deactivate",
            undefined,
            undefined,
            "notifications.deactivate",
        );
    }
}
