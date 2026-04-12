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
import { BaseManager } from "../managers/base-manager";

export interface CryptoBackupInfo {
    version: string;
    algorithm: string;
    auth_data: Record<string, unknown>;
    etag: string;
    count: number;
    hash: string;
}

export interface CryptoBackupManagerEvents {
    backup_enabled: void;
    backup_disabled: void;
    backup_restored: { version: string };
}

export class CryptoBackupManager extends BaseManager<keyof CryptoBackupManagerEvents, CryptoBackupManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public isCryptoBackupEnabled(): boolean {
        return this.client.isCryptoBackupEnabled();
    }

    public async enableCryptoBackup(passphrase: string): Promise<void> {
        await this.client.enableCryptoBackup(passphrase);
    }

    public async disableCryptoBackup(): Promise<void> {
        await this.client.disableCryptoBackup();
    }

    public async getCryptoBackup(): Promise<CryptoBackupInfo | null> {
        return this.withRetry(
            () => this.client.getCryptoBackup() as Promise<CryptoBackupInfo | null>,
            "getCryptoBackup",
        );
    }

    public async restoreCryptoBackup(backup: CryptoBackupInfo | string, passphrase: string): Promise<void> {
        await this.client.restoreCryptoBackup(backup, passphrase);
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getCryptoBackupManager(): CryptoBackupManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCryptoBackupManager = function (): CryptoBackupManager {
        return new CryptoBackupManager(this);
    };
}

export default extendMatrixClient;
