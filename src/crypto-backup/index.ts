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

export class CryptoBackupManager {
    constructor(private client: MatrixClient) {}

    /**
     * Is crypto backup enabled
     */
    public isCryptoBackupEnabled(): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isCryptoBackupEnabled();
    }

    /**
     * Enable crypto backup
     */
    public async enableCryptoBackup(passphrase: string): Promise<unknown> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).enableCryptoBackup(passphrase);
    }

    /**
     * Disable crypto backup
     */
    public async disableCryptoBackup(): Promise<unknown> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).disableCryptoBackup();
    }

    /**
     * Get crypto backup
     */
    public async getCryptoBackup(): Promise<unknown> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getCryptoBackup();
    }

    /**
     * Restore crypto backup
     */
    public async restoreCryptoBackup(backup: unknown, passphrase: string): Promise<unknown> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).restoreCryptoBackup(backup, passphrase);
    }
}

// Declare prototype extension
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
