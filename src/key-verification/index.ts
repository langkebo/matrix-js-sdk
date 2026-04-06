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

import {
    type IDeviceSigningVerificationAcceptRequest,
    type IDeviceSigningVerificationAcceptResponse,
    type IDeviceSigningVerificationCancelResponse,
    type IDeviceSigningVerificationDoneResponse,
    type IDeviceSigningVerificationDoneRequest,
    type IDeviceSigningVerificationKeyAgreementResponse,
    type IDeviceSigningVerificationKeyAgreementRequest,
    type IDeviceSigningVerificationMacResponse,
    type IDeviceSigningVerificationMacRequest,
    type IDeviceSigningVerificationStartResponse,
    type IDeviceSigningVerificationStartRequest,
    type IVerificationRequestsResponse,
    MatrixClient,
} from "../client";

type VerificationApiVersion = "v1" | "r0";

const DEFAULT_CANCEL_CODE = "m.user";
const DEFAULT_CANCEL_REASON = "Cancelled by user";

export class KeyVerificationManager {
    constructor(private client: MatrixClient) {}

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
        roomId: string,
        userId: string,
        version: VerificationApiVersion = "v1",
    ): Promise<IDeviceSigningVerificationStartResponse> {
        const request: IDeviceSigningVerificationStartRequest = {
            from_device: this.client.getDeviceId() ?? "",
            to_user: userId,
            method: "sas",
        };
        void roomId;
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
        userIdOrVersion?: string,
        version: VerificationApiVersion = "v1",
    ): Promise<IVerificationRequestsResponse> {
        if (userIdOrVersion === "v1" || userIdOrVersion === "r0") {
            return this.client.getVerificationRequests(userIdOrVersion);
        }

        void userIdOrVersion;
        return this.client.getVerificationRequests(version);
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
        return new KeyVerificationManager(this);
    };
}

export default extendMatrixClient;
