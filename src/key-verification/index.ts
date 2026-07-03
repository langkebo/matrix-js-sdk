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
 * Key Verification Manager - 密钥验证管理
 *
 * 提供密钥验证功能
 */

import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import {
    type IDeviceSigningVerificationAcceptRequest,
    type IDeviceSigningVerificationAcceptResponse,
    type IDeviceSigningVerificationCancelRequest,
    type IDeviceSigningVerificationCancelResponse,
    type IDeviceSigningVerificationDoneResponse,
    type IDeviceSigningVerificationDoneRequest,
    type IDeviceSigningVerificationKeyAgreementResponse,
    type IDeviceSigningVerificationKeyAgreementRequest,
    type IDeviceSigningVerificationMacResponse,
    type IDeviceSigningVerificationMacRequest,
    type IDeviceSigningVerificationStartResponse,
    type IDeviceSigningVerificationStartRequest,
    type IScanQrCodeRequest,
    type IScanQrCodeResponse,
    type IShowQrCodeResponse,
    type IVerificationRequestsResponse,
    MatrixClient,
} from "../client";
import { Method } from "../http-api/method";
import type { Body } from "../http-api/interface";
import type { IRequestOpts } from "../http-api/interface";
import type { QueryDict } from "../utils";
import {
    startDeviceSigningVerificationRequest,
    acceptDeviceSigningVerificationRequest,
    sendDeviceSigningVerificationKeyAgreementRequest,
    confirmDeviceSigningVerificationMacRequest,
    completeDeviceSigningVerificationRequest,
    cancelDeviceSigningVerificationRequest,
    getVerificationRequestsHttpRequest,
    showQrCodeHttpRequest,
    scanQrCodeHttpRequest,
} from "../client-crypto-requests";
import { getLegacyClientPrefix } from "../client-internals";
import { ClientPrefix } from "../http-api/prefix";

type VerificationApiVersion = "v1" | "r0" | "v3";

function resolveVerificationPrefix(version: VerificationApiVersion): string {
    if (version === "v3") return ClientPrefix.V3;
    return getLegacyClientPrefix(version);
}

const DEFAULT_CANCEL_CODE = "m.user";
const DEFAULT_CANCEL_REASON = "Cancelled by user";

export interface IVerificationStatusResponse {
    transaction_id: string;
    state: string;
    from_device?: string;
    method?: string;
    created_ts?: number;
    updated_ts?: number;
}

