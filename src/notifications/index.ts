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

import { MatrixClient } from "../client";
import { EventTimelineSet } from "../models/event-timeline-set";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { type LocalNotificationSettings } from "../@types/local_notifications";
import { BaseManager } from "../managers/base-manager";
import { AdminValidators } from "../admin/validators";

export interface ILocalNotificationSettings {
    is_silenced: boolean;
    [key: string]: unknown;
}

export interface INotificationsResponse {
    next_token?: string;
    notifications: Array<{
        actions: unknown[];
        event: {
            content: Record<string, unknown>;
            event_id: string;
            origin_server_ts: number;
            room_id: string;
            sender: string;
            type: string;
        };
        profile_tag?: string;
        read: boolean;
        room_id: string;
        ts: number;
    }>;
}

export interface NotificationsManagerEvents {
    notifications_updated: { count: number };
    notification_cleared: { roomId: string };
}

export class NotificationsManager extends BaseManager<keyof NotificationsManagerEvents, NotificationsManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public getNotifTimelineSet(): EventTimelineSet | null {
        return this.client.getNotifTimelineSet();
    }

    public setNotifTimelineSet(set: EventTimelineSet): void {
        this.client.setNotifTimelineSet(set);
    }

    public resetNotifTimelineSet(): void {
        this.client.resetNotifTimelineSet();
    }

    public async setLocalNotificationSettings(deviceId: string, settings: LocalNotificationSettings): Promise<void> {
        await this.client.setLocalNotificationSettings(deviceId, settings);
    }

    /**
     * 获取通知列表
     *
     * @param opts - 查询选项
     * @param opts.from - 分页起始位置（可选）
     * @param opts.limit - 返回数量限制（可选，默认由服务器决定）
     * @param opts.only - 过滤条件（可选，如 "highlight"）
     * @returns 通知列表和分页信息
     *
     * @example
     * ```typescript
     * // 获取通知列表
     * const result = await notificationsManager.getNotifications();
     * result.notifications.forEach(notif => {
     *     console.log(`Room: ${notif.room_id}`);
     *     console.log(`Event: ${notif.event.type}`);
     *     console.log(`Read: ${notif.read}`);
     * });
     *
     * // 分页获取
     * const result = await notificationsManager.getNotifications({ limit: 20 });
     * if (result.next_token) {
     *     const nextPage = await notificationsManager.getNotifications({
     *         from: result.next_token,
     *         limit: 20
     *     });
     * }
     *
     * // 只获取高亮通知
     * const highlights = await notificationsManager.getNotifications({
     *     only: "highlight"
     * });
     * ```
     *
     * @throws {ValidationError} 如果 limit 参数超出范围
     * @throws {ApiError} 如果 API 调用失败
     */
    public async getNotifications(opts?: {
        from?: string;
        limit?: number;
        only?: string;
    }): Promise<INotificationsResponse> {
        if (opts?.limit !== undefined) {
            AdminValidators.validateLimit(opts.limit);
        }

        return this.withRetry(
            () =>
                this.client.http.authedRequest<INotificationsResponse>(Method.Get, "/notifications", opts, undefined, {
                    prefix: ClientPrefix.V3,
                }),
            "getNotifications",
        );
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getNotificationsManager(): NotificationsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getNotificationsManager = function (): NotificationsManager {
        return new NotificationsManager(this);
    };
}

export default extendMatrixClient;
