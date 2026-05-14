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
import type { VerificationPathPattern } from "./__generated__/route-table";
import { getOrCreateManager } from "../client-infra/manager-registry";

type StripR0<P extends string> = P extends `/_matrix/client/r0${infer Rest}` ? Rest : never;
type StripV1<P extends string> = P extends `/_matrix/client/v1${infer Rest}` ? Rest : never;
type VerificationManagerPathPattern = StripR0<VerificationPathPattern> | StripV1<VerificationPathPattern>;

function vp<P extends VerificationManagerPathPattern>(path: P): P {
    return path;
}

/**
 * VerificationManager — 设备/交叉签名互认证
 *
 * 对接后端 `synapse-rust/src/web/routes/verification_routes.rs`：
 *   - POST /keys/device_signing/verify_start
 *   - PUT  /keys/device_signing/verify_accept
 *   - POST /keys/device_signing/verify_key_agreement
 *   - POST /keys/device_signing/verify_mac
 *   - POST /keys/device_signing/verify_done
 *   - POST /keys/device_signing/verify_cancel
 *   - GET  /keys/device_signing/requests
 *   - GET  /keys/qr_code/show
 *   - POST /keys/qr_code/scan
 *
 * 后端只挂在 `/_matrix/client/v1` 与 `/_matrix/client/r0` 两个前缀下（v3 留给 e2ee_routes）。
 */

export interface VerificationStartRequest {
    /** 发起方的 device_id；后端要求字符串 */
    from_device: string;
    /** 目标用户 */
    to_user: string;
    /** 可选：目标 device，省略表示对该用户所有设备 */
    to_device?: string;
    /** 可选：transaction_id，省略时由后端生成 */
    transaction_id?: string;
    /** 可选：method，默认 m.sas.v1 */
    method?: string;
}

export interface VerificationStartResponse {
    transaction_id: string;
    method: string;
    key_agreement_protocol: string[];
    hash: string[];
    short_authentication_string: string[];
}

export interface VerificationAcceptRequest {
    transaction_id: string;
    key_agreement_protocol: string;
    hash: string;
    commitment?: string;
}

export interface VerificationAcceptResponse extends VerificationStartResponse {
    commitment?: string;
}

export interface VerificationKeyAgreementRequest {
    transaction_id: string;
    /** Curve25519 公钥（base64） */
    pubkey: string;
}

export interface VerificationKeyAgreementResponse {
    transaction_id: string;
    confirmed: boolean;
    /** SAS 表征：emoji + decimal 三段，或纯 decimal */
    short_authentication_string: {
        emoji?: string[];
        decimal?: { points: number[] };
    };
}

export interface VerificationMacRequest {
    transaction_id: string;
    mac: string;
}

export interface VerificationMacResponse {
    transaction_id: string;
    verified: boolean;
}

export interface VerificationDoneRequest {
    transaction_id: string;
    mac: string;
}

export interface VerificationCancelRequest {
    transaction_id: string;
    code: string;
    reason: string;
}

export interface VerificationCancelResponse {
    transaction_id: string;
    state: "cancelled";
    code: string;
    reason: string;
}

export interface VerificationRequestEntry {
    transaction_id: string;
    from_user: string;
    from_device: string;
    to_user: string;
    to_device?: string;
    method: string;
    state: string;
    created_ts: number;
    updated_ts: number;
}

export interface ListVerificationRequestsResponse {
    requests: VerificationRequestEntry[];
}

export interface QrCodeShowResponse {
    transaction_id: string;
    server_name: string;
    user_id: string;
    device_id: string;
    device_ed25519_key: string;
    device_curve25519_key: string;
}

export interface ScanQrCodeRequest {
    transaction_id: string;
    server_name: string;
    user_id: string;
    device_id: string;
    device_ed25519_key: string;
    device_curve25519_key: string;
}

export interface ScanQrCodeResponse {
    transaction_id: string;
    state: "pending" | "verified" | "cancelled";
}

export class VerificationManager extends BaseManager {
    public constructor(client: MatrixClient) {
        super(client);
    }

