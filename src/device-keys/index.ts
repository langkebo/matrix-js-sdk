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
 * Device Keys Manager - 设备密钥管理
 * 
 * 提供设备密钥相关功能
 */

import { MatrixClient } from "../client";

export class DeviceKeysManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get device keys
     */
    public async getDeviceKeys(userId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getDeviceKeys(userId);
    }

    /**
     * Upload device keys
     */
    public async uploadDeviceKeys(keys: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).uploadDeviceKeys(keys);
    }

    /**
     * Get user devices
     */
    public async getUserDevices(userId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getUserDevices(userId);
    }

    /**
     * Has device
     */
    public hasDevice(deviceId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).hasDevice(deviceId);
    }

    /**
     * Get device
     */
    public getDevice(deviceId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getDevice(deviceId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getDeviceKeysManager(): DeviceKeysManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getDeviceKeysManager = function (): DeviceKeysManager {
        return new DeviceKeysManager(this);
    };
}

export default extendMatrixClient;
