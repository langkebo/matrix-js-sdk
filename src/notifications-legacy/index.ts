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
 * Notifications Legacy Manager - 旧版通知管理
 *
 * 提供通知相关功能
 */

import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface NotificationsLegacyManagerEvents {
    notification_count_changed: { roomId: string; count: number };
    highlight_count_changed: { roomId: string; count: number };
}

export class NotificationsLegacyManager extends BaseManager<
    keyof NotificationsLegacyManagerEvents,
    NotificationsLegacyManagerEvents
> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public getNotificationCount(roomId: string): number {
        return this.client.getNotificationCount(roomId);
    }

    public getHighlightCount(roomId: string): number {
        return this.client.getHighlightCount(roomId);
    }

    public hasUnreadNotifications(roomId: string): boolean {
        return this.client.hasUnreadNotifications(roomId);
    }

    public hasUnreadHighlights(roomId: string): boolean {
        return this.client.hasUnreadHighlights(roomId);
    }

    public setNotificationCallback(callback: (count: number) => void): void {
        this.client.notificationCallback = callback;
    }

    public getTotalNotificationCount(): number {
        return this.client.getTotalNotificationCount();
    }

    public getTotalHighlightCount(): number {
        return this.client.getTotalHighlightCount();
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getNotificationsLegacyManager(): NotificationsLegacyManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getNotificationsLegacyManager = function (): NotificationsLegacyManager {
        return getOrCreateManager(this, "notificationsLegacy", () => new NotificationsLegacyManager(this));
    };
}

export default extendMatrixClient;