    public async startVerification(request: VerificationStartRequest): Promise<VerificationStartResponse> {
        this.requireNonEmptyString(request.from_device, "from_device");
        this.requireNonEmptyString(request.to_user, "to_user");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<VerificationStartResponse>(
                Method.Post,
                vp("/keys/device_signing/verify_start"),
                undefined,
                request,
                { prefix: ClientPrefix.V1 },
            );
        }, "startVerification");
    }

    public async acceptVerification(request: VerificationAcceptRequest): Promise<VerificationAcceptResponse> {
        this.requireNonEmptyString(request.transaction_id, "transaction_id");
        this.requireNonEmptyString(request.key_agreement_protocol, "key_agreement_protocol");
        this.requireNonEmptyString(request.hash, "hash");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<VerificationAcceptResponse>(
                Method.Put,
                vp("/keys/device_signing/verify_accept"),
                undefined,
                request,
                { prefix: ClientPrefix.V1 },
            );
        }, "acceptVerification");
    }

    public async exchangeKeys(
        request: VerificationKeyAgreementRequest,
    ): Promise<VerificationKeyAgreementResponse> {
        this.requireNonEmptyString(request.transaction_id, "transaction_id");
        this.requireNonEmptyString(request.pubkey, "pubkey");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<VerificationKeyAgreementResponse>(
                Method.Post,
                vp("/keys/device_signing/verify_key_agreement"),
                undefined,
                request,
                { prefix: ClientPrefix.V1 },
            );
        }, "exchangeKeys");
    }

    public async confirmMac(request: VerificationMacRequest): Promise<VerificationMacResponse> {
        this.requireNonEmptyString(request.transaction_id, "transaction_id");
        this.requireNonEmptyString(request.mac, "mac");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<VerificationMacResponse>(
                Method.Post,
                vp("/keys/device_signing/verify_mac"),
                undefined,
                request,
                { prefix: ClientPrefix.V1 },
            );
        }, "confirmMac");
    }

    public async completeVerification(request: VerificationDoneRequest): Promise<{ transaction_id: string }> {
        this.requireNonEmptyString(request.transaction_id, "transaction_id");
        this.requireNonEmptyString(request.mac, "mac");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<{ transaction_id: string }>(
                Method.Post,
                vp("/keys/device_signing/verify_done"),
                undefined,
                request,
                { prefix: ClientPrefix.V1 },
            );
        }, "completeVerification");
    }

    public async cancelVerification(request: VerificationCancelRequest): Promise<VerificationCancelResponse> {
        this.requireNonEmptyString(request.transaction_id, "transaction_id");
        this.requireNonEmptyString(request.code, "code");
        this.requireNonEmptyString(request.reason, "reason");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<VerificationCancelResponse>(
                Method.Post,
                vp("/keys/device_signing/verify_cancel"),
                undefined,
                request,
                { prefix: ClientPrefix.V1 },
            );
        }, "cancelVerification");
    }

    public async listPendingVerifications(): Promise<ListVerificationRequestsResponse> {
        try {
            return await this.client.http.authedRequest<ListVerificationRequestsResponse>(
                Method.Get,
                vp("/keys/device_signing/requests"),
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );
        } catch (e) {
            logger.warn("VerificationManager.listPendingVerifications failed", e);
            return { requests: [] };
        }
    }

    public async showQrCode(): Promise<QrCodeShowResponse> {
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<QrCodeShowResponse>(
                Method.Get,
                vp("/keys/qr_code/show"),
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );
        }, "showQrCode");
    }

    public async scanQrCode(request: ScanQrCodeRequest): Promise<ScanQrCodeResponse> {
        this.requireNonEmptyString(request.transaction_id, "transaction_id");
        this.requireNonEmptyString(request.server_name, "server_name");
        this.requireNonEmptyString(request.user_id, "user_id");
        this.requireNonEmptyString(request.device_id, "device_id");
        this.requireNonEmptyString(request.device_ed25519_key, "device_ed25519_key");
        this.requireNonEmptyString(request.device_curve25519_key, "device_curve25519_key");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<ScanQrCodeResponse>(
                Method.Post,
                vp("/keys/qr_code/scan"),
                undefined,
                request,
                { prefix: ClientPrefix.V1 },
            );
        }, "scanQrCode");
    }

    public start(): void {}
    public stop(): void {}
}

declare module "../client.ts" {
    interface MatrixClient {
        getVerificationManager(): VerificationManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getVerificationManager = function (): VerificationManager {
        return getOrCreateManager(this, "verification", () => new VerificationManager(this));
    };
}

export default extendMatrixClient;
