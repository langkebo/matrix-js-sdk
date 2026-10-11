/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.

    http://www.apache.org/licenses/LICENSE-2.0
*/

import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { InvalidParamError } from "../common/errors";
import { ValidationError } from "../errors";
import type { E2eePath } from "./__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type {
    UploadKeysOptions,
    UploadKeysResponse,
    QueryKeysRequest,
    QueryKeysResponse,
    ClaimKeysRequest,
    ClaimKeysResponse,
    KeyChangesResponse,
    DeviceListUpdateEntry,
    DeviceListDeletedEntry,
    RoomKeyRequestsResponse,
} from "../device-keys/index";
import type { UploadDeviceSigningRequest } from "./__generated__/dto";
import type { IContent } from "../models/event";
import type { PathAssert, StripV3 } from "../http-api/strip-prefix";

function ep<const P extends string>(path: P & PathAssert<P, StripV3<E2eePath>>): P {
    return path;
}

/**
 * E2EEManager — 端到端加密原始端点的薄封装。
 *
 * 对接后端 `synapse-rust/src/web/routes/e2ee_routes.rs`（25 个路由）：
 * 兼容子路由（同时挂在 `/_matrix/client/{r0,v1,v3}`）：
 *   - POST   /keys/upload
 *   - POST   /keys/query
 *   - POST   /keys/claim
 *   - GET    /keys/changes
 *   - POST   /keys/device_list/update
 *   - POST   /keys/signatures/upload
 *   - POST   /keys/device_signing/upload
 *   - GET/POST /room_keys/request
 *   - DELETE /room_keys/request/{request_id}
 *   - GET    /rooms/{room_id}/keys/distribution
 *   - PUT    /sendToDevice/{event_type}/{transaction_id}
 *
 * 仅 v3 暴露：
 *   - POST   /keys/backup/secure
 *   - GET/DELETE /keys/backup/secure/{backup_id}
 *   - POST   /keys/backup/secure/{backup_id}/keys
 *   - POST   /keys/backup/secure/{backup_id}/restore
 *   - POST   /keys/backup/secure/{backup_id}/verify
 *
 * ## vodozemac 后端对齐（synapse-rust C-5，2026-06）
 *
 * 后端 Megolm 已收敛到 vodozemac（Phase 1 MegolmProvider ◆ Phase 2 双写
 * PickleFormat::Dual ◆ Phase 3 互操作测试进行中）。
 *
 * SDK 通过 `@matrix-org/matrix-sdk-crypto-wasm`（基于同一 vodozemac 库）
 * 管理客户端 Megolm session。重要兼容性说明：
 *
 * - **session import/export**: SDK 使用 WASM `importRoomKeys()`/`exportRoomKeys()`
 *   导出 Megolm session。后端 vodozemac 格式与此兼容（同一 pickle 格式）。
 *
 * - **m.room_key to-device 事件**: 消息格式由 Matrix 协议规范定义，vodozemac
 *   不改变线格式。
 *
 * - **key backup**: 后端 v10 使用 vodozemac 格式存储备份密钥。
 *   SDK 的 `backup.ts` 通过 WASM `BackupDecryptor` 解密，格式兼容。
 *
 * - **配置**: 后端 `E2EE_USE_VODOZEMAC_MEGOLM` 环境变量控制服务器端路径选择。
 *   SDK 客户端始终使用 vodozemac（WASM），无需额外配置。
 *
 * @remarks
 * 对绝大多数应用：使用 `MatrixClient.initRustCrypto()` 提供的高层 API，
 * 而不是直接调用此 Manager。本 Manager 只为需要绕过 Rust crypto 直接驱动
 * 后端 E2EE 端点的高级集成（管理工具、迁移脚本、契约测试）准备。
 */

export interface KeyAuditEntry {
    id: string;
    created_ts: number;
    [key: string]: unknown;
}

export interface KeyHistoryResponse {
    history: KeyAuditEntry[];
    next_batch: string | null;
}

export interface SecureBackupInfo {
    backup_id: string;
    algorithm: string;
    /** Algorithm-specific auth data (shape varies by backup algorithm) */
    auth_data: IContent;
    version: string;
    count?: number;
    etag?: string;
}

export interface SecureBackupCreateResponse extends SecureBackupInfo {}

