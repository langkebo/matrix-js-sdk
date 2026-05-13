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
 * QR Login Manager - QR 登录管理
 *
 * 提供 QR 码登录功能 (MSC4388)
 * 对应后端 API:
 * - GET /_matrix/client/v1/login/get_qr_code
 * - POST /_matrix/client/v1/login/qr/start
 * - POST /_matrix/client/v1/login/qr/confirm
 * - GET /_matrix/client/v1/login/qr/{transaction_id}/status
 * - POST /_matrix/client/v1/login/qr/invalidate
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import type { AuthPathPattern } from "../auth/__generated__/route-table.ts";
import { getOrCreateManager } from "../client-infra/manager-registry";

type StripAuthPrefix<P extends string> =
    P extends `/_matrix/client/v3${infer Rest}` ? Rest :
    P extends `/_matrix/client/r0${infer Rest}` ? Rest :
    P extends `/_matrix/client/v1${infer Rest}` ? Rest :
    P;

function ap<P extends StripAuthPrefix<AuthPathPattern>>(path: P): P {
    return path;
}

export interface QrCodeResponse {
    transaction_id: string;
    mode: string;
    challenge: string;
    expires_in: number;
}

export interface QrLoginStartRequest {
    transaction_id: string;
    device_id?: string;
    initial_display_name?: string;
}

export interface QrLoginStartResponse {
    transaction_id: string;
    user_id: string;
    device_id?: string;
    initial_display_name?: string;
    status: string;
}

export interface QrLoginConfirmRequest {
    transaction_id: string;
}

export interface QrLoginConfirmResponse {
    transaction_id: string;
    status: string;
}

export interface QrLoginStatusResponse {
    transaction_id: string;
    user_id: string;
    status: "pending" | "confirmed" | "expired" | "invalidated";
}

export interface QrLoginInvalidateRequest {
    transaction_id: string;
}

export interface QrLoginInvalidateResponse {
    transaction_id: string;
    status: string;
}

export type QrLoginStatus = "pending" | "confirmed" | "expired" | "invalidated";

export class QrLoginManager {
    constructor(private client: MatrixClient) {}

    public async getQrCode(): Promise<QrCodeResponse> {
        return this.client.http.request<QrCodeResponse>(
            Method.Get,
            ap("/login/get_qr_code"),
            undefined,
            undefined,
            {
                prefix: ClientPrefix.V1,
            },
        );
    }

    public async startQrLogin(request: QrLoginStartRequest): Promise<QrLoginStartResponse> {
        return this.client.http.request<QrLoginStartResponse>(Method.Post, ap("/login/qr/start"), undefined, request, {
            prefix: ClientPrefix.V1,
        });
    }

    public async confirmQrLogin(request: QrLoginConfirmRequest): Promise<QrLoginConfirmResponse> {
        return this.client.http.authedRequest<QrLoginConfirmResponse>(
            Method.Post,
            ap("/login/qr/confirm"),
            undefined,
            request,
            { prefix: ClientPrefix.V1 },
        );
    }

    public async getQrStatus(transactionId: string): Promise<QrLoginStatusResponse> {
        const path = ap(`/login/qr/${encodeURIComponent(transactionId)}/status` as StripAuthPrefix<AuthPathPattern>);
        return this.client.http.request<QrLoginStatusResponse>(Method.Get, path, undefined, undefined, {
            prefix: ClientPrefix.V1,
        });
    }

    public async invalidateQrLogin(request: QrLoginInvalidateRequest): Promise<QrLoginInvalidateResponse> {
        return this.client.http.request<QrLoginInvalidateResponse>(
            Method.Post,
            ap("/login/qr/invalidate"),
            undefined,
            request,
            { prefix: ClientPrefix.V1 },
        );
    }

    public async waitForConfirmation(
        transactionId: string,
        timeoutMs: number = 300000,
        pollIntervalMs: number = 2000,
    ): Promise<QrLoginStatusResponse> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            const status = await this.getQrStatus(transactionId);

            if (status.status === "confirmed") {
                return status;
            }

            if (status.status === "expired" || status.status === "invalidated") {
                throw new Error(`QR login ${status.status}: ${transactionId}`);
            }

            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }

        throw new Error(`QR login timed out after ${timeoutMs}ms`);
    }
}

declare module "../client" {
    interface MatrixClient {
        getQrLoginManager(): QrLoginManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getQrLoginManager = function (): QrLoginManager {
        return getOrCreateManager(this, "qrLogin", () => new QrLoginManager(this));
    };
}

export default extendMatrixClient;
