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

    public async getNotifications(opts?: {
        from?: string;
        limit?: number;
        only?: string;
    }): Promise<INotificationsResponse> {
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
