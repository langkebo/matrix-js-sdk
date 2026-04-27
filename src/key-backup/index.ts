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
 * 提供密钥备份、恢复、导入导出等功能
 * 对应后端: synapse-rust/src/web/routes/key_backup.rs
 *
 * 后端端点:
 * - GET/POST /room_keys/version
 * - GET/PUT/DELETE /room_keys/version/{version}
 * - GET/PUT /room_keys/keys
 * - GET/PUT /room_keys/keys/{version}
 * - GET /room_keys/keys/{version}/{room_id}
 * - GET /room_keys/keys/{version}/{room_id}/{session_id}
 * - POST /room_keys/{version}/keys
 * - POST /room_keys/recover
 * - GET /room_keys/recovery/{version}/progress
 * - GET /room_keys/verify/{version}
 * - POST /room_keys/batch_recover
 * - GET /room_keys/recover/{version}/{room_id}
 * - GET /room_keys/recover/{version}/{room_id}/{session_id}
 * - GET /room_keys/export
 * - GET /room_keys/export/{version}
 * - POST /room_keys/import
 * - POST /room_keys/import/{version}
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { MatrixError } from "../http-api/errors.ts";
import { AuthError, NotFoundError, ApiError, SdkError } from "../errors.ts";
import { logger } from "../logger.ts";
import { LRUCache } from "../utils/lru-cache.ts";
import { AdminValidators } from "../admin/validators";
import { ValidationError } from "../errors";

export interface EncryptedData {
    ciphertext: string;
    ephemeral: string;
    mac: string;
}

export interface AuthData {
    public_key: string;
    signatures?: Record<string, Record<string, string>>;
}

export interface SessionData {
    first_message_index: number;
    forwarded_count: number;
    is_verified: boolean;
    session_data: EncryptedData | Record<string, unknown>;
}

export interface BackupVersionInfo {
    version: string;
    algorithm: string;
    auth_data: AuthData | Record<string, unknown>;
}

export interface BackupVersion {
    version: string;
    algorithm: string;
    auth_data: AuthData | Record<string, unknown>;
    count?: number;
    etag?: string;
}

export interface RoomSessions {
    sessions: Record<string, SessionData>;
}

export interface RoomKeyBackup {
    rooms: Record<string, RoomSessions>;
    etag: string;
}

export interface RecoveryProgress {
    user_id: string;
    version: string;
    total_keys: number;
    recovered_keys: number;
    status: string;
    started_ts: number;
    updated_ts: number;
}

export interface BatchRecoverResult {
    rooms: Record<string, RoomSessions>;
    total_sessions: number;
    has_more: boolean;
    next_batch?: string;
}

export interface ExportResult {
    room_keys: Array<{
        room_id: string;
        session_id: string;
        session_data: EncryptedData | Record<string, unknown>;
        first_message_index: number;
        forwarded_count: number;
        is_verified: boolean;
    }>;
    version: string;
}

export interface ImportResult {
    count: number;
    failed: number;
    total: number;
}

export interface VerifyResult {
    valid: boolean;
    algorithm: string;
    auth_data: AuthData | Record<string, unknown>;
    key_count: number;
    signatures?: Record<string, Record<string, string>>;
}

export interface PutRoomKeysBody {
    room_id: string;
    sessions: SessionData[];
}

export interface UploadKeysResult {
    count: number;
    etag: string;
}

export interface RecoverKeysResult {
    rooms: Record<string, RoomSessions>;
    total_keys: number;
    recovered_keys: number;
}

export interface RecoverRoomKeysResult {
    room_id: string;
    sessions: SessionData[];
}

export interface RecoverSessionKeyResult {
    room_id: string;
    session_id: string;
    session_data: EncryptedData | Record<string, unknown>;
}
export class KeyBackupManager {
    private client: MatrixClient;
    private currentVersion: string | null = null;
    private versionCache: LRUCache<BackupVersionInfo>;
    private readonly maxRetries = 3;
    private readonly retryDelay = 1000;

