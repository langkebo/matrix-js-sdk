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
 * 对应后端: synapse-rust/src/web/routes/e2ee_routes.rs
 *
 * 后端端点:
 * - POST /keys/upload
 * - POST /keys/query
 * - POST /keys/claim
 * - GET /keys/changes
 * - POST /keys/device_list/update
 * - POST /keys/signatures/upload
 * - POST /keys/device_signing/upload
 * - GET /rooms/{room_id}/keys/distribution
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { BaseManager } from "../managers/base-manager";
import { NotFoundError } from "../errors";
import { logger } from "../logger";
import { LRUCache } from "../utils/lru-cache";
import { getOrCreateManager } from "../client-infra/manager-registry";
import type { KeySignatures, IUploadKeySignaturesResponse, IDownloadKeyResult, IClaimOTKsResult } from "../client-api-types";

export interface IDeviceKeys {
    user_id: string;
    device_id: string;
    algorithms: string[];
    keys: Record<string, string>;
    signatures?: Record<string, Record<string, string>>;
    unsigned?: {
        device_display_name: string;
        [key: string]: unknown;
    };
}

export interface IOneTimeKey {
    key: string;
    signatures?: Record<string, Record<string, string>>;
}

export interface IKeysUploadRequest {
    device_keys?: IDeviceKeys;
    one_time_keys?: Record<string, IOneTimeKey | string>;
    "org.matrix.msc2732.fallback_keys"?: Record<string, IOneTimeKey | string>;
}

export interface IKeysUploadResponse {
    one_time_key_counts: Record<string, number>;
}

export interface IKeysQueryRequest {
    device_keys: Record<string, string[]>;
    timeout?: number;
    token?: string;
}

export interface IKeysClaimRequest {
    one_time_keys: Record<string, Record<string, string>>;
    timeout?: number;
}

export interface IKeysChangesResponse {
    changed: string[];
    left: string[];
}

export interface IDeviceSigningUploadRequest {
    master_key?: IDeviceKeys;
    self_signing_key?: IDeviceKeys;
}

export interface IRoomKeyDistributionResponse {
    room_id: string;
    algorithm: string;
    session_id: string;
    session_key: string;
}
export class CryptoKeysManager extends BaseManager {
    private deviceKeysCache: LRUCache<IDeviceKeys>;

    constructor(client: MatrixClient) {
        super(client);
        this.deviceKeysCache = new LRUCache<IDeviceKeys>({
            maxSize: 500,
            ttl: 10 * 60 * 1000,
            name: "index.ts-idevicekeys",
        });
    }

