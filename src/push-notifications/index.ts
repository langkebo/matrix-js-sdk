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
 * Push Notifications Manager - 推送通知管理
 * 
 * 提供推送通知相关功能
 */

import { MatrixClient } from "../client";

export class PushNotificationsManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get pushers
     */
    public async getPushers(): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getPushers();
    }

    /**
     * Set pushers
     */
    public async setPushers(pushers: any[]): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).setPushers(pushers);
    }

    /**
     * Remove pusher
     */
    public async removePusher(pusherData: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).removePusher(pusherData);
    }

    /**
     * Get pusher data
     */
    public getPusherData(roomId: string, userId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getPusherData(roomId, userId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getPushNotificationsManager(): PushNotificationsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getPushNotificationsManager = function (): PushNotificationsManager {
        return new PushNotificationsManager(this);
    };
}

export default extendMatrixClient;