export interface SecureBackupKeysResponse {
    count: number;
}

export interface SecureBackupRestoreResponse {
    /** Total number of keys stored in the backup. */
    total_keys: number;
    /** Encrypted session keys returned by the backend (filtered by `rooms` when supplied). */
    sessions: Array<{ room_id: string; session_id: string; session_key: string }>;
}

export interface SecureBackupVerifyResponse {
    valid: boolean;
}

export interface RoomKeyRequestBody {
    room_id: string;
    session_id: string;
    algorithm: string;
    /** Additional key request data (varies by algorithm) */
    body?: IContent;
}

export interface RoomKeyDistributionResponse {
    room_id: string;
    sessions: Array<{
        session_id: string;
        algorithm: string;
        sender_key?: string;
    }>;
}

export interface SignaturesUploadResponse {
    failures?: Record<string, Record<string, string>>;
}

/**
 * Request body for creating a secure backup.
 *
 * The backend removed passphrase mode: callers must derive the backup key
 * client-side and supply the algorithm plus the corresponding `auth_data`.
 */
export interface SecurityBackupCreateBody {
    algorithm: string;
    /** Algorithm-specific auth data (shape varies by backup algorithm) */
    auth_data: IContent;
}

export interface StoreSecureBackupKeysBody {
    session_keys?: Array<{ session_id: string; session_data: IContent }>;
}

export interface RestoreSecureBackupBody {
    rooms?: string[];
}

export interface VerifySecureBackupPassphraseBody {
    passphrase: string;
}

/** Messages for send-to-device: user_id → device_id → event content // Dynamic: content shape varies by event type */
export type SendToDeviceMessages = Record<string, Record<string, IContent>>;

export interface DeviceSigningUploadResponse {
    failures?: Record<string, Record<string, string>>;
}

export interface SendToDeviceResponse {
    failures?: Record<string, Record<string, string>>;
}

export type SendToDeviceVersion = "v1" | "v3";

export class E2EEManager extends BaseManager {
    public constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    // -------- compat (r0/v1/v3) ----------

    /**
     * 上传本设备的端到端加密密钥（设备密钥、一次性密钥、回退密钥）。
     * POST /keys/upload
     *
     * @param body - 待上传的密钥集合，见 `UploadKeysOptions`
     * @returns 上传结果，包含各类一次性密钥的剩余数量 `one_time_key_counts`
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getE2EEManager();
     * const result = await mgr.uploadKeys({ oneTimeKeys: { "curve25519:AAAA": { key: "..." } } });
     * console.log(result.one_time_key_counts);
     */
    public async uploadKeys(body: UploadKeysOptions): Promise<UploadKeysResponse> {
        return this.post(ep("/keys/upload"), body, "uploadKeys");
    }

    /**
     * Upload keys for a specific device via path parameter.
     * POST /_matrix/client/v3/keys/upload/{device_id}
     *
     * Same handler as `uploadKeys` but the device_id is taken from the URL
     * instead of the authenticated session.
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getE2EEManager();
     * await mgr.uploadKeysToDevice("DEVICEID", { oneTimeKeys: { "curve25519:AAAA": { key: "..." } } });
     */
    public async uploadKeysToDevice(deviceId: string, body: UploadKeysOptions): Promise<UploadKeysResponse> {
        this.requireNonEmptyString(deviceId, "deviceId");
        return this.post(ep(`/keys/upload/${encodeURIComponent(deviceId)}`), body, "uploadKeysToDevice");
    }

    /**
     * 查询指定用户的设备密钥与交叉签名密钥。
     * POST /keys/query
     *
     * @param body - 查询条件，`device_keys` 以 userId 映射到需要查询的 deviceId 列表
     * @returns 匹配的设备密钥、交叉签名密钥及失败信息
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getE2EEManager();
     * const keys = await mgr.queryKeys({ device_keys: { "@alice:example.org": [] } });
     * console.log(keys.device_keys?.["@alice:example.org"]);
     */
    public async queryKeys(body: QueryKeysRequest): Promise<QueryKeysResponse> {
        return this.post(ep("/keys/query"), body, "queryKeys");
    }

