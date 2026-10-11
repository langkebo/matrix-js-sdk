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
import { NotFoundError, ValidationError } from "../errors";
import { LRUCache } from "../utils/lru-cache";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import type { KeyBackupPath } from "./__generated__/route-table";
import type { E2eePath } from "../e2ee/__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type { Aes256AuthData } from "../crypto-api/keybackup";
import type { AESEncryptedSecretStoragePayload } from "../@types/AESEncryptedSecretStoragePayload";
import type { PathAssert, StripV3 } from "../http-api/strip-prefix";

/** Strip the v3 Matrix client prefix so bare call-site paths match the ledger. */

/** Slice of `E2eePath` limited to the `/keys/backup/secure` surface. */
type SecureBackupV3Path = Extract<StripV3<E2eePath>, `/keys/backup/secure${string}`>;

/** v3-scoped, prefix-stripped variant of `KeyBackupPath`. */
type KeyBackupV3Path = StripV3<KeyBackupPath> | SecureBackupV3Path;

/**
 * Compile-time bind from a manager call site to the generated
 * `KEY_BACKUP_ROUTES` ledger. Identity at runtime; a typo or a path that
 * does not exist in the ledger fails type-checking with `TS2345`.
 */
function kb<const P extends string>(path: P & PathAssert<P, KeyBackupV3Path>): P {
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
     *
     * @param forceRefresh - 为 `true` 时跳过本地缓存，强制向服务器请求
     * @returns 服务器上最新的备份版本信息
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * const info = await mgr.getLatestBackupVersion(true);
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
     * 检查是否存在密钥备份（兼容方法）
     *
     * 这是 {@link getLatestBackupVersion} 的兼容别名，对齐标准 SDK 的
     * `CryptoApi.checkKeyBackupAndEnable` 命名风格。当服务器不存在备份版本
     * （HTTP 404 / M_NOT_FOUND）时返回 `null`，而非抛出错误，便于调用方
     * 用 `if (info)` 的方式判断是否已启用备份。
     *
     * 注意：与 `RustBackupManager.checkKeyBackupAndEnable` 不同，本方法仅做
     * 只读检查，不会自动启用备份。
     *
     * 对应 GET /room_keys/version
     *
     * @param forceRefresh - 为 `true` 时跳过本地缓存，强制向服务器请求
     * @returns 备份版本信息；服务器尚无备份（HTTP 404 / M_NOT_FOUND）时返回 `null`
     * @throws {SdkError} 当请求失败且非 404 时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * const info = await mgr.checkKeyBackup();
     * if (info) {
     *     console.log("Backup enabled:", info.version);
     * }
     */
    async checkKeyBackup(forceRefresh = false): Promise<BackupVersionInfo | null> {
        try {
            return await this.getLatestBackupVersion(forceRefresh);
            // 404 / M_NOT_FOUND 表示尚无备份版本，是预期情况，返回 null
            // @swallow-error { owner: "key-backup", expires: "2026-12-31" }
        } catch (error) {
            if (error instanceof NotFoundError) {
                return null;
            }
            // 兜底：处理未被 normalizeError 转换的原始 HTTPError
            const httpStatus = (error as { httpStatus?: number })?.httpStatus;
            if (httpStatus === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * 获取所有备份版本信息 (兼容旧版)
     *
     * @param forceRefresh - 为 `true` 时跳过本地缓存，强制向服务器请求
     * @returns 以 `versions` 数组包装的备份版本列表（当前实现仅包含最新版本）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * const { versions } = await mgr.getBackupVersions();
     */
    async getBackupVersions(forceRefresh = false): Promise<{ versions: BackupVersionInfo[] }> {
        const latest = await this.getLatestBackupVersion(forceRefresh);
        return { versions: [latest] };
    }

    /**
     * 创建新的密钥备份版本
     * 对应 POST /room_keys/version
     *
     * @param algorithm - 备份算法，默认 `m.megolm_backup.v1.curve25519-aes-sha2`
     * @param authData - 可选的认证数据
     * @returns 新建备份的版本号
     * @throws {ValidationError} 当算法为空时抛出
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * const { version } = await mgr.createBackupVersion();
     */
    async createBackupVersion(
        algorithm: string = "m.megolm_backup.v1.curve25519-aes-sha2",
        authData?: AuthData | Aes256AuthData,
    ): Promise<{ version: string }> {
        if (!algorithm || algorithm.trim().length === 0) {
            throw new ValidationError("Algorithm is required");
        }
        try {
            const result = await this.withRetry(async () => {
                return await this.request<{ version: string }>({
                    method: Method.Post,
                    path: kb("/room_keys/version"),
                    body: { algorithm, auth_data: authData },
                    prefix: ClientPrefix.V3,
                });
            }, "createBackupVersion");

            this.currentVersion = result.version;
            return result;
        } catch (error) {
            throw this.normalizeError(error, "createBackupVersion");
        }
    }

    /**
     * 按版本号获取备份版本信息
     * 对应 GET /room_keys/version/{version}
     *
     * @param version - 备份版本号
     * @param forceRefresh - 为 `true` 时跳过本地缓存，强制向服务器请求
     * @returns 指定版本的备份信息
     * @throws {ValidationError} 当版本号为空时抛出
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * const info = await mgr.getBackupVersion("1");
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

    /**
     * 更新指定备份版本的认证数据
     * 对应 PUT /room_keys/version/{version}
     *
     * @param version - 备份版本号
     * @param authData - 新的认证数据
     * @returns 更新后的备份版本号
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * await mgr.updateBackupVersion("1", { public_key: "..." });
     */
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

    /**
     * 删除指定备份版本
     * 对应 DELETE /room_keys/version/{version}
     *
     * @param version - 备份版本号
     * @returns 删除结果，含 `deleted` 标志与版本号
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * await mgr.deleteBackupVersion("1");
     */
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

    /**
     * 获取指定版本下的全部房间密钥
     * 对应 GET /room_keys/keys?version={version}
     *
     * @param version - 备份版本号
     * @returns 包含全部房间会话密钥的备份数据
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * const keys = await mgr.getAllRoomKeys("1");
     */
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

    /**
     * 上传指定版本下的全部房间密钥
     * 对应 PUT /room_keys/keys?version={version}
     *
     * @param version - 备份版本号
     * @param body - 待上传的房间密钥数据
     * @returns 上传结果，含密钥数量与 etag
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * await mgr.putAllRoomKeys("1", { rooms: {} });
     */
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

    /**
     * 获取指定房间在备份中的会话密钥
     * 对应 GET /room_keys/keys/{roomId}?version={version}
     *
     * @param version - 备份版本号
     * @param roomId - 房间 ID
     * @returns 该房间的会话密钥集合
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * const { sessions } = await mgr.getRoomKeys("1", "!room:example.com");
     */
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

    /**
     * 上传指定房间的会话密钥到备份
     * 对应 PUT /room_keys/keys/{roomId}?version={version}
     *
     * @param version - 备份版本号
     * @param roomId - 房间 ID
     * @param body - 该房间的会话密钥数据
     * @returns 上传结果，含密钥数量与 etag
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * await mgr.putRoomKeys("1", "!room:example.com", { sessions: {} });
     */
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

    /**
     * 删除指定版本下的全部房间密钥
     * 对应 DELETE /room_keys/keys?version={version}
     *
     * @param version - 备份版本号
     * @returns 删除结果，含密钥数量与 etag
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * await mgr.deleteAllRoomKeys("1");
     */
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

    /**
     * 删除指定房间在备份中的密钥
     * 对应 DELETE /room_keys/keys/{roomId}?version={version}
     *
     * @param version - 备份版本号
     * @param roomId - 房间 ID
     * @returns 删除结果，含密钥数量与 etag
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * await mgr.deleteRoomKeys("1", "!room:example.com");
     */
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

    /**
     * 获取指定会话的密钥
     * 对应 GET /room_keys/keys/{roomId}/{sessionId}?version={version}
     *
     * @param version - 备份版本号
     * @param roomId - 房间 ID
     * @param sessionId - 会话 ID
     * @returns 会话密钥的加密数据
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * const session = await mgr.getSessionKey("1", "!room:example.com", "session-id");
     */
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

    /**
     * 上传指定会话的密钥到备份
     * 对应 PUT /room_keys/keys/{roomId}/{sessionId}?version={version}
     *
     * @param version - 备份版本号
     * @param roomId - 房间 ID
     * @param sessionId - 会话 ID
     * @param sessionData - 会话密钥数据
     * @returns 上传结果，含密钥数量与 etag
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * await mgr.putSessionKey("1", "!room:example.com", "session-id", {
     *     first_message_index: 0,
     *     forwarded_count: 0,
     *     is_verified: false,
     *     session_data: { ciphertext: "", ephemeral: "", mac: "" },
     * });
     */
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

    /**
     * 删除指定会话的备份密钥
     * 对应 DELETE /room_keys/keys/{roomId}/{sessionId}?version={version}
     *
     * @param version - 备份版本号
     * @param roomId - 房间 ID
     * @param sessionId - 会话 ID
     * @returns 删除结果，含密钥数量与 etag
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * await mgr.deleteSessionKey("1", "!room:example.com", "session-id");
     */
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

    /**
     * 从备份中恢复密钥
     * 对应 POST /room_keys/recover
     *
     * @param version - 备份版本号
     * @param rooms - 可选，限定要恢复的房间 ID 列表
     * @returns 恢复结果，含已恢复的房间、总密钥数与已恢复密钥数
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * await mgr.recoverKeys("1", ["!room:example.com"]);
     */
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

    /**
     * 获取指定版本的密钥恢复进度
     * 对应 GET /room_keys/recovery/{version}/progress
     *
     * @param version - 备份版本号
     * @returns 恢复进度信息
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * const progress = await mgr.getRecoveryProgress("1");
     */
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

    /**
     * 校验指定版本备份的完整性
     * 对应 GET /room_keys/verify/{version}
     *
     * @param version - 备份版本号
     * @returns 校验结果，含是否有效、算法与密钥数量
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * const result = await mgr.verifyBackup("1");
     */
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

    /**
     * 批量恢复多个房间的密钥
     * 对应 POST /room_keys/batch_recover
     *
     * @param version - 备份版本号
     * @param roomIds - 待恢复的房间 ID 列表
     * @param sessionLimit - 可选，单批返回的最大会话数
     * @returns 批量恢复结果，含房间密钥、总会话数与分页信息
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * await mgr.batchRecover("1", ["!room:example.com"], 100);
     */
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

    /**
     * 恢复指定房间的密钥
     * 对应 GET /room_keys/recover/{version}/{roomId}
     *
     * @param version - 备份版本号
     * @param roomId - 房间 ID
     * @returns 该房间恢复出的会话密钥列表
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * await mgr.recoverRoomKeys("1", "!room:example.com");
     */
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

    /**
     * 恢复指定会话的密钥
     * 对应 GET /room_keys/recover/{version}/{roomId}/{sessionId}
     *
     * @param version - 备份版本号
     * @param roomId - 房间 ID
     * @param sessionId - 会话 ID
     * @returns 该会话恢复出的密钥数据
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * await mgr.recoverSessionKey("1", "!room:example.com", "session-id");
     */
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

    /**
     * 导出备份密钥
     * 对应 GET /room_keys/export[/{version}]
     *
     * @param version - 可选，指定要导出的备份版本；省略时导出默认版本
     * @returns 导出的房间密钥集合
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * const exported = await mgr.exportKeys("1");
     */
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

    /**
     * 导入备份密钥
     * 对应 POST /room_keys/import[/{version}]
     *
     * @param roomKeys - 待导入的房间密钥列表
     * @param version - 可选，指定导入到的备份版本
     * @returns 导入结果，含成功数、失败数与总数
     * @throws {SdkError} 当请求失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * const exported = await mgr.exportKeys();
     * await mgr.importKeys(exported.room_keys, "1");
     */
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

    /**
     * 获取当前缓存的备份版本号
     *
     * @returns 当前版本号；尚未设置时返回 `null`
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * const version = mgr.getCurrentVersion();
     */
    getCurrentVersion(): string | null {
        return this.currentVersion;
    }

    /**
     * 设置当前备份版本号
     *
     * @param version - 版本号；传 `null` 表示清空
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * mgr.setCurrentVersion("1");
     */
    setCurrentVersion(version: string | null): void {
        this.currentVersion = version;
    }

    /**
     * 确保存在可用的备份版本，返回其版本号
     *
     * 若已缓存当前版本则直接返回；否则拉取最新版本并缓存。
     * @param _algorithm - 备份算法（当前实现未使用，保留以兼容签名）
     * @returns 可用的备份版本号
     * @throws {SdkError} 当拉取最新版本失败时抛出（经 `normalizeError` 归一化）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * const version = await mgr.ensureBackupVersion();
     */
    async ensureBackupVersion(_algorithm: string = "m.megolm.v1.aes-sha2"): Promise<string> {
        if (this.currentVersion) {
            return this.currentVersion;
        }

        const latest = await this.getLatestBackupVersion();
        this.currentVersion = latest.version;
        return this.currentVersion;
    }

    /**
     * 清空版本信息缓存
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * mgr.clearCache();
     */
    clearCache(): void {
        this.versionCache.clear();
    }

    /**
     * 获取版本信息缓存的统计信息
     *
     * @returns 缓存大小、命中数、未命中数与命中率
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getKeyBackupManager();
     * const stats = mgr.getCacheStats();
     */
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
