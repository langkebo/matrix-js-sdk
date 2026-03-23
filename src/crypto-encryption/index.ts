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
 * Crypto Encryption Manager - 加密管理
 * 
 * 提供加密相关功能
 */

import { MatrixClient } from "../client";

export class CryptoEncryptionManager {
    constructor(private client: MatrixClient) {}

    /**
     * Is e2e enabled
     */
    public isE2eEnabled(): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isE2eEnabled();
    }

    /**
     * Get crypto
     */
    public getCrypto(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).crypto;
    }

    /**
     * Is crypto ready
     */
    public isCryptoReady(): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isCryptoReady();
    }

    /**
     * Get device list
     */
    public getDeviceList(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).deviceList;
    }

    /**
     * Encrypt event
     */
    public async encryptEvent(event: any, room: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).encryptEvent(event, room);
    }

    /**
     * Decrypt event
     */
    public async decryptEvent(event: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).decryptEvent(event);
    }

    /**
     * Get user devices
     */
    public async getUserDevices(userId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getUserDevices(userId);
    }

    /**
     * Set device verified
     */
    public async setDeviceVerified(userId: string, deviceId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).setDeviceVerified(userId, deviceId);
    }

    /**
     * Mark device as verified
     */
    public async markDeviceAsVerified(userId: string, deviceId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).markDeviceAsVerified(userId, deviceId);
    }

    /**
     * Mark all devices as verified
     */
    public async markAllDevicesAsVerified(userId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).markAllDevicesAsVerified(userId);
    }

    /**
     * Get encryption info for room
     */
    public async getEncryptionInfoForRoom(roomId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getEncryptionInfoForRoom(roomId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getCryptoEncryptionManager(): CryptoEncryptionManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCryptoEncryptionManager = function (): CryptoEncryptionManager {
        return new CryptoEncryptionManager(this);
    };
}

export default extendMatrixClient;
