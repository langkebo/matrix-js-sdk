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
 * @remarks
 * 对绝大多数应用：使用 `MatrixClient.initRustCrypto()` 提供的高层 API，
 * 而不是直接调用此 Manager。本 Manager 只为需要绕过 Rust crypto 直接驱动
 * 后端 E2EE 端点的高级集成（管理工具、迁移脚本、契约测试）准备。
 */

export interface DeviceVerificationRequestBody {
    user_id: string;
    device_id?: string;
    method?: string;
}

export interface SecurityBackupCreateBody {
    algorithm: string;
    auth_data?: Record<string, unknown>;
    passphrase?: string;
}

export type SendToDeviceMessages = Record<string, Record<string, unknown>>;

export class E2EEManager extends BaseManager {
    public constructor(client: MatrixClient) {
        super(client);
    }

    // -------- compat (r0/v1/v3) ----------

    public async uploadKeys(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post("/keys/upload", body, "uploadKeys");
    }

    public async queryKeys(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post("/keys/query", body, "queryKeys");
    }

    public async claimKeys(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post("/keys/claim", body, "claimKeys");
    }

    public async getKeyChanges(params: { from?: string; to?: string } = {}): Promise<Record<string, unknown>> {
        try {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Get,
                "/keys/changes",
                params,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        } catch (e) {
            throw this.normalizeError(e, "getKeyChanges");
        }
    }

    public async postDeviceListUpdate(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post("/keys/device_list/update", body, "postDeviceListUpdate");
    }

    public async uploadSignatures(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post("/keys/signatures", body, "uploadSignatures");
    }

    /**
     * `/keys/signatures/upload` 与 `/keys/signatures` 是同一 handler 的别名，
     * 后端两条路径都会被路由到 `upload_signatures`，按 SDK 习惯保留两个入口。
     */
    public async uploadSignaturesAlt(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post("/keys/signatures/upload", body, "uploadSignaturesAlt");
    }

    public async uploadDeviceSigning(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post("/keys/device_signing/upload", body, "uploadDeviceSigning");
    }

    public async createRoomKeyRequest(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post("/room_keys/request", body, "createRoomKeyRequest");
    }

    public async listRoomKeyRequests(): Promise<Record<string, unknown>> {
        try {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Get,
                "/room_keys/request",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        } catch (e) {
            throw this.normalizeError(e, "listRoomKeyRequests");
        }
    }

