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
 * 遵循 D7 契约驱动开发标准，100% 覆盖后端端点并保持类型对齐。
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { ValidationError } from "../errors";
import { LRUCache } from "../utils/lru-cache";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import type { KeyBackupPathPattern } from "./__generated__/route-table";
import type { E2eePathPattern } from "../e2ee/__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type { Aes256AuthData } from "../crypto-api/keybackup";
import type { AESEncryptedSecretStoragePayload } from "../@types/AESEncryptedSecretStoragePayload";

/** Strip the v3 Matrix client prefix so bare call-site paths match the ledger. */
type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

/** Slice of `E2eePathPattern` limited to the `/keys/backup/secure` surface. */
type SecureBackupV3PathPattern = Extract<StripV3<E2eePathPattern>, `/keys/backup/secure${string}`>;

/** v3-scoped, prefix-stripped variant of `KeyBackupPathPattern`. */
type KeyBackupV3PathPattern = StripV3<KeyBackupPathPattern> | SecureBackupV3PathPattern;

/**
 * Compile-time bind from a manager call site to the generated
 * `KEY_BACKUP_ROUTES` ledger. Identity at runtime; a typo or a path that
 * does not exist in the ledger fails type-checking with `TS2345`.
 */
function kb<P extends KeyBackupV3PathPattern>(path: P): P {
    return path;
}

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
    session_data: EncryptedData | AESEncryptedSecretStoragePayload;
}

export interface BackupVersionInfo {
    version: string;
    algorithm: string;
    auth_data: AuthData | Aes256AuthData;
    count?: number;
    etag?: string;
}

export interface BackupVersion {
    version: string;
    algorithm: string;
    auth_data: AuthData | Aes256AuthData;
    count?: number;
    etag?: string;
}

export interface RoomSessions {
    sessions: Record<string, SessionData>;
}

export interface RoomKeyBackup {
    rooms: Record<string, RoomSessions>;
    etag?: string;
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
        session_data: EncryptedData | AESEncryptedSecretStoragePayload;
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
    auth_data: AuthData | Aes256AuthData;
    key_count: number;
    signatures?: Record<string, Record<string, string>>;
}

export interface PutRoomKeysBody {
    rooms: Record<string, RoomSessions>;
}

export interface PutRoomSessionsBody {
    sessions: Record<string, SessionData>;
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
    session_data: EncryptedData | AESEncryptedSecretStoragePayload;
}

export interface KeyBackupAuthData {
    type: string;
    session?: string;
    password?: string;
    token?: string;
    user?: string;
    [key: string]: unknown;
}

