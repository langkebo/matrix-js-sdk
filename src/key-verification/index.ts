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

import { getOrCreateManager } from "../client-infra/manager-registry";
import { BaseManager } from "../managers/base-manager";
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

type VerificationApiVersion = "v1" | "r0";

const DEFAULT_CANCEL_CODE = "m.user";
const DEFAULT_CANCEL_REASON = "Cancelled by user";

export class KeyVerificationManager extends BaseManager {
    constructor(client: MatrixClient) {
        super(client);
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
        return this.client.startDeviceSigningVerification(request, version);
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
        return this.client.startDeviceSigningVerification(request, version);
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
        return this.client.startDeviceSigningVerification(request, version);
    }

    /**
     * Accept device signing verification
     */
    public async acceptKeyVerification(
        request: IDeviceSigningVerificationAcceptRequest,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationAcceptResponse> {
        return this.client.acceptDeviceSigningVerification(request, version);
    }

    /**
     * Send key agreement step
     */
    public async sendKeyAgreement(
        request: IDeviceSigningVerificationKeyAgreementRequest,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationKeyAgreementResponse> {
        return this.client.sendDeviceSigningVerificationKeyAgreement(request, version);
    }

    /**
     * Send MAC confirmation
     */
    public async confirmVerificationMac(
        request: IDeviceSigningVerificationMacRequest,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationMacResponse> {
        return this.client.confirmDeviceSigningVerificationMac(request, version);
    }

    /**
     * Complete key verification
     */
    public async completeKeyVerification(
        txnId: string,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationDoneResponse> {
        const request: IDeviceSigningVerificationDoneRequest = { transaction_id: txnId };
        return this.client.completeDeviceSigningVerification(request, version);
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
        return this.client.cancelDeviceSigningVerification(
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
        if (_userIdOrVersion === "v1" || _userIdOrVersion === "r0") {
            return this.client.getVerificationRequests(_userIdOrVersion);
        }

        return this.client.getVerificationRequests(version);
    }

    public async showQrCode(
        transactionId: string,
        version: VerificationApiVersion = "v1",
    ): Promise<{ qr_code_data: string; transaction_id: string }> {
        const prefix = version === "r0" ? "/_matrix/client/r0" : "/_matrix/client/v1";
        return this.withRetry(
            async () =>
                await this.client.http.authedRequest(
                    Method.Get,
                    `/keys/qr_code/show`,
                    { transaction_id: transactionId },
                    undefined,
                    { prefix },
                ),
            "showQrCode",
        );
    }

    public async scanQrCode(
        qrCodeData: string,
        transactionId?: string,
        version: VerificationApiVersion = "v1",
    ): Promise<{ transaction_id: string; verified: boolean }> {
        const prefix = version === "r0" ? "/_matrix/client/r0" : "/_matrix/client/v1";
        return this.withRetry(
            async () =>
                await this.client.http.authedRequest(
                    Method.Post,
                    `/keys/qr_code/scan`,
                    undefined,
                    { qr_code_data: qrCodeData, transaction_id: transactionId },
                    { prefix },
                ),
            "scanQrCode",
        );
    }

    private getAuthedRequestProxy() {
        return <T>(
            method: Method,
            path: string,
            queryParams?: QueryDict,
            body?: Body,
            requestOpts?: IRequestOpts,
        ): Promise<T> => this.client.http.authedRequest<T>(method, path, queryParams, body, requestOpts);
    }

    public startDeviceSigningVerification(
        request: IDeviceSigningVerificationStartRequest,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationStartResponse> {
        return startDeviceSigningVerificationRequest<IDeviceSigningVerificationStartResponse>(
            request,
            getLegacyClientPrefix(version),
            this.getAuthedRequestProxy(),
        );
    }

    public acceptDeviceSigningVerification(
        request: IDeviceSigningVerificationAcceptRequest,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationAcceptResponse> {
        return acceptDeviceSigningVerificationRequest<IDeviceSigningVerificationAcceptResponse>(
            request,
            getLegacyClientPrefix(version),
            this.getAuthedRequestProxy(),
        );
    }

    public sendDeviceSigningVerificationKeyAgreement(
        request: IDeviceSigningVerificationKeyAgreementRequest,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationKeyAgreementResponse> {
        return sendDeviceSigningVerificationKeyAgreementRequest<IDeviceSigningVerificationKeyAgreementResponse>(
            request,
            getLegacyClientPrefix(version),
            this.getAuthedRequestProxy(),
        );
    }

    public confirmDeviceSigningVerificationMac(
        request: IDeviceSigningVerificationMacRequest,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationMacResponse> {
        return confirmDeviceSigningVerificationMacRequest<IDeviceSigningVerificationMacResponse>(
            request,
            getLegacyClientPrefix(version),
            this.getAuthedRequestProxy(),
        );
    }

    public completeDeviceSigningVerification(
        request: IDeviceSigningVerificationDoneRequest,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationDoneResponse> {
        return completeDeviceSigningVerificationRequest<IDeviceSigningVerificationDoneResponse>(
            request,
            getLegacyClientPrefix(version),
            this.getAuthedRequestProxy(),
        );
    }

    public cancelDeviceSigningVerification(
        request: IDeviceSigningVerificationCancelRequest,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationCancelResponse> {
        return cancelDeviceSigningVerificationRequest<IDeviceSigningVerificationCancelResponse>(
            request,
            getLegacyClientPrefix(version),
            this.getAuthedRequestProxy(),
        );
    }

    public getVerificationRequestsHttp(version: VerificationApiVersion = "v1"): Promise<IVerificationRequestsResponse> {
        return getVerificationRequestsHttpRequest<IVerificationRequestsResponse>(
            getLegacyClientPrefix(version),
            this.getAuthedRequestProxy(),
        );
    }

    public showQrCodeHttp(version: VerificationApiVersion = "v1"): Promise<IShowQrCodeResponse> {
        return showQrCodeHttpRequest<IShowQrCodeResponse>(getLegacyClientPrefix(version), this.getAuthedRequestProxy());
    }

    public scanQrCodeHttp(request: IScanQrCodeRequest, version: VerificationApiVersion = "v1"): Promise<IScanQrCodeResponse> {
        return scanQrCodeHttpRequest<IScanQrCodeResponse>(
            request,
            getLegacyClientPrefix(version),
            this.getAuthedRequestProxy(),
        );
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getKeyVerificationManager(): KeyVerificationManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getKeyVerificationManager = function (): KeyVerificationManager {
        return getOrCreateManager(this, "keyVerification", () => new KeyVerificationManager(this));
    };
}

export default extendMatrixClient;
