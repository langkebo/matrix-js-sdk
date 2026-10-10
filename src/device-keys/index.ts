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
 * Device Keys Manager - 设备密钥管理
 *
 * 提供设备密钥、一次性密钥、签名等 E2EE 核心功能
 * 对应后端: synapse-rust/src/web/routes/e2ee_routes.rs
 *
 * 后端端点 (compat - r0/v1/v3):
 * - POST /keys/upload - 上传设备密钥和一次性密钥
 * - POST /keys/query - 查询设备密钥
 * - POST /keys/claim - 声明一次性密钥
 * - GET /keys/changes - 获取密钥变化
 * - POST /keys/device_list/update - 更新设备列表
 * - POST /keys/signatures - 上传签名
 * - POST /keys/device_signing/upload - 上传设备签名
 * - POST /room_keys/request - 创建密钥请求
 * - GET /room_keys/request - 获取密钥请求
 * - DELETE /room_keys/request/{request_id} - 删除密钥请求
 * - GET /rooms/{room_id}/keys/distribution - 获取房间密钥分发
 * - PUT /sendToDevice/{event_type}/{transaction_id} - 发送设备消息
 */

import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { MatrixClient } from "../client";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type { IContent } from "../models/event";
import type { IDevice } from "../device/index";
import type { IUploadKeysRequest } from "../client-api-types";

export interface DeviceKeys {
    user_id: string;
    device_id: string;
    algorithms: string[];
    keys: Record<string, string>;
    signatures: Record<string, Record<string, string>>;
    unsigned?: IContent; // Dynamic: may contain device_display_name etc.
}

export interface OneTimeKeys {
    [keyId: string]: {
        key: string;
        signatures?: Record<string, Record<string, string>>;
    };
}

export interface UploadKeysResponse {
    one_time_key_counts?: Record<string, number>;
}

export interface FallbackKeys {
    [keyId: string]: {
        key: string;
        signatures?: Record<string, Record<string, string>>;
    };
}

export interface UploadKeysOptions {
    deviceKeys?: DeviceKeys;
    oneTimeKeys?: OneTimeKeys;
    fallbackKeys?: FallbackKeys;
}

export interface QueryKeysRequest {
    device_keys?: Record<string, string[]>;
    token?: string;
}

export interface CrossSigningKey {
    user_id: string;
    usage: string[];
    keys: Record<string, string>;
    signatures?: Record<string, Record<string, string>>;
}

export interface QueryKeysResponse {
    device_keys?: Record<string, Record<string, DeviceKeys>>;
    master_keys?: Record<string, CrossSigningKey>;
    self_signing_keys?: Record<string, CrossSigningKey>;
    user_signing_keys?: Record<string, CrossSigningKey>;
    failures?: Record<string, Record<string, string>>;
}

export interface ClaimKeysRequest {
    one_time_keys: Record<string, Record<string, string>>;
}

export type OneTimeKeysMap = Record<
    string,
    Record<
        string,
        {
            key: string;
            signatures?: Record<string, Record<string, string>>;
        }
    >
>;

export interface ClaimKeysResponse {
    one_time_keys?: OneTimeKeysMap;
    failures?: Record<string, Record<string, string>>;
}

export interface KeyChangesResponse {
    changed?: string[];
    left?: string[];
}

export interface DeviceListUpdateDeviceData {
    display_name?: string | null;
    last_seen_ts?: number | null;
}

export interface DeviceListUpdateEntry {
    user_id: string;
    device_id: string;
    device_data?: DeviceListUpdateDeviceData;
}

export interface DeviceListDeletedEntry {
    user_id: string;
    device_id: string;
}

export interface DeviceListUpdateResponse {
    changed: DeviceListUpdateEntry[];
    deleted: DeviceListDeletedEntry[];
    left: string[];
    stream_id?: number;
}

export interface RoomKeyRequest {
    request_id: string;
    user_id: string;
    device_id: string;
    room_id: string;
    session_id: string;
    algorithm: string;
    request_type?: string;
    action?: string;
    status?: string;
    created_ts?: number;
}

