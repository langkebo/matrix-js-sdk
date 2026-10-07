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
import { type IPusher as PushManagerPusher } from "../push";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

/**
 * 推送器的权威形状，别名到 `PushManager`（`src/push/index.ts`）使用的 `IPusher`。
 *
 * 此前本文件自己抄了一份：`kind` 写成必需 `string`、`data` 写成必需，
 * 且缺 `enabled` / `device_id`。与 `PushManager` 的那份并存过。
 */
export type IPusher = PushManagerPusher;

export interface IPushersResponse {
    pushers: IPusher[];
}

export class PushNotificationsManager {
    constructor(private client: MatrixClient) {}

    // 全部委托给 `PushManager` —— 它才是推送器的**唯一实现**（含 `/_matrix/client/v3/pushers`
    // 的读写、缓存 `pushersCache`、MSC3881 兼容处理与 `PushEvent` 上报）。
    // 本模块此前逐个转发 `this.client.getPushers()` / `setPushers()` / `removePusher()` /
    // `getPusherData()` —— 这 4 个方法在本 fork 的 MatrixClient 上**运行时并不存在**
    // （类型表却声明了它们：src/matrix-client-extensions.ts:690-694），调用即 TypeError。

    public async getPushers(): Promise<IPushersResponse> {
        return { pushers: await this.client.getPushManager().getPushers() };
    }

    /** 逐个下发 —— `PushManager.setPusher` 一次只处理一个推送器。 */
    public async setPushers(pushers: IPusher[]): Promise<void> {
        const pushManager = this.client.getPushManager();
        for (const pusher of pushers) {
            await pushManager.setPusher(pusher);
        }
    }

    public async removePusher(pusherData: IPusher): Promise<void> {
        await this.client.getPushManager().removePusher(pusherData.pushkey, pusherData.app_id, pusherData.device_id);
    }
}

// Declare prototype extension

export function extendMatrixClient(): void {
    MatrixClient.prototype.getPushNotificationsManager = function (): PushNotificationsManager {
        registerManagerClass("pushNotifications", PushNotificationsManager);
        return getOrCreateManager(this, "pushNotifications", () => new PushNotificationsManager(this));
    };
}