    async uploadKeys(content: IKeysUploadRequest): Promise<IKeysUploadResponse> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IKeysUploadResponse>(
                    Method.Post,
                    "/keys/upload",
                    undefined,
                    content,
                    { prefix: ClientPrefix.V3 },
                );
            }, "uploadKeys");

            return response;
        } catch (error) {
            throw this.normalizeError(error, "uploadKeys");
        }
    }

    async queryKeys(userIds: string[], opts: { token?: string; timeout?: number } = {}): Promise<IDownloadKeyResult> {
        const cacheKey = `query:${userIds.join(",")}`;
        const cached = this.deviceKeysCache.get(cacheKey);
        if (cached && !opts.token) {
            return {
                device_keys: {
                    [cached.user_id]: {
                        [cached.device_id]: cached,
                    },
                },
                failures: {},
            };
        }

        const content: IKeysQueryRequest = {
            device_keys: {},
        };

        for (const userId of userIds) {
            content.device_keys[userId] = [];
        }

        if (opts.token) content.token = opts.token;
        if (opts.timeout) content.timeout = opts.timeout;

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IDownloadKeyResult>(
                    Method.Post,
                    "/keys/query",
                    undefined,
                    content,
                    { prefix: ClientPrefix.V3 },
                );
            }, "queryKeys");

            for (const [userId, devices] of Object.entries(response.device_keys || {})) {
                for (const [deviceId, deviceKeys] of Object.entries(devices)) {
                    this.deviceKeysCache.set(`${userId}:${deviceId}`, deviceKeys);
                }
            }

            return response;
        } catch (error) {
            throw this.normalizeError(error, "queryKeys");
        }
    }

    async claimKeys(
        devices: [string, string][],
        keyAlgorithm = "signed_curve25519",
        timeout?: number,
    ): Promise<IClaimOTKsResult> {
        const queries: Record<string, Record<string, string>> = {};
        for (const [userId, deviceId] of devices) {
            if (!queries[userId]) {
                queries[userId] = {};
            }
            queries[userId][deviceId] = keyAlgorithm;
        }

        const content: IKeysClaimRequest = {
            one_time_keys: queries,
        };
        if (timeout) content.timeout = timeout;

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IClaimOTKsResult>(
                    Method.Post,
                    "/keys/claim",
                    undefined,
                    content,
                    { prefix: ClientPrefix.V3 },
                );
            }, "claimKeys");

            return response;
        } catch (error) {
            throw this.normalizeError(error, "claimKeys");
        }
    }

    async getKeysChanges(from: string, to: string): Promise<IKeysChangesResponse> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IKeysChangesResponse>(
                    Method.Get,
                    "/keys/changes",
                    { from, to },
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "getKeysChanges");

            return response;
        } catch (error) {
            throw this.normalizeError(error, "getKeysChanges");
        }
    }

    async updateDeviceList(): Promise<void> {
        try {
            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Post,
                    "/keys/device_list/update",
                    undefined,
                    {},
                    { prefix: ClientPrefix.V3 },
                );
            }, "updateDeviceList");
        } catch (error) {
            throw this.normalizeError(error, "updateDeviceList");
        }
    }

    async uploadKeySignatures(
        signatures: KeySignatures,
    ): Promise<IUploadKeySignaturesResponse> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IUploadKeySignaturesResponse>(
                    Method.Post,
                    "/keys/signatures/upload",
                    undefined,
                    { signatures },
                    { prefix: ClientPrefix.V3 },
                );
            }, "uploadKeySignatures");

            return response;
        } catch (error) {
            throw this.normalizeError(error, "uploadKeySignatures");
        }
    }

    async uploadDeviceSigning(masterKey?: IDeviceKeys, selfSigningKey?: IDeviceKeys): Promise<void> {
        const content: IDeviceSigningUploadRequest = {};
        if (masterKey) content.master_key = masterKey;
        if (selfSigningKey) content.self_signing_key = selfSigningKey;

        try {
            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Post,
                    "/keys/device_signing/upload",
                    undefined,
                    content,
                    { prefix: ClientPrefix.V3 },
                );
            }, "uploadDeviceSigning");
        } catch (error) {
            throw this.normalizeError(error, "uploadDeviceSigning");
        }
    }

    /**
     * 获取房间密钥分发信息
     *
     * @param roomId - 房间 ID
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 分发信息
     */
    async getRoomKeyDistribution(roomId: string, throwOnError = true): Promise<IRoomKeyDistributionResponse | null> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IRoomKeyDistributionResponse>(
                    Method.Get,
                    `/rooms/${encodeURIComponent(roomId)}/keys/distribution`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "getRoomKeyDistribution");

            return response;
        } catch (error) {
            const err = this.normalizeError(error, "getRoomKeyDistribution");
            if (throwOnError) {
                throw err;
            }
            if (err instanceof NotFoundError) {
                logger.warn(`CryptoKeysManager.getRoomKeyDistribution failed for ${roomId}:`, err);
                return null;
            }
            throw err;
        }
    }

    getDeviceKeysFromCache(userId: string, deviceId: string): IDeviceKeys | undefined {
        return this.deviceKeysCache.get(`${userId}:${deviceId}`);
    }

    clearCache(): void {
        this.deviceKeysCache.clear();
    }

    getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        return this.deviceKeysCache.getStats();
    }

}

declare module "../client.ts" {
    interface MatrixClient {
        getCryptoKeysManager(): CryptoKeysManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCryptoKeysManager = function (): CryptoKeysManager {
        return getOrCreateManager(this, "cryptoKeys", () => new CryptoKeysManager(this));
    };
}

export default extendMatrixClient;