export interface RoomKeyRequestsResponse {
    requests: RoomKeyRequest[];
}

export interface SendToDeviceMessage {
    [userId: string]: {
        [deviceId: string]: IContent;
    };
}

export interface SignaturesUploadResponse {
    failures?: Record<string, Record<string, string>>;
}

export interface KeyDistributionResponse {
    room_id: string;
    algorithm: string;
    session_id: string;
    session_key: string;
}

export enum DeviceKeysEvent {
    KeysUploaded = "KeysUploaded",
    KeysQueried = "KeysQueried",
    KeyClaimed = "KeyClaimed",
    DeviceListUpdated = "DeviceListUpdated",
    RoomKeyRequested = "RoomKeyRequested",
}

interface DeviceKeysManagerEventMap {
    [DeviceKeysEvent.KeysUploaded]: (counts: Record<string, number>) => void;
    [DeviceKeysEvent.KeysQueried]: (deviceKeys: Record<string, Record<string, DeviceKeys>>) => void;
    [DeviceKeysEvent.KeyClaimed]: (keys: OneTimeKeysMap) => void;
    [DeviceKeysEvent.DeviceListUpdated]: (changed: string[], left: string[]) => void;
    [DeviceKeysEvent.RoomKeyRequested]: (requests: RoomKeyRequest[]) => void;
}

