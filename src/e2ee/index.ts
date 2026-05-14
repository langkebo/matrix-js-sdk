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
import { getOrCreateManager } from "../client-infra/manager-registry";

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

export interface SecurityBackupCreateBody {
    algorithm?: string;
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
        return this.post(ep("/keys/upload"), body, "uploadKeys");
    }

    public async queryKeys(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post(ep("/keys/query"), body, "queryKeys");
    }

    public async claimKeys(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post(ep("/keys/claim"), body, "claimKeys");
    }

    public async getKeyChanges(params: { from?: string; to?: string } = {}): Promise<Record<string, unknown>> {
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Get,
                ep("/keys/changes"),
                params,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        }, "getKeyChanges");
    }

    public async postDeviceListUpdate(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post(ep("/keys/device_list/update"), body, "postDeviceListUpdate");
    }

    public async uploadSignatures(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post(ep("/keys/signatures"), body, "uploadSignatures");
    }

    /**
     * `/keys/signatures/upload` 与 `/keys/signatures` 是同一 handler 的别名，
     * 后端两条路径都会被路由到 `upload_signatures`，按 SDK 习惯保留两个入口。
     */
    public async uploadSignaturesAlt(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post(ep("/keys/signatures/upload"), body, "uploadSignaturesAlt");
    }

    public async uploadDeviceSigning(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post(ep("/keys/device_signing/upload"), body, "uploadDeviceSigning");
    }

    public async createRoomKeyRequest(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post(ep("/room_keys/request"), body, "createRoomKeyRequest");
    }

    public async listRoomKeyRequests(): Promise<Record<string, unknown>> {
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<Record<string, unknown>>(
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

    public async getRoomKeyDistribution(roomId: string): Promise<Record<string, unknown>> {
        this.requireNonEmptyString(roomId, "roomId");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<Record<string, unknown>>(
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
    ): Promise<Record<string, unknown>> {
        this.requireNonEmptyString(eventType, "eventType");
        this.requireNonEmptyString(transactionId, "transactionId");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Put,
                ep(
                    `/sendToDevice/${encodeURIComponent(eventType)}/${encodeURIComponent(transactionId)}` as StripV3<E2eePathPattern>,
                ),
                undefined,
                { messages },
                { prefix: ClientPrefix.V3 },
            );
        }, "sendToDevice");
    }

    // -------- v3-only ----------

    public async requestDeviceVerification(
        body: DeviceVerificationRequestBody,
    ): Promise<Record<string, unknown>> {
        if (!body.device_id && !body.new_device_id) {
            throw new InvalidParamError("device_id or new_device_id is required");
        }
        return this.post(ep("/device_verification/request"), body, "requestDeviceVerification");
    }

    public async respondDeviceVerification(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post(ep("/device_verification/respond"), body, "respondDeviceVerification");
    }

    public async getDeviceVerificationStatus(token: string): Promise<Record<string, unknown>> {
        this.requireNonEmptyString(token, "token");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Get,
                ep(`/device_verification/status/${encodeURIComponent(token)}` as StripV3<E2eePathPattern>),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        }, "getDeviceVerificationStatus");
    }

    public async getDeviceTrustList(): Promise<Record<string, unknown>> {
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Get,
                ep("/device_trust"),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        }, "getDeviceTrustList");
    }

    public async getDeviceTrust(deviceId: string): Promise<Record<string, unknown>> {
        this.requireNonEmptyString(deviceId, "deviceId");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Get,
                ep(`/device_trust/${encodeURIComponent(deviceId)}` as StripV3<E2eePathPattern>),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        }, "getDeviceTrust");
    }

    public async getSecuritySummary(): Promise<Record<string, unknown>> {
        try {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Get,
                ep("/security/summary"),
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
        this.requireNonEmptyString(body.passphrase, "passphrase");
        return this.post(ep("/keys/backup/secure"), body, "createSecureBackup");
    }

    public async getSecureBackup(backupId: string): Promise<Record<string, unknown>> {
        this.requireNonEmptyString(backupId, "backupId");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<Record<string, unknown>>(
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
        body: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        this.requireNonEmptyString(backupId, "backupId");
        return this.post(
            ep(`/keys/backup/secure/${encodeURIComponent(backupId)}/keys` as StripV3<E2eePathPattern>),
            body,
            "storeSecureBackupKeys",
        );
    }

    public async restoreSecureBackup(
        backupId: string,
        body: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        this.requireNonEmptyString(backupId, "backupId");
        return this.post(
            ep(`/keys/backup/secure/${encodeURIComponent(backupId)}/restore` as StripV3<E2eePathPattern>),
            body,
            "restoreSecureBackup",
        );
    }

    public async verifySecureBackupPassphrase(
        backupId: string,
        body: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        this.requireNonEmptyString(backupId, "backupId");
        return this.post(
            ep(`/keys/backup/secure/${encodeURIComponent(backupId)}/verify` as StripV3<E2eePathPattern>),
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
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Post,
                path,
                undefined,
                body,
                { prefix: ClientPrefix.V3 },
            );
        }, label);
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
        return getOrCreateManager(this, "e2ee", () => new E2EEManager(this));
    };
}

export default extendMatrixClient;