    /**
     * 为指定设备认领一次性密钥。
     * POST /keys/claim
     *
     * @param body - 认领条件，`one_time_keys` 以 userId → deviceId → 算法 映射
     * @returns 认领到的一次性密钥及失败信息
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getE2EEManager();
     * const claimed = await mgr.claimKeys({
     *     one_time_keys: { "@alice:example.org": { DEVICEID: "signed_curve25519" } },
     * });
     * console.log(claimed.one_time_keys);
     */
    public async claimKeys(body: ClaimKeysRequest): Promise<ClaimKeysResponse> {
        return this.post(ep("/keys/claim"), body, "claimKeys");
    }

    /**
     * 获取自某个同步令牌以来设备密钥发生变化的用户列表。
     * GET /keys/changes
     *
     * @param params - 分页参数；`from` 为起始令牌，`to` 为结束令牌（默认取当前同步位置）
     * @returns 设备密钥发生变化或已离开的用户 ID 列表
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getE2EEManager();
     * const changes = await mgr.getKeyChanges({ from: "s72595_4483_1934" });
     * console.log(changes.changed);
     */
    public async getKeyChanges(params: { from?: string; to?: string } = {}): Promise<KeyChangesResponse> {
        return await this.withRetry(async () => {
            return await this.request<KeyChangesResponse>({
                method: Method.Get,
                path: ep("/keys/changes"),
                queryParams: params,
                prefix: ClientPrefix.V3,
            });
        }, "getKeyChanges");
    }

    /**
     * 提交设备列表变更（内部端点，用于设备列表同步）。
     * POST /keys/device_list/update
     *
     * @param body - 设备更新与删除条目组成的数组
     * @returns 无返回值
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getE2EEManager();
     * await mgr.postDeviceListUpdate([{ user_id: "@alice:example.org", device_id: "DEVICEID" }]);
     */
    public async postDeviceListUpdate(body: Array<DeviceListUpdateEntry | DeviceListDeletedEntry>): Promise<void> {
        return this.postVoid(ep("/keys/device_list/update"), body, "postDeviceListUpdate");
    }

    /**
     * Upload device signing (cross-signing) keys.
     *
     * Adds client-side validation before sending to the backend:
     * - At least one of `master_key`, `self_signing_key`, `user_signing_key` must be provided
     * - `usage` field (if present) must be a valid array of strings
     * - `user_id` in key objects must match the current authenticated user
     *
     * @param body - The request body containing cross-signing keys to upload
     * @returns The response from the server (empty object on success)
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getE2EEManager();
     * await mgr.uploadDeviceSigning({
     *     master_key: { user_id: "@alice:example.org", usage: ["master"], keys: { "ed25519:abc": "..." } },
     * });
     *
     * @throws {ValidationError} If validation fails before sending the request
     * @throws {ApiError} If the API call fails
     */
    public async uploadDeviceSigning(body: UploadDeviceSigningRequest): Promise<DeviceSigningUploadResponse> {
        // Validate: at least one key must be provided
        const keyFields: Array<keyof UploadDeviceSigningRequest> = [
            "master_key",
            "self_signing_key",
            "user_signing_key",
        ];
        const hasAnyKey = keyFields.some((field) => {
            const key = body[field];
            return key && typeof key === "object" && Object.keys(key).length > 0;
        });

        if (!hasAnyKey) {
            throw new ValidationError("At least one of master_key, self_signing_key, or user_signing_key is required");
        }

        // Validate each provided key
        const currentUser = this.client.getUserId();
        for (const field of keyFields) {
            const key = body[field];
            if (!key || typeof key !== "object") continue;

            // Validate usage field if present
            const usage = (key as { usage?: unknown }).usage;
            if (usage !== undefined && !Array.isArray(usage)) {
                throw new ValidationError(`Invalid usage field in ${field}: must be an array of strings`);
            }

            // Validate user_id matches current user
            const keyUserId = (key as { user_id?: string }).user_id;
            if (keyUserId !== undefined && keyUserId !== currentUser) {
                throw new ValidationError(
                    `user_id in ${field} (${keyUserId}) does not match authenticated user (${currentUser})`,
                );
            }
        }

        return this.post(ep("/keys/device_signing/upload"), body, "uploadDeviceSigning");
    }