export class DeviceKeysManager extends BaseManager<DeviceKeysEvent, DeviceKeysManagerEventMap> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    // normalizeError provided by BaseManager

    /**
     * 上传设备密钥和一次性密钥
     * POST /_matrix/client/v3/keys/upload
     */
    async uploadKeys(options: UploadKeysOptions): Promise<UploadKeysResponse> {
        const body: { device_keys?: DeviceKeys; one_time_keys?: OneTimeKeys; fallback_keys?: FallbackKeys } = {};

        if (options.deviceKeys) {
            body.device_keys = options.deviceKeys;
        }

        if (options.oneTimeKeys) {
            body.one_time_keys = options.oneTimeKeys;
        }

        if (options.fallbackKeys) {
            body.fallback_keys = options.fallbackKeys;
        }

        const response = await this.request<UploadKeysResponse>({
            method: Method.Post,
            path: "/keys/upload",
            body,
            prefix: ClientPrefix.V3,
        });

        if (response.one_time_key_counts) {
            this.emit(DeviceKeysEvent.KeysUploaded, response.one_time_key_counts);
        }

        return response;
    }

    /**
     * 查询设备密钥
     * POST /_matrix/client/v3/keys/query
     */
    async queryKeys(request: QueryKeysRequest): Promise<QueryKeysResponse> {
        const response = await this.request<QueryKeysResponse>({
            method: Method.Post,
            path: "/keys/query",
            body: request,
            prefix: ClientPrefix.V3,
        });

        if (response.device_keys) {
            this.emit(DeviceKeysEvent.KeysQueried, response.device_keys);
        }

        return response;
    }

    /**
     * 声明一次性密钥
     * POST /_matrix/client/v3/keys/claim
     */
    async claimKeys(request: ClaimKeysRequest): Promise<ClaimKeysResponse> {
        const response = await this.request<ClaimKeysResponse>({
            method: Method.Post,
            path: "/keys/claim",
            body: request,
            prefix: ClientPrefix.V3,
        });

        if (response.one_time_keys) {
            this.emit(DeviceKeysEvent.KeyClaimed, response.one_time_keys);
        }

        return response;
    }

    /**
     * 获取密钥变化
     * GET /_matrix/client/v3/keys/changes
     */
    async getKeyChanges(from: string, to?: string): Promise<KeyChangesResponse> {
        const params: Record<string, string> = { from };
        if (to) params.to = to;

        const response = await this.request<KeyChangesResponse>({
            method: Method.Get,
            path: "/keys/changes",
            queryParams: params,
            prefix: ClientPrefix.V3,
        });

        if (response.changed || response.left) {
            this.emit(DeviceKeysEvent.DeviceListUpdated, response.changed || [], response.left || []);
        }

        return response;
    }

    /**
     * 更新设备列表
     * POST /_matrix/client/v3/keys/device_list/update
     */
    async updateDeviceList(users: string[], since?: string): Promise<DeviceListUpdateResponse> {
        const body: { users: string[]; since?: string } = { users };

        if (since) {
            body.since = since;
        }

        const response = await this.request<{
            changed?: DeviceListUpdateEntry[];
            deleted?: DeviceListDeletedEntry[];
            left?: string[];
            stream_id?: number;
        }>({
            method: Method.Post,
            path: "/keys/device_list/update",
            body,
            prefix: ClientPrefix.V3,
        });

        return {
            changed: response.changed || [],
            deleted: response.deleted || [],
            left: response.left || [],
            stream_id: response.stream_id,
        };
    }

    /**
     * 上传跨签名
     *
     * `POST /_matrix/client/v3/keys/signatures/upload`。
     *
     * ⚠️ 2026-10-09 修正：此前打成 `/keys/signatures`（**漏了 `/upload`**）⇒ 必然 404，
     * 即这个方法此前从未真正工作过。同一个 SDK 里其它两处（`client-crypto-requests.ts`、
     * `rust-crypto/OutgoingRequestProcessor.ts`）用的都是带 `/upload` 的正确路径。
     *
     * @example
     * ```typescript
     * await client.getDeviceKeysManager().uploadSignatures({
     *     "@alice:example.org": { DEVICEID: { "ed25519:DEVICEID": "<signature>" } },
     * });
     * ```
     */
    async uploadSignatures(
        signatures: Record<string, Record<string, Record<string, string>>>,
    ): Promise<SignaturesUploadResponse> {
        return await this.request<SignaturesUploadResponse>({
            method: Method.Post,
            path: "/keys/signatures/upload",
            body: signatures,
            prefix: ClientPrefix.V3,
        });
    }

    /**
     * 上传设备签名密钥
     * POST /_matrix/client/v3/keys/device_signing/upload
     */
    async uploadDeviceSigning(keys: {
        master_key?: CrossSigningKey;
        self_signing_key?: CrossSigningKey;
        user_signing_key?: CrossSigningKey;
    }): Promise<void> {
        await this.request<void>({
            method: Method.Post,
            path: "/keys/device_signing/upload",
            body: keys,
            prefix: ClientPrefix.V3,
        });
    }

    /**
     * 创建房间密钥请求
     * POST /_matrix/client/v3/room_keys/request
     */
    async createRoomKeyRequest(request: {
        room_id: string;
        session_id: string;
        algorithm: string;
        request_type?: string;
        request_id?: string;
    }): Promise<{ request_id: string }> {
        const response = await this.request<{ request_id: string }>({
            method: Method.Post,
            path: "/room_keys/request",
            body: request,
            prefix: ClientPrefix.V3,
        });

        return response;
    }

    /**
     * 获取房间密钥请求
     * GET /_matrix/client/v3/room_keys/request
     */
    async getRoomKeyRequests(options?: {
        status?: string;
        room_id?: string;
        session_id?: string;
        limit?: number;
        from?: string;
    }): Promise<RoomKeyRequestsResponse> {
        const params: Record<string, string> = {};
        if (options?.status) params.status = options.status;
        if (options?.room_id) params.room_id = options.room_id;
        if (options?.session_id) params.session_id = options.session_id;
        // P-11：`limit`/`from` 此前只声明不下发 ⇒ 分页失效（后端 `devices.rs:324` 支持二者）。
        if (options?.limit !== undefined) params.limit = String(options.limit);
        if (options?.from) params.from = options.from;

        const response = await this.request<RoomKeyRequestsResponse>({
            method: Method.Get,
            path: "/room_keys/request",
            queryParams: Object.keys(params).length > 0 ? params : undefined,
            prefix: ClientPrefix.V3,
        });

        if (response.requests) {
            this.emit(DeviceKeysEvent.RoomKeyRequested, response.requests);
        }

        return response;
    }

    /**
     * 删除房间密钥请求
     * DELETE /_matrix/client/v3/room_keys/request/{request_id}
     */
    async deleteRoomKeyRequest(requestId: string): Promise<void> {
        await this.request<void>({
            method: Method.Delete,
            path: `/room_keys/request/${encodeURIComponent(requestId)}`,
            prefix: ClientPrefix.V3,
        });
    }

    /**
     * 获取房间密钥分发
     * GET /_matrix/client/v3/rooms/{room_id}/keys/distribution
     */
    async getRoomKeyDistribution(roomId: string): Promise<KeyDistributionResponse> {
        return await this.request<KeyDistributionResponse>({
            method: Method.Get,
            path: `/rooms/${encodeURIComponent(roomId)}/keys/distribution`,
            prefix: ClientPrefix.V3,
        });
    }

    /**
     * 发送设备消息
     * PUT /_matrix/client/v3/sendToDevice/{event_type}/{transaction_id}
     */
    async sendToDevice(eventType: string, transactionId: string, messages: SendToDeviceMessage): Promise<void> {
        await this.request<void>({
            method: Method.Put,
            path: `/sendToDevice/${encodeURIComponent(eventType)}/${encodeURIComponent(transactionId)}`,
            body: { messages },
            prefix: ClientPrefix.V3,
        });
    }

    // ⚠️ 2026-10-07 删除 `getDeviceKeys(userId)`：它与本类已有的
    // `getUserDevices(userId)` 是**同一能力**（都走 `POST /keys/query`），
    // 两个方法并存只会让调用方猜该用哪个（`getUserDevices` 有真实消费者：
    // Tjg 的 `CryptoDeviceAdapter`）。原实现转发给 `client.getDeviceKeys()` ——
    // 那个方法在 MatrixClient 上并不存在。

    // 上传本设备的密钥。
    // 本 fork 没有 `client.uploadDeviceKeys`；真实入口是
    // `client.uploadKeysRequest({ device_keys })`（`POST /keys/upload`）。
    public async uploadDeviceKeys(keys: DeviceKeys): Promise<UploadKeysResponse> {
        return this.client.uploadKeysRequest({ device_keys: keys } as IUploadKeysRequest);
    }

    /**
     * Look up the device-key map of an arbitrary user.
     *
     * Delegates to {@link MatrixClient.getUserDevices}, which uses
     * `POST /keys/query` — the only endpoint able to resolve another user's
     * devices. (`GET /devices` is caller-scoped and cannot be used here.)
     *
     * @param userId - target MXID
     * @returns `deviceId → device content` map (empty object when none)
     */
    public async getUserDevices(userId: string): Promise<Record<string, IContent>> {
        return this.client.getUserDevices(userId);
    }

    // 本 fork 没有 `client.hasDevice`；等价物是 `DeviceManager` 的缓存查询
    // （`getCachedDevice` 先查已拉取的设备列表，未命中返回 null ⇒ 即"没有这个设备"）。
    public hasDevice(deviceId: string): boolean {
        return this.client.getDeviceManager().getCachedDevice(deviceId) !== null;
    }

    public async getDevice(deviceId: string): Promise<IDevice | null> {
        // ⚠️ 不要写成 `this.client.getDevice(...)`：本 fork 已把设备读取移进 DeviceManager，
        // 类型表里那条 `MatrixClient.getDevice` 是**上游残留声明**（运行时 undefined）。
        // 走已接线的 manager，才不会「类型检查通过、运行时 TypeError」。
        return this.client.getDeviceManager().getDevice(deviceId);
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getDeviceKeysManager = function (): DeviceKeysManager {
        registerManagerClass("deviceKeys", DeviceKeysManager);
        return getOrCreateManager(this, "deviceKeys", () => new DeviceKeysManager(this));
    };
}
