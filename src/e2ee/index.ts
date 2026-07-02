/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.

    http://www.apache.org/licenses/LICENSE-2.0
*/

import { logger } from "../logger";
import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { InvalidParamError } from "../common/errors";
import type { E2eePathPattern } from "./__generated__/route-table";
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
} from "../device-keys/index";
import type { UploadDeviceSigningRequest } from "./__generated__/dto";
import type { IContent } from "../models/event";

type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function ep<P extends StripV3<E2eePathPattern>>(path: P): P {
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
 *   - POST   /device_verification/request
 *   - POST   /device_verification/respond
 *   - GET    /device_verification/status/{token}
 *   - GET    /device_trust
 *   - GET    /device_trust/{device_id}
 *   - GET    /security/summary
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

export interface DeviceVerificationRequestBody {
    user_id?: string;
    new_device_id?: string;
    device_id?: string;
    method?: string;
}

export interface DeviceVerificationRespondBody {
    token: string;
    action: "accept" | "reject";
}

export interface DeviceVerificationStatusResponse {
    token: string;
    status: "pending" | "accepted" | "rejected" | "expired";
    requesting_device_id?: string;
    expires_at?: number;
    methods_available?: string[];
}

export interface DeviceTrustInfo {
    user_id: string;
    device_id: string;
    trust_level: "verified" | "cross_signed" | "unverified" | "unknown";
    verified_at?: number;
}

export interface SecuritySummaryResponse {
    devices_total: number;
    devices_verified: number;
    devices_unverified: number;
    cross_signing_ready: boolean;
    [key: string]: unknown;
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
    /** Number of keys recovered */
    recovered_keys: number;
    /** Total keys in backup */
    total: number;
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

export interface RoomKeyRequestResponse {
    request_id: string;
    room_id: string;
    session_id: string;
    algorithm: string;
    state: "pending" | "accepted" | "cancelled";
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

export interface SecurityBackupCreateBody {
    algorithm?: string;
    /** Algorithm-specific auth data (shape varies by backup algorithm) */
    auth_data?: IContent;
    passphrase?: string;
}

export interface StoreSecureBackupKeysBody {
    passphrase: string;
    session_keys?: Array<{ session_id: string; session_data: IContent }>;
}

export interface RestoreSecureBackupBody {
    passphrase: string;
    rooms?: string[];
    key?: string;
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

export interface DeviceVerificationRequestResponse {
    token: string;
    expires_at?: number;
    [key: string]: unknown;
}

export interface DeviceVerificationRespondResponse {
    success?: boolean;
    [key: string]: unknown;
}

export type SendToDeviceVersion = "r0" | "v1" | "v3";

export class E2EEManager extends BaseManager {
    public constructor(client: MatrixClient) {
        super(client);
    }

    // -------- compat (r0/v1/v3) ----------

    public async uploadKeys(body: UploadKeysOptions): Promise<UploadKeysResponse> {
        return this.post(ep("/keys/upload"), body, "uploadKeys");
    }

    public async queryKeys(body: QueryKeysRequest): Promise<QueryKeysResponse> {
        return this.post(ep("/keys/query"), body, "queryKeys");
    }

    public async claimKeys(body: ClaimKeysRequest): Promise<ClaimKeysResponse> {
        return this.post(ep("/keys/claim"), body, "claimKeys");
    }

    public async getKeyChanges(params: { from?: string; to?: string } = {}): Promise<KeyChangesResponse> {
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<KeyChangesResponse>(
                Method.Get,
                ep("/keys/changes"),
                params,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        }, "getKeyChanges");
    }

    public async postDeviceListUpdate(body: Array<DeviceListUpdateEntry | DeviceListDeletedEntry>): Promise<void> {
        return this.postVoid(ep("/keys/device_list/update"), body, "postDeviceListUpdate");
    }

    public async uploadSignatures(body: Record<string, Record<string, Record<string, string>>>): Promise<SignaturesUploadResponse> {
        return this.post(ep("/keys/signatures"), body, "uploadSignatures");
    }

    /**
     * `/keys/signatures/upload` 与 `/keys/signatures` 是同一 handler 的别名，
     * 后端两条路径都会被路由到 `upload_signatures`，按 SDK 习惯保留两个入口。
     */
    public async uploadSignaturesAlt(body: Record<string, Record<string, Record<string, string>>>): Promise<SignaturesUploadResponse> {
        return this.post(ep("/keys/signatures/upload"), body, "uploadSignaturesAlt");
    }

    public async uploadDeviceSigning(body: UploadDeviceSigningRequest): Promise<DeviceSigningUploadResponse> {
        return this.post(ep("/keys/device_signing/upload"), body, "uploadDeviceSigning");
    }

    public async createRoomKeyRequest(body: RoomKeyRequestBody): Promise<RoomKeyRequestResponse> {
        return this.post(ep("/room_keys/request"), body, "createRoomKeyRequest");
    }

    public async listRoomKeyRequests(): Promise<RoomKeyRequestResponse[]> {
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<RoomKeyRequestResponse[]>(
                Method.Get,
                ep("/room_keys/request"),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        }, "listRoomKeyRequests");
    }

    public async deleteRoomKeyRequest(requestId: string): Promise<void> {
        this.requireNonEmptyString(requestId, "requestId");
        return await this.withRetry(async () => {
            await this.client.http.authedRequest<void>(
                Method.Delete,
                ep(`/room_keys/request/${encodeURIComponent(requestId)}` as StripV3<E2eePathPattern>),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        }, "deleteRoomKeyRequest");
    }

    public async getRoomKeyDistribution(roomId: string): Promise<RoomKeyDistributionResponse> {
        this.requireNonEmptyString(roomId, "roomId");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<RoomKeyDistributionResponse>(
                Method.Get,
                ep(`/rooms/${encodeURIComponent(roomId)}/keys/distribution` as StripV3<E2eePathPattern>),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
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
            r0: ClientPrefix.R0,
            v1: ClientPrefix.V1,
            v3: ClientPrefix.V3,
        };
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<SendToDeviceResponse>(
                Method.Put,
                `/sendToDevice/${encodeURIComponent(eventType)}/${encodeURIComponent(transactionId)}`,
                undefined,
                { messages },
                { prefix: prefixMap[version] },
            );
        }, "sendToDevice");
    }

    public async sendToDeviceV1(
        eventType: string,
        transactionId: string,
        messages: SendToDeviceMessages,
    ): Promise<SendToDeviceResponse> {
        return this.sendToDevice(eventType, transactionId, messages, "v1");
    }

    public async sendToDeviceR0(
        eventType: string,
        transactionId: string,
        messages: SendToDeviceMessages,
    ): Promise<SendToDeviceResponse> {
        return this.sendToDevice(eventType, transactionId, messages, "r0");
    }

    // -------- v3-only ----------

    public async requestDeviceVerification(
        body: DeviceVerificationRequestBody,
    ): Promise<DeviceVerificationRequestResponse> {
        if (!body.device_id && !body.new_device_id) {
            throw new InvalidParamError("device_id or new_device_id is required");
        }
        return this.post(ep("/device_verification/request"), body, "requestDeviceVerification");
    }

    public async respondDeviceVerification(body: DeviceVerificationRespondBody): Promise<DeviceVerificationRespondResponse> {
        return this.post(ep("/device_verification/respond"), body, "respondDeviceVerification");
    }

    public async getDeviceVerificationStatus(token: string): Promise<DeviceVerificationStatusResponse> {
        this.requireNonEmptyString(token, "token");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<DeviceVerificationStatusResponse>(
                Method.Get,
                ep(`/device_verification/status/${encodeURIComponent(token)}` as StripV3<E2eePathPattern>),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        }, "getDeviceVerificationStatus");
    }

    public async getDeviceTrustList(): Promise<Record<string, DeviceTrustInfo>> {
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<Record<string, DeviceTrustInfo>>(
                Method.Get,
                ep("/device_trust"),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        }, "getDeviceTrustList");
    }

    public async getDeviceTrust(deviceId: string): Promise<DeviceTrustInfo> {
        this.requireNonEmptyString(deviceId, "deviceId");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<DeviceTrustInfo>(
                Method.Get,
                ep(`/device_trust/${encodeURIComponent(deviceId)}` as StripV3<E2eePathPattern>),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        }, "getDeviceTrust");
    }

    public async getSecuritySummary(): Promise<SecuritySummaryResponse> {
        try {
            return await this.client.http.authedRequest<SecuritySummaryResponse>(
                Method.Get,
                ep("/security/summary"),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        } catch (e) {
            logger.warn("E2EEManager.getSecuritySummary failed", e);
            return { devices_total: 0, devices_verified: 0, devices_unverified: 0, cross_signing_ready: false };
        }
    }

    public async createSecureBackup(body: SecurityBackupCreateBody): Promise<SecureBackupCreateResponse> {
        // Support both passphrase mode and algorithm+auth_data mode
        if (!body.passphrase && !body.algorithm) {
            throw new InvalidParamError("Either passphrase or algorithm must be provided");
        }
        return this.post(ep("/keys/backup/secure"), body, "createSecureBackup");
    }

    /**
     * GET /keys/backup/secure — 列出所有安全备份
     * 对应后端 get_secure_backup_list handler
     */
    public async getSecureBackupList(): Promise<{ backups: SecureBackupInfo[] }> {
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<{ backups: SecureBackupInfo[] }>(
                Method.Get,
                ep("/keys/backup/secure"),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        }, "getSecureBackupList");
    }

    public async getSecureBackup(backupId: string): Promise<SecureBackupInfo> {
        this.requireNonEmptyString(backupId, "backupId");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<SecureBackupInfo>(
                Method.Get,
                ep(`/keys/backup/secure/${encodeURIComponent(backupId)}` as StripV3<E2eePathPattern>),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        }, "getSecureBackup");
    }

    public async deleteSecureBackup(backupId: string): Promise<void> {
        this.requireNonEmptyString(backupId, "backupId");
        return await this.withRetry(async () => {
            await this.client.http.authedRequest<void>(
                Method.Delete,
                ep(`/keys/backup/secure/${encodeURIComponent(backupId)}` as StripV3<E2eePathPattern>),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        }, "deleteSecureBackup");
    }

    public async storeSecureBackupKeys(
        backupId: string,
        body: StoreSecureBackupKeysBody,
    ): Promise<SecureBackupKeysResponse> {
        this.requireNonEmptyString(backupId, "backupId");
        return this.post(
            ep(`/keys/backup/secure/${encodeURIComponent(backupId)}/keys` as StripV3<E2eePathPattern>),
            body,
            "storeSecureBackupKeys",
        );
    }

    public async restoreSecureBackup(
        backupId: string,
        body: RestoreSecureBackupBody,
    ): Promise<SecureBackupRestoreResponse> {
        this.requireNonEmptyString(backupId, "backupId");
        return this.post(
            ep(`/keys/backup/secure/${encodeURIComponent(backupId)}/restore` as StripV3<E2eePathPattern>),
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
            ep(`/keys/backup/secure/${encodeURIComponent(backupId)}/verify` as StripV3<E2eePathPattern>),
            body,
            "verifySecureBackupPassphrase",
        );
    }

    // -------- helpers ----------

    private async post<T = IContent>(
        path: string,
        body: object,
        label: string,
    ): Promise<T> {
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<T>(
                Method.Post,
                path,
                undefined,
                body,
                { prefix: ClientPrefix.V3 },
            );
        }, label);
    }

    private async postVoid(
        path: string,
        body: object,
        label: string,
    ): Promise<void> {
        return await this.withRetry(async () => {
            await this.client.http.authedRequest<void>(
                Method.Post,
                path,
                undefined,
                body,
                { prefix: ClientPrefix.V3 },
            );
        }, label);
    }

}


export function extendMatrixClient(): void {
    MatrixClient.prototype.getE2EEManager = function (): E2EEManager {
        registerManagerClass("e2ee", E2EEManager);
    return getOrCreateManager(this, "e2ee", () => new E2EEManager(this));
    };
}

export default extendMatrixClient;
