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
import { LOCAL_NOTIFICATION_SETTINGS_PREFIX } from "../@types/event";
import { type EmptyObject } from "../@types/common";
import { BaseManager } from "../managers/base-manager";
import { AdminValidators } from "../admin/validators";
import type { PushPathPattern } from "../push/__generated__/route-table";
import { getOrCreateManager } from "../client-infra/manager-registry";
import { ValidationError } from "../errors";

type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function np<P extends StripV3<PushPathPattern>>(path: P): P {
    return path;
}

export interface ILocalNotificationSettings {
    is_silenced: boolean;
}

export interface INotificationsResponse {
    next_token?: string;
    notifications: Array<{
        actions: unknown[];
        event: Record<string, unknown>;
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
    private notifTimelineSet: EventTimelineSet | null = null;

    constructor(client: MatrixClient) {
        super(client);
    }

    public getNotifTimelineSet(): EventTimelineSet | null {
        return this.notifTimelineSet;
    }

    public setNotifTimelineSet(set: EventTimelineSet): void {
        this.notifTimelineSet = set;
    }

    public resetNotifTimelineSet(): void {
        if (!this.notifTimelineSet) {
            return;
        }

        this.notifTimelineSet.resetLiveTimeline("end");
    }

    public async setLocalNotificationSettings(deviceId: string, settings: LocalNotificationSettings): Promise<EmptyObject> {
        const key = `${LOCAL_NOTIFICATION_SETTINGS_PREFIX.name}.${deviceId}` as const;
        return this.client.setAccountData(key, settings);
    }

    /**
     * 获取通知列表
     *
     * @param opts - 查询选项
     * @param opts.from - 分页起始位置（可选）
     * @param opts.limit - 返回数量限制（可选，默认由服务器决定）
     * @param opts.only - 过滤条件（可选，如 "highlight"）
     * @returns 通知列表和分页信息
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
                this.client.http.authedRequest<INotificationsResponse>(
                    Method.Get,
                    np("/notifications"),
                    opts,
                    undefined,
                    {
                        prefix: ClientPrefix.V3,
                    },
                ),
            "getNotifications",
        );
    }

    /**
     * 确认通知
     *
     * @param notificationId - 通知 ID (event_id)
     * @returns 成功返回空对象
     */
    public async ackNotification(notificationId: string): Promise<Record<string, unknown>> {
        if (!notificationId) {
            throw new ValidationError("notificationId is required");
        }

        return this.withRetry(
            () =>
                this.client.http.authedRequest<Record<string, unknown>>(
                    Method.Post,
                    np(`/notifications/${encodeURIComponent(notificationId)}/ack` as StripV3<PushPathPattern>),
                    undefined,
                    undefined,
                    {
                        prefix: ClientPrefix.V3,
                    },
                ),
            "ackNotification",
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
        return getOrCreateManager(this, "notifications", () => new NotificationsManager(this));
    };
}

export default extendMatrixClient;
