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

export class IdentityManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get identity server URL
     */
    public getIdentityServerUrl(): string | undefined {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).idBaseUrl;
    }

    /**
     * Lookup 3PID
     */
    public async lookup3pid(medium: string, address: string): Promise<any> {
        const path = "/_matrix/identity/v1/lookup";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Get, path, { medium, address });
    }

    /**
     * Store 3PID
     */
    public async store3pid(medium: string, address: string, validationToken: string): Promise<any> {
        const path = "/_matrix/identity/v1/store-invite";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Post, path, undefined, {
            medium,
            address,
            token: validationToken
        });
    }

    /**
     * Request verification token
     */
    public async requestVerificationToken(medium: string, address: string): Promise<any> {
        const path = "/_matrix/identity/v1/validate/email/requestToken";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Post, path, undefined, {
            email: address,
            sendAttempt: 1
        });
    }

    /**
     * Bind 3PID
     */
    public async bind3pid(medium: string, address: string, mxid: string, token: string): Promise<any> {
        const path = "/_matrix/identity/v1/3pid/bind";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Post, path, undefined, {
            sid: token,
            client_secret: mxid,
            mxid
        });
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getIdentityManager(): IdentityManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getIdentityManager = function (): IdentityManager {
        return new IdentityManager(this);
    };
}

export default extendMatrixClient;
