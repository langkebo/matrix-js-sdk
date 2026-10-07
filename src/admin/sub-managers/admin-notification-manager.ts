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
 *
 * 字段取自后端 `synapse-storage/src/server_notification/models.rs::ServerNotification`（16 个字段）。
 *
 * ⚠️ 原先声明的 `message` / `important` / `sent_ts` / `expired` **四个键后端都不存在**，
 * 而真实的 12 个字段（`title`/`content`/`notification_type`/`priority`/…/`updated_ts`）全部缺失 ——
 * 属"完全不相干"级的不符，不是字段名笔误。
 */
export interface ServerNotification {
    id: number;
    title: string;
    content: string;
    notification_type: string;
    priority: number;
    target_audience: string;
    /** 目标用户 id 列表（后端列类型是 JSON，可能为 `null`） */
    target_user_ids: string[] | null;
    starts_at: number | null;
    expires_at: number | null;
    is_enabled: boolean;
    is_dismissable: boolean;
    action_url: string | null;
    action_text: string | null;
    created_by: string | null;
    created_ts: number;
    updated_ts: number;
}

/**
 * 通知列表响应 —— `GET /_synapse/admin/v1/notifications`
 *
 * ⚠️ 后端只返回 `{notifications, next_batch}`：**没有 `total`**，游标键是 `next_batch`
 * （不是 `next_token`，后者会恒为 `undefined` ⇒ 翻页在第一页就退出）。
 */
export interface NotificationsListResponse {
    notifications: ServerNotification[];
    next_batch: string | null;
}

/**
 * 创建通知请求载荷 —— `POST /_synapse/admin/v1/notifications`
 *
 * 后端 `CreateNotificationRequest` 里 `title` 与 `content` 是**必填**，
 * 其余可选。
 *
 * ⚠️ 原声明的 `{message, important}` 两个键后端都不认识（`title`/`content` 又缺失）
 * ⇒ 该请求**必然 400（missing field）**。
 */
export interface CreateNotificationRequest {
    title: string;
    content: string;
    notification_type?: string;
    priority?: number;
    target_audience?: string;
    target_user_ids?: string[];
    starts_at?: number;
    expires_at?: number;
    is_dismissable?: boolean;
    action_url?: string;
    action_text?: string;
}

/**
 * 更新通知请求载荷 —— `PUT /_synapse/admin/v1/notifications/{id}`
 *
 * 与创建同字段集，但**全部可选**；后端带 `deny_unknown_fields`，
 * 故 `message` / `important` 这类未知字段会直接 400。
 */
export type UpdateNotificationRequest = Partial<CreateNotificationRequest>;

/**
 * 通知分页选项
 *
 * `from` 是后端 `decode_server_notification_cursor` 解析的游标；
 * `audience` 可筛选目标受众。
 */
export interface NotificationPaginationOptions {
    /** 每页限制（后端上限 100，默认 50） */
    limit?: number;
    /** 游标 */
    from?: string;
    /** 目标受众筛选 */
    audience?: string;
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
     * 后端返回 `{notifications, next_batch}`。
     *
     * @example
     * ```typescript
     * const result = await adminManager.notifications.list({ limit: 10 });
     * console.log(result.notifications.length, result.next_batch);
     * ```
     */
    async list(options?: NotificationPaginationOptions): Promise<NotificationsListResponse> {
        // 转换为查询参数 Record
        const params: Record<string, string> = {};
        if (options?.limit !== undefined) params.limit = String(options.limit);
        if (options?.from !== undefined) params.from = options.from;
        if (options?.audience !== undefined) params.audience = options.audience;

        const response = await this.adminRequest<{
            notifications?: ServerNotification[];
            next_batch?: string | null;
        }>(
            Method.Get,
            "/notifications",
            Object.keys(params).length > 0 ? params : undefined,
            undefined,
            "notifications.list",
        );
        return { notifications: response.notifications ?? [], next_batch: response.next_batch ?? null };
    }

    /**
     * 获取单个通知
     *
     * ⚠️ 后端 `get_notification` 返回的是**通知对象本身**（`Json(json!(notification))`），
     * 不是 `{notification: {...}}` 包装。原实现读 `res.notification` ⇒ 恒为 `undefined`。
     *
     * @param notificationId - 通知 ID
     * @returns 通知详情
     *
     * @throws NotFoundError 如果通知不存在
     */
    async get(notificationId: number): Promise<ServerNotification> {
        return await this.adminRequest<ServerNotification>(
            Method.Get,
            `/notifications/${notificationId}`,
            undefined,
            undefined,
            "notifications.get",
        );
    }

    /**
     * 创建新通知
     *
     * 请求体必须是后端 `CreateNotificationRequest` 的形状（`title` / `content` 必填）；
     * 响应是创建出的通知对象本身（不是包装）。
     *
     * @param payload - 通知内容
     * @returns 创建的通知
     *
     * @example
     * ```typescript
     * const notif = await adminManager.notifications.create({
     *     title: "维护通知",
     *     content: "系统将于 02:00 维护",
     *     notification_type: "maintenance",
     *     is_dismissable: true,
     * });
     * console.log(notif.id);
     * ```
     */
    async create(payload: CreateNotificationRequest): Promise<ServerNotification> {
        return await this.adminRequest<ServerNotification>(
            Method.Post,
            "/notifications",
            undefined,
            payload,
            "notifications.create",
        );
    }

    /**
     * 更新通知
     *
     * 响应是更新后的通知对象本身（不是包装）。
     *
     * @param notificationId - 通知 ID
     * @param payload - 更新内容（与创建同字段集，全部可选）
     * @returns 更新后的通知
     *
     * @throws NotFoundError 如果通知不存在
     */
    async update(notificationId: number, payload: UpdateNotificationRequest): Promise<ServerNotification> {
        return await this.adminRequest<ServerNotification>(
            Method.Put,
            `/notifications/${notificationId}`,
            undefined,
            payload,
            "notifications.update",
        );
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
     * 禁用某条通知的发送
     *
     * ⚠️ 后端注册的是 **`PUT /_synapse/admin/v1/notifications/{notification_id}/deactivate`**
     * （返回 `{is_enabled: false}`）；本方法打的 `DELETE /notifications/deactivate`
     * **在后端没有注册**，调用必失败。该差异已登记在
     * `scripts/quality/path-contract-waivers.json`（`semantic-mismatch`），
     * 保留原行为以免破坏既有调用方的编译；**新代码请用 `PUT /notifications/{id}/deactivate`**。
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
