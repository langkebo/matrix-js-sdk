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
 * Notifications Manager - 通知管理
 * 
 * 提供通知相关功能
 */

import { MatrixClient } from "../client";

export class NotificationsManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get notification timeline set
     */
    public getNotifTimelineSet(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getNotifTimelineSet();
    }

    /**
     * Set notification timeline set
     */
    public setNotifTimelineSet(set: any): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).setNotifTimelineSet(set);
    }

    /**
     * Reset notification timeline set
     */
    public resetNotifTimelineSet(): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).resetNotifTimelineSet();
    }

    /**
     * Set local notification settings
     */
    public async setLocalNotificationSettings(roomId: string, settings: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).setLocalNotificationSettings(roomId, settings);
    }

    /**
     * Get notifications
     */
    public async getNotifications(opts?: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getNotifications(opts);
    }
}

// Declare prototype extension
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
