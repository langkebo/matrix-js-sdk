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
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

type StripR0<P extends string> = P extends `/_matrix/client/r0${infer Rest}` ? Rest : never;
type StripV1<P extends string> = P extends `/_matrix/client/v1${infer Rest}` ? Rest : never;
type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;
type VerificationManagerPathPattern =
    | StripR0<VerificationPathPattern>
    | StripV1<VerificationPathPattern>
    | StripV3<VerificationPathPattern>;
type VerificationApiVersion = "r0" | "v1" | "v3";

function vp<P extends VerificationManagerPathPattern>(path: P): P {
    return path;
}

function verificationPrefix(version: VerificationApiVersion = "v1"): ClientPrefix.R0 | ClientPrefix.V1 | ClientPrefix.V3 {
    if (version === "r0") {
        return ClientPrefix.R0;
    }
    if (version === "v3") {
        return ClientPrefix.V3;
    }
    return ClientPrefix.V1;
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
 * 默认使用 `/_matrix/client/v1` 保持兼容；调用方可显式传入 `v3` 使用生成契约中的新版路径。
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

    public async startVerification(
        request: VerificationStartRequest,
        version?: VerificationApiVersion,
    ): Promise<VerificationStartResponse> {
        this.requireNonEmptyString(request.from_device, "from_device");
        this.requireNonEmptyString(request.to_user, "to_user");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<VerificationStartResponse>(
                Method.Post,
                vp("/keys/device_signing/verify_start"),
                undefined,
                request,
                { prefix: verificationPrefix(version) },
            );
        }, "startVerification");
    }

    public async acceptVerification(
        request: VerificationAcceptRequest,
        version?: VerificationApiVersion,
    ): Promise<VerificationAcceptResponse> {
        this.requireNonEmptyString(request.transaction_id, "transaction_id");
        this.requireNonEmptyString(request.key_agreement_protocol, "key_agreement_protocol");
        this.requireNonEmptyString(request.hash, "hash");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<VerificationAcceptResponse>(
                Method.Put,
                vp("/keys/device_signing/verify_accept"),
                undefined,
                request,
                { prefix: verificationPrefix(version) },
            );
        }, "acceptVerification");
    }

    public async exchangeKeys(
        request: VerificationKeyAgreementRequest,
        version?: VerificationApiVersion,
    ): Promise<VerificationKeyAgreementResponse> {
        this.requireNonEmptyString(request.transaction_id, "transaction_id");
        this.requireNonEmptyString(request.pubkey, "pubkey");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<VerificationKeyAgreementResponse>(
                Method.Post,
                vp("/keys/device_signing/verify_key_agreement"),
                undefined,
                request,
                { prefix: verificationPrefix(version) },
            );
        }, "exchangeKeys");
    }

    public async confirmMac(
        request: VerificationMacRequest,
        version?: VerificationApiVersion,
    ): Promise<VerificationMacResponse> {
        this.requireNonEmptyString(request.transaction_id, "transaction_id");
        this.requireNonEmptyString(request.mac, "mac");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<VerificationMacResponse>(
                Method.Post,
                vp("/keys/device_signing/verify_mac"),
                undefined,
                request,
                { prefix: verificationPrefix(version) },
            );
        }, "confirmMac");
    }

    public async completeVerification(
        request: VerificationDoneRequest,
        version?: VerificationApiVersion,
    ): Promise<{ transaction_id: string }> {
        this.requireNonEmptyString(request.transaction_id, "transaction_id");
        this.requireNonEmptyString(request.mac, "mac");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<{ transaction_id: string }>(
                Method.Post,
                vp("/keys/device_signing/verify_done"),
                undefined,
                request,
                { prefix: verificationPrefix(version) },
            );
        }, "completeVerification");
    }

    public async cancelVerification(
        request: VerificationCancelRequest,
        version?: VerificationApiVersion,
    ): Promise<VerificationCancelResponse> {
        this.requireNonEmptyString(request.transaction_id, "transaction_id");
        this.requireNonEmptyString(request.code, "code");
        this.requireNonEmptyString(request.reason, "reason");
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<VerificationCancelResponse>(
                Method.Post,
                vp("/keys/device_signing/verify_cancel"),
                undefined,
                request,
                { prefix: verificationPrefix(version) },
            );
        }, "cancelVerification");
    }

    public async listPendingVerifications(version?: VerificationApiVersion): Promise<ListVerificationRequestsResponse> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<ListVerificationRequestsResponse>(
                    Method.Get,
                    vp("/keys/device_signing/requests"),
                    undefined,
                    undefined,
                    { prefix: verificationPrefix(version) },
                );
            }, "listPendingVerifications");
        } catch (e) {
            logger.warn("VerificationManager.listPendingVerifications failed", e);
            return { requests: [] };
        }
    }

    public async showQrCode(version?: VerificationApiVersion): Promise<QrCodeShowResponse> {
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<QrCodeShowResponse>(
                Method.Get,
                vp("/keys/qr_code/show"),
                undefined,
                undefined,
                { prefix: verificationPrefix(version) },
            );
        }, "showQrCode");
    }

    public async scanQrCode(
        request: ScanQrCodeRequest,
        version?: VerificationApiVersion,
    ): Promise<ScanQrCodeResponse> {
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
                { prefix: verificationPrefix(version) },
            );
        }, "scanQrCode");
    }

}


export function extendMatrixClient(): void {
    MatrixClient.prototype.getVerificationManager = function (): VerificationManager {
        registerManagerClass("verification", VerificationManager);
    return getOrCreateManager(this, "verification", () => new VerificationManager(this));
    };
}

export default extendMatrixClient;
