/*
Copyright 2024 The Matrix.org Foundation C.I.C.
*/

/**
 * Key Backup Manager - 密钥备份管理
 */

export interface KeyBackupInfo {
    version: string
    algorithm: string
    auth_data: any
    count?: number
    etag?: string
}

export interface KeyBackupSession {
    room_id: string
    session_id: string
    session_data: any
}

export interface BackupVersion {
    version: string
    algorithm: string
    auth_data: any
    created_on: string
}

export class KeyBackupManager {
    private client: any;
    private currentVersion: string | null = null;

    constructor(client: any) {
        this.client = client;
    }

    async getCapabilities(): Promise<{ available: boolean; enabled?: boolean }> {
        try {
            const capabilities = await this.client.getCapabilities();
            const backup = capabilities['m.key_backup'];
            return { available: backup?.available || false, enabled: backup?.enabled };
        } catch (e) {
            return { available: false };
        }
    }

    async createBackup(algorithm: string, authData: any): Promise<BackupVersion> {
        const result = await this.client.createKeyBackup({ algorithm, auth_data: authData });
        this.currentVersion = result.version;
        return result;
    }

    async getBackupInfo(): Promise<KeyBackupInfo | null> {
        try {
            if (!this.currentVersion) {
                const versions = await this.client.getKeyBackupVersions();
                const versionsList = Object.values(versions as any);
                if (versionsList.length > 0) {
                    this.currentVersion = (versionsList[0] as any).version;
                }
            }
            if (this.currentVersion) {
                return await this.client.getKeyBackupInfo(this.currentVersion);
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    async getBackupKeys(roomId: string, sessionId: string): Promise<any | null> {
        try {
            if (!this.currentVersion) await this.getBackupInfo();
            if (this.currentVersion) {
                return await this.client.getKeyBackupSession(this.currentVersion, roomId, sessionId);
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    async backupKeys(roomId: string, sessionId: string, sessionData: any): Promise<void> {
        try {
            if (!this.currentVersion) await this.getBackupInfo();
            if (this.currentVersion) {
                await this.client.putKeyBackupSession(this.currentVersion, roomId, sessionId, { session_data: sessionData });
            }
        } catch (e) {
            // ignore
        }
    }

    async deleteBackup(version?: string): Promise<void> {
        try {
            const ver = version || this.currentVersion;
            if (ver) {
                await this.client.deleteKeyBackup(ver);
                if (ver === this.currentVersion) this.currentVersion = null;
            }
        } catch (e) {
            // ignore
        }
    }

    async checkKeys(roomId: string, sessionId: string): Promise<boolean> {
        try {
            if (!this.currentVersion) await this.getBackupInfo();
            if (this.currentVersion) {
                await this.client.getKeyBackupSession(this.currentVersion, roomId, sessionId);
                return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    async getBackupVersions(): Promise<BackupVersion[]> {
        try {
            const versions = await this.client.getKeyBackupVersions();
            return Object.values(versions as any);
        } catch (e) {
            return [];
        }
    }

    async restoreBackup(version?: string): Promise<{ imported: number; total: number }> {
        try {
            const ver = version || this.currentVersion;
            if (!ver) return { imported: 0, total: 0 };
            
            const keys = await this.client.getKeyBackupKeys(ver);
            let imported = 0;
            
            if (keys?.rooms) {
                for (const roomId of Object.keys(keys.rooms)) {
                    const sessions = (keys.rooms as any)[roomId].sessions;
                    for (const sessionId of Object.keys(sessions || {})) {
                        try {
                            await this.client.putKeyBackupSession(ver, roomId, sessionId, sessions[sessionId]);
                            imported++;
                        } catch (e) {
                            // ignore
                        }
                    }
                }
            }
            return { imported, total: imported };
        } catch (e) {
            return { imported: 0, total: 0 };
        }
    }

    start(): void {}
    stop(): void {}
}