    /**
     * 创建房间密钥请求。**后端只返回 `{ request_id }`**（`e2ee/keys.rs::create_room_key_request`），
     * 此前 SDK 声明 5 个字段 ⇒ 其中 4 个恒为 undefined。
     *
     * @example
     * ```typescript
     * const { request_id } = await client.getE2EEManager().createRoomKeyRequest({
     *     room_id: "!room:example.org",
     *     session_id: "session-1",
     *     algorithm: "m.megolm.v1.aes-sha2",
     * });
     * ```
     */
    public async createRoomKeyRequest(body: RoomKeyRequestBody): Promise<{ request_id: string }> {
        return this.post(ep("/room_keys/request"), body, "createRoomKeyRequest");
    }

    /**
     * 列出当前用户的房间密钥请求。
     * GET /room_keys/request
     *
     * @returns 房间密钥请求列表
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getE2EEManager();
     * const { requests } = await mgr.listRoomKeyRequests();
     * console.log(requests.length);
     */
    public async listRoomKeyRequests(): Promise<RoomKeyRequestsResponse> {
        return await this.withRetry(async () => {
            return await this.request<RoomKeyRequestsResponse>({
                method: Method.Get,
                path: ep("/room_keys/request"),
                prefix: ClientPrefix.V3,
            });
        }, "listRoomKeyRequests");
    }

    /**
     * 删除指定的房间密钥请求。
     * DELETE /room_keys/request/{request_id}
     *
     * @param requestId - 待删除的请求 ID
     * @returns 无返回值
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getE2EEManager();
     * await mgr.deleteRoomKeyRequest("request-1");
     */
    public async deleteRoomKeyRequest(requestId: string): Promise<void> {
        this.requireNonEmptyString(requestId, "requestId");
        return await this.withRetry(async () => {
            await this.request({
                method: Method.Delete,
                path: ep(`/room_keys/request/${encodeURIComponent(requestId)}`),
                prefix: ClientPrefix.V3,
            });
        }, "deleteRoomKeyRequest");
    }

    /**
     * 获取某个房间的密钥分发情况。
     * GET /rooms/{room_id}/keys/distribution
     *
     * @param roomId - 目标房间 ID
     * @returns 该房间内各 Megolm session 的分发信息
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getE2EEManager();
     * const dist = await mgr.getRoomKeyDistribution("!room:example.org");
     * console.log(dist.sessions);
     */
    public async getRoomKeyDistribution(roomId: string): Promise<RoomKeyDistributionResponse> {
        this.requireNonEmptyString(roomId, "roomId");
        return await this.withRetry(async () => {
            return await this.request<RoomKeyDistributionResponse>({
                method: Method.Get,
                path: ep(`/rooms/${encodeURIComponent(roomId)}/keys/distribution`),
                prefix: ClientPrefix.V3,
            });
        }, "getRoomKeyDistribution");
    }

    /**
     * 通过 to-device 消息向指定设备发送事件。
     * PUT /sendToDevice/{event_type}/{transaction_id}
     *
     * @param eventType - to-device 事件类型（如 `m.room_key`）
     * @param transactionId - 幂等事务 ID
     * @param messages - userId → deviceId → 事件内容的映射
     * @param version - API 版本，`"v3"`（默认）或 `"v1"`
     * @returns 发送失败信息（成功时为空对象）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getE2EEManager();
     * await mgr.sendToDevice("m.room_key", "txn-1", {
     *     "@alice:example.org": { DEVICEID: { algorithm: "m.megolm.v1.aes-sha2" } },
     * });
     */
    public async sendToDevice(
        eventType: string,
        transactionId: string,
        messages: SendToDeviceMessages,
        version: SendToDeviceVersion = "v3",
    ): Promise<SendToDeviceResponse> {
        this.requireNonEmptyString(eventType, "eventType");
        this.requireNonEmptyString(transactionId, "transactionId");
        const prefixMap: Record<SendToDeviceVersion, ClientPrefix> = {
            v1: ClientPrefix.V1,
            v3: ClientPrefix.V3,
        };
        return await this.withRetry(async () => {
            return await this.request<SendToDeviceResponse>({
                method: Method.Put,
                path: `/sendToDevice/${encodeURIComponent(eventType)}/${encodeURIComponent(transactionId)}`,
                body: { messages },
                prefix: prefixMap[version],
            });
        }, "sendToDevice");
    }

