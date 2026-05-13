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
 * Global Logout Manager - 全局登出管理
 *
 * 提供多设备全局登出功能
 * 对应 API: POST /_matrix/client/v3/logout/all
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import { getOrCreateManager } from "../client-infra/manager-registry";

export class GlobalLogoutManager {
    constructor(private client: MatrixClient) {}

    /**
     * 登出所有设备
     * 对应 API: POST /_matrix/client/v3/logout/all
     */
    public async logoutAll(): Promise<void> {
        await this.client.http.authedRequest(Method.Post, "/logout/all");
    }

    /**
     * 获取活跃会话列表
     * 对应 API: GET /_matrix/client/v3/devices
     */
    public async getActiveSessions(): Promise<Device[]> {
        const devices = await this.client.getDeviceManager().getDevices();
        return devices.map((d) => ({
            deviceId: d.device_id,
            displayName: d.display_name,
            lastSeenTs: d.last_seen_ts,
        }));
    }

    /**
     * 登出指定设备
     * 对应 API: DELETE /_matrix/client/v3/devices/{device_id}
     */
    public async logoutDevice(deviceId: string): Promise<void> {
        await this.client.http.authedRequest(Method.Delete, `/devices/${deviceId}`);
    }

    /**
     * 登出除当前设备外的所有设备
     */
    public async logoutOtherDevices(): Promise<void> {
        const devices = await this.getActiveSessions();
        const currentDeviceId = this.client.deviceId;

        const otherDevices = devices.filter((d) => d.deviceId !== currentDeviceId);

        for (const device of otherDevices) {
            await this.logoutDevice(device.deviceId);
        }
    }
}

interface Device {
    deviceId: string;
    displayName?: string;
    lastSeenTs?: number;
}

declare module "../client.ts" {
    interface MatrixClient {
        getGlobalLogoutManager(): GlobalLogoutManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getGlobalLogoutManager = function (): GlobalLogoutManager {
        return getOrCreateManager(this, "authGlobalLogout", () => new GlobalLogoutManager(this));
    };
}

export default extendMatrixClient;
