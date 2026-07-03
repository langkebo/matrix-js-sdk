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
import { MatrixEvent, type IClearEvent, type IContent } from "../models/event";
import { Room } from "../models/room";
import { CryptoApi } from "../crypto-api";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface IEncryptionResult {
    event: MatrixEvent;
    encryptedContent: IContent;
}

export interface IDecryptionResult {
    clearEvent: IClearEvent;
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

export interface CryptoEncryptionManagerEvents {
    encryption_enabled: void;
    encryption_disabled: void;
    device_verified: { userId: string; deviceId: string };
}

export class CryptoEncryptionManager extends BaseManager<
    keyof CryptoEncryptionManagerEvents,
    CryptoEncryptionManagerEvents
> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public isE2eEnabled(): boolean {
        return this.client.getCrypto() !== undefined;
    }

    public getCrypto(): CryptoApi | undefined {
        return this.client.getCrypto();
    }

    public isCryptoReady(): boolean {
        return this.client.isCryptoReady();
    }

    public getDeviceList(): unknown {
        return this.client.deviceList;
    }

    public async encryptEvent(event: MatrixEvent, room: Room): Promise<IEncryptionResult> {
        return this.withRetry(
            () => this.client.encryptEvent(event, room),
            "encryptEvent",
        );
    }

    public async decryptEvent(event: MatrixEvent): Promise<IDecryptionResult> {
        return this.withRetry(
            () => this.client.decryptEvent(event),
            "decryptEvent",
        );
    }

    public async getUserDevices(userId: string): Promise<Record<string, unknown>> { // Dynamic: device info structure varies
        return this.withRetry(
            () => this.client.getUserDevices(userId),
            "getUserDevices",
        );
    }

    public async setDeviceVerified(userId: string, deviceId: string): Promise<void> {
        return this.withRetry(
            () => this.client.setDeviceVerified(userId, deviceId),
            "setDeviceVerified",
        );
    }

    public async markDeviceAsVerified(userId: string, deviceId: string): Promise<void> {
        return this.withRetry(
            () => this.client.markDeviceAsVerified(userId, deviceId),
            "markDeviceAsVerified",
        );
    }

    public async markAllDevicesAsVerified(userId: string): Promise<void> {
        return this.withRetry(
            () => this.client.markAllDevicesAsVerified(userId),
            "markAllDevicesAsVerified",
        );
    }

    public async getEncryptionInfoForRoom(roomId: string): Promise<IEncryptionInfo> {
        return this.withRetry(
            () => this.client.getEncryptionInfoForRoom(roomId),
            "getEncryptionInfoForRoom",
        );
    }
}


export function extendMatrixClient(): void {
    MatrixClient.prototype.getCryptoEncryptionManager = function (): CryptoEncryptionManager {
        registerManagerClass("cryptoEncryption", CryptoEncryptionManager);
    return getOrCreateManager(this, "cryptoEncryption", () => new CryptoEncryptionManager(this));
    };
}

export default extendMatrixClient;
