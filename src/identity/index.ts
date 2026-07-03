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
 * Identity Manager - 身份管理
 *
 * 提供身份服务器相关功能
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface Lookup3PidResult {
    mxid: string;
    display_name?: string;
}

export interface Store3PidResult {
    token: string;
    public_keys: string[];
    display_name: string;
}

export interface VerificationTokenResult {
    sid: string;
    submit_url?: string;
}

export interface Bind3PidResult {
    mxid: string;
    address: string;
    medium: string;
}

export interface IdentityManagerEvents {
    identity_verified: { medium: string; address: string };
    identity_bound: { mxid: string; medium: string };
}

export class IdentityManager extends BaseManager<keyof IdentityManagerEvents, IdentityManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public getIdentityServerUrl(): string | undefined {
        return this.client.idBaseUrl;
    }

    public async lookup3pid(medium: string, address: string): Promise<Lookup3PidResult | null> {
        return this.withRetry(async () => {
            const path = "/_matrix/identity/v1/lookup";
            return this.request<Lookup3PidResult | null>({
                method: Method.Get,
                path: path,
                queryParams: { medium, address },
            });
        }, "lookup3pid");
    }

    public async store3pid(medium: string, address: string, validationToken: string): Promise<Store3PidResult> {
        return this.withRetry(async () => {
            const path = "/_matrix/identity/v1/store-invite";
            return this.request<Store3PidResult>({
                method: Method.Post,
                path: path,
                body: {
                    medium,
                    address,
                    token: validationToken,
                },
            });
        }, "store3pid");
    }

    public async requestVerificationToken(medium: string, address: string): Promise<VerificationTokenResult> {
        return this.withRetry(async () => {
            const path = "/_matrix/identity/v1/validate/email/requestToken";
            return this.request<VerificationTokenResult>({
                method: Method.Post,
                path: path,
                body: {
                    email: address,
                    sendAttempt: 1,
                },
            });
        }, "requestVerificationToken");
    }

    public async bind3pid(medium: string, address: string, mxid: string, token: string): Promise<Bind3PidResult> {
        return this.withRetry(async () => {
            const path = "/_matrix/identity/v1/3pid/bind";
            return this.request<Bind3PidResult>({
                method: Method.Post,
                path: path,
                body: {
                    sid: token,
                    client_secret: mxid,
                    mxid,
                },
            });
        }, "bind3pid");
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getIdentityManager = function (): IdentityManager {
        registerManagerClass("identity", IdentityManager);
        return getOrCreateManager(this, "identity", () => new IdentityManager(this));
    };
}

export default extendMatrixClient;
