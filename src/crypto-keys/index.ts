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
 * Crypto Keys Manager - 加密密钥管理
 * 
 * 提供密钥上传、下载、认领等功能
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";

export class CryptoKeysManager {
    constructor(private client: MatrixClient) {}

    /**
     * Upload keys
     */
    public uploadKeysRequest(content: any): Promise<any> {
        const path = "/keys/upload";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Post, path, undefined, content);
    }

    /**
     * Upload key signatures
     */
    public uploadKeySignatures(content: any): Promise<any> {
        const path = "/keys/signatures/upload";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Post, path, undefined, content);
    }

    /**
     * Download keys for users
     */
    public downloadKeysForUsers(userIds: string[], opts: { token?: string } = {}): Promise<any> {
        const content: Record<string, any> = {
            device_keys: {},
        };
        if (opts.token !== undefined) {
            content.token = opts.token;
        }
        userIds.forEach((u) => {
            content.device_keys[u] = [];
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Post, "/keys/query", undefined, content);
    }

    /**
     * Claim one-time keys
     */
    public claimOneTimeKeys(
        devices: [string, string][],
        keyAlgorithm = "signed_curve25519",
        timeout?: number,
    ): Promise<any> {
        const queries: Record<string, Record<string, string>> = {};
        for (const [userId, deviceId] of devices) {
            queries[userId] = { [deviceId]: keyAlgorithm };
        }

        const content: Record<string, any> = { one_time_keys: queries };
        if (timeout) content.timeout = timeout;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Post, "/keys/claim", undefined, content);
    }

    /**
     * Query keys
     */
    public queryKeys(userIds: string[], opts: { token?: string; timeout?: number } = {}): Promise<any> {
        const content: Record<string, any> = { device_keys: {} };
        
        for (const userId of userIds) {
            content.device_keys[userId] = [];
        }
        
        if (opts.token) content.token = opts.token;
        if (opts.timeout) content.timeout = opts.timeout;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Post, "/keys/query", undefined, content);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getCryptoKeysManager(): CryptoKeysManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCryptoKeysManager = function (): CryptoKeysManager {
        return new CryptoKeysManager(this);
    };
}

export default extendMatrixClient;
