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
 * Crypto Backup Manager - 加密备份管理
 *
 * 提供加密备份相关功能
 */

import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type { Curve25519AuthData, Aes256AuthData } from "../crypto-api/keybackup";
import type { ISigned } from "../@types/signed";

export interface CryptoBackupInfo {
    version: string;
    algorithm: string;
    auth_data: ISigned & (Curve25519AuthData | Aes256AuthData);
    etag: string;
    count: number;
    hash: string;
}

export interface CryptoBackupManagerEvents {
    backup_enabled: () => void;
    backup_disabled: () => void;
    backup_restored: (data: { version: string }) => void;
}

export class CryptoBackupManager extends BaseManager<keyof CryptoBackupManagerEvents, CryptoBackupManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public async isCryptoBackupEnabled(): Promise<boolean> {
        const crypto = this.client.getCrypto();
        if (!crypto) return false;
        const version = await crypto.getActiveSessionBackupVersion();
        return version !== null;
    }

    public async enableCryptoBackup(passphrase: string): Promise<void> {
        return this.withRetry(async () => {
            const crypto = this.client.getCrypto();
            if (!crypto) return;
            // If a passphrase is provided, try to restore from an existing backup first;
            // otherwise create a new backup.
            if (passphrase) {
                try {
                    await crypto.restoreKeyBackupWithPassphrase(passphrase);
                } catch {
                    // If restore fails (no existing backup), create a new one
                    await crypto.resetKeyBackup();
                }
            } else {
                await crypto.resetKeyBackup();
            }
            this.emit("backup_enabled");
        }, "enableCryptoBackup");
    }

    public async disableCryptoBackup(): Promise<void> {
        return this.withRetry(async () => {
            const crypto = this.client.getCrypto();
            if (!crypto) return;
            await crypto.disableKeyStorage();
            this.emit("backup_disabled");
        }, "disableCryptoBackup");
    }

    public async getCryptoBackup(): Promise<CryptoBackupInfo | null> {
        return this.withRetry(async () => {
            const crypto = this.client.getCrypto();
            if (!crypto) return null;
            const keyBackupInfo = await crypto.getKeyBackupInfo();
            if (!keyBackupInfo) return null;
            return {
                version: keyBackupInfo.version ?? "",
                algorithm: keyBackupInfo.algorithm,
                auth_data: { ...keyBackupInfo.auth_data },
                etag: keyBackupInfo.etag ?? "",
                count: keyBackupInfo.count ?? 0,
                hash: "",
            };
        }, "getCryptoBackup");
    }

    public async restoreCryptoBackup(backup: CryptoBackupInfo | string, passphrase: string): Promise<void> {
        return this.withRetry(async () => {
            const crypto = this.client.getCrypto();
            if (!crypto) return;
            await crypto.restoreKeyBackupWithPassphrase(passphrase);
            const version = typeof backup === "string" ? backup : backup.version;
            this.emit("backup_restored", { version });
        }, "restoreCryptoBackup");
    }
}


export function extendMatrixClient(): void {
    MatrixClient.prototype.getCryptoBackupManager = function (): CryptoBackupManager {
        registerManagerClass("cryptoBackup", CryptoBackupManager);
    return getOrCreateManager(this, "cryptoBackup", () => new CryptoBackupManager(this));
    };
}

export default extendMatrixClient;