    private requestStats = {
        total: 0,
        successful: 0,
        failed: 0,
        retried: 0,
    };

    constructor(client: MatrixClient) {
        this.client = client;
        this.versionCache = new LRUCache<BackupVersionInfo>({
            maxSize: 10,
            ttl: 5 * 60 * 1000,
            name: "index.ts-backupversioninfo",
        });
    }

    // ==================== 版本管理 ====================

    async getBackupVersions(forceRefresh = false): Promise<{ versions: BackupVersionInfo[] }> {
        if (!forceRefresh) {
            const cached = this.versionCache.get("__versions__");
            if (cached) {
                return { versions: [cached] };
            }
        }

        try {
            const result = await this.withRetry(async () => {
                return await this.client.http.authedRequest<{ versions: BackupVersionInfo[] }>(
                    Method.Get,
                    "/room_keys/version",
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "getBackupVersions");

            if (result.versions && result.versions.length > 0) {
                result.versions.forEach((v) => {
                    this.versionCache.set(v.version, v);
                });
            }

            return result;
        } catch (error) {
            throw this.normalizeError(error, "getBackupVersions");
        }
    }

    /**
     * 创建密钥备份版本
     *
     * @param algorithm - 加密算法（默认：m.megolm.v1.aes-sha2）
     * @param authData - 认证数据（可选）
     * @returns 包含版本号的对象
     *
     * @example
     * ```typescript
     * // 创建默认备份版本
     * const result = await keyBackupManager.createBackupVersion();
     * console.log("Backup version:", result.version);
     *
     * // 创建带认证数据的备份版本
     * const result = await keyBackupManager.createBackupVersion(
     *     "m.megolm.v1.aes-sha2",
     *     {
     *         public_key: "base64_public_key",
     *         signatures: {}
     *     }
     * );
     * ```
     *
     * @throws {ValidationError} 如果算法格式无效
     * @throws {ApiError} 如果 API 调用失败
     */
    async createBackupVersion(
        algorithm: string = "m.megolm.v1.aes-sha2",
        authData?: AuthData | Record<string, unknown>,
    ): Promise<{ version: string }> {
        if (!algorithm || algorithm.trim().length === 0) {
            throw new ValidationError("Algorithm is required");
        }
        try {
            const result = await this.withRetry(async () => {
                return await this.client.http.authedRequest<{ version: string }>(
                    Method.Post,
                    "/room_keys/version",
                    undefined,
                    { algorithm, auth_data: authData },
                    { prefix: ClientPrefix.V3 },
                );
            }, "createBackupVersion");

            this.currentVersion = result.version;
            return result;
        } catch (error) {
            throw this.normalizeError(error, "createBackupVersion");
        }
    }

    /**
     * 获取密钥备份版本信息
     *
     * @param version - 备份版本号
     * @param forceRefresh - 是否强制刷新缓存（默认 false）
     * @returns 备份版本信息
     *
     * @example
     * ```typescript
     * // 获取备份版本信息
     * const info = await keyBackupManager.getBackupVersion("1");
     * console.log("Algorithm:", info.algorithm);
     * console.log("Auth data:", info.auth_data);
     *
     * // 强制刷新
     * const freshInfo = await keyBackupManager.getBackupVersion("1", true);
     * ```
     *
     * @throws {ValidationError} 如果版本号为空
     * @throws {NotFoundError} 如果版本不存在
     * @throws {ApiError} 如果 API 调用失败
     */
    async getBackupVersion(version: string, forceRefresh = false): Promise<BackupVersionInfo> {
        if (!version || version.trim().length === 0) {
            throw new ValidationError("Version is required");
        }
        if (!forceRefresh) {
            const cached = this.versionCache.get(version);
            if (cached) {
                return cached;
            }
        }

        try {
            const result = await this.withRetry(async () => {
                return await this.client.http.authedRequest<BackupVersionInfo>(
                    Method.Get,
                    `/room_keys/version/${version}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "getBackupVersion");

            this.versionCache.set(version, result);
            return result;
        } catch (error) {
            throw this.normalizeError(error, "getBackupVersion");
        }
    }

    async updateBackupVersion(
        version: string,
        authData: AuthData | Record<string, unknown>,
    ): Promise<{ version: string }> {
        try {
            const result = await this.withRetry(async () => {
                return await this.client.http.authedRequest<{ version: string }>(
                    Method.Put,
                    `/room_keys/version/${version}`,
                    undefined,
                    { auth_data: authData },
                    { prefix: ClientPrefix.V3 },
                );
            }, "updateBackupVersion");

            this.versionCache.delete(version);
            return result;
        } catch (error) {
            throw this.normalizeError(error, "updateBackupVersion");
        }
    }

    async deleteBackupVersion(version: string): Promise<{ deleted: boolean; version: string }> {
        try {
            const result = await this.withRetry(async () => {
                return await this.client.http.authedRequest<{ deleted: boolean; version: string }>(
                    Method.Delete,
                    `/room_keys/version/${version}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "deleteBackupVersion");

            if (version === this.currentVersion) {
                this.currentVersion = null;
            }
            this.versionCache.delete(version);
            return result;
        } catch (error) {
            throw this.normalizeError(error, "deleteBackupVersion");
        }
    }

    // ==================== 密钥读写 ====================

    async getAllBackupKeys(): Promise<RoomKeyBackup> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<RoomKeyBackup>(
                    Method.Get,
                    "/room_keys/keys",
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "getAllBackupKeys");
        } catch (error) {
            throw this.normalizeError(error, "getAllBackupKeys");
        }
    }

    async uploadKeysToLatest(body: PutRoomKeysBody): Promise<UploadKeysResult> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<UploadKeysResult>(
                    Method.Put,
                    "/room_keys/keys",
                    undefined,
                    body,
                    { prefix: ClientPrefix.V3 },
                );
            }, "uploadKeysToLatest");
        } catch (error) {
            throw this.normalizeError(error, "uploadKeysToLatest");
        }
    }

    async getBackupKeys(version: string): Promise<RoomKeyBackup> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<RoomKeyBackup>(
                    Method.Get,
                    `/room_keys/keys/${version}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "getBackupKeys");
        } catch (error) {
            throw this.normalizeError(error, "getBackupKeys");
        }
    }

    async uploadKeysToVersion(version: string, body: PutRoomKeysBody): Promise<UploadKeysResult> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<UploadKeysResult>(
                    Method.Put,
                    `/room_keys/keys/${version}`,
                    undefined,
                    body,
                    { prefix: ClientPrefix.V3 },
                );
            }, "uploadKeysToVersion");
        } catch (error) {
            throw this.normalizeError(error, "uploadKeysToVersion");
        }
    }

    async getRoomBackupKeys(version: string, roomId: string): Promise<{ rooms: Record<string, RoomSessions> }> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<{ rooms: Record<string, RoomSessions> }>(
                    Method.Get,
                    `/room_keys/keys/${version}/${encodeURIComponent(roomId)}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "getRoomBackupKeys");
        } catch (error) {
            throw this.normalizeError(error, "getRoomBackupKeys");
        }
    }

    async getSessionBackupKey(version: string, roomId: string, sessionId: string): Promise<RecoverSessionKeyResult> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<RecoverSessionKeyResult>(
                    Method.Get,
                    `/room_keys/keys/${version}/${encodeURIComponent(roomId)}/${encodeURIComponent(sessionId)}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "getSessionBackupKey");
        } catch (error) {
            throw this.normalizeError(error, "getSessionBackupKey");
        }
    }

    async uploadSessionKey(
        version: string,
        roomId: string,
        sessionId: string,
        sessionData: SessionData,
    ): Promise<{ etag: string }> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<{ etag: string }>(
                    Method.Put,
                    `/room_keys/keys/${version}/${encodeURIComponent(roomId)}/${encodeURIComponent(sessionId)}`,
                    undefined,
                    sessionData,
                    { prefix: ClientPrefix.V3 },
                );
            }, "uploadSessionKey");
        } catch (error) {
            throw this.normalizeError(error, "uploadSessionKey");
        }
    }

    async uploadBatchKeys(version: string, keys: Record<string, RoomSessions>): Promise<UploadKeysResult> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<UploadKeysResult>(
                    Method.Post,
                    `/room_keys/${version}/keys`,
                    undefined,
                    keys,
                    { prefix: ClientPrefix.V3 },
                );
            }, "uploadBatchKeys");
        } catch (error) {
            throw this.normalizeError(error, "uploadBatchKeys");
        }
    }

    // ==================== 恢复与校验 ====================

    async recoverKeys(version: string, rooms?: string[]): Promise<RecoverKeysResult> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<RecoverKeysResult>(
                    Method.Post,
                    "/room_keys/recover",
                    undefined,
                    { version, rooms },
                    { prefix: ClientPrefix.V3 },
                );
            }, "recoverKeys");
        } catch (error) {
            throw this.normalizeError(error, "recoverKeys");
        }
    }

    async getRecoveryProgress(version: string): Promise<RecoveryProgress> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<RecoveryProgress>(
                    Method.Get,
                    `/room_keys/recovery/${version}/progress`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "getRecoveryProgress");
        } catch (error) {
            throw this.normalizeError(error, "getRecoveryProgress");
        }
    }

    async verifyBackup(version: string): Promise<VerifyResult> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<VerifyResult>(
                    Method.Get,
                    `/room_keys/verify/${version}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "verifyBackup");
        } catch (error) {
            throw this.normalizeError(error, "verifyBackup");
        }
    }

    async batchRecover(version: string, roomIds: string[], sessionLimit?: number): Promise<BatchRecoverResult> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<BatchRecoverResult>(
                    Method.Post,
                    "/room_keys/batch_recover",
                    undefined,
                    { version, room_ids: roomIds, session_limit: sessionLimit },
                    { prefix: ClientPrefix.V3 },
                );
            }, "batchRecover");
        } catch (error) {
            throw this.normalizeError(error, "batchRecover");
        }
    }

    async recoverRoomKeys(version: string, roomId: string): Promise<RecoverRoomKeysResult> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<RecoverRoomKeysResult>(
                    Method.Get,
                    `/room_keys/recover/${version}/${encodeURIComponent(roomId)}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "recoverRoomKeys");
        } catch (error) {
            throw this.normalizeError(error, "recoverRoomKeys");
        }
    }

    async recoverSessionKey(version: string, roomId: string, sessionId: string): Promise<RecoverSessionKeyResult> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<RecoverSessionKeyResult>(
                    Method.Get,
                    `/room_keys/recover/${version}/${encodeURIComponent(roomId)}/${encodeURIComponent(sessionId)}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "recoverSessionKey");
        } catch (error) {
            throw this.normalizeError(error, "recoverSessionKey");
        }
    }

    // ==================== 导出与导入 ====================

    async exportKeys(): Promise<ExportResult> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<ExportResult>(
                    Method.Get,
                    "/room_keys/export",
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "exportKeys");
        } catch (error) {
            throw this.normalizeError(error, "exportKeys");
        }
    }

    async exportKeysByVersion(version: string): Promise<ExportResult> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<ExportResult>(
                    Method.Get,
                    `/room_keys/export/${version}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "exportKeysByVersion");
        } catch (error) {
            throw this.normalizeError(error, "exportKeysByVersion");
        }
    }

    async importKeys(roomKeys: ExportResult["room_keys"], version?: string): Promise<ImportResult> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<ImportResult>(
                    Method.Post,
                    "/room_keys/import",
                    undefined,
                    { room_keys: roomKeys, version },
                    { prefix: ClientPrefix.V3 },
                );
            }, "importKeys");
        } catch (error) {
            throw this.normalizeError(error, "importKeys");
        }
    }

    async importKeysToVersion(version: string, roomKeys: ExportResult["room_keys"]): Promise<ImportResult> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<ImportResult>(
                    Method.Post,
                    `/room_keys/import/${version}`,
                    undefined,
                    { room_keys: roomKeys },
                    { prefix: ClientPrefix.V3 },
                );
            }, "importKeysToVersion");
        } catch (error) {
            throw this.normalizeError(error, "importKeysToVersion");
        }
    }

    // ==================== 安全备份 (v3-only) ====================

    async createSecureBackup(algorithm: string, authData?: Record<string, unknown>): Promise<{ backup_id: string }> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<{ backup_id: string }>(
                    Method.Post,
                    "/keys/backup/secure",
                    undefined,
                    { algorithm, auth_data: authData },
                    { prefix: ClientPrefix.V3 },
                );
            }, "createSecureBackup");
        } catch (error) {
            throw this.normalizeError(error, "createSecureBackup");
        }
    }

    async getSecureBackup(backupId: string): Promise<Record<string, unknown>> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<Record<string, unknown>>(
                    Method.Get,
                    `/keys/backup/secure/${encodeURIComponent(backupId)}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "getSecureBackup");
        } catch (error) {
            throw this.normalizeError(error, "getSecureBackup");
        }
    }

    async deleteSecureBackup(backupId: string): Promise<{ deleted: boolean }> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<{ deleted: boolean }>(
                    Method.Delete,
                    `/keys/backup/secure/${encodeURIComponent(backupId)}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "deleteSecureBackup");
        } catch (error) {
            throw this.normalizeError(error, "deleteSecureBackup");
        }
    }

    async storeSecureBackupKeys(backupId: string, keys: Record<string, unknown>): Promise<{ stored: boolean }> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<{ stored: boolean }>(
                    Method.Post,
                    `/keys/backup/secure/${encodeURIComponent(backupId)}/keys`,
                    undefined,
                    keys,
                    { prefix: ClientPrefix.V3 },
                );
            }, "storeSecureBackupKeys");
        } catch (error) {
            throw this.normalizeError(error, "storeSecureBackupKeys");
        }
    }

    async restoreSecureBackup(backupId: string, passphrase?: string): Promise<Record<string, unknown>> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<Record<string, unknown>>(
                    Method.Post,
                    `/keys/backup/secure/${encodeURIComponent(backupId)}/restore`,
                    undefined,
                    { passphrase },
                    { prefix: ClientPrefix.V3 },
                );
            }, "restoreSecureBackup");
        } catch (error) {
            throw this.normalizeError(error, "restoreSecureBackup");
        }
    }

    async verifySecureBackupPassphrase(backupId: string, passphrase: string): Promise<{ valid: boolean }> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<{ valid: boolean }>(
                    Method.Post,
                    `/keys/backup/secure/${encodeURIComponent(backupId)}/verify`,
                    undefined,
                    { passphrase },
                    { prefix: ClientPrefix.V3 },
                );
            }, "verifySecureBackupPassphrase");
        } catch (error) {
            throw this.normalizeError(error, "verifySecureBackupPassphrase");
        }
    }

    // ==================== 辅助方法 ====================

    getCurrentVersion(): string | null {
        return this.currentVersion;
    }

    setCurrentVersion(version: string | null): void {
        this.currentVersion = version;
    }

    async ensureBackupVersion(algorithm: string = "m.megolm.v1.aes-sha2"): Promise<string> {
        if (this.currentVersion) {
            return this.currentVersion;
        }

        const { versions } = await this.getBackupVersions();
        if (versions && versions.length > 0) {
            this.currentVersion = versions[0].version;
            return this.currentVersion;
        }

        const result = await this.createBackupVersion(algorithm);
        return result.version;
    }

    clearCache(): void {
        this.versionCache.clear();
    }

    getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        return this.versionCache.getStats();
    }

    getRequestStats(): typeof this.requestStats {
        return { ...this.requestStats };
    }

    resetRequestStats(): void {
        this.requestStats = {
            total: 0,
            successful: 0,
            failed: 0,
            retried: 0,
        };
    }

    // ==================== 私有方法 ====================

    private async withRetry<T>(requestFn: () => Promise<T>, method: string, retries = this.maxRetries): Promise<T> {
        let lastError: unknown;
        const startTime = Date.now();

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const result = await requestFn();
                this.recordRequest(true, attempt > 0);

                if (attempt > 0) {
                    logger.info(`KeyBackupManager.${method} succeeded after ${attempt} retries`, {
                        method,
                        attempts: attempt + 1,
                        duration: Date.now() - startTime,
                    });
                }

                return result;
            } catch (error: unknown) {
                lastError = error;

                if (!this.isRetryableError(error)) {
                    this.recordRequest(false, false);
                    this.emitMetric("api_error", method, {
                        error: this.getErrorType(error),
                        attempt: attempt + 1,
                        retryable: false,
                    });
                    throw error;
                }

                if (attempt < retries) {
                    const delay = this.retryDelay * Math.pow(2, attempt);
                    logger.warn(
                        `KeyBackupManager.${method} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms`,
                        {
                            method,
                            attempt: attempt + 1,
                            maxAttempts: retries + 1,
                            delay,
                            error: this.getErrorType(error),
                        },
                    );

                    this.emitMetric("api_retry", method, {
                        attempt: attempt + 1,
                        delay,
                        error: this.getErrorType(error),
                    });

                    await this.sleep(delay);
                }
            }
        }

        this.recordRequest(false, true);
        const duration = Date.now() - startTime;
        this.emitMetric("api_failure", method, {
            attempts: retries + 1,
            duration,
            error: this.getErrorType(lastError),
        });

        throw lastError;
    }

    private recordRequest(success: boolean, retried: boolean): void {
        this.requestStats.total++;
        if (success) {
            this.requestStats.successful++;
        } else {
            this.requestStats.failed++;
        }
        if (retried) {
            this.requestStats.retried++;
        }
    }

    private isRetryableError(error: unknown): boolean {
        if (error instanceof MatrixError) {
            const retryableCodes = ["M_LIMIT_EXCEEDED", "M_SERVER_UNAVAILABLE"];
            const retryableStatus = [429, 500, 502, 503, 504];
            return retryableCodes.includes(error.errcode ?? "") || retryableStatus.includes(error.httpStatus ?? 0);
        }
        return false;
    }

    private normalizeError(error: unknown, method: string): SdkError {
        const err = error as Error;
        if (error instanceof MatrixError) {
            if (error.httpStatus === 401 || error.errcode === "M_UNKNOWN_TOKEN") {
                return new AuthError(`KeyBackupManager.${method} failed: ${err?.message ?? "Unknown error"}`, error);
            }
            if (error.httpStatus === 404 || error.errcode === "M_NOT_FOUND") {
                return new NotFoundError(
                    `KeyBackupManager.${method} failed: ${err?.message ?? "Unknown error"}`,
                    error,
                );
            }
            return new ApiError(
                `KeyBackupManager.${method} failed: ${err?.message ?? "Unknown error"}`,
                error.errcode ?? "UNKNOWN",
                error.httpStatus ?? 0,
                error,
            );
        }
        return new ApiError(`KeyBackupManager.${method} failed: ${err?.message ?? String(error)}`, "UNKNOWN", 0, error);
    }

    private getErrorType(error: unknown): string {
        if (error instanceof MatrixError) {
            return error.errcode ?? `http_${error.httpStatus}`;
        }
        if (error instanceof Error) {
            return error.name ?? "UnknownError";
        }
        return "UnknownError";
    }

    private emitMetric(type: string, method: string, data: Record<string, unknown>): void {
        try {
            logger.debug(`Metric: ${type}.${method}`, { type, method, ...data, timestamp: Date.now() });
        } catch {
            // 忽略监控发送错误，不影响主流程
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

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
