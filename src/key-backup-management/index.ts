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
 * Key Backup Manager - 密钥备份管理
 * 
 * 提供密钥备份、恢复等功能
 */

import { MatrixClient } from "../client";

export class KeyBackupManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get key backup status
     */
    public async getKeyBackupStatus(): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getKeyBackupStatus();
    }

    /**
     * Check if key backup key is stored
     */
    public async isKeyBackupKeyStored(): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isKeyBackupKeyStored();
    }

    /**
     * Delete keys from backup
     */
    public async deleteKeysFromBackup(roomId?: string, sessionId?: string, version?: string): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).deleteKeysFromBackup(roomId, sessionId, version);
    }

    /**
     * Get restake backup info
     */
    public async getRestorationToken(): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRestorationToken();
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getKeyBackupManager(): KeyBackupManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getKeyBackupManager = function (): KeyBackupManager {
        return new KeyBackupManager(this);
    };
}

export default extendMatrixClient;