export class KeyVerificationManager extends BaseManager {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * Request verification
     */
    public async requestVerification(
        userId: string,
        methods?: string[],
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationStartResponse> {
        const request: IDeviceSigningVerificationStartRequest = {
            from_device: this.client.getDeviceId() ?? "",
            to_user: userId,
            method: methods?.[0],
        };
        return this.startDeviceSigningVerification(request, version);
    }

    /**
     * Request room key verification
     */
    public async requestRoomKeyVerification(
        _roomId: string,
        userId: string,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationStartResponse> {
        const request: IDeviceSigningVerificationStartRequest = {
            from_device: this.client.getDeviceId() ?? "",
            to_user: userId,
            method: "sas",
        };
        return this.startDeviceSigningVerification(request, version);
    }

    /**
     * Begin key verification
     */
    public async beginKeyVerification(
        method: string,
        targetUserId: string,
        targetDeviceId: string,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationStartResponse> {
        const request: IDeviceSigningVerificationStartRequest = {
            from_device: this.client.getDeviceId() ?? "",
            to_user: targetUserId,
            to_device: targetDeviceId,
            method,
        };
        return this.startDeviceSigningVerification(request, version);
    }

    /**
     * Accept device signing verification
     */
    public async acceptKeyVerification(
        request: IDeviceSigningVerificationAcceptRequest,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationAcceptResponse> {
        return this.acceptDeviceSigningVerification(request, version);
    }

    /**
     * Send key agreement step
     */
    public async sendKeyAgreement(
        request: IDeviceSigningVerificationKeyAgreementRequest,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationKeyAgreementResponse> {
        return this.sendDeviceSigningVerificationKeyAgreement(request, version);
    }

    /**
     * Send MAC confirmation
     */
    public async confirmVerificationMac(
        request: IDeviceSigningVerificationMacRequest,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationMacResponse> {
        return this.confirmDeviceSigningVerificationMac(request, version);
    }

    /**
     * Complete key verification
     */
    public async completeKeyVerification(
        txnId: string,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationDoneResponse> {
        const request: IDeviceSigningVerificationDoneRequest = { transaction_id: txnId };
        return this.completeDeviceSigningVerification(request, version);
    }

    /**
     * Cancel key verification
     */
    public async cancelKeyVerification(
        txnId: string,
        reason = DEFAULT_CANCEL_REASON,
        code = DEFAULT_CANCEL_CODE,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationCancelResponse> {
        return this.cancelDeviceSigningVerification(
            {
                transaction_id: txnId,
                code,
                reason,
            },
            version,
        );
    }

    /**
     * Get verification requests
     */
    public getVerificationRequests(
        _userIdOrVersion?: string,
        version: VerificationApiVersion = "v1",
    ): Promise<IVerificationRequestsResponse> {
        if (_userIdOrVersion === "v1" || _userIdOrVersion === "r0" || _userIdOrVersion === "v3") {
            return this.getVerificationRequestsHttp(_userIdOrVersion);
        }

        return this.getVerificationRequestsHttp(version);
    }

    public async showQrCode(
        transactionId: string,
        version: VerificationApiVersion = "v1",
    ): Promise<{ qr_code_data: string; transaction_id: string }> {
        return this.withRetry(
            async () =>
                await this.request({
                    method: Method.Get,
                    path: `/keys/qr_code/show`,
                    queryParams: { transaction_id: transactionId },
                    prefix: resolveVerificationPrefix(version),
                }),
            "showQrCode",
        );
    }

    public async scanQrCode(
        qrCodeData: string,
        transactionId?: string,
        version: VerificationApiVersion = "v1",
    ): Promise<{ transaction_id: string; verified: boolean }> {
        return this.withRetry(
            async () =>
                await this.request({
                    method: Method.Post,
                    path: `/keys/qr_code/scan`,
                    body: { qr_code_data: qrCodeData, transaction_id: transactionId },
                    prefix: resolveVerificationPrefix(version),
                }),
            "scanQrCode",
        );
    }

    private getAuthedRequestProxy() {
        return <T>(
            method: Method,
            path: string,
            queryParams?: QueryDict,
            body?: Body,
            _requestOpts?: IRequestOpts,
        ): Promise<T> =>
            this.request<T>({
                method: method,
                path: path,
                queryParams: queryParams,
                body: body,
            });
    }

    public startDeviceSigningVerification(
        request: IDeviceSigningVerificationStartRequest,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationStartResponse> {
        return startDeviceSigningVerificationRequest<IDeviceSigningVerificationStartResponse>(
            request,
            resolveVerificationPrefix(version),
            this.getAuthedRequestProxy(),
        );
    }

    public acceptDeviceSigningVerification(
        request: IDeviceSigningVerificationAcceptRequest,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationAcceptResponse> {
        return acceptDeviceSigningVerificationRequest<IDeviceSigningVerificationAcceptResponse>(
            request,
            resolveVerificationPrefix(version),
            this.getAuthedRequestProxy(),
        );
    }

    public sendDeviceSigningVerificationKeyAgreement(
        request: IDeviceSigningVerificationKeyAgreementRequest,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationKeyAgreementResponse> {
        return sendDeviceSigningVerificationKeyAgreementRequest<IDeviceSigningVerificationKeyAgreementResponse>(
            request,
            resolveVerificationPrefix(version),
            this.getAuthedRequestProxy(),
        );
    }

    public confirmDeviceSigningVerificationMac(
        request: IDeviceSigningVerificationMacRequest,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationMacResponse> {
        return confirmDeviceSigningVerificationMacRequest<IDeviceSigningVerificationMacResponse>(
            request,
            resolveVerificationPrefix(version),
            this.getAuthedRequestProxy(),
        );
    }

    public completeDeviceSigningVerification(
        request: IDeviceSigningVerificationDoneRequest,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationDoneResponse> {
        return completeDeviceSigningVerificationRequest<IDeviceSigningVerificationDoneResponse>(
            request,
            resolveVerificationPrefix(version),
            this.getAuthedRequestProxy(),
        );
    }

    public cancelDeviceSigningVerification(
        request: IDeviceSigningVerificationCancelRequest,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationCancelResponse> {
        return cancelDeviceSigningVerificationRequest<IDeviceSigningVerificationCancelResponse>(
            request,
            resolveVerificationPrefix(version),
            this.getAuthedRequestProxy(),
        );
    }

    public getVerificationRequestsHttp(version: VerificationApiVersion = "v1"): Promise<IVerificationRequestsResponse> {
        return getVerificationRequestsHttpRequest<IVerificationRequestsResponse>(
            resolveVerificationPrefix(version),
            this.getAuthedRequestProxy(),
        );
    }

    public showQrCodeHttp(version: VerificationApiVersion = "v1"): Promise<IShowQrCodeResponse> {
        return showQrCodeHttpRequest<IShowQrCodeResponse>(
            resolveVerificationPrefix(version),
            this.getAuthedRequestProxy(),
        );
    }

    public scanQrCodeHttp(
        request: IScanQrCodeRequest,
        version: VerificationApiVersion = "v1",
    ): Promise<IScanQrCodeResponse> {
        return scanQrCodeHttpRequest<IScanQrCodeResponse>(
            request,
            resolveVerificationPrefix(version),
            this.getAuthedRequestProxy(),
        );
    }

    public async getVerificationStatus(
        transactionId: string,
        version: VerificationApiVersion = "v1",
    ): Promise<IVerificationStatusResponse> {
        this.requireNonEmptyString(transactionId, "transactionId");
        return await this.withRetry(async () => {
            return await this.request<IVerificationStatusResponse>({
                method: Method.Get,
                path: `/keys/verification/${encodeURIComponent(transactionId)}`,
                prefix: resolveVerificationPrefix(version),
            });
        }, "getVerificationStatus");
    }
}

// Declare prototype extension

export function extendMatrixClient(): void {
    MatrixClient.prototype.getKeyVerificationManager = function (): KeyVerificationManager {
        registerManagerClass("keyVerification", KeyVerificationManager);
        return getOrCreateManager(this, "keyVerification", () => new KeyVerificationManager(this));
    };
}

export default extendMatrixClient;
