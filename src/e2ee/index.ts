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
 *   - POST   /keys/signatures
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

    public async uploadKeys(body: UploadKeysOptions): Promise<UploadKeysResponse> {
        return this.post(ep("/keys/upload"), body, "uploadKeys");
    }

    /**
     * Upload keys for a specific device via path parameter.
     * POST /_matrix/client/v3/keys/upload/{device_id}
     *
     * Same handler as `uploadKeys` but the device_id is taken from the URL
     * instead of the authenticated session.
     */
    public async uploadKeysToDevice(deviceId: string, body: UploadKeysOptions): Promise<UploadKeysResponse> {
        this.requireNonEmptyString(deviceId, "deviceId");
        return this.post(ep(`/keys/upload/${encodeURIComponent(deviceId)}`), body, "uploadKeysToDevice");
    }

    public async queryKeys(body: QueryKeysRequest): Promise<QueryKeysResponse> {
        return this.post(ep("/keys/query"), body, "queryKeys");
    }

    public async claimKeys(body: ClaimKeysRequest): Promise<ClaimKeysResponse> {
        return this.post(ep("/keys/claim"), body, "claimKeys");
    }

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

    public async postDeviceListUpdate(body: Array<DeviceListUpdateEntry | DeviceListDeletedEntry>): Promise<void> {
        return this.postVoid(ep("/keys/device_list/update"), body, "postDeviceListUpdate");
    }

    public async uploadSignatures(
        body: Record<string, Record<string, Record<string, string>>>,
    ): Promise<SignaturesUploadResponse> {
        return this.post(ep("/keys/signatures/upload"), body, "uploadSignatures");
    }

    /**
     * `/keys/signatures` 是历史别名；后端 ledger 只注册 `/keys/signatures/upload`
     * （`POST /_matrix/client/{v1,v3}/keys/signatures/upload`），旧路径恒 404，
     * 故两个入口统一指向规范路径。
     */
    public async uploadSignaturesAlt(
        body: Record<string, Record<string, Record<string, string>>>,
    ): Promise<SignaturesUploadResponse> {
        return this.post(ep("/keys/signatures/upload"), body, "uploadSignaturesAlt");
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

    public async listRoomKeyRequests(): Promise<RoomKeyRequestsResponse> {
        return await this.withRetry(async () => {
            return await this.request<RoomKeyRequestsResponse>({
                method: Method.Get,
                path: ep("/room_keys/request"),
                prefix: ClientPrefix.V3,
            });
        }, "listRoomKeyRequests");
    }

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

    public async sendToDeviceV1(
        eventType: string,
        transactionId: string,
        messages: SendToDeviceMessages,
    ): Promise<SendToDeviceResponse> {
        return this.sendToDevice(eventType, transactionId, messages, "v1");
    }

    // -------- v3-only ----------

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

    public async storeSecureBackupKeys(
        backupId: string,
        body: StoreSecureBackupKeysBody,
    ): Promise<SecureBackupKeysResponse> {
        this.requireNonEmptyString(backupId, "backupId");
        return this.post(ep(`/keys/backup/secure/${encodeURIComponent(backupId)}/keys`), body, "storeSecureBackupKeys");
    }

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