export class KeyBackupManager extends BaseManager {
    private currentVersion: string | null = null;
    private versionCache: LRUCache<BackupVersionInfo>;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
        this.versionCache = new LRUCache<BackupVersionInfo>({
            maxSize: 10,
            ttl: 5 * 60 * 1000,
            name: "key-backup-version-cache",
        });
    }

    // ==================== 版本管理 ====================

    /**
     * 获取最新备份版本
     * 对应 GET /room_keys/version
     */
    async getLatestBackupVersion(forceRefresh = false): Promise<BackupVersionInfo> {
        if (!forceRefresh) {
            const cached = this.versionCache.get("__latest__");
            if (cached) {
                return cached;
            }
        }

        try {
            const result = await this.withRetry(async () => {
                return await this.request<BackupVersionInfo>({
                    method: Method.Get,
                    path: kb("/room_keys/version"),
                    prefix: ClientPrefix.V3,
                });
            }, "getLatestBackupVersion");

            this.versionCache.set(result.version, result);
            this.versionCache.set("__latest__", result);

            return result;
        } catch (error) {
            throw this.normalizeError(error, "getLatestBackupVersion");
        }
    }

    /**
     * 获取所有备份版本信息 (兼容旧版)
     */
    async getBackupVersions(forceRefresh = false): Promise<{ versions: BackupVersionInfo[] }> {
        const latest = await this.getLatestBackupVersion(forceRefresh);
        return { versions: [latest] };
    }

    async createBackupVersion(
        algorithm: string = "m.megolm_backup.v1.curve25519-aes-sha2",
        authData?: AuthData | Aes256AuthData,
        auth?: KeyBackupAuthData,
    ): Promise<{ version: string }> {
        if (!algorithm || algorithm.trim().length === 0) {
            throw new ValidationError("Algorithm is required");
        }
        try {
            const result = await this.withRetry(async () => {
                return await this.request<{ version: string }>({
                    method: Method.Post,
                    path: kb("/room_keys/version"),
                    body: { algorithm, auth_data: authData, auth },
                    prefix: ClientPrefix.V3,
                });
            }, "createBackupVersion");

            this.currentVersion = result.version;
            return result;
        } catch (error) {
            throw this.normalizeError(error, "createBackupVersion");
        }
    }

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
                return await this.request<BackupVersionInfo>({
                    method: Method.Get,
                    path: kb(`/room_keys/version/${version}`),
                    prefix: ClientPrefix.V3,
                });
            }, "getBackupVersion");

            this.versionCache.set(version, result);
            return result;
        } catch (error) {
            throw this.normalizeError(error, "getBackupVersion");
        }
    }

    async updateBackupVersion(version: string, authData: AuthData | Aes256AuthData): Promise<{ version: string }> {
        try {
            const result = await this.withRetry(async () => {
                return await this.request<{ version: string }>({
                    method: Method.Put,
                    path: kb(`/room_keys/version/${version}`),
                    body: { auth_data: authData },
                    prefix: ClientPrefix.V3,
                });
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
                return await this.request<{ deleted: boolean; version: string }>({
                    method: Method.Delete,
                    path: kb(`/room_keys/version/${version}`),
                    prefix: ClientPrefix.V3,
                });
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

    async getAllRoomKeys(version: string): Promise<RoomKeyBackup> {
        try {
            return await this.withRetry(async () => {
                return await this.request<RoomKeyBackup>({
                    method: Method.Get,
                    path: kb("/room_keys/keys"),
                    queryParams: { version },
                    prefix: ClientPrefix.V3,
                });
            }, "getAllRoomKeys");
        } catch (error) {
            throw this.normalizeError(error, "getAllRoomKeys");
        }
    }

    async putAllRoomKeys(version: string, body: PutRoomKeysBody): Promise<UploadKeysResult> {
        try {
            return await this.withRetry(async () => {
                return await this.request<UploadKeysResult>({
                    method: Method.Put,
                    path: kb("/room_keys/keys"),
                    queryParams: { version },
                    body: body,
                    prefix: ClientPrefix.V3,
                });
            }, "putAllRoomKeys");
        } catch (error) {
            throw this.normalizeError(error, "putAllRoomKeys");
        }
    }

    async getRoomKeys(version: string, roomId: string): Promise<{ sessions: Record<string, SessionData> }> {
        try {
            return await this.withRetry(async () => {
                return await this.request<{ sessions: Record<string, SessionData> }>({
                    method: Method.Get,
                    path: kb(`/room_keys/keys/${encodeURIComponent(roomId)}`),
                    queryParams: { version },
                    prefix: ClientPrefix.V3,
                });
            }, "getRoomKeys");
        } catch (error) {
            throw this.normalizeError(error, "getRoomKeys");
        }
    }

    async putRoomKeys(version: string, roomId: string, body: PutRoomSessionsBody): Promise<UploadKeysResult> {
        try {
            return await this.withRetry(async () => {
                return await this.request<UploadKeysResult>({
                    method: Method.Put,
                    path: kb(`/room_keys/keys/${encodeURIComponent(roomId)}`),
                    queryParams: { version },
                    body: body,
                    prefix: ClientPrefix.V3,
                });
            }, "putRoomKeys");
        } catch (error) {
            throw this.normalizeError(error, "putRoomKeys");
        }
    }

    async deleteAllRoomKeys(version: string): Promise<UploadKeysResult> {
        try {
            return await this.withRetry(async () => {
                return await this.request<UploadKeysResult>({
                    method: Method.Delete,
                    path: kb("/room_keys/keys"),
                    queryParams: { version },
                    prefix: ClientPrefix.V3,
                });
            }, "deleteAllRoomKeys");
        } catch (error) {
            throw this.normalizeError(error, "deleteAllRoomKeys");
        }
    }

    async deleteRoomKeys(version: string, roomId: string): Promise<UploadKeysResult> {
        try {
            return await this.withRetry(async () => {
                return await this.request<UploadKeysResult>({
                    method: Method.Delete,
                    path: kb(`/room_keys/keys/${encodeURIComponent(roomId)}`),
                    queryParams: { version },
                    prefix: ClientPrefix.V3,
                });
            }, "deleteRoomKeys");
        } catch (error) {
            throw this.normalizeError(error, "deleteRoomKeys");
        }
    }

    async getSessionKey(
        version: string,
        roomId: string,
        sessionId: string,
    ): Promise<EncryptedData | AESEncryptedSecretStoragePayload> {
        try {
            return await this.withRetry(async () => {
                return await this.request<EncryptedData | AESEncryptedSecretStoragePayload>({
                    method: Method.Get,
                    path: kb(`/room_keys/keys/${encodeURIComponent(roomId)}/${encodeURIComponent(sessionId)}`),
                    queryParams: { version },
                    prefix: ClientPrefix.V3,
                });
            }, "getSessionKey");
        } catch (error) {
            throw this.normalizeError(error, "getSessionKey");
        }
    }

    async putSessionKey(
        version: string,
        roomId: string,
        sessionId: string,
        sessionData: SessionData,
    ): Promise<UploadKeysResult> {
        try {
            return await this.withRetry(async () => {
                return await this.request<UploadKeysResult>({
                    method: Method.Put,
                    path: kb(`/room_keys/keys/${encodeURIComponent(roomId)}/${encodeURIComponent(sessionId)}`),
                    queryParams: { version },
                    body: sessionData,
                    prefix: ClientPrefix.V3,
                });
            }, "putSessionKey");
        } catch (error) {
            throw this.normalizeError(error, "putSessionKey");
        }
    }

    async deleteSessionKey(version: string, roomId: string, sessionId: string): Promise<UploadKeysResult> {
        try {
            return await this.withRetry(async () => {
                return await this.request<UploadKeysResult>({
                    method: Method.Delete,
                    path: kb(`/room_keys/keys/${encodeURIComponent(roomId)}/${encodeURIComponent(sessionId)}`),
                    queryParams: { version },
                    prefix: ClientPrefix.V3,
                });
            }, "deleteSessionKey");
        } catch (error) {
            throw this.normalizeError(error, "deleteSessionKey");
        }
    }

    // ==================== 恢复与校验 ====================

    async recoverKeys(version: string, rooms?: string[]): Promise<RecoverKeysResult> {
        try {
            return await this.withRetry(async () => {
                return await this.request<RecoverKeysResult>({
                    method: Method.Post,
                    path: kb("/room_keys/recover"),
                    body: { version, rooms },
                    prefix: ClientPrefix.V3,
                });
            }, "recoverKeys");
        } catch (error) {
            throw this.normalizeError(error, "recoverKeys");
        }
    }

    async getRecoveryProgress(version: string): Promise<RecoveryProgress> {
        try {
            return await this.withRetry(async () => {
                return await this.request<RecoveryProgress>({
                    method: Method.Get,
                    path: kb(`/room_keys/recovery/${version}/progress`),
                    prefix: ClientPrefix.V3,
                });
            }, "getRecoveryProgress");
        } catch (error) {
            throw this.normalizeError(error, "getRecoveryProgress");
        }
    }

    async verifyBackup(version: string): Promise<VerifyResult> {
        try {
            return await this.withRetry(async () => {
                return await this.request<VerifyResult>({
                    method: Method.Get,
                    path: kb(`/room_keys/verify/${version}`),
                    prefix: ClientPrefix.V3,
                });
            }, "verifyBackup");
        } catch (error) {
            throw this.normalizeError(error, "verifyBackup");
        }
    }

    async batchRecover(version: string, roomIds: string[], sessionLimit?: number): Promise<BatchRecoverResult> {
        try {
            return await this.withRetry(async () => {
                return await this.request<BatchRecoverResult>({
                    method: Method.Post,
                    path: kb("/room_keys/batch_recover"),
                    body: { version, room_ids: roomIds, session_limit: sessionLimit },
                    prefix: ClientPrefix.V3,
                });
            }, "batchRecover");
        } catch (error) {
            throw this.normalizeError(error, "batchRecover");
        }
    }

    async recoverRoomKeys(version: string, roomId: string): Promise<RecoverRoomKeysResult> {
        try {
            return await this.withRetry(async () => {
                return await this.request<RecoverRoomKeysResult>({
                    method: Method.Get,
                    path: kb(`/room_keys/recover/${version}/${encodeURIComponent(roomId)}`),
                    prefix: ClientPrefix.V3,
                });
            }, "recoverRoomKeys");
        } catch (error) {
            throw this.normalizeError(error, "recoverRoomKeys");
        }
    }

    async recoverSessionKey(version: string, roomId: string, sessionId: string): Promise<RecoverSessionKeyResult> {
        try {
            return await this.withRetry(async () => {
                return await this.request<RecoverSessionKeyResult>({
                    method: Method.Get,
                    path: kb(
                        `/room_keys/recover/${version}/${encodeURIComponent(roomId)}/${encodeURIComponent(sessionId)}`,
                    ),
                    prefix: ClientPrefix.V3,
                });
            }, "recoverSessionKey");
        } catch (error) {
            throw this.normalizeError(error, "recoverSessionKey");
        }
    }

    // ==================== 导出与导入 ====================

    async exportKeys(version?: string): Promise<ExportResult> {
        const path = version ? kb(`/room_keys/export/${version}`) : kb("/room_keys/export");
        try {
            return await this.withRetry(async () => {
                return await this.request<ExportResult>({
                    method: Method.Get,
                    path: path,
                    prefix: ClientPrefix.V3,
                });
            }, "exportKeys");
        } catch (error) {
            throw this.normalizeError(error, "exportKeys");
        }
    }

    async importKeys(roomKeys: ExportResult["room_keys"], version?: string): Promise<ImportResult> {
        const path = version ? kb(`/room_keys/import/${version}`) : kb("/room_keys/import");
        try {
            return await this.withRetry(async () => {
                return await this.request<ImportResult>({
                    method: Method.Post,
                    path: path,
                    body: { room_keys: roomKeys, version },
                    prefix: ClientPrefix.V3,
                });
            }, "importKeys");
        } catch (error) {
            throw this.normalizeError(error, "importKeys");
        }
    }

    // ==================== 辅助方法 ====================

    getCurrentVersion(): string | null {
        return this.currentVersion;
    }

    setCurrentVersion(version: string | null): void {
        this.currentVersion = version;
    }

    async ensureBackupVersion(_algorithm: string = "m.megolm.v1.aes-sha2"): Promise<string> {
        if (this.currentVersion) {
            return this.currentVersion;
        }

        const latest = await this.getLatestBackupVersion();
        this.currentVersion = latest.version;
        return this.currentVersion;
    }

    clearCache(): void {
        this.versionCache.clear();
    }

    getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        return this.versionCache.getStats();
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getKeyBackupManager = function (): KeyBackupManager {
        registerManagerClass("keyBackup", KeyBackupManager);
        return getOrCreateManager(this, "keyBackup", () => new KeyBackupManager(this));
    };
}

export default extendMatrixClient;