    public async deleteRoomKeyRequest(requestId: string): Promise<void> {
        this.requireNonEmpty(requestId, "requestId");
        try {
            await this.client.http.authedRequest<void>(
                Method.Delete,
                `/room_keys/request/${encodeURIComponent(requestId)}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        } catch (e) {
            throw this.normalizeError(e, "deleteRoomKeyRequest");
        }
    }

    public async getRoomKeyDistribution(roomId: string): Promise<Record<string, unknown>> {
        this.requireNonEmpty(roomId, "roomId");
        try {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Get,
                `/rooms/${encodeURIComponent(roomId)}/keys/distribution`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        } catch (e) {
            throw this.normalizeError(e, "getRoomKeyDistribution");
        }
    }

    public async sendToDevice(
        eventType: string,
        transactionId: string,
        messages: SendToDeviceMessages,
    ): Promise<Record<string, unknown>> {
        this.requireNonEmpty(eventType, "eventType");
        this.requireNonEmpty(transactionId, "transactionId");
        try {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Put,
                `/sendToDevice/${encodeURIComponent(eventType)}/${encodeURIComponent(transactionId)}`,
                undefined,
                { messages },
                { prefix: ClientPrefix.V3 },
            );
        } catch (e) {
            throw this.normalizeError(e, "sendToDevice");
        }
    }

    // -------- v3-only ----------

    public async requestDeviceVerification(
        body: DeviceVerificationRequestBody,
    ): Promise<Record<string, unknown>> {
        this.requireNonEmpty(body.user_id, "user_id");
        return this.post("/device_verification/request", body, "requestDeviceVerification");
    }

    public async respondDeviceVerification(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post("/device_verification/respond", body, "respondDeviceVerification");
    }

    public async getDeviceVerificationStatus(token: string): Promise<Record<string, unknown>> {
        this.requireNonEmpty(token, "token");
        try {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Get,
                `/device_verification/status/${encodeURIComponent(token)}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        } catch (e) {
            throw this.normalizeError(e, "getDeviceVerificationStatus");
        }
    }

    public async getDeviceTrustList(): Promise<Record<string, unknown>> {
        try {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Get,
                "/device_trust",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        } catch (e) {
            throw this.normalizeError(e, "getDeviceTrustList");
        }
    }

    public async getDeviceTrust(deviceId: string): Promise<Record<string, unknown>> {
        this.requireNonEmpty(deviceId, "deviceId");
        try {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Get,
                `/device_trust/${encodeURIComponent(deviceId)}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        } catch (e) {
            throw this.normalizeError(e, "getDeviceTrust");
        }
    }

    public async getSecuritySummary(): Promise<Record<string, unknown>> {
        try {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Get,
                "/security/summary",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        } catch (e) {
            logger.warn("E2EEManager.getSecuritySummary failed", e);
            return {};
        }
    }

    public async createSecureBackup(body: SecurityBackupCreateBody): Promise<Record<string, unknown>> {
        this.requireNonEmpty(body.algorithm, "algorithm");
        return this.post("/keys/backup/secure", body, "createSecureBackup");
    }

    public async getSecureBackup(backupId: string): Promise<Record<string, unknown>> {
        this.requireNonEmpty(backupId, "backupId");
        try {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Get,
                `/keys/backup/secure/${encodeURIComponent(backupId)}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        } catch (e) {
            throw this.normalizeError(e, "getSecureBackup");
        }
    }

    public async deleteSecureBackup(backupId: string): Promise<void> {
        this.requireNonEmpty(backupId, "backupId");
        try {
            await this.client.http.authedRequest<void>(
                Method.Delete,
                `/keys/backup/secure/${encodeURIComponent(backupId)}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        } catch (e) {
            throw this.normalizeError(e, "deleteSecureBackup");
        }
    }

    public async storeSecureBackupKeys(
        backupId: string,
        body: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        this.requireNonEmpty(backupId, "backupId");
        return this.post(`/keys/backup/secure/${encodeURIComponent(backupId)}/keys`, body, "storeSecureBackupKeys");
    }

    public async restoreSecureBackup(
        backupId: string,
        body: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        this.requireNonEmpty(backupId, "backupId");
        return this.post(`/keys/backup/secure/${encodeURIComponent(backupId)}/restore`, body, "restoreSecureBackup");
    }

    public async verifySecureBackupPassphrase(
        backupId: string,
        body: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        this.requireNonEmpty(backupId, "backupId");
        return this.post(
            `/keys/backup/secure/${encodeURIComponent(backupId)}/verify`,
            body,
            "verifySecureBackupPassphrase",
        );
    }

    // -------- helpers ----------

    private async post(
        path: string,
        body: object,
        label: string,
    ): Promise<Record<string, unknown>> {
        try {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Post,
                path,
                undefined,
                body,
                { prefix: ClientPrefix.V3 },
            );
        } catch (e) {
            throw this.normalizeError(e, label);
        }
    }

    private requireNonEmpty(value: string | undefined, field: string): void {
        if (!value || value.length === 0) {
            throw new InvalidParamError(`${field} is required`);
        }
    }

    public start(): void {}
    public stop(): void {}
}

declare module "../client.ts" {
    interface MatrixClient {
        getE2EEManager(): E2EEManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getE2EEManager = function (): E2EEManager {
        return new E2EEManager(this);
    };
}

export default extendMatrixClient;
