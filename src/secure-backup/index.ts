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
 * Secure Backup Manager - 安全备份管理
 *
 * 提供口令驱动的安全备份功能
 * 对应后端: synapse-rust/src/web/routes/e2ee_routes.rs
 *
 * 后端端点:
 * - POST /keys/backup/secure
 * - GET /keys/backup/secure/{backup_id}
 * - DELETE /keys/backup/secure/{backup_id}
 * - POST /keys/backup/secure/{backup_id}/keys
 * - POST /keys/backup/secure/{backup_id}/restore
 * - POST /keys/backup/secure/{backup_id}/verify
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { LRUCache } from "../utils/lru-cache";
import type { E2eePathPattern } from "../e2ee/__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

/** Strip the v3 Matrix client prefix so bare call-site paths match the ledger. */
type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

/** Slice of `E2eePathPattern` limited to the `/keys/backup/secure` surface. */
type SecureBackupV3PathPattern = Extract<StripV3<E2eePathPattern>, `/keys/backup/secure${string}`>;

/**
 * Compile-time bind from a secure-backup call site to the `/keys/backup/secure`
 * slice of the generated `E2EE_ROUTES` ledger. Identity at runtime; a typo
 * fails type-checking with `TS2345`.
 */
function sb<P extends SecureBackupV3PathPattern>(path: P): P {
    return path;
}

export interface SecureBackupAuthData {
    public_key?: string;
    signatures?: Record<string, Record<string, string>>;
    [key: string]: unknown;
}

export interface SecureBackupInfo {
    backup_id: string;
    version: string;
    algorithm: string;
    auth_data: SecureBackupAuthData;
    key_count: number;
}

export interface SessionKey {
    room_id: string;
    session_id: string;
    session_key: string;
}

export interface SecureBackupKeysResponse {
    key_count: number;
}

export interface SecureBackupRestoreResponse {
    recovered_keys: number;
    total_keys: number;
}

export interface SecureBackupVerifyResponse {
    valid: boolean;
}
export class SecureBackupManager extends BaseManager {
    private backupCache: LRUCache<SecureBackupInfo>;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
        this.backupCache = new LRUCache<SecureBackupInfo>({
            maxSize: 10,
            ttl: 5 * 60 * 1000,
            name: "index.ts-securebackupinfo",
        });
    }

    /**
     * 列出所有安全备份
     * GET /_matrix/client/v3/keys/backup/secure
     */
    async listSecureBackups(): Promise<Record<string, unknown>> {
        // Dynamic: backup list structure varies by algorithm
        try {
            return await this.withRetry(async () => {
                return await this.request<Record<string, unknown>>({
                    // Dynamic: backup list structure varies by algorithm
                    method: Method.Get,
                    path: sb("/keys/backup/secure"),
                    prefix: ClientPrefix.V3,
                });
            }, "listSecureBackups");
        } catch (error) {
            throw this.normalizeError(error, "listSecureBackups");
        }
    }

    /**
     * 创建安全备份
     * POST /_matrix/client/v3/keys/backup/secure
     */
    async createSecureBackup(passphrase: string): Promise<SecureBackupInfo> {
        try {
            const result = await this.withRetry(async () => {
                return await this.request<SecureBackupInfo>({
                    method: Method.Post,
                    path: sb("/keys/backup/secure"),
                    body: { passphrase },
                    prefix: ClientPrefix.V3,
                });
            }, "createSecureBackup");

            this.backupCache.set(result.backup_id, result);
            return result;
        } catch (error) {
            throw this.normalizeError(error, "createSecureBackup");
        }
    }

    /**
     * 获取安全备份
     * GET /_matrix/client/v3/keys/backup/secure/{backup_id}
     */
    async getSecureBackup(backupId: string, forceRefresh = false): Promise<SecureBackupInfo> {
        if (!forceRefresh) {
            const cached = this.backupCache.get(backupId);
            if (cached) {
                return cached;
            }
        }

        try {
            const result = await this.withRetry(async () => {
                return await this.request<SecureBackupInfo>({
                    method: Method.Get,
                    path: sb(`/keys/backup/secure/${encodeURIComponent(backupId)}`),
                    prefix: ClientPrefix.V3,
                });
            }, "getSecureBackup");

            this.backupCache.set(backupId, result);
            return result;
        } catch (error) {
            throw this.normalizeError(error, "getSecureBackup");
        }
    }

    /**
     * 删除安全备份
     * DELETE /_matrix/client/v3/keys/backup/secure/{backup_id}
     */
    async deleteSecureBackup(backupId: string): Promise<void> {
        try {
            await this.withRetry(async () => {
                return await this.request({
                    method: Method.Delete,
                    path: sb(`/keys/backup/secure/${encodeURIComponent(backupId)}`),
                    prefix: ClientPrefix.V3,
                });
            }, "deleteSecureBackup");

            this.backupCache.delete(backupId);
        } catch (error) {
            throw this.normalizeError(error, "deleteSecureBackup");
        }
    }

    /**
     * 添加密钥到安全备份
     * POST /_matrix/client/v3/keys/backup/secure/{backup_id}/keys
     */
    async addKeysToSecureBackup(
        backupId: string,
        passphrase: string,
        sessionKeys: SessionKey[],
    ): Promise<SecureBackupKeysResponse> {
        try {
            const result = await this.withRetry(async () => {
                return await this.request<SecureBackupKeysResponse>({
                    method: Method.Post,
                    path: sb(`/keys/backup/secure/${encodeURIComponent(backupId)}/keys`),
                    body: { passphrase, session_keys: sessionKeys },
                    prefix: ClientPrefix.V3,
                });
            }, "addKeysToSecureBackup");

            this.backupCache.delete(backupId);
            return result;
        } catch (error) {
            throw this.normalizeError(error, "addKeysToSecureBackup");
        }
    }

    /**
     * 从安全备份恢复
     * POST /_matrix/client/v3/keys/backup/secure/{backup_id}/restore
     */
    async restoreFromSecureBackup(backupId: string, passphrase: string): Promise<SecureBackupRestoreResponse> {
        try {
            const result = await this.withRetry(async () => {
                return await this.request<SecureBackupRestoreResponse>({
                    method: Method.Post,
                    path: sb(`/keys/backup/secure/${encodeURIComponent(backupId)}/restore`),
                    body: { passphrase },
                    prefix: ClientPrefix.V3,
                });
            }, "restoreFromSecureBackup");

            return result;
        } catch (error) {
            throw this.normalizeError(error, "restoreFromSecureBackup");
        }
    }

    /**
     * 验证安全备份
     * POST /_matrix/client/v3/keys/backup/secure/{backup_id}/verify
     */
    async verifySecureBackup(backupId: string, passphrase: string): Promise<SecureBackupVerifyResponse> {
        try {
            const result = await this.withRetry(async () => {
                return await this.request<SecureBackupVerifyResponse>({
                    method: Method.Post,
                    path: sb(`/keys/backup/secure/${encodeURIComponent(backupId)}/verify`),
                    body: { passphrase },
                    prefix: ClientPrefix.V3,
                });
            }, "verifySecureBackup");

            return result;
        } catch (error) {
            throw this.normalizeError(error, "verifySecureBackup");
        }
    }

    clearCache(): void {
        this.backupCache.clear();
    }

    getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        return this.backupCache.getStats();
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSecureBackupManager = function (): SecureBackupManager {
        registerManagerClass("secureBackup", SecureBackupManager);
        return getOrCreateManager(this, "secureBackup", () => new SecureBackupManager(this));
    };
}
