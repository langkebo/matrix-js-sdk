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
import { type IEvent } from "../models/event";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { validateLimit } from "../common/validators";
import type { PushPath } from "../push/__generated__/route-table";
import type { NotificationsPath } from "./__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { ValidationError } from "../errors";
import type { PathAssert, StripV3 } from "../http-api/strip-prefix";

/**
 * 校验并返回通知/推送路径。
 *
 * 本 manager 同时承担**两个 ledger 模块**的端点：
 * - `push`（push.rs）→ `/notifications`、`/notifications/{id}/ack`（来自 `PushPath`）
 * - `push_notification`（push_notification.rs）→ `/push/devices`、`/push/send`（来自 `NotificationsPath`）
 *
 * 因此约束取两张契约表的并集 —— 与本仓 `RoomManager` 并集多表（room|search|moderation…）
 * 的写法一致。并把上游 `PushPath` 与本地 `NotificationsPath` 都纳入断言，杜绝路径拼错。
 */
function np<const P extends string>(path: P & PathAssert<P, StripV3<PushPath | NotificationsPath>>): P {
    return path;
}

export interface ILocalNotificationSettings {
    is_silenced: boolean;
}

export interface INotificationsResponse {
    next_token?: string;
    notifications: Array<{
        actions: unknown[];
        event: IEvent;
        profile_tag?: string;
        read: boolean;
        room_id: string;
        ts: number;
    }>;
}

/**
 * 已注册的推送设备。
 *
 * 对应后端 `push_notification.rs::DeviceResponse`。
 */
export interface IPushDevice {
    device_id: string;
    push_type: string;
    platform?: string | null;
    enabled: boolean;
    created_ts: number;
    last_used_ts?: number | null;
}

/**
 * 注册推送设备请求体。
 *
 * 对应后端 `RegisterDeviceBody`（标注 `deny_unknown_fields`，**不要传多余字段**）。
 */
export interface IRegisterPushDeviceRequest {
    device_id: string;
    push_token: string;
    push_type: string;
    app_id?: string;
    platform?: string;
    platform_version?: string;
    app_version?: string;
    locale?: string;
    timezone?: string;
}

/**
 * 触发服务端推送请求体。
 *
 * 对应后端 `SendNotificationBody`（标注 `deny_unknown_fields`）。
 */
export interface ISendPushNotificationRequest {
    device_id?: string;
    event_id?: string;
    room_id?: string;
    notification_type?: string;
    title: string;
    body: string;
    data?: unknown;
    priority?: number;
}

/** 推送设备注销 / 推送入队等操作的简单回执。 */
export interface IPushAckResponse {
    message: string;
}

export interface NotificationsManagerEvents {
    notifications_updated: { count: number };
    notification_cleared: { roomId: string };
}

export class NotificationsManager extends BaseManager<keyof NotificationsManagerEvents, NotificationsManagerEvents> {
    private notifTimelineSet: EventTimelineSet | null = null;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
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

    public async setLocalNotificationSettings(
        deviceId: string,
        settings: LocalNotificationSettings,
    ): Promise<EmptyObject> {
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
            validateLimit(opts.limit);
        }

