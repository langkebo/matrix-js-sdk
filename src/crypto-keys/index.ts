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
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { NotFoundError } from "../errors";
import { logger } from "../logger";
import { LRUCache } from "../utils/lru-cache";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type {
    KeySignatures,
    IUploadKeySignaturesResponse,
    IDownloadKeyResult,
    IClaimOTKsResult,
} from "../client-api-types";

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

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
        this.deviceKeysCache = new LRUCache<IDeviceKeys>({
            maxSize: 500,
            ttl: 10 * 60 * 1000,
            name: "index.ts-idevicekeys",
        });
    }

    /**
     * 上传本设备的设备密钥、一次性密钥（OTK）与兜底密钥（POST /keys/upload）。
     *
     * @param content 待上传的密钥内容（设备密钥、一次性密钥等）。
     * @returns 各算法已上传的一次性密钥数量。
     * @throws {SdkError} 请求失败（网络错误或后端 HTTP 错误会被归一化为 SdkError）。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getCryptoKeysManager();
     * const result = await mgr.uploadKeys({ device_keys: deviceKeys });
     * ```
     */
    async uploadKeys(content: IKeysUploadRequest): Promise<IKeysUploadResponse> {
        try {
            const response = await this.withRetry(async () => {
                return await this.request<IKeysUploadResponse>({
                    method: Method.Post,
                    path: "/keys/upload",
                    body: content,
                    prefix: ClientPrefix.V3,
                });
            }, "uploadKeys");

            return response;
        } catch (error) {
            throw this.normalizeError(error, "uploadKeys");
        }
    }

    /**
     * 查询指定用户的设备密钥（POST /keys/query），命中本地缓存时直接返回。
     *
     * @param userIds 需要查询的用户 ID 列表。
     * @param opts 可选参数：`token` 增量查询游标、`timeout` 超时毫秒数。
     * @returns 设备密钥查询结果（含 `device_keys` 与 `failures`）。
     * @throws {SdkError} 请求失败。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getCryptoKeysManager();
     * const result = await mgr.queryKeys(["@alice:example.com"]);
     * ```
     */
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
                return await this.request<IDownloadKeyResult>({
                    method: Method.Post,
                    path: "/keys/query",
                    body: content,
                    prefix: ClientPrefix.V3,
                });
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

    /**
     * 认领指定设备的一次性密钥（POST /keys/claim）。
     *
     * @param devices `[userId, deviceId]` 二元组列表。
     * @param keyAlgorithm 期望的密钥算法，默认 `signed_curve25519`。
     * @param timeout 可选超时毫秒数。
     * @returns 认领到的一次性密钥结果。
     * @throws {SdkError} 请求失败。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getCryptoKeysManager();
     * const result = await mgr.claimKeys([["@alice:example.com", "DEVICEID"]]);
     * ```
     */
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
                return await this.request<IClaimOTKsResult>({
                    method: Method.Post,
                    path: "/keys/claim",
                    body: content,
                    prefix: ClientPrefix.V3,
                });
            }, "claimKeys");

            return response;
        } catch (error) {
            throw this.normalizeError(error, "claimKeys");
        }
    }

    /**
     * 获取指定同步区间内密钥发生变化的用户（GET /keys/changes）。
     *
     * @param from 起始同步令牌。
     * @param to 结束同步令牌。
     * @returns 变化/离场用户列表（`changed` 与 `left`）。
     * @throws {SdkError} 请求失败。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getCryptoKeysManager();
     * const changes = await mgr.getKeysChanges(fromToken, toToken);
     * ```
     */
    async getKeysChanges(from: string, to: string): Promise<IKeysChangesResponse> {
        try {
            const response = await this.withRetry(async () => {
                return await this.request<IKeysChangesResponse>({
                    method: Method.Get,
                    path: "/keys/changes",
                    queryParams: { from, to },
                    prefix: ClientPrefix.V3,
                });
            }, "getKeysChanges");

            return response;
        } catch (error) {
            throw this.normalizeError(error, "getKeysChanges");
        }
    }

    /**
     * 上报本设备列表已更新（POST /keys/device_list/update）。
     *
     * @returns 无返回值。
     * @throws {SdkError} 请求失败。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getCryptoKeysManager();
     * await mgr.updateDeviceList();
     * ```
     */
    async updateDeviceList(): Promise<void> {
        try {
            await this.withRetry(async () => {
                return await this.request({
                    method: Method.Post,
                    path: "/keys/device_list/update",
                    body: {},
                    prefix: ClientPrefix.V3,
                });
            }, "updateDeviceList");
        } catch (error) {
            throw this.normalizeError(error, "updateDeviceList");
        }
    }

    /**
     * 上传密钥交叉签名（POST /keys/signatures/upload）。
     *
     * @param signatures 签名映射（按用户 / 密钥组织）。
     * @returns 上传结果（含失败项信息）。
     * @throws {SdkError} 请求失败。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getCryptoKeysManager();
     * const result = await mgr.uploadKeySignatures(signatures);
     * ```
     */
    async uploadKeySignatures(signatures: KeySignatures): Promise<IUploadKeySignaturesResponse> {
        try {
            const response = await this.withRetry(async () => {
                return await this.request<IUploadKeySignaturesResponse>({
                    method: Method.Post,
                    path: "/keys/signatures/upload",
                    // Matrix 规范：请求体**直接是签名映射**；`{ signatures }` 的包一层是
                    // 后端为历史写法保留的兼容分支（`device_keys/service.rs` 的
                    // `body.get("signatures").unwrap_or(body)`），SDK 不再产生它。
                    body: signatures,
                    prefix: ClientPrefix.V3,
                });
            }, "uploadKeySignatures");

            return response;
        } catch (error) {
            throw this.normalizeError(error, "uploadKeySignatures");
        }
    }

    /**
     * 上传设备签名密钥（主密钥 / 自签名密钥，POST /keys/device_signing/upload）。
     *
     * @param masterKey 可选的主密钥（master key）。
     * @param selfSigningKey 可选的自签名密钥（self-signing key）。
     * @returns 无返回值。
     * @throws {SdkError} 请求失败。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getCryptoKeysManager();
     * await mgr.uploadDeviceSigning(masterKey, selfSigningKey);
     * ```
     */
    async uploadDeviceSigning(masterKey?: IDeviceKeys, selfSigningKey?: IDeviceKeys): Promise<void> {
        const content: IDeviceSigningUploadRequest = {};
        if (masterKey) content.master_key = masterKey;
        if (selfSigningKey) content.self_signing_key = selfSigningKey;

        try {
            await this.withRetry(async () => {
                return await this.request({
                    method: Method.Post,
                    path: "/keys/device_signing/upload",
                    body: content,
                    prefix: ClientPrefix.V3,
                });
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
     * @throws {NotFoundError} `throwOnError` 为 true 且房间密钥分发不存在时抛出。
     * @throws {SdkError} 其它请求失败（`throwOnError` 为 true 时）。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getCryptoKeysManager();
     * const dist = await mgr.getRoomKeyDistribution("!room:example.com");
     * ```
     */
    async getRoomKeyDistribution(roomId: string, throwOnError = true): Promise<IRoomKeyDistributionResponse | null> {
        try {
            const response = await this.withRetry(async () => {
                return await this.request<IRoomKeyDistributionResponse>({
                    method: Method.Get,
                    path: `/rooms/${encodeURIComponent(roomId)}/keys/distribution`,
                    prefix: ClientPrefix.V3,
                });
            }, "getRoomKeyDistribution");

            return response;
        } catch (error) {
            const err = this.normalizeError(error, "getRoomKeyDistribution");
            if (throwOnError) {
                throw err;
            }
            if (err instanceof NotFoundError) {
                // @swallow-error { owner: "crypto-keys", expires: "2026-12-31" }
                logger.warn(`CryptoKeysManager.getRoomKeyDistribution failed for ${roomId}:`, err);
                return null;
            }
            throw err;
        }
    }

    /**
     * 从本地缓存读取指定设备的设备密钥（不发起网络请求）。
     *
     * @param userId 用户 ID。
     * @param deviceId 设备 ID。
     * @returns 缓存的设备密钥；未命中时返回 `undefined`。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getCryptoKeysManager();
     * const deviceKeys = mgr.getDeviceKeysFromCache("@alice:example.com", "DEVICEID");
     * ```
     */
    getDeviceKeysFromCache(userId: string, deviceId: string): IDeviceKeys | undefined {
        return this.deviceKeysCache.get(`${userId}:${deviceId}`);
    }

    /**
     * 清空设备密钥缓存。
     *
     * @returns 无返回值。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getCryptoKeysManager();
     * mgr.clearCache();
     * ```
     */
    clearCache(): void {
        this.deviceKeysCache.clear();
    }

    /**
     * 获取设备密钥缓存的命中统计。
     *
     * @returns 缓存大小、命中次数、未命中次数与命中率。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getCryptoKeysManager();
     * const stats = mgr.getCacheStats();
     * ```
     */
    getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        return this.deviceKeysCache.getStats();
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCryptoKeysManager = function (): CryptoKeysManager {
        registerManagerClass("cryptoKeys", CryptoKeysManager);
        return getOrCreateManager(this, "cryptoKeys", () => new CryptoKeysManager(this));
    };
}
