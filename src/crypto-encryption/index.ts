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
 * Crypto Encryption Manager - 加密管理
 * 
 * 提供加密相关功能
 */

import { MatrixClient } from "../client";
import { MatrixEvent } from "../models/event";
import { Room } from "../models/room";
import { CryptoApi } from "../crypto-api";

export interface IEncryptionResult {
    event: MatrixEvent;
    encryptedContent: Record<string, unknown>;
}

export interface IDecryptionResult {
    clearEvent: Record<string, unknown>;
    senderKey?: string;
    forwardingCurve25519KeyChain?: string[];
    keysClaimed?: Record<string, string>;
}

export interface IEncryptionInfo {
    algorithm: string;
    senderKey?: string;
    senderEd25519?: string;
    senderCurve25519?: string;
    deviceId?: string;
}

export class CryptoEncryptionManager {
    constructor(private client: MatrixClient) {}

    public isE2eEnabled(): boolean {
        return this.client.getCrypto() !== undefined;
    }

    public getCrypto(): CryptoApi | undefined {
        return this.client.getCrypto();
    }

    public isCryptoReady(): boolean {
        return (this.client as unknown as {
            isCryptoReady: () => boolean;
        }).isCryptoReady();
    }

    public getDeviceList(): unknown {
        return (this.client as unknown as { deviceList?: unknown }).deviceList;
    }

    public async encryptEvent(event: MatrixEvent, room: Room): Promise<IEncryptionResult> {
        return (this.client as unknown as {
            encryptEvent: (event: MatrixEvent, room: Room) => Promise<IEncryptionResult>;
        }).encryptEvent(event, room);
    }

    public async decryptEvent(event: MatrixEvent): Promise<IDecryptionResult> {
        return (this.client as unknown as {
            decryptEvent: (event: MatrixEvent) => Promise<IDecryptionResult>;
        }).decryptEvent(event);
    }

    public async getUserDevices(userId: string): Promise<Record<string, unknown>> {
        return (this.client as unknown as {
            getUserDevices: (userId: string) => Promise<Record<string, unknown>>;
        }).getUserDevices(userId);
    }

    public async setDeviceVerified(userId: string, deviceId: string): Promise<void> {
        return (this.client as unknown as {
            setDeviceVerified: (userId: string, deviceId: string) => Promise<void>;
        }).setDeviceVerified(userId, deviceId);
    }

    public async markDeviceAsVerified(userId: string, deviceId: string): Promise<void> {
        return (this.client as unknown as {
            markDeviceAsVerified: (userId: string, deviceId: string) => Promise<void>;
        }).markDeviceAsVerified(userId, deviceId);
    }

    public async markAllDevicesAsVerified(userId: string): Promise<void> {
        return (this.client as unknown as {
            markAllDevicesAsVerified: (userId: string) => Promise<void>;
        }).markAllDevicesAsVerified(userId);
    }

    public async getEncryptionInfoForRoom(roomId: string): Promise<IEncryptionInfo> {
        return (this.client as unknown as {
            getEncryptionInfoForRoom: (roomId: string) => Promise<IEncryptionInfo>;
        }).getEncryptionInfoForRoom(roomId);
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
