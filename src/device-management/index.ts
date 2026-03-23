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
 * Device Manager - 设备管理
 * 
 * 提供设备列表、设备详情、删除设备等功能
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import { type EmptyObject } from "../@types/common";
import * as utils from "../utils";

export class DeviceManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get device ID
     */
    public getDeviceId(): string | null {
        return this.client.deviceId;
    }

    /**
     * Get all devices
     */
    public async getDevices(): Promise<any> {
        const path = "/devices";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Get, path);
    }

    /**
     * Get a specific device
     */
    public async getDevice(deviceId: string): Promise<any> {
        const path = utils.encodeUri("/devices/$deviceId", { $deviceId: deviceId });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Get, path);
    }

    /**
     * Update device details
     */
    public async setDeviceDetails(deviceId: string, body: { display_name: string }): Promise<EmptyObject> {
        const path = utils.encodeUri("/devices/$deviceId", { $deviceId: deviceId });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Put, path, undefined, body);
    }

    /**
     * Delete a device
     */
    public async deleteDevice(deviceId: string, auth?: any): Promise<EmptyObject> {
        const path = utils.encodeUri("/devices/$deviceId", { $deviceId: deviceId });
        const body = auth ? { auth } : {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Delete, path, undefined, body);
    }

    /**
     * Delete multiple devices
     */
    public async deleteMultipleDevices(devices: string[], auth?: any): Promise<EmptyObject> {
        const body: Record<string, any> = { devices };
        if (auth) body.auth = auth;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Post, "/delete_devices", undefined, body);
    }

    /**
     * Set password
     */
    public async setPassword(authDict: any, newPassword: string, logoutDevices = true): Promise<EmptyObject> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).setPassword(authDict, newPassword, logoutDevices);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getDeviceManager(): DeviceManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getDeviceManager = function (): DeviceManager {
        return new DeviceManager(this);
    };
}

export default extendMatrixClient;
