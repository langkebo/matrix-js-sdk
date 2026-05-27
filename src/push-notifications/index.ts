/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You May obtain a copy of the License at

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
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface IPusher {
    pushkey: string;
    kind: string;
    app_id: string;
    app_display_name: string;
    device_display_name: string;
    profile_tag?: string;
    lang: string;
    data: Record<string, unknown>;
}

export interface IPushersResponse {
    pushers: IPusher[];
}

export interface IPusherData {
    url?: string;
    format?: string;
    default_payload?: Record<string, unknown>;
}

export class PushNotificationsManager {
    constructor(private client: MatrixClient) {}

    public async getPushers(): Promise<IPushersResponse> {
        return this.client.getPushers();
    }

    public async setPushers(pushers: IPusher[]): Promise<void> {
        return this.client.setPushers(pushers);
    }

    public async removePusher(pusherData: IPusher): Promise<void> {
        return this.client.removePusher(pusherData);
    }

    public getPusherData(roomId: string, userId: string): IPusherData | null {
        return this.client.getPusherData(roomId, userId);
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
        return getOrCreateManager(this, "pushNotifications", () => new PushNotificationsManager(this));
    };
}

export default extendMatrixClient;
