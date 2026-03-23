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

export class NotificationsLegacyManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get notification count
     */
    public getNotificationCount(roomId: string): number {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getNotificationCount(roomId);
    }

    /**
     * Get highlight count
     */
    public getHighlightCount(roomId: string): number {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getHighlightCount(roomId);
    }

    /**
     * Has unread notifications
     */
    public hasUnreadNotifications(roomId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).hasUnreadNotifications(roomId);
    }

    /**
     * Has unread highlights
     */
    public hasUnreadHighlights(roomId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).hasUnreadHighlights(roomId);
    }

    /**
     * Set notification callback
     */
    public setNotificationCallback(callback: Function): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).notificationCallback = callback;
    }

    /**
     * Get total notification count
     */
    public getTotalNotificationCount(): number {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getTotalNotificationCount();
    }

    /**
     * Get total highlight count
     */
    public getTotalHighlightCount(): number {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getTotalHighlightCount();
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getNotificationsLegacyManager(): NotificationsLegacyManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getNotificationsLegacyManager = function (): NotificationsLegacyManager {
        return new NotificationsLegacyManager(this);
    };
}

export default extendMatrixClient;