    /**
     * 使用 v1 前缀发送 to-device 消息（`sendToDevice` 的便捷封装）。
     * PUT /sendToDevice/{event_type}/{transaction_id}（v1 前缀）
     *
     * @param eventType - to-device 事件类型
     * @param transactionId - 幂等事务 ID
     * @param messages - userId → deviceId → 事件内容的映射
     * @returns 发送失败信息（成功时为空对象）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getE2EEManager();
     * await mgr.sendToDeviceV1("m.room_key", "txn-1", {
     *     "@alice:example.org": { DEVICEID: { algorithm: "m.megolm.v1.aes-sha2" } },
     * });
     */
    public async sendToDeviceV1(
        eventType: string,
        transactionId: string,
        messages: SendToDeviceMessages,
    ): Promise<SendToDeviceResponse> {
        return this.sendToDevice(eventType, transactionId, messages, "v1");
    }

    // -------- v3-only ----------

    /**
     * 创建一个新的安全备份（secure backup）。
     * POST /keys/backup/secure
     *
     * 后端已移除 passphrase 模式：调用方须在客户端派生备份密钥，并同时提供
     * 算法标识与对应的 `auth_data`。
     *
     * @param body - 备份创建参数，必须同时包含 `algorithm` 与 `auth_data`
     * @returns 新建备份的信息
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getE2EEManager();
     * const backup = await mgr.createSecureBackup({
     *     algorithm: "m.megolm_backup.v1.curve25519-aes-sha2",
     *     auth_data: { public_key: "..." },
     * });
     * console.log(backup.backup_id);
     *
     * @throws {InvalidParamError} 当 `algorithm` 或 `auth_data` 缺失时
     */
    public async createSecureBackup(body: SecurityBackupCreateBody): Promise<SecureBackupCreateResponse> {
        // The backend no longer accepts a passphrase; the key must be derived client-side.
        if (!body.algorithm || !body.auth_data) {
            throw new InvalidParamError("'algorithm' and 'auth_data' are required to create a secure backup");
        }
        return this.post(ep("/keys/backup/secure"), body, "createSecureBackup");
    }

    /**
     * GET /keys/backup/secure — 列出所有安全备份
     * 对应后端 get_secure_backup_list handler
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getE2EEManager();
     * const { backups } = await mgr.getSecureBackupList();
     * console.log(backups.map((b) => b.backup_id));
     */
    public async getSecureBackupList(): Promise<{ backups: SecureBackupInfo[] }> {
        return await this.withRetry(async () => {
            return await this.request<{ backups: SecureBackupInfo[] }>({
                method: Method.Get,
                path: ep("/keys/backup/secure"),
                prefix: ClientPrefix.V3,
            });
        }, "getSecureBackupList");
    }

    /**
     * 获取指定安全备份的元信息。
     * GET /keys/backup/secure/{backup_id}
     *
     * @param backupId - 目标备份 ID
     * @returns 该备份的版本、算法、auth_data 及密钥数量等信息
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getE2EEManager();
     * const backup = await mgr.getSecureBackup("1");
     * console.log(backup.version, backup.count);
     */
    public async getSecureBackup(backupId: string): Promise<SecureBackupInfo> {
        this.requireNonEmptyString(backupId, "backupId");
        return await this.withRetry(async () => {
            return await this.request<SecureBackupInfo>({
                method: Method.Get,
                path: ep(`/keys/backup/secure/${encodeURIComponent(backupId)}`),
                prefix: ClientPrefix.V3,
            });
        }, "getSecureBackup");
    }

    /**
     * 删除指定的安全备份。
     * DELETE /keys/backup/secure/{backup_id}
     *
     * @param backupId - 待删除的备份 ID
     * @returns 无返回值
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getE2EEManager();
     * await mgr.deleteSecureBackup("1");
     */
    public async deleteSecureBackup(backupId: string): Promise<void> {
        this.requireNonEmptyString(backupId, "backupId");
        return await this.withRetry(async () => {
            await this.request({
                method: Method.Delete,
                path: ep(`/keys/backup/secure/${encodeURIComponent(backupId)}`),
                prefix: ClientPrefix.V3,
            });
        }, "deleteSecureBackup");
    }