        return this.withRetry(
            () =>
                this.request<INotificationsResponse>({
                    method: Method.Get,
                    path: np("/notifications"),
                    queryParams: opts,
                    prefix: ClientPrefix.V3,
                }),
            "getNotifications",
        );
    }

    /**
     * 确认通知
     *
     * @param notificationId - 通知 ID (event_id)
     * @returns 成功返回空对象
     */
    public async ackNotification(notificationId: string): Promise<EmptyObject> {
        if (!notificationId) {
            throw new ValidationError("notificationId is required");
        }

        return this.withRetry(
            () =>
                this.request<EmptyObject>({
                    method: Method.Post,
                    path: np(`/notifications/${encodeURIComponent(notificationId)}/ack`),
                    prefix: ClientPrefix.V3,
                }),
            "ackNotification",
        );
    }

    // ==================== 推送设备与推送触发（push_notification 模块） ====================
    //
    // 这 4 条端点是本 fork 的**移动端推送能力**：注册/注销推送令牌、按需触发服务端推送。
    // 后端注册在 `synapse-web/src/routes/push_notification.rs`，契约表为
    // `src/notifications/__generated__/route-table.ts`（在补齐本组方法前该表无任何消费者）。

    /**
     * 列出当前账号已注册的推送设备。
     *
     * 对应 `GET /_matrix/client/v3/push/devices`。
     *
     * @returns 推送设备列表（后端返回**裸数组**；为兼容包裹形态同时接受 `{ devices }`）
     * @example
     * ```typescript
     * const devices = await client.getNotificationsManager().getPushDevices();
     * console.log(devices.length, "push devices registered");
     * ```
     */
    public async getPushDevices(): Promise<IPushDevice[]> {
        const res = await this.withRetry(
            () =>
                this.request<IPushDevice[] | { devices?: IPushDevice[] }>({
                    method: Method.Get,
                    path: np("/push/devices"),
                    prefix: ClientPrefix.V3,
                }),
            "getPushDevices",
        );
        if (Array.isArray(res)) return res;
        return res?.devices ?? [];
    }

    /**
     * 注册推送设备（推送令牌）。
     *
     * 对应 `POST /_matrix/client/v3/push/devices`。
     *
     * @param body - 注册请求体（`device_id`/`push_token`/`push_type` 必填）
     * @returns 注册后的设备信息
     * @throws ValidationError `device_id`/`push_token`/`push_type` 任一缺失时
     * @example
     * ```typescript
     * const device = await client.getNotificationsManager().registerPushDevice({
     *     device_id: "ABCDEF",
     *     push_token: "apns-token-or-fcm-token",
     *     push_type: "apns",
     * });
     * console.log("registered", device.device_id);
     * ```
     */
    public async registerPushDevice(body: IRegisterPushDeviceRequest): Promise<IPushDevice> {
        if (!body?.device_id) throw new ValidationError("device_id is required");
        if (!body?.push_token) throw new ValidationError("push_token is required");
        if (!body?.push_type) throw new ValidationError("push_type is required");

        return this.withRetry(
            () =>
                this.request<IPushDevice>({
                    method: Method.Post,
                    path: np("/push/devices"),
                    body,
                    prefix: ClientPrefix.V3,
                }),
            "registerPushDevice",
        );
    }

    /**
     * 注销推送设备。
     *
     * 对应 `DELETE /_matrix/client/v3/push/devices/{device_id}`。
     *
     * @param deviceId - 设备 ID
     * @returns 后端回执 `{ message }`
     * @throws ValidationError `deviceId` 为空时
     * @example
     * ```typescript
     * await client.getNotificationsManager().unregisterPushDevice("ABCDEF");
     * ```
     */
    public async unregisterPushDevice(deviceId: string): Promise<IPushAckResponse> {
        if (!deviceId) throw new ValidationError("deviceId is required");

        return this.withRetry(
            () =>
                this.request<IPushAckResponse>({
                    method: Method.Delete,
                    path: np(`/push/devices/${encodeURIComponent(deviceId)}`),
                    prefix: ClientPrefix.V3,
                }),
            "unregisterPushDevice",
        );
    }

    /**
     * 触发服务端向指定设备投递一条推送。
     *
     * 对应 `POST /_matrix/client/v3/push/send`。
     *
     * @param body - 推送内容（`title`/`body` 必填）
     * @returns 后端回执 `{ message }`（入队成功）
     * @throws ValidationError `title`/`body` 任一缺失时
     * @example
     * ```typescript
     * const ack = await client.getNotificationsManager().sendPushNotification({
     *     title: "新消息",
     *     body: "来自 Tjg 的推送测试",
     * });
     * console.log(ack.message);
     * ```
     */
    public async sendPushNotification(body: ISendPushNotificationRequest): Promise<IPushAckResponse> {
        if (!body?.title) throw new ValidationError("title is required");
        if (!body?.body) throw new ValidationError("body is required");

        return this.withRetry(
            () =>
                this.request<IPushAckResponse>({
                    method: Method.Post,
                    path: np("/push/send"),
                    body,
                    prefix: ClientPrefix.V3,
                }),
            "sendPushNotification",
        );
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getNotificationsManager = function (): NotificationsManager {
        registerManagerClass("notifications", NotificationsManager);
        return getOrCreateManager(this, "notifications", () => new NotificationsManager(this));
    };
}