    /**
     * 向指定安全备份写入会话密钥。
     * POST /keys/backup/secure/{backup_id}/keys
     *
     * @param backupId - 目标备份 ID
     * @param body - 待写入的会话密钥集合，见 `StoreSecureBackupKeysBody`
     * @returns 备份中当前的密钥数量
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getE2EEManager();
     * const result = await mgr.storeSecureBackupKeys("1", {
     *     session_keys: [{ session_id: "session-1", session_data: { ciphertext: "..." } }],
     * });
     * console.log(result.count);
     */
    public async storeSecureBackupKeys(
        backupId: string,
        body: StoreSecureBackupKeysBody,
    ): Promise<SecureBackupKeysResponse> {
        this.requireNonEmptyString(backupId, "backupId");
        return this.post(ep(`/keys/backup/secure/${encodeURIComponent(backupId)}/keys`), body, "storeSecureBackupKeys");
    }

    /**
     * 从指定安全备份恢复会话密钥。
     * POST /keys/backup/secure/{backup_id}/restore
     *
     * @param backupId - 目标备份 ID
     * @param body - 恢复参数，可通过 `rooms` 限定要恢复的房间，见 `RestoreSecureBackupBody`
     * @returns 备份中的密钥总数及返回的会话密钥列表
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getE2EEManager();
     * const restored = await mgr.restoreSecureBackup("1", { rooms: ["!room:example.org"] });
     * console.log(restored.total_keys);
     */
    public async restoreSecureBackup(
        backupId: string,
        body: RestoreSecureBackupBody,
    ): Promise<SecureBackupRestoreResponse> {
        this.requireNonEmptyString(backupId, "backupId");
        return this.post(
            ep(`/keys/backup/secure/${encodeURIComponent(backupId)}/restore`),
            body,
            "restoreSecureBackup",
        );
    }

    /**
     * 校验安全备份的 passphrase。
     * POST /keys/backup/secure/{backup_id}/verify
     *
     * @param backupId - 目标备份 ID
     * @param body - 待校验的 passphrase，见 `VerifySecureBackupPassphraseBody`
     * @returns 校验结果（`valid` 表示 passphrase 是否正确）
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getE2EEManager();
     * const result = await mgr.verifySecureBackupPassphrase("1", { passphrase: "my passphrase" });
     * console.log(result.valid);
     */
    public async verifySecureBackupPassphrase(
        backupId: string,
        body: VerifySecureBackupPassphraseBody,
    ): Promise<SecureBackupVerifyResponse> {
        this.requireNonEmptyString(backupId, "backupId");
        return this.post(
            ep(`/keys/backup/secure/${encodeURIComponent(backupId)}/verify`),
            body,
            "verifySecureBackupPassphrase",
        );
    }

    // -------- helpers ----------

    /**
     * Get key history (audit log) for the current user.
     * GET /_matrix/client/v3/keys/history
     *
     * @param params - Optional pagination parameters.
     * @param params.limit - Maximum number of entries to return (default 100, max 1000).
     * @param params.from - Pagination cursor from a previous response's `next_batch`.
     *
     * @example
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getE2EEManager();
     * const history = await mgr.getKeyHistory({ limit: 50 });
     * for (const entry of history.history) {
     *     console.log(entry.id, entry.created_ts);
     * }
     */
    public async getKeyHistory(params?: { limit?: number; from?: string }): Promise<KeyHistoryResponse> {
        return await this.withRetry(async () => {
            return await this.request<KeyHistoryResponse>({
                method: Method.Get,
                path: ep("/keys/history"),
                queryParams: params,
                prefix: ClientPrefix.V3,
            });
        }, "getKeyHistory");
    }

    private async post<T = IContent>(path: string, body: object, label: string): Promise<T> {
        return await this.withRetry(async () => {
            return await this.request<T>({
                method: Method.Post,
                path,
                body,
                prefix: ClientPrefix.V3,
            });
        }, label);
    }

    private async postVoid(path: string, body: object, label: string): Promise<void> {
        return await this.withRetry(async () => {
            await this.request({
                method: Method.Post,
                path,
                body,
                prefix: ClientPrefix.V3,
            });
        }, label);
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getE2EEManager = function (): E2EEManager {
        registerManagerClass("e2ee", E2EEManager);
        return getOrCreateManager(this, "e2ee", () => new E2EEManager(this));
    };
}
